import { cookies } from 'next/headers';
import { toResponse } from '@/app/api/_bridge';
import { SESSION_COOKIE } from '@/back/adapters/session';
import { handleAuthSession } from '@/back/handlers/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 登录状态。路由壳 —— 业务在 `@/back/handlers/auth`。
 *
 * 前端三分支全靠这个接口：configured=false / authenticated=false / authenticated=true。
 */
export async function GET(request: Request) {
  // Next 15 起 cookies() 变成异步 API，必须 await
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  return toResponse(await handleAuthSession({ sessionToken }), request.url);
}
