import { useCallback, useEffect, useState } from "react";

import { ApiError, isAbortError } from "@/front/api/ApiError";
import { useApiClient, useAuthEpoch } from "@/front/app/api-context";
import type { AuthSessionView } from "@/shared/contracts/auth";

export type AuthSessionState =
  | { status: "loading" }
  | { status: "ready"; session: AuthSessionView }
  | { status: "error"; message: string; retryable: boolean };

const ANONYMOUS_SESSION: AuthSessionView = {
  configured: true,
  authenticated: false,
  user: null,
};

/**
 * 读取当前会话并对外暴露 Loading / Ready / Error 三态。
 *
 * 401 与「未登录」在语义上等价：README 中的授权流程图要求统一回到 AuthGate，
 * 因此这里不做「再刷新一次」的重试，避免与全局会话刷新相互递归。
 */
export function useAuthSession() {
  const client = useApiClient();
  const authEpoch = useAuthEpoch();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AuthSessionState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    client
      .getSession(controller.signal)
      .then((session) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", session });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || isAbortError(caught)) return;
        if (caught instanceof ApiError && caught.isAuthError) {
          setState({ status: "ready", session: ANONYMOUS_SESSION });
          return;
        }
        setState({
          status: "error",
          message:
            caught instanceof Error ? caught.message : "无法获取登录状态，请重试。",
          retryable: true,
        });
      });

    return () => controller.abort();
  }, [client, authEpoch, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { state, reload };
}
