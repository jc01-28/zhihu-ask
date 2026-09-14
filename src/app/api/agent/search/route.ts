import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/back/adapters/session';
import { clientKey } from '@/back/framework/throttle';
import { handleAgentSearch } from '@/back/handlers/agent';
import type { SearchAgentEvent } from '@/shared/contract';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 问题找人 —— **NDJSON 流式**。路由壳，业务在 `@/back/handlers/agent`。
 *
 * 三个必须注意的点：
 *
 * 1. **每写一行立刻推给下游**，不要攒着最后一起发。攒着发的话前端会在最后一刻
 *    拿到全部进度，等于没有流式 —— 进度条从 0 跳到 100，用户只觉得更卡。
 * 2. **Content-Type 必须是 `application/x-ndjson`**，前端据此选择流式解析器。
 * 3. **必须带 `no-transform` / `X-Accel-Buffering: no`**：
 *    中间的 nginx / 云平台默认会缓冲响应体，一旦被缓冲，流式同样失效。
 *
 * ⚠️ HTTP 状态**恒为 200**：流一旦开始写就改不了状态码，
 * 所以失败通过流内的 `run.failed` 事件表达（契约里本就有这个事件）。
 */
export async function POST(request: Request) {
  // JSON 解析失败不在这里报错，交给 handler 统一转成 run.failed
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  // Next 15 起 cookies() 是异步 API
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SearchAgentEvent) => {
        // NDJSON：一行一个 JSON，行尾必须是 \n —— 前端就是按行切分的
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await handleAgentSearch({
          body,
          sessionToken,
          clientKey: clientKey(request),
          emit,
        });
      } catch (error) {
        // handler 内部已把业务失败转成 run.failed；能走到这里说明兜底也挂了。
        // 仍要保证流里有**终止事件**，否则前端会一直等一个不会来的结尾。
        console.error('[agent/search] 流处理异常：', error);
        try {
          emit({
            type: 'run.failed',
            error: {
              code: 'INTERNAL_ERROR',
              message: '搜索过程中发生未知错误',
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
