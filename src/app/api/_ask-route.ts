import { cookies } from 'next/headers';
import { toResponse } from './_bridge';
import { SESSION_COOKIE } from '@/back/adapters/session';
import { handleAsk } from '@/back/handlers/ask';
import { clientKey } from '@/back/framework/throttle';

/**
 * `/api/agent/search` 与已废弃的 `/api/ask` 共用的路由体。
 *
 * 抽出来是因为两个路径必须行为完全一致 —— 复制一份迟早会漂移
 * （改了限流参数只改一边，另一边的测试就变成假绿）。
 */
export async function askRoute(request: Request) {
  // JSON 解析失败不在这里处理，交给 handler 统一回信封（body: null）
  let body: { question?: unknown; experiment?: unknown } | null = null;
  try {
    body = (await request.json()) as { question?: unknown; experiment?: unknown };
  } catch {
    body = null;
  }

  // Next 15 起 cookies() 是异步 API
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;

  return toResponse(
    await handleAsk({ body, sessionToken, clientKey: clientKey(request) }),
    request.url,
  );
}
