import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { PageSkeleton, ErrorPanel } from "@/front/components/layout/PageStates";
import { AuthGate } from "@/front/features/auth/AuthGate";
import { authMessageFor } from "@/front/features/auth/auth-messages";
import { useAuthSession } from "@/front/features/auth/useAuthSession";
import type { AuthSessionView } from "@/shared/contracts/auth";

/**
 * 演示模式：未登录也放行。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 本项目对外提交给官方的入口是 `https://zhihu-wenren.vercel.app/`，
 * 而知乎 OAuth 回调地址**必须**是报名表登记的那个值：
 *   https://zhihu-wenren.pages.dev/auth/callback
 * 两者不同域 ⇒ 回调完成后浏览器落在 pages.dev，会话 Cookie 也种在 pages.dev，
 * 从 vercel.app 发起授权拿不到会话。这是平台的硬约束，改代码绕不过去。
 *
 * 再加上 vercel.app 在境内 DNS 被污染（解析到 Facebook 的 IP 段），
 * 不挂代理根本打不开 —— 要求评委挂代理再登录，风险太高。
 *
 * 所以对黑客松演示这个场景，最稳的选择是**去掉登录门槛**：
 * 访客直接进入全部功能，产品价值（问人 / 领域星图 / 虚拟对话）一个不少。
 *
 * ── 明确不做什么 ────────────────────────────────────────────────────────
 * · 不伪造「已授权」状态：顶栏如实显示「访客」，
 *   不做「假装知道用户是谁」这种事（契约里 `user` 本就允许为 null）。
 * · 不删除 `AuthGate` 与授权链路：真实登录代码全部保留，
 *   把 `DEMO_BYPASS_AUTH` 置为 false（或删掉这个分支）即可恢复门禁。
 */

/**
 * 是否放行未登录访客。
 *
 * 默认开启（演示优先）。需要恢复真实门禁时，把它改成 `false` 即可 ——
 * 之所以做成常量而不是环境变量，是因为 SPA 是构建期静态产物，
 * 运行时读不到新的环境变量，改了得重新构建才会生效，反而更容易踩坑。
 */
const DEMO_BYPASS_AUTH = true;

/** 访客会话：结构与真实 session 一致，`user` 为 null，如实表达「未登录」 */
const GUEST_SESSION: AuthSessionView = {
  configured: true,
  authenticated: false,
  user: null,
};

/**
 * 受保护路由的统一门禁。
 *
 * 三态收敛在一处：
 *  - loading → 骨架屏（避免未登录时先闪一下登录页）
 *  - error   → 可重试的错误面板（后端挂了与未登录是两件事）
 *  - 未授权  → 演示模式下放行；否则走 `AuthGate`
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
    // 演示模式：未登录也放行，让评委无需授权即可体验全部功能
    if (DEMO_BYPASS_AUTH) {
      return <>{children(GUEST_SESSION)}</>;
    }
    return <AuthGate session={state.session} message={message} />;
  }

  return <>{children(state.session)}</>;
}
