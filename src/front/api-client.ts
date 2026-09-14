/**
 * 前端 · API 客户端
 *
 * 前端**唯一**允许发 HTTP 请求的地方。端点路径与响应类型全部来自 `@/shared/contract`，
 * 所以后端改字段时只需要动「契约文件 + 这里」两处，页面组件不用动。
 *
 * 它替页面处理掉三件琐事：
 *   1. 统一信封解析（`{status:'success',data}` / `{error}`）—— 页面不用自己判 HTTP 状态码
 *   2. 统一把错误转成 `Error` —— 页面只需要 try/catch
 *   3. 端点常量集中 —— 不会出现散落各处的硬编码路径
 *
 * 后端还没就绪时，前端可以只依赖 `@/shared/contract` 的类型 + 一份样例响应先开发。
 */

import {
  API_ROUTES,
  type AskRequest,
  type AskResult,
  type HealthResponse,
  type OAuthStatusResponse,
} from '@/shared/contract';

/**
 * 统一的请求 + 信封拆包。所有导出函数都走这里，保证错误语义一致。
 *
 * 信封形状见 `@/shared/contract` 的 `ApiEnvelope`。这里从 `unknown` 手动收窄而不是直接断言成
 * 联合类型：响应来自网络，运行时什么都可能是，逐字段判类型比信任断言更稳。
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`响应不是合法 JSON（HTTP ${res.status}）`);
  }

  const env = payload as { status?: unknown; data?: unknown; error?: unknown } | null;
  if (!res.ok || !env || env.status !== 'success') {
    throw new Error(
      typeof env?.error === 'string' ? env.error : `请求失败 HTTP ${res.status}`,
    );
  }
  return env.data as T;
}

/** 一次提问 → 完整推荐结果。experiment 只在演示对照实验时传。 */
export function ask(payload: AskRequest, signal?: AbortSignal): Promise<AskResult> {
  return request<AskResult>(API_ROUTES.ask, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

/** 授权状态 + 凭证自查 + 当日额度 */
export function fetchOAuthStatus(): Promise<OAuthStatusResponse> {
  return request<OAuthStatusResponse>(API_ROUTES.oauthStatus, { cache: 'no-store' });
}

/** 健康检查。演示前用它确认当前在跑哪份语料。 */
export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>(API_ROUTES.health, { cache: 'no-store' });
}

/** 发起 OAuth 授权（整页跳转，不是 fetch） */
export const oauthAuthorizeUrl = API_ROUTES.oauthAuthorize;

/** 头像走同源代理，避免知乎图床的跨域/防盗链问题 */
export function imageProxyUrl(raw: string): string {
  return `${API_ROUTES.imageProxy}?url=${encodeURIComponent(raw)}`;
}
