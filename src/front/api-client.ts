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
  fieldGraphPath,
  type AskRequest,
  type AskResponse,
  type AuthSessionResponse,
  type FieldGraphResponse,
  type FieldSearchResponse,
  type FieldSummary,
  type HealthResponse,
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

/**
 * 一次提问 → 完整推荐结果（含六阶段进度）。
 * `experiment` 只在演示对照实验时传，平时留空走默认组。
 */
export function ask(payload: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
  return request<AskResponse>(API_ROUTES.agentSearch, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

/**
 * 登录状态。前端三分支全靠它：
 *   configured=false → 服务端未配置授权
 *   authenticated=false → 显示授权入口
 *   authenticated=true → 显示功能首页
 */
export function fetchAuthSession(): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>(API_ROUTES.session, { cache: 'no-store' });
}

/** 健康检查。演示前用它确认当前在跑哪份语料。 */
export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>(API_ROUTES.health, { cache: 'no-store' });
}

/** 发起授权：**整页跳转，不是 fetch**（用 window.location.assign） */
export const authLoginUrl = API_ROUTES.login;

/** 退出登录：同样是整页跳转，退出后会被 302 回 /app?auth=required */
export const authLogoutUrl = API_ROUTES.logout;

/** 头像走同源代理，避免知乎图床的跨域/防盗链问题 */
export function imageProxyUrl(raw: string): string {
  return `${API_ROUTES.imageProxy}?url=${encodeURIComponent(raw)}`;
}

// ── 领域域（专业领域社交）────────────────────────────────────────────────

/**
 * 推荐领域。返回顺序是产品定的展示顺序，**不要在前端重排**。
 *
 * `memberCount` / `topicCount` 是后端从真实语料算出来的，会随语料变化；
 * 演示前打 `/api/health` 可以看到当前跑的是哪份语料。
 */
export function fetchFeaturedFields(): Promise<FieldSummary[]> {
  return request<FieldSummary[]>(API_ROUTES.fieldsFeatured, { cache: 'no-store' });
}

/**
 * 领域搜索。
 *
 * ⚠️ 两件事：① 返回的是 `{ fields, total }` 不是数组（`total` 可能大于 `fields.length`）；
 * ② **只搜领域，不返回人物** —— 想找人请用 `ask()`，那是另一条路径。
 */
export function searchFields(query: string, limit = 12): Promise<FieldSearchResponse> {
  const qs = new URLSearchParams({ query, limit: String(limit) });
  return request<FieldSearchResponse>(`${API_ROUTES.fields}?${qs}`, { cache: 'no-store' });
}

/** 领域星图。节点的 `position` 后端已经算好，前端等比缩放到容器即可 */
export function fetchFieldGraph(fieldId: string): Promise<FieldGraphResponse> {
  return request<FieldGraphResponse>(fieldGraphPath(fieldId), { cache: 'no-store' });
}
