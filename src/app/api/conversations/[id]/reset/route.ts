import { toResponse } from '@/app/api/_bridge';
import { handleResetConversation } from '@/back/handlers/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 重置会话：清空消息、咨询回到「免费交流」。
 *
 * ⚠️ **会话 id 不变**（它是从用户+人物+来源运行派生的），
 * 所以前端成功后的动作是「整体替换 conversation 与 messages」，不是跳新路由。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return toResponse(await handleResetConversation(decodeURIComponent(id)), request.url);
}
