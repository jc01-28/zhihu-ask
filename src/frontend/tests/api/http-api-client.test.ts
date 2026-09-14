import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/front/api/ApiError";
import { HttpApiClient } from "@/front/api/HttpApiClient";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import { FIXTURE_CREATORS } from "@/front/mocks/demo-data";
import { buildMockSearchResult } from "@/front/mocks/mock-search-result";
import type { SearchAgentEvent } from "@/shared/contracts/agent";

const requestId = "00000000-0000-4000-8000-000000000011";
const runId = "00000000-0000-4000-8000-000000000051";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

function createClient(
  handler: (url: string, init: RequestInit) => Promise<Response>,
  onUnauthorized?: () => void,
) {
  const fetchImpl = vi.fn(handler);
  const client = new HttpApiClient({
    baseUrl: "",
    onUnauthorized,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl };
}

describe("HttpApiClient", () => {
  it("每个请求都带 credentials: include 并做响应校验", async () => {
    const { client, fetchImpl } = createClient(async () =>
      jsonResponse({
        configured: true,
        authenticated: true,
        user: { id: "u-1", displayName: "演示用户", avatarUrl: null },
      }),
    );

    const session = await client.getSession();

    expect(session.user?.displayName).toBe("演示用户");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("/api/auth/session");
    expect(init).toMatchObject({ credentials: "include" });
  });

  it("非 2xx 使用错误信封构造 ApiError", async () => {
    const { client } = createClient(async () =>
      jsonResponse(
        { code: API_ERROR_CODES.rateLimited, message: "请求过于频繁", retryable: true },
        { status: 429 },
      ),
    );

    await expect(client.getSession()).rejects.toMatchObject({
      code: API_ERROR_CODES.rateLimited,
      status: 429,
      retryable: true,
    });
  });

  it("非 JSON 错误体按状态码推断", async () => {
    const { client } = createClient(
      async () => new Response("boom", { status: 503 }),
    );

    const error = await client.getSession().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(API_ERROR_CODES.persistenceUnavailable);
    expect((error as ApiError).retryable).toBe(true);
  });

  // 咨询 409 的「回正」靠服务端把当前 Consultation 放在信封的 `details` 里。
  // 这条链路有两个静默失效点：信封的 `.strict()` 不认 `details`（整个信封解析
  // 失败 → code 退化成 CONFLICT），以及 `send()` 不把它转进 ApiError。
  // 两者都不会报错，只会让回正在真实后端下永不触发，所以各钉一条断言。
  it("错误信封里的 details 原样交给上层（咨询 409 靠它回正）", async () => {
    const serverConsultation = {
      id: "consultation-server",
      status: "mock_paid",
      packageId: "voice-30",
      amount: 19900,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { client } = createClient(
      async () =>
        jsonResponse(
          {
            code: API_ERROR_CODES.invalidConsultationTransition,
            message: "当前状态不允许这个操作。",
            retryable: false,
            details: serverConsultation,
          },
          { status: 409 },
        ),
    );

    const error = await client
      .applyConsultationAction("c-1", {
        action: "confirm_mock_payment",
        actorRole: "seeker",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    // code 必须是精确码，不能退化成按状态码推断的 CONFLICT。
    expect((error as ApiError).code).toBe(
      API_ERROR_CODES.invalidConsultationTransition,
    );
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).details).toEqual(serverConsultation);
  });

  it("信封里出现未声明的字段时按状态码兜底，不静默吸收", async () => {
    const { client } = createClient(async () =>
      jsonResponse(
        {
          code: API_ERROR_CODES.rateLimited,
          message: "请求过于频繁",
          retryable: true,
          internalStack: "at /srv/secret.ts:42",
        },
        { status: 429 },
      ),
    );

    const error = await client.getSession().catch((caught: unknown) => caught);
    // 信封整体不符合契约 → 退回按状态码推断（429 仍得到同一个码），
    // 而多出来的 internalStack 不会被带进 ApiError。
    expect((error as ApiError).code).toBe(API_ERROR_CODES.rateLimited);
    expect((error as ApiError).details).toBeUndefined();
  });

  it("401 会通知全局会话刷新", async () => {
    const onUnauthorized = vi.fn();
    const { client } = createClient(
      async () =>
        jsonResponse(
          {
            code: API_ERROR_CODES.authExpired,
            message: "授权已过期",
            retryable: false,
          },
          { status: 401 },
        ),
      onUnauthorized,
    );

    await expect(client.getConversation("c-1")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("会话探测自己的 401 不触发全局刷新，否则会形成死循环", async () => {
    // 这条是真实后端上踩过的坑：`GET /api/auth/session` 返回 401 时，
    // 若也去通知全局刷新，就会变成
    //   401 → authEpoch++ → 会话探测重跑 → 又是 401 → …
    // `useAuthSession` 的 effect 依赖 authEpoch，于是会话失效时
    // 浏览器会以网络往返的速度持续打这个接口。
    // mock 模式永远返回 200，所以这条只有接真实后端才可能被触发。
    const onUnauthorized = vi.fn();
    const { client, fetchImpl } = createClient(
      async () =>
        jsonResponse(
          {
            code: API_ERROR_CODES.authExpired,
            message: "授权已过期",
            retryable: false,
          },
          { status: 401 },
        ),
      onUnauthorized,
    );

    await expect(client.getSession()).rejects.toMatchObject({ status: 401 });
    // 调用方仍然会按「未授权」处理（useAuthSession 捕获后回到 AuthGate），
    // 只是不再把这次 401 当成需要刷新会话的事件。
    expect(onUnauthorized).not.toHaveBeenCalled();

    // 其它接口的 401 仍然照常刷新会话。
    await expect(client.getFieldGraph("f-1")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("响应结构不符合契约时抛出 INVALID_RESPONSE", async () => {
    const { client } = createClient(async () => jsonResponse({ configured: true }));

    await expect(client.getSession()).rejects.toMatchObject({
      code: API_ERROR_CODES.invalidResponse,
    });
  });

  it("listMessages 携带 limit 与 cursor", async () => {
    const { client, fetchImpl } = createClient(async () =>
      jsonResponse({ items: [], nextCursor: null }),
    );

    await client.listMessages("conversation-1", "12");

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "/api/conversations/conversation-1/messages?limit=50&cursor=12",
    );
  });

  it("streamSearch 转发事件并返回 run.completed", async () => {
    const result = buildMockSearchResult("大厂产品转 AI 创业公司");
    const { client } = createClient(async () =>
      ndjsonResponse([
        JSON.stringify({ type: "run.started", requestId }),
        JSON.stringify({
          type: "step.started",
          step: "retrieving",
          message: "从多个搜索方向寻找公开内容",
        }),
        JSON.stringify({
          type: "run.completed",
          result,
          runId,
          persistence: "saved",
        }),
      ]),
    );

    const events: SearchAgentEvent[] = [];
    const completed = await client.streamSearch(
      { query: "大厂产品转 AI 创业公司", sessionId: "s-1" },
      (event) => events.push(event),
    );

    expect(completed.type).toBe("run.completed");
    expect(completed.result.cards).toHaveLength(FIXTURE_CREATORS.length);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "step.started",
      "run.completed",
    ]);
  });

  it("run.failed 事件被转换成 ApiError 抛出", async () => {
    const { client } = createClient(async () =>
      ndjsonResponse([
        JSON.stringify({ type: "run.started", requestId }),
        JSON.stringify({
          type: "run.failed",
          error: {
            code: API_ERROR_CODES.rateLimited,
            message: "演示模式：本次检索被限流",
            retryable: true,
          },
        }),
      ]),
    );

    await expect(
      client.streamSearch({ query: "大厂产品转 AI 创业公司", sessionId: "s-1" }, () => undefined),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.rateLimited, retryable: true });
  });

  it("createConversation 只提交 creatorId 与 sourceRunId", async () => {
    const { client, fetchImpl } = createClient(async () =>
      jsonResponse({
        conversation: {
          id: "conversation-1",
          user: { id: "u-1", displayName: "演示用户", avatarUrl: null },
          creator: FIXTURE_CREATORS[0],
          sourceRunId: runId,
          consultation: {
            id: "consultation-1",
            status: "free_chat",
            packageId: "voice-30",
            amount: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );

    const conversation = await client.createConversation({
      creatorId: FIXTURE_CREATORS[0].id,
      sourceRunId: runId,
    });

    expect(conversation.id).toBe("conversation-1");
    const init = fetchImpl.mock.calls[0][1];
    expect(JSON.parse(String(init.body))).toEqual({
      creatorId: FIXTURE_CREATORS[0].id,
      sourceRunId: runId,
    });
  });

  it("网络错误被收敛成 NETWORK_ERROR", async () => {
    const { client } = createClient(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(client.getSession()).rejects.toMatchObject({
      code: API_ERROR_CODES.networkError,
      retryable: true,
    });
  });
});
