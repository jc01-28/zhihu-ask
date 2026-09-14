import { toResponse } from '@/app/api/_bridge';
import { handleConsultationAction } from '@/back/handlers/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 提交咨询动作。路由壳 —— 业务（状态机）在 `@/back/domain/consultation`。
 *
 * **状态由后端持有**：前端只提交 `action`，不推导下一状态。
 * 非法流转返回 409，并把当前完整的 `Consultation` 放进 `details` 供前端回正。
 *
 * ⚠️ 这是**模拟支付**：不接受任何银行卡 / 手机号 / 身份证字段，
 * 不创建真实订单，不产生扣款。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const input = (body ?? {}) as {
    action?: unknown;
    actorRole?: unknown;
    packageId?: unknown;
  };

  return toResponse(
    await handleConsultationAction({
      id: decodeURIComponent(id),
      action: typeof input.action === 'string' ? input.action : '',
      actorRole: typeof input.actorRole === 'string' ? input.actorRole : '',
      packageId: typeof input.packageId === 'string' ? input.packageId : undefined,
    }),
    request.url,
  );
}
