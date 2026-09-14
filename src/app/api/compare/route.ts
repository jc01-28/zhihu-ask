import { cookies } from 'next/headers';
import { toResponse } from '@/app/api/_bridge';
import { SESSION_COOKIE } from '@/back/adapters/session';
import { clientKey } from '@/back/framework/throttle';
import { handleCompare } from '@/back/handlers/agent';

export const runtime = 'nodejs';
// 对比接口把整条链路跑两遍（原文侧 + Agent 侧），比单次搜索更需要上限余量。
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * 三栏对比（原文侧 vs Agent 侧）。路由壳 —— 业务在 `@/back/handlers/agent`。
 *
 * ⚠️ 会**跑两遍检索**，额度消耗是单次搜索的两倍多。
 * 前端只应在用户显式点「对比」时调用，不要在页面加载时自动触发。
 */
export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  return toResponse(
    await handleCompare({ body, sessionToken, clientKey: clientKey(request) }),
    request.url,
  );
}
