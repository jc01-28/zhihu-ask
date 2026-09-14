import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/back/adapters/session';
import { handleOAuthStatus } from '@/back/handlers/oauth-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 路由壳：业务在 `@/back/handlers/oauth-status` */
export async function GET() {
  const result = await handleOAuthStatus({
    sessionToken: (await cookies()).get(SESSION_COOKIE)?.value,
  });
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}
