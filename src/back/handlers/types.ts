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

/** 走「统一信封」的成功响应 */
export function ok<T>(data: T): HandlerResult {
  return { status: 200, body: { status: 'success', data } };
}

/** 走「统一信封」的错误响应 */
export function fail(status: number, error: string, hint?: string): HandlerResult {
  return { status, body: hint ? { error, hint } : { error } };
}

/** 限流响应（带 Retry-After 头） */
export function tooMany(retryAfterSec: number, hint: string): HandlerResult {
  return {
    status: 429,
    body: { error: `请求过于频繁，请 ${retryAfterSec} 秒后再试`, hint },
    headers: { 'Retry-After': String(retryAfterSec) },
  };
}

/** 302 跳转。`location` 可以是相对路径（如 `/app?auth=success`） */
export function redirect(location: string, cookies?: CookieInstruction[]): HandlerResult {
  return { status: 302, body: null, headers: { Location: location }, cookies };
}
