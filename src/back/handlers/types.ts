/**
 * 路由处理器 · 通用形状
 *
 * 为什么不让 handler 直接返回 NextResponse：
 * 那样 handler 就绑死在 Next 上了 —— 想做「不启 HTTP 也能跑一遍业务逻辑」的测试就没办法。
 * 这里只回一个纯数据形状，由 `src/app/api/_bridge.ts` 翻译成框架响应。
 *
 * 同理，handler 也**不读 cookie、不读 header**：需要什么就让 route 层作为参数传进来。
 * 于是「HTTP 边界」与「业务边界」在代码里是两件可见的事。
 */

import { API_ERROR_CODES, type ApiErrorEnvelope } from '@/shared/contract';

/**
 * 一条 cookie 指令。形状是刻意跟框架无关的 —— 不 import `next/headers`，
 * 这样在纯 node 测试里也能直接断言「登录后会下发哪个 cookie」。
 */
export interface CookieInstruction {
  name: string;
  value: string;
  options?: {
    httpOnly?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    path?: string;
    maxAge?: number;
    secure?: boolean;
  };
  /** true = 删除该 cookie（清会话时用） */
  remove?: boolean;
}

export interface HandlerResult {
  status: number;
  body: unknown;
  /** 会原样成为响应头。`Location` 允许是相对路径，由桥接层补成绝对地址 */
  headers?: Record<string, string>;
  /** 需要下发的 cookie */
  cookies?: CookieInstruction[];
}

/** 成功响应：**载荷本身就是响应体**，不套 `{status, data}` 外壳 */
export function ok<T>(data: T): HandlerResult {
  return { status: 200, body: data };
}

/**
 * 失败响应：前端契约规定的错误信封 `{ code, message, retryable, details? }`。
 *
 * ⚠️ 前端用 zod `.strict()` 校验：**只允许这四个键**。所以不要往这里塞
 * `hint`、`trace`、`stack` 之类的诊断字段 —— 多一个键，前端会把整条响应
 * 判为 `INVALID_RESPONSE`，连 `code` 都读不到。
 *
 * `code` 是 `z.string()`，因此写未在契约里登记的码是合法的（前端会走兜底分支），
 * 但**能给语义正确的码就给** —— 那决定前端显示「重试按钮」还是「返回上一页」。
 */
export function fail(
  status: number,
  code: string,
  message: string,
  retryable = false,
  details?: unknown,
): HandlerResult {
  const body: ApiErrorEnvelope = { code, message, retryable };
  if (details !== undefined) body.details = details;
  return { status, body };
}

/** 限流：前端按 `RATE_LIMITED` 展示「稍后再试」，并读 `Retry-After` 做倒计时 */
export function tooMany(retryAfterSec: number, message: string): HandlerResult {
  return {
    status: 429,
    body: {
      code: API_ERROR_CODES.rateLimited,
      message,
      retryable: true,
    } satisfies ApiErrorEnvelope,
    headers: { 'Retry-After': String(retryAfterSec) },
  };
}

/**
 * 302 跳转。`location` 可以是相对路径（如 `/app?auth=success`）。
 *
 * 授权跳转需要 `Cache-Control: no-store` —— 否则浏览器/中间层可能缓存那次
 * 302，用户重复进入时会直接跳回旧的授权地址而拿不到新 state。
 */
export function redirect(location: string, cookies?: CookieInstruction[]): HandlerResult {
  return {
    status: 302,
    body: null,
    headers: { Location: location, 'Cache-Control': 'no-store' },
    cookies,
  };
}
