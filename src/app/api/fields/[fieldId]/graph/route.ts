import { toResponse } from '@/app/api/_bridge';
import { handleFieldGraph } from '@/back/handlers/fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 领域星图。路由壳 —— 业务在 `@/back/handlers/fields`。
 *
 * Next 15 起动态段参数是异步的，所以要 `await params`。
 *
 * 响应里的 `position` 是**后端算好的确定性坐标**（0~1000 画布，中心 500,500），
 * 前端等比缩放即可；刷新页面位置不会变 —— 演示时这点很重要。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ fieldId: string }> },
) {
  const { fieldId } = await params;
  return toResponse(await handleFieldGraph(decodeURIComponent(fieldId)), request.url);
}
