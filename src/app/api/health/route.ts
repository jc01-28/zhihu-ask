import { toResponse } from '@/app/api/_bridge';
import { handleHealth } from '@/back/handlers/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 路由壳：业务在 `@/back/handlers/health` */
export async function GET(request: Request) {
  return toResponse(await handleHealth(), request.url);
}
