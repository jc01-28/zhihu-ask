import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, isAbortError } from "@/front/api/ApiError";
import { useApiClient, useRefreshSession } from "@/front/app/api-context";
import {
  normalizeFieldQuery,
  planFieldQuery,
} from "@/front/features/fields/field-search";
import type { FieldSummary } from "@/shared/contracts/field";

export type FieldListStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type FieldListState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "ready"; query: string; items: FieldSummary[] }
  | { status: "empty"; query: string }
  | {
      status: "error";
      query: string;
      message: string;
      code: string;
      retryable: boolean;
    };

export type FeaturedState =
  | { status: "loading" }
  | { status: "ready"; items: FieldSummary[] }
  | { status: "error"; message: string; retryable: boolean };

/**
 * 领域目录的唯一状态源。
 *
 * 两条状态线彼此独立：
 *  - `featuredState`：推荐领域。只有在「推荐本身失败」时才进入 error；
 *    检索失败**不会**清空它，用户始终有东西可看。
 *  - `listState`  ：检索结果。状态固定为 idle | loading | ready | empty | error。
 *
 * 每次新检索都会先取消上一次请求，因此快速连续提交不会出现「后发先至」的错位结果。
 */
export function useFields() {
  const client = useApiClient();
  const refreshSession = useRefreshSession();

  const [featuredState, setFeaturedState] = useState<FeaturedState>({
    status: "loading",
  });
  const [listState, setListState] = useState<FieldListState>({ status: "idle" });
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const featuredAbort = useRef<AbortController | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const [featuredAttempt, setFeaturedAttempt] = useState(0);

  const loadFeatured = useCallback(async () => {
    featuredAbort.current?.abort();
    const controller = new AbortController();
    featuredAbort.current = controller;
    setFeaturedState({ status: "loading" });

    try {
      const items = await client.getFeaturedFields(controller.signal);
      if (controller.signal.aborted) return;
      setFeaturedState({ status: "ready", items });
    } catch (caught) {
      if (controller.signal.aborted || isAbortError(caught)) return;
      if (caught instanceof ApiError && caught.isAuthError) refreshSession();
      setFeaturedState({
        status: "error",
        message:
          caught instanceof Error ? caught.message : "推荐领域加载失败，请稍后重试。",
        retryable: caught instanceof ApiError ? caught.retryable : true,
      });
    }
  }, [client, refreshSession]);

  useEffect(() => {
    void loadFeatured();
    return () => featuredAbort.current?.abort();
  }, [loadFeatured, featuredAttempt]);

  const runSearch = useCallback(
    async (raw: string): Promise<FieldSummary[] | null> => {
      const plan = planFieldQuery(raw);
      if (plan.action === "clear") {
        searchAbort.current?.abort();
        setListState({ status: "idle" });
        setInputError(null);
        return null;
      }
      if (plan.action === "invalid") {
        setInputError(plan.message);
        return null;
      }

      setInputError(null);
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      setListState({ status: "loading", query: plan.query });

      try {
        const items = await client.searchFields(plan.query, undefined, controller.signal);
        if (controller.signal.aborted) return null;
        setListState(
          items.length === 0
            ? { status: "empty", query: plan.query }
            : { status: "ready", query: plan.query, items },
        );
        return items;
      } catch (caught) {
        if (controller.signal.aborted || isAbortError(caught)) return null;
        if (caught instanceof ApiError && caught.isAuthError) refreshSession();
        setListState({
          status: "error",
          query: plan.query,
          code: caught instanceof ApiError ? caught.code : "UNKNOWN_ERROR",
          message: caught instanceof Error ? caught.message : "领域检索失败，请稍后重试。",
          retryable: caught instanceof ApiError ? caught.retryable : true,
        });
        return null;
      }
    },
    [client, refreshSession],
  );

  /** 提交表单：等价于「按当前输入检索」。 */
  const submit = useCallback(
    () => runSearch(input),
    [input, runSearch],
  );

  /** 重试：重新执行当前查询，而不是清空条件。 */
  const retrySearch = useCallback(() => {
    if (listState.status === "error" || listState.status === "empty") {
      return runSearch(listState.query);
    }
    return runSearch(input);
  }, [input, listState, runSearch]);

  /** 清空检索条件，回到推荐领域。 */
  const clearSearch = useCallback(() => {
    searchAbort.current?.abort();
    setInput("");
    setInputError(null);
    setListState({ status: "idle" });
  }, []);

  const retryFeatured = useCallback(() => setFeaturedAttempt((value) => value + 1), []);

  useEffect(() => () => searchAbort.current?.abort(), []);

  return {
    input,
    setInput,
    inputError,
    listState,
    featuredState,
    /** 当前正在显示的查询（用于错误文案与重试）。 */
    activeQuery:
      listState.status === "idle" ? normalizeFieldQuery(input) : listState.query,
    submit,
    runSearch,
    retrySearch,
    clearSearch,
    retryFeatured,
  };
}

export type FieldsController = ReturnType<typeof useFields>;
