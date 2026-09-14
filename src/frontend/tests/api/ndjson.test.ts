import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { ApiError } from "@/front/api/ApiError";
import { parseNdjsonStream } from "@/front/api/ndjson";
import { searchAgentEventSchema, type SearchAgentEvent } from "@/shared/contracts/agent";
import { API_ERROR_CODES } from "@/shared/contracts/errors";

const requestId = "00000000-0000-4000-8000-000000000011";

const started = JSON.stringify({ type: "run.started", requestId });
const stepStarted = JSON.stringify({
  type: "step.started",
  step: "understanding",
  message: "提取处境、目标与关键约束",
});
const stepCompleted = JSON.stringify({
  type: "step.completed",
  step: "understanding",
  message: "提取处境、目标与关键约束",
});

function encode(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

/** 永不结束的流，用于验证取消行为。 */
function hangingResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${started}\n`));
    },
  });
  return new Response(stream, { status: 200 });
}

function collect(schema: z.ZodType<SearchAgentEvent>) {
  const events: SearchAgentEvent[] = [];
  return {
    events,
    onEvent: (event: SearchAgentEvent) => {
      events.push(event);
    },
    schema,
  };
}

const isTerminal = (event: SearchAgentEvent) =>
  event.type === "run.completed" || event.type === "run.failed";

describe("parseNdjsonStream", () => {
  it("一个 chunk 里的多行都会按顺序派发", async () => {
    const { events, onEvent } = collect(searchAgentEventSchema);
    const response = encode([`${started}\n${stepStarted}\n${stepCompleted}\n`]);

    const terminal = await parseNdjsonStream({
      response,
      schema: searchAgentEventSchema,
      onEvent,
      isTerminal,
    }).catch((error: unknown) => error);

    // 没有终态事件：必须抛出 INCOMPLETE_STREAM，而不是静默成功。
    expect(terminal).toBeInstanceOf(ApiError);
    expect((terminal as ApiError).code).toBe(API_ERROR_CODES.streamIncomplete);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "step.started",
      "step.completed",
    ]);
  });

  it("一行被拆到两个 chunk 时依然可以解析", async () => {
    const { events, onEvent } = collect(searchAgentEventSchema);
    const response = encode([started.slice(0, 12), `${started.slice(12)}\n${stepStarted}\n`]);

    await parseNdjsonStream({
      response,
      schema: searchAgentEventSchema,
      onEvent,
      isTerminal,
    }).catch(() => undefined);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "run.started", requestId });
  });

  it("最后一行没有换行符也会被处理，且收到终态后立即结束", async () => {
    const { events, onEvent } = collect(searchAgentEventSchema);
    const completed = JSON.stringify({
      type: "run.completed",
      result: {
        cards: [],
        modeUsed: "fixture",
        fallbackReason: null,
        modelFallback: false,
        contextStatus: "unavailable",
        contextSourceCounts: { creation: 0, followee: 0, collection: 0, favlist: 0 },
        searchedQueries: [],
        background: [],
        analyzedContentCount: 0,
        rejectedContentCount: 0,
        runId: null,
        persistence: "unavailable",
      },
      runId: null,
      persistence: "unavailable",
    });
    const response = encode([`${started}\n${completed}`]);

    const terminal = await parseNdjsonStream({
      response,
      schema: searchAgentEventSchema,
      onEvent,
      isTerminal,
    });

    expect(terminal.type).toBe("run.completed");
    expect(events).toHaveLength(2);
  });

  it("空行、非法 JSON 与不符合 Schema 的行都被丢弃", async () => {
    const { events, onEvent } = collect(searchAgentEventSchema);
    const response = encode([
      "\n",
      "   \n",
      "{不是 JSON}\n",
      JSON.stringify({ type: "step.started", step: "thinking_hard", message: "x" }) + "\n",
      `${started}\n`,
    ]);

    await parseNdjsonStream({
      response,
      schema: searchAgentEventSchema,
      onEvent,
      isTerminal,
    }).catch(() => undefined);

    expect(events).toEqual([{ type: "run.started", requestId }]);
  });

  it("取消后抛出 AbortError，不再继续派发事件", async () => {
    const { events, onEvent } = collect(searchAgentEventSchema);
    const controller = new AbortController();
    const parse = parseNdjsonStream({
      response: hangingResponse(),
      schema: searchAgentEventSchema,
      onEvent,
      signal: controller.signal,
      isTerminal,
    });

    controller.abort();

    await expect(parse).rejects.toMatchObject({ name: "AbortError" });
    expect(events.every((event) => event.type === "run.started")).toBe(true);
  });

  it("没有可读流时抛出 STREAM_UNAVAILABLE", async () => {
    const response = new Response(null, { status: 200 });
    const onEvent = vi.fn();

    await expect(
      parseNdjsonStream({
        response,
        schema: searchAgentEventSchema,
        onEvent,
        isTerminal,
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.streamUnavailable });
  });
});
