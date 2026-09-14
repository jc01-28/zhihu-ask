import { NextResponse } from 'next/server';
import type { HandlerResult } from '@/back/handlers/types';

/**
 * 把「框架无关的处理结果」翻译成 Next 响应。
 *
 * 所有 `api/**\/route.ts` 都用这一个函数收口，于是：
 *   - 路由壳永远只有几行，**不可能**混进业务逻辑（这正是分层的意义）
 *   - 加 cookie / 加响应头 / 改状态码都只改这一处
 *
 * 放在 `_` 前缀文件里是刻意的：Next 只把 `route.ts` / `page.tsx` 当路由，
 * 其他文件都是普通模块，可以放心当私有工具用。
 */
export function toResponse(result: HandlerResult, requestUrl: string): NextResponse {
  const location = result.headers?.Location;
  let response: NextResponse;

  if (result.status === 301 || result.status === 302) {
    // Location 允许是相对路径（如 /app?auth=success），但 NextResponse.redirect 要求绝对地址
    const absolute = location
      ? location.startsWith('http')
        ? location
        : new URL(location, requestUrl).toString()
      : requestUrl;

    response = NextResponse.redirect(absolute, result.status);
    // 跳转响应上除 Location 外的自定义头也一并带上
    for (const [key, value] of Object.entries(result.headers ?? {})) {
      if (key.toLowerCase() !== 'location') response.headers.set(key, value);
    }
  } else {
    response = NextResponse.json(result.body, {
      status: result.status,
      headers: result.headers,
    });
  }

  for (const cookie of result.cookies ?? []) {
    if (cookie.remove) {
      response.cookies.delete(cookie.name);
    } else {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
  }

  return response;
}
