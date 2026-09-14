import { cookies } from 'next/headers';
import { toResponse } from '@/app/api/_bridge';
import { SESSION_COOKIE } from '@/back/adapters/session';
import {
  GUEST_COOKIE,
  handleListMessages,
  handleSendMessage,
} from '@/back/handlers/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 消息列表（游标分页）。路由壳 —— 业务在 `@/back/handlers/conversations`。 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  return toResponse(
    await handleListMessages({
      id: decodeURIComponent(id),
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit'),
    }),
    request.url,
  );
}

/**
 * 发消息。**按 `clientMessageId` 幂等** —— 同一个 id 重复提交不会产生第二条，
 * 这是前端断线重发的安全网。
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

  const jar = await cookies();
  const input = (body ?? {}) as {
    clientMessageId?: unknown;
    actorRole?: unknown;
    content?: unknown;
  };

  return toResponse(
    await handleSendMessage({
      id: decodeURIComponent(id),
      clientMessageId: typeof input.clientMessageId === 'string' ? input.clientMessageId : '',
      actorRole: typeof input.actorRole === 'string' ? input.actorRole : '',
      content: typeof input.content === 'string' ? input.content : '',
      sessionToken: jar.get(SESSION_COOKIE)?.value,
      guestId: jar.get(GUEST_COOKIE)?.value,
    }),
    request.url,
  );
}
