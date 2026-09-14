import { toResponse } from '@/app/api/_bridge';
import { handleAuthLogin } from '@/back/handlers/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 发起知乎授权。**整页跳转，不是 fetch** ——
 * 前端用 `window.location.assign(API_ROUTES.login)`，本接口 302 到知乎授权页。
 *
 * 路由壳：业务在 `@/back/handlers/auth`。
 */
export async function GET(request: Request) {
  return toResponse(await handleAuthLogin(), request.url);
}
