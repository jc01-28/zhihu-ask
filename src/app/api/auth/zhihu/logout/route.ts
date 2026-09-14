import { toResponse } from '@/app/api/_bridge';
import { handleAuthLogout } from '@/back/handlers/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 退出登录。路由壳 —— 业务在 `@/back/handlers/auth`。
 *
 * GET 与 POST 都接：
 *   - GET  方便前端直接用 `<a href>` 或整页跳转
 *   - POST 方便表单语义
 * 退出后 302 回 `/app?auth=required`，前端据此显示授权入口。
 */
export async function GET(request: Request) {
  return toResponse(await handleAuthLogout(), request.url);
}

export const POST = GET;
