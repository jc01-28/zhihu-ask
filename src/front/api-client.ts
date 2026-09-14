/**
 * 前端 · API 客户端
 *
 * 前端**唯一**允许发 HTTP 请求的地方。端点路径与响应类型全部来自 `@/shared/contract`。
 *
 * ⚠️ **这个文件即将被废弃**：正式前端是队友那套独立 SPA
 * （`origin/front` 分支的 `src/frontend/`），本仓库的 Next.js 侧退为**纯 API**。
 * 保留它只是为了在页面移除之前让仓库仍能编译，不要在此基础上继续开发。
 *
 * 它替页面处理掉三件琐事：
 *   1. 响应解析（成功 = 载荷本身；失败 = `{code,message,retryable}`）
 *   2. 统一把错误转成 `Error`（并把 code/retryable 挂上去）—— 页面只需要 try/catch
 *   3. 端点常量集中 —— 不会出现散落各处的硬编码路径
 */

import {
  API_ROUTES,
  fieldGraphPath,
  type AskRequest,
  type AskResponse,
  type AuthSessionResponse,
  type FieldGraphResponse,
  type FieldListResponse,
  type FieldSummary,
  type HealthResponse,
} from '@/shared/contract';

/**
 * 统一的请求。所有导出函数都走这里，保证错误语义一致。
 *
 * 响应形状由**前端契约**决定：
 *   · 成功 → **响应体就是载荷本身**，没有 `{status:'success', data}` 外壳
 *   · 失败 → `{ code, message, retryable, details? }`
 *
 * 这里从 `unknown` 手动收窄而不是断言：响应来自网络，运行时什么都可能是。
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

  if (!res.ok) {
    const err = payload as { code?: unknown; message?: unknown; retryable?: unknown } | null;
    const failure = new Error(
      typeof err?.message === 'string' ? err.message : `请求失败 HTTP ${res.status}`,
    ) as Error & { code?: string; retryable?: boolean };
    // code 决定界面显示「重试」还是「返回上一页」，别丢
    if (typeof err?.code === 'string') failure.code = err.code;
    if (typeof err?.retryable === 'boolean') failure.retryable = err.retryable;
    throw failure;
  }

  return payload as T;
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
/**
 * 推荐领域。返回顺序是产品定的展示顺序，**不要在前端重排**。
 *
 * ⚠️ 返回的是 `{ items }` 而不是数组 —— 契约如此。
 */
export function fetchFeaturedFields(): Promise<FieldListResponse> {
  return request<FieldListResponse>(API_ROUTES.fieldsFeatured, { cache: 'no-store' });
}

/**
 * 领域搜索。
 *
 * ⚠️ 两件事：① 返回 `{ items }`；② **只搜领域，不返回人物** ——
 * 想找人请用 `ask()`，那是另一条路径。
 */
export function searchFields(query: string, limit = 12): Promise<FieldListResponse> {
  const qs = new URLSearchParams({ query, limit: String(limit) });
  return request<FieldListResponse>(`${API_ROUTES.fields}?${qs}`, { cache: 'no-store' });
}

/** 领域星图。节点的 `position` 后端已经算好，前端等比缩放到容器即可 */
export function fetchFieldGraph(fieldId: string): Promise<FieldGraphResponse> {
  return request<FieldGraphResponse>(fieldGraphPath(fieldId), { cache: 'no-store' });
}
