import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, isAbortError } from "@/front/api/ApiError";
import { useApiClient, useRefreshSession } from "@/front/app/api-context";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import type { FieldGraphResponse } from "@/shared/contracts/field";

export type FieldGraphState =
  | { status: "loading" }
  | { status: "ready"; graph: FieldGraphResponse }
  | { status: "not-found"; message: string }
  | { status: "error"; message: string; retryable: boolean };

/**
 * 领域星图的数据状态。
 *
 * 404 与其它错误分开：领域不存在时页面应该给「返回领域目录」而不是「重试」，
 * 否则用户会反复点一个永远不可能成功的按钮。
 */
export function useFieldGraph(fieldId: string) {
  const client = useApiClient();
  const refreshSession = useRefreshSession();
  const [state, setState] = useState<FieldGraphState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!fieldId) {
      setState({ status: "not-found", message: "没有指定领域。" });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "loading" });

    client
      .getFieldGraph(fieldId, controller.signal)
      .then((graph) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", graph });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || isAbortError(caught)) return;
        if (caught instanceof ApiError && caught.isAuthError) {
          refreshSession();
        }
        const notFound =
          caught instanceof ApiError &&
          (caught.status === 404 || caught.code === API_ERROR_CODES.fieldNotFound);

        if (notFound) {
          setState({
            status: "not-found",
            message:
              caught instanceof Error ? caught.message : "这个领域不存在或已下线。",
          });
          return;
        }
        setState({
          status: "error",
          message:
            caught instanceof Error ? caught.message : "领域星图加载失败，请稍后重试。",
          retryable: caught instanceof ApiError ? caught.retryable : true,
        });
      });

    return () => controller.abort();
  }, [client, fieldId, refreshSession, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { state, reload };
}
