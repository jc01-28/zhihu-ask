import { clientKey } from '@/back/framework/throttle';
import { runConversationAgent } from '@/back/handlers/conversations';
import type { ConversationAgentEvent } from '@/shared/contract';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 会话内 Agent —— **NDJSON 流式**。路由壳，业务在 `@/back/handlers/conversations`。
 *
 * 与 `/api/agent/search` 是**两套协议**：那边发检索阶段，这边发消息增量。
 * 共同的只有三件事：一行一个 JSON、写完立刻 flush、失败也要发终止事件。
 *
 * ⚠️ HTTP 状态**恒为 200**：流一开始就改不了状态码，失败一律走
 * 流内的 `agent.run.failed`。
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

  const input = (body ?? {}) as { clientMessageId?: unknown; content?: unknown };
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ConversationAgentEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await runConversationAgent(
          {
            id: decodeURIComponent(id),
            clientMessageId:
              typeof input.clientMessageId === 'string' ? input.clientMessageId : '',
            content: typeof input.content === 'string' ? input.content : '',
            clientKey: clientKey(request),
          },
          emit,
        );
      } catch (error) {
        console.error('[conversations/agent-runs] 流处理异常：', error);
        try {
          emit({
            type: 'agent.run.failed',
            requestId: 'unknown',
            error: {
              code: 'INTERNAL_ERROR',
              message: '生成回应时发生未知错误',
              retryable: true,
            },
          });
        } catch {
          /* 流已被下游关闭，忽略 */
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
