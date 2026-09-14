import { toResponse } from '@/app/api/_bridge';
import { handleConsultationPackages } from '@/back/handlers/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 咨询套餐。**纯静态数据**，不查语料也不调模型，所以几乎不会失败。
 *
 * 金额单位是**人民币分**（契约写死的）。前端按 `currency: 'CNY'` 格式化显示，
 * 并明确标注「不会创建真实订单，也不会产生扣款」。
 */
export function GET(request: Request) {
  return toResponse(handleConsultationPackages(), request.url);
}
