import { cookies } from 'next/headers';
import { toResponse } from '@/app/api/_bridge';
import { STATE_COOKIE } from '@/back/adapters/session';
import { handleAuthCallback } from '@/back/handlers/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 知乎 OAuth 回调。路由壳 —— 业务在 `@/back/handlers/auth`。
 *
 * ⚠️ 这个路径必须与 `ZHIHU_REDIRECT_URI` **逐字符一致**，且在开放平台登记过。
 *
 * 无论成功失败都 302 回 `/app?auth=<码>`，让用户永远落在能操作的页面上
 * （旧实现失败时返回 JSON，用户会看到一屏原始报错）。
 */
export async function GET(request: Request) {
  const stateCookie = (await cookies()).get(STATE_COOKIE)?.value;
  const params = new URL(request.url).searchParams;
  return toResponse(await handleAuthCallback({ params, stateCookie }), request.url);
}
