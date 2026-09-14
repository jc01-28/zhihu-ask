import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/back/adapters/session';
import { clientKey } from '@/back/framework/throttle';
import { handleAsk } from '@/back/handlers/ask';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * ⚠️ 这是**路由壳**：只把 HTTP 上下文拍平成参数，业务在 `@/back/handlers/ask`。
 * 不要在这一层写业务逻辑 —— 写了就没法脱离 Next 做测试。
 */
export async function POST(request: Request) {
  // JSON 解析失败不在这里处理，交给 handler 统一回信封（body: null）
  let body: { question?: unknown; experiment?: unknown } | null = null;
  try {
    body = (await request.json()) as { question?: unknown; experiment?: unknown };
  } catch {
    body = null;
  }

  // Next 15 起 cookies() 变成异步 API，必须 await
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;

  const result = await handleAsk({ body, sessionToken, clientKey: clientKey(request) });

  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}
