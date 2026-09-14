import { toResponse } from '@/app/api/_bridge';
import { handleCreatorDetail } from '@/back/handlers/creators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 人物公开资料。路由壳 —— 业务在 `@/back/handlers/creators`。
 *
 * 领域星图与问题找人**共用这一个出口**，返回同一份 `CreatorCard`。
 * 所以前端两个入口打开的是同一个名片组件，形状必须完全一致。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ creatorId: string }> },
) {
  const { creatorId } = await params;
  return toResponse(await handleCreatorDetail(decodeURIComponent(creatorId)), request.url);
}
