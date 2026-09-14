import type { z } from "zod";

import { ApiError, createAbortError } from "@/front/api/ApiError";
import { API_ERROR_CODES } from "@/shared/contracts/errors";

export type ParseNdjsonStreamInput<T> = {
  response: Response;
  schema: z.ZodType<T>;
  onEvent: (event: T) => void;
  signal?: AbortSignal;
  /** 终态判定：收到终态事件后立即结束读取。 */
  isTerminal: (event: T) => boolean;
};

function decodeLine<T>(line: string, schema: z.ZodType<T>): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * 逐行解析 NDJSON 流。
 *
 * 约定：
 * - 一个 chunk 可以包含多行；一行也可能被拆到两个 chunk。
 * - 空行跳过；非法 JSON 或不符合 Schema 的行一律丢弃，绝不交给 UI 渲染。
 * - 收到终态事件立刻结束，不再等待流自然关闭。
 * - 流结束后仍没有终态事件时抛出 INCOMPLETE_STREAM（调用方需先判断是否已取消）。
 */
export async function parseNdjsonStream<T>(
  input: ParseNdjsonStreamInput<T>,
): Promise<T> {
  const { response, schema, onEvent, signal, isTerminal } = input;

  if (!response.body) {
    throw new ApiError({
      code: API_ERROR_CODES.streamUnavailable,
      message: "服务端没有返回可读取的流式响应。",
      retryable: true,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // fetch 的 signal 通常会直接中断底层流；这里额外兜底，
  // 保证注入的假 Response（测试）也能在取消时立即结束读取。
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const consumeLine = (rawLine: string): T | null => {
    const line = rawLine.trim();
    if (!line) return null;
    const event = decodeLine(line, schema);
    if (!event) return null;
    onEvent(event);
    return isTerminal(event) ? event : null;
  };

  try {
    for (;;) {
      if (signal?.aborted) throw createAbortError();

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (caught) {
        // 流推到一半被掐断：底层实现抛的是 TypeError
        // （undici 是 "terminated"，浏览器是 "Failed to fetch"）。
        // 这必须收敛成 ApiError——否则调用方会把它当成一般 Error，
        // 把 `error.message` 原样显示出来，界面上就出现一句英文技术错误。
        if (signal?.aborted) throw createAbortError();
        throw new ApiError({
          code: API_ERROR_CODES.networkError,
          message: "连接中断，没有收到完整结果，请重试。",
          retryable: true,
          cause: caught,
        });
      }

      const { value, done } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const terminal = consumeLine(rawLine);
        if (terminal) {
          await reader.cancel().catch(() => undefined);
          return terminal;
        }
      }
    }

    // 最后一行可能没有换行符，需要在流结束后单独处理。
    const tail = consumeLine(buffer);
    if (tail) return tail;
    buffer = "";
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // 流已被 cancel 时释放锁会抛错，忽略即可。
    }
  }

  if (signal?.aborted) throw createAbortError();

  throw new ApiError({
    code: API_ERROR_CODES.streamIncomplete,
    message: "连接中断，没有收到完整结果，请重试。",
    retryable: true,
  });
}
