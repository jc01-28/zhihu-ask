import { NextResponse } from 'next/server';
import { handleHealth } from '@/back/handlers/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 路由壳：业务在 `@/back/handlers/health` */
export async function GET() {
  const result = await handleHealth();
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}
