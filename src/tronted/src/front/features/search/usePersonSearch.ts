import { useCallback, useEffect, useReducer, useRef } from "react";

import { ApiError, isAbortError } from "@/front/api/ApiError";
import { useApiClient, useRefreshSession } from "@/front/app/api-context";
import type { SearchAgentEvent } from "@/shared/contracts/agent";
import type { SearchRequest } from "@/shared/contracts/search";

import {
  createInitialSearchState,
  personSearchReducer,
  restoreResponseToResult,
  validateQuery,
} from "@/front/features/search/search-state";
import {
  readSessionText,
  readText,
  removeSessionText,
  writeSessionText,
  writeText,
  STORAGE_KEYS,
} from "@/front/shared/storage";

/** sessionStorage 里的运行指针：存 runId 与查询词，不存结果本身。 */
type StoredRun = { runId: string; query: string };

function parseStoredRun(raw: string | null): StoredRun | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as StoredRun).runId === "string" &&
      typeof (parsed as StoredRun).query === "string"
    ) {
      return parsed as StoredRun;
    }
  } catch {
    // 脏数据一律当作没有：重新搜索即可恢复。
  }
  return null;
}

/**
 * 找人搜索的唯一状态源。
 *
 * 规则：
 * - 每次搜索创建新的 AbortController，开始新搜索前先取消旧请求；
 * - 取消后回到 idle，不显示错误红条，也不清空输入；
 * - 只有 `run.completed` 能写入 result；
 * - 刷新后若本会话拿到过运行，用 `restoreRun` 重新向服务端要一次结果，
 *   而不是把结果缓存在本机（业务真相始终在服务端）。
 */
export function usePersonSearch(initialQuery: string) {
  const client = useApiClient();
  const refreshSession = useRefreshSession();
  const [state, dispatch] = useReducer(
    personSearchReducer,
    initialQuery,
    createInitialSearchState,
  );
  const abortRef = useRef<AbortController | null>(null);
  const draftReadyRef = useRef(false);

  // 草稿只用于恢复未发送的输入，业务真相永远来自 API。
  useEffect(() => {
    const draft = readText(STORAGE_KEYS.searchDraft);
    if (draft) dispatch({ type: "query.changed", query: draft });
    draftReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!draftReadyRef.current) return;
    writeText(STORAGE_KEYS.searchDraft, state.query);
  }, [state.query]);

  // 刷新恢复：读取本次会话的运行指针，再向服务端换取结果。
  useEffect(() => {
    const stored = parseStoredRun(readSessionText(STORAGE_KEYS.lastSearchRun));
    if (!stored) return;

    const controller = new AbortController();
    client
      .restoreRun(stored.runId, controller.signal)
      .then((run) => {
        if (controller.signal.aborted) return;
        const result = restoreResponseToResult(run);
        dispatch({ type: "query.changed", query: stored.query });
        dispatch({ type: "run.restored", result, query: stored.query });
      })
      .catch(() => {
        // 运行已过期或存储不可用：清掉指针，静默回到「可以重新搜索」的状态。
        // 这里刻意不显示错误红条——用户什么都没做错，输入框里还留着上次的问题。
        if (!controller.signal.aborted) removeSessionText(STORAGE_KEYS.lastSearchRun);
      });

    return () => controller.abort();
  }, [client]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const setQuery = useCallback((query: string) => {
    dispatch({ type: "query.changed", query });
  }, []);

  const stopSearch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runSearch = useCallback(
    async (override?: string) => {
      const nextQuery = (override ?? state.query).trim();
      const invalid = validateQuery(nextQuery);
      if (invalid) {
        dispatch({ type: "query.rejected", message: invalid });
        return null;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // 开新搜索就先丢掉旧指针，避免刷新时把上一次的结果当成这一次的。
      removeSessionText(STORAGE_KEYS.lastSearchRun);
      dispatch({ type: "run.started", query: nextQuery });

      const payload: SearchRequest = {
        query: nextQuery,
        sessionId: crypto.randomUUID(),
        mode: "auto",
      };

      try {
        const completed = await client.streamSearch(
          payload,
          (event: SearchAgentEvent) => {
            if (event.type === "step.started" || event.type === "step.completed") {
              dispatch({ type: "step", event });
            }
          },
          controller.signal,
        );
        if (controller.signal.aborted) return null;
        dispatch({ type: "run.completed", result: completed.result });
        // 只有服务端明确存下来了，才写指针：否则刷新时必然 404。
        if (completed.result.runId && completed.result.persistence === "saved") {
          writeSessionText(
            STORAGE_KEYS.lastSearchRun,
            JSON.stringify({ runId: completed.result.runId, query: nextQuery }),
          );
        }
        return completed.result;
      } catch (caught) {
        if (controller.signal.aborted || isAbortError(caught)) {
          dispatch({ type: "run.aborted" });
          return null;
        }
        if (caught instanceof ApiError && caught.isAuthError) {
          // 授权失效：收敛到全局会话刷新，由 AuthGate 接管下一步。
          dispatch({
            type: "run.failed",
            error: {
              code: caught.code,
              message: "知乎授权已失效，请重新授权后再试。",
              retryable: false,
            },
          });
          refreshSession();
          return null;
        }
        dispatch({
          type: "run.failed",
          error: {
            code: caught instanceof ApiError ? caught.code : "UNKNOWN_ERROR",
            message:
              caught instanceof Error ? caught.message : "搜索失败，请稍后重试。",
            retryable: caught instanceof ApiError ? caught.retryable : true,
          },
        });
        return null;
      }
    },
    [client, refreshSession, state.query],
  );

  const selectSample = useCallback(
    (sample: string) => {
      abortRef.current?.abort();
      // 结果被清空，指针也必须同步失效，否则刷新后会「复活」上一次的结果。
      removeSessionText(STORAGE_KEYS.lastSearchRun);
      dispatch({ type: "sample.selected", query: sample });
    },
    [],
  );

  const reset = useCallback(() => {
    removeSessionText(STORAGE_KEYS.lastSearchRun);
    dispatch({ type: "reset" });
  }, []);

  return { state, setQuery, runSearch, stopSearch, selectSample, reset };
}

export type PersonSearchController = ReturnType<typeof usePersonSearch>;
