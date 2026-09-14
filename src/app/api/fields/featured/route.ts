import { toResponse } from '@/app/api/_bridge';
import { handleFeaturedFields } from '@/back/handlers/fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 推荐领域列表。路由壳 —— 业务在 `@/back/handlers/fields`。
 *
 * 返回顺序即 `FIELD_SEEDS` 的定义顺序（产品决定的展示顺序），不按人数排序。
 */
export async function GET(request: Request) {
  return toResponse(await handleFeaturedFields(), request.url);
}
