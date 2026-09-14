import { toResponse } from '@/app/api/_bridge';
import { handleRunRestore } from '@/back/handlers/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 刷新页面后恢复上一次搜索结果。路由壳 —— 业务在 `@/back/handlers/agent`。
 *
 * 404 是有意义的信号：前端据此**静默清掉本地运行指针、回到 idle**，
 * 而不是弹红条 —— 用户只是刷新得晚了一点，没做错任何事。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  return toResponse(await handleRunRestore(decodeURIComponent(runId)), request.url);
}
