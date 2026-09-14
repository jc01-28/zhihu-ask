import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { PageSkeleton, ErrorPanel } from "@/front/components/layout/PageStates";
import { AuthGate } from "@/front/features/auth/AuthGate";
import { authMessageFor } from "@/front/features/auth/auth-messages";
import { useAuthSession } from "@/front/features/auth/useAuthSession";
import type { AuthSessionView } from "@/shared/contracts/auth";

/**
 * 受保护路由的统一门禁。
 *
 * 三态收敛在一处：
 *  - loading → 骨架屏（避免未登录时先闪一下登录页）
 *  - error   → 可重试的错误面板（后端挂了与未登录是两件事）
 *  - 未授权  → `AuthGate`，且不提供任何绕过入口
 *
 * 授权后的页面通过 render prop 拿到已确认的会话，因此不需要各自再查一次会话。
 */
export function RequireAuth({
  children,
}: {
  children: (session: AuthSessionView) => ReactNode;
}) {
  const { state, reload } = useAuthSession();
  const [searchParams] = useSearchParams();
  const message = authMessageFor(searchParams.get("auth"));

  if (state.status === "loading") {
    return <PageSkeleton label="正在读取登录状态" />;
  }

  if (state.status === "error") {
    return (
      <ErrorPanel
        title="无法读取登录状态"
        message={state.message}
        retryable={state.retryable}
        onRetry={reload}
      />
    );
  }

  if (!state.session.configured || !state.session.authenticated) {
    return <AuthGate session={state.session} message={message} />;
  }

  return <>{children(state.session)}</>;
}
