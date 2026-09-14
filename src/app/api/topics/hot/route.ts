import { toResponse } from '@/app/api/_bridge';
import { handleHotTopics } from '@/back/handlers/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 热榜选题。路由壳 —— 业务在 `@/back/handlers/agent`。
 *
 * ⚠️ 它**只作提问参考，不参与人物推荐**。拿不到时返回空列表 + `unavailable: true`，
 * 由前端隐藏整个热榜区，而不是报错。
 */
export async function GET(request: Request) {
  return toResponse(await handleHotTopics(), request.url);
}
