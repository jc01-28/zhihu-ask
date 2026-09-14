import { cookies } from 'next/headers';
import { toResponse } from '@/app/api/_bridge';
import { SESSION_COOKIE } from '@/back/adapters/session';
import { GUEST_COOKIE, handleCreateConversation } from '@/back/handlers/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 创建（或幂等恢复）会话。路由壳 —— 业务在 `@/back/handlers/conversations`。
 *
 * **不要求登录**：前端聊天页 `/app/chat/:id` 是唯一没挂 `RequireAuth` 的路由，
 * 未登录时用一枚 `zh_guest` cookie 维持稳定的访客身份。
 */
export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const jar = await cookies();
  const input = (body ?? {}) as { creatorId?: unknown; sourceRunId?: unknown };

  return toResponse(
    await handleCreateConversation({
      creatorId: typeof input.creatorId === 'string' ? input.creatorId : '',
      sourceRunId: typeof input.sourceRunId === 'string' ? input.sourceRunId : null,
      sessionToken: jar.get(SESSION_COOKIE)?.value,
      guestId: jar.get(GUEST_COOKIE)?.value,
    }),
    request.url,
  );
}
