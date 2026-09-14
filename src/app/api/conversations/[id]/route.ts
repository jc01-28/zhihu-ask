import { toResponse } from '@/app/api/_bridge';
import { handleGetConversation } from '@/back/handlers/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 读取单个会话。路由壳 —— 业务在 `@/back/handlers/conversations`。 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return toResponse(await handleGetConversation(decodeURIComponent(id)), request.url);
}
