import { NextResponse } from 'next/server';
import { SESSION_COOKIE, STATE_COOKIE } from '@/back/adapters/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 退出授权：清掉本地会话。注意知乎当前没有提供 token 撤销接口。 */
export async function POST() {
  const response = NextResponse.json({ status: 'ok' });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
