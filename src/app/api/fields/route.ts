import { toResponse } from '@/app/api/_bridge';
import { handleSearchFields } from '@/back/handlers/fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 领域搜索。路由壳 —— 业务在 `@/back/handlers/fields`。
 *
 * `GET /api/fields?query=训练大模型&limit=12`
 *
 * ⚠️ **只搜领域，不返回人物**。这是「领域搜索 → 找领域」与「问题搜索 → 找人」
 * 两条路径的边界；破了它，两个功能就糊在一起了。
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return toResponse(
    await handleSearchFields({
      query: params.get('query') ?? '',
      limit: Number(params.get('limit') ?? 12),
    }),
    request.url,
  );
}
