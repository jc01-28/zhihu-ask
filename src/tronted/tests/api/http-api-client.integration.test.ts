import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/front/api/ApiError";
import { HttpApiClient } from "@/front/api/HttpApiClient";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import type { SearchAgentEvent } from "@/shared/contracts/agent";

/**
 * 真实 socket 上的 HttpApiClient 集成测试。
 *
 * `http-api-client.test.ts` 注入的是假的 `fetchImpl` 与假的 `Response`，
 * 因此它证明不了任何与「真的走网络」有关的事：
 *
 * - NDJSON 一行被 TCP 切在两个 chunk 之间（甚至切在一个汉字的 3 字节中间）时，
 *   `TextDecoder` + 行缓冲能不能把它拼回来；
 * - 收到终态事件后是不是**立刻**返回，而不是等连接自然关闭；
 * - 取消请求时底层 socket 会不会真的被中断；
 * - 请求头（`Accept: application/x-ndjson`）与请求体是不是真的发出去了。
 *
 * 这些只有把请求打到真正的 HTTP 服务器上才能验证。本文件就是补这一层，
 * 并且它是后端接手联调时最可能踩到的那几个点。
 */

const REQUEST_ID = "00000000-0000-4000-8000-000000000011";
const RUN_ID = "00000000-0000-4000-8000-000000000051";

/** 咨询 409 时服务端附在错误信封里的「当前真实状态」。 */
const SERVER_CONSULTATION = {
  id: "consultation-server",
  status: "mock_paid",
  packageId: "voice-30",
  amount: 19900,
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const CREATOR = {
  id: "creator-1",
  name: "林见山",
  headline: "AI 产品负责人",
  initial: "林",
  avatarTone: "bg-violet-500",
  avatarUrl: null,
  profileUrl: "https://www.zhihu.com/people/lin-jian-shan",
  identityConfidence: "high",
  role: "经历最接近",
  relevanceLevel: "高度相关",
  score: 92,
  matchedDimensions: ["产品经验"],
  reason: "有公开内容可以核验。",
  evidence: [],
  suitableQuestions: ["冷启动该怎么排优先级？"],
  limitations: ["未公开团队规模"],
} as const;

const CONTEXT_SOURCE_COUNTS = {
  creation: 12,
  followee: 3,
  collection: 2,
  favlist: 1,
};

const PERSON_SEARCH_RESULT = {
  cards: [CREATOR],
  modeUsed: "live",
  fallbackReason: null,
  modelFallback: false,
  contextStatus: "applied",
  contextSourceCounts: CONTEXT_SOURCE_COUNTS,
  searchedQueries: ["大厂产品转 AI 创业公司"],
  background: [],
  analyzedContentCount: 18,
  rejectedContentCount: 4,
  runId: RUN_ID,
  persistence: "saved",
} as const;

const FIELD_AI_PRODUCT = {
  id: "ai-product",
  name: "AI 产品",
  description: "把模型能力做成可用产品",
  icon: "sparkles",
  color: "violet",
  tags: ["产品", "增长"],
  memberCount: 128,
  topicCount: 6,
} as const;

const FIELD_GRAPH = {
  field: FIELD_AI_PRODUCT,
  topics: [
    {
      id: "cold-start",
      name: "冷启动",
      description: "从零到第一批留存用户",
      position: { x: 0.24, y: 0.38 },
    },
  ],
  people: [
    {
      id: "creator-1",
      name: "林见山",
      headline: "AI 产品负责人",
      avatarUrl: null,
      initial: "林",
      avatarTone: "bg-violet-500",
      topicIds: ["cold-start"],
      relevance: 88,
      profileUrl: "https://www.zhihu.com/people/lin-jian-shan",
    },
  ],
} as const;

const HOT_TOPICS = {
  topics: [
    {
      scope: "background",
      source: "hot_list",
      title: "模型价格战继续",
      excerpt: "本周公开讨论集中在推理成本。",
      url: "https://www.zhihu.com/hot",
      thumbnailUrl: null,
      publishedAt: null,
    },
  ],
  unavailable: false,
} as const;

/** 六个阶段各 started/completed，共 12 条，加上首尾两条。 */
const STEP_EVENTS = [
  "loading_context",
  "understanding",
  "retrieving",
  "verifying",
  "ranking",
  "saving",
].flatMap((step) => [
  { type: "step.started", step, message: `开始检索公开内容（${step}）` },
  { type: "step.completed", step, message: `完成（${step}）` },
]);

const TERMINAL_EVENT = {
  type: "run.completed",
  result: PERSON_SEARCH_RESULT,
  runId: RUN_ID,
  persistence: "saved",
} as const;

const EXPECTED_EVENT_TYPES = [
  "run.started",
  ...STEP_EVENTS.map((event) => event.type),
  "run.completed",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendNdjsonHead(response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

type RecordedRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

async function readBody(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

describe("HttpApiClient（真实 HTTP 服务器）", () => {
  let server: Server;
  let client: HttpApiClient;
  let baseUrl: string;
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  const onUnauthorized = vi.fn();

  beforeAll(async () => {
    server = createServer((request, response) => {
      void (async () => {
        const path = request.url ?? "/";
        const body =
          request.method === "POST" || request.method === "PUT"
            ? await readBody(request)
            : "";
        requests.push({
          method: request.method ?? "GET",
          url: path,
          headers: request.headers,
          body,
        });

        // ---- 授权：没有 Cookie 一律 401，用来验证错误信封 ----
        if (path === "/api/auth/session" && !request.headers.cookie) {
          sendJson(response, 401, {
            code: API_ERROR_CODES.authExpired,
            message: "知乎授权已失效，请重新登录。",
            retryable: false,
          });
          return;
        }
        if (path === "/api/auth/session") {
          sendJson(response, 200, {
            configured: true,
            authenticated: true,
            user: {
              id: "public-user-1",
              displayName: "田永灿",
              avatarUrl: null,
            },
          });
          return;
        }

        // ---- 背景资料（热榜）：也走这条真实链路，顺带验证
        //      `backgroundDocumentSchema` 在真实响应上能被接受 ----
        if (path === "/api/topics/hot") {
          sendJson(response, 200, HOT_TOPICS);
          return;
        }

        // ---- 非 JSON 错误体：应按状态码推断 ----
        if (path === "/api/consultation/packages") {
          response.writeHead(503, { "Content-Type": "text/plain" });
          response.end("upstream unavailable");
          return;
        }

        // ---- 领域搜索：故意退化成人物列表，契约必须拒绝 ----
        if (path.startsWith("/api/fields?") && path.includes("degraded=1")) {
          sendJson(response, 200, { items: [CREATOR] });
          return;
        }

        // ---- 领域目录 ----
        if (path === "/api/fields/featured") {
          sendJson(response, 200, { items: [FIELD_AI_PRODUCT] });
          return;
        }
        if (path.startsWith("/api/fields?")) {
          sendJson(response, 200, { items: [FIELD_AI_PRODUCT] });
          return;
        }
        if (path === "/api/fields/ai-product/graph") {
          sendJson(response, 200, FIELD_GRAPH);
          return;
        }
        if (path === "/api/creators/creator-1") {
          sendJson(response, 200, CREATOR);
          return;
        }
        // 业务接口上的 401：应当触发全局会话刷新（与会话探测相反）。
        if (path === "/api/creators/auth-expired") {
          sendJson(response, 401, {
            code: API_ERROR_CODES.authExpired,
            message: "知乎授权已失效，请重新登录。",
            retryable: false,
          });
          return;
        }

        // ---- 咨询 409：错误信封里带 details（服务端的当前 Consultation）----
        // 这条只有在真实 socket 上才测得到：信封是 `.strict()` 的，`details`
        // 必须被显式声明，否则整个信封解析失败、code 退化成 CONFLICT。
        if (path === "/api/conversations/c-conflict/consultation/actions") {
          sendJson(response, 409, {
            code: API_ERROR_CODES.invalidConsultationTransition,
            message: "当前咨询状态不允许这个操作，已按服务端状态回正。",
            retryable: false,
            details: SERVER_CONSULTATION,
          });
          return;
        }

        // ---- 刷新恢复 ----
        if (path === `/api/agent/runs/${RUN_ID}`) {
          sendJson(response, 200, {
            runId: RUN_ID,
            cards: [CREATOR],
            mode: "live",
            contextStatus: "applied",
            analyzedCount: 18,
            rejectedCount: 4,
            fallbackReason: null,
            modelFallback: false,
            contextSourceCounts: CONTEXT_SOURCE_COUNTS,
            searchedQueries: ["大厂产品转 AI 创业公司"],
            background: [],
            persistence: "saved",
            createdAt: 1_757_840_000_000,
            expiresAt: 1_757_843_600_000,
          });
          return;
        }

        // ---- 搜索流：把一个 NDJSON 流故意切碎 ----
        if (path === "/api/agent/search") {
          sendNdjsonHead(response);
          const lines = [
            JSON.stringify({ type: "run.started", requestId: REQUEST_ID }),
            // 一行垃圾 + 一行契约不合法：都必须被丢弃，且不影响后续事件。
            "{ 这不是 JSON",
            JSON.stringify({ type: "step.started", step: "不存在的阶段" }),
            ...STEP_EVENTS.map((event) => JSON.stringify(event)),
            JSON.stringify(TERMINAL_EVENT),
          ];
          const payload = Buffer.from(`${lines.join("\n")}\n`, "utf8");

          // 切点刻意选在 JSON 记号中间，其中 `zh` 落在某个汉字的 3 字节内部，
          // 用来验证 `TextDecoder({ stream: true })` 能跨 chunk 拼接多字节字符。
          const cutPoints = new Set([5, 17]);
          const zhIndex = payload.indexOf(Buffer.from("检索", "utf8"));
          if (zhIndex >= 0) cutPoints.add(zhIndex + 1);

          let cursor = 0;
          for (const cut of [...cutPoints].sort((a, b) => a - b)) {
            if (cut <= cursor || cut >= payload.length) continue;
            response.write(payload.subarray(cursor, cut));
            cursor = cut;
            // 给 TCP 一点时间真的把这一段发出去，否则会被合并成一个 chunk，
            // 「跨 chunk」这件事就没有被验证到。
            await sleep(25);
          }
          response.write(payload.subarray(cursor));
          response.end();
          return;
        }

        // ---- 连接建立后只推终态事件，然后**不关闭**连接 ----
        if (path === "/api/agent/search/held-open") {
          sendNdjsonHead(response);
          response.write(`${JSON.stringify({ type: "run.started", requestId: REQUEST_ID })}\n`);
          response.write(`${JSON.stringify(TERMINAL_EVENT)}\n`);
          // 故意不调用 `response.end()`：客户端必须在收到终态事件后立即返回，
          // 而不是等这里把连接关掉。
          return;
        }

        // ---- 推到一半直接掐断 socket ----
        if (path === "/api/agent/search/dropped") {
          sendNdjsonHead(response);
          response.write(
            `${JSON.stringify({ type: "run.started", requestId: REQUEST_ID })}\n`,
          );
          await sleep(20);
          response.destroy();
          return;
        }

        // ---- 慢流：用于验证取消 ----
        if (path === "/api/agent/search/slow") {
          sendNdjsonHead(response);
          response.write(`${JSON.stringify({ type: "run.started", requestId: REQUEST_ID })}\n`);
          await sleep(8_000);
          response.end();
          return;
        }

        sendJson(response, 404, {
          code: API_ERROR_CODES.notFound,
          message: "请求的资源不存在或已过期。",
          retryable: false,
        });
      })();
    });

    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    // 结尾多一个斜杠：顺带验证 baseUrl 的尾斜杠会被去掉，不会拼成 `//api/...`。
    baseUrl = `http://127.0.0.1:${address.port}/`;
    client = new HttpApiClient({ baseUrl, onUnauthorized });
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it("NDJSON 跨 chunk / 跨多字节字符被正确重组，非法行被丢弃", async () => {
    const events: SearchAgentEvent[] = [];

    const completed = await client.streamSearch(
      { query: "大厂产品转 AI 创业公司", sessionId: "session-1" },
      (event) => events.push(event),
    );

    expect(completed.type).toBe("run.completed");
    expect(completed.result.cards).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(EXPECTED_EVENT_TYPES);
    expect(events[1]).toMatchObject({
      type: "step.started",
      message: "开始检索公开内容（loading_context）",
    });
    expect(events.at(-2)).toMatchObject({ type: "step.completed", step: "saving" });
  });

  it("流式请求真的带上了 NDJSON 请求头与请求体", async () => {
    const record = requests.find(
      (item) => item.url === "/api/agent/search" && item.method === "POST",
    );

    expect(record).toBeDefined();
    expect(record?.headers.accept).toBe("application/x-ndjson");
    expect(record?.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(JSON.parse(record?.body ?? "{}")).toEqual({
      query: "大厂产品转 AI 创业公司",
      sessionId: "session-1",
    });
  });

  it("收到终态事件后立即返回，不等连接关闭", async () => {
    const started = Date.now();
    const response = await fetch(`${baseUrl}api/agent/search/held-open`, {
      method: "POST",
    });
    // 直接复用客户端的解析器语义：把同一个客户端指向这条挂住的响应。
    const heldClient = new HttpApiClient({
      baseUrl,
      fetchImpl: async () => response,
    });

    const completed = await heldClient.streamSearch(
      { query: "大厂产品转 AI 创业公司", sessionId: "session-1" },
      () => undefined,
    );

    expect(completed.type).toBe("run.completed");
    // 服务端这条连接会一直挂着（慢流分支要等 8s），
    // 客户端却必须已经返回。留 3s 的余量足够区分「立即」和「等关闭」。
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 20_000);

  it("取消流式请求会中断底层 socket 并保持取消语义", async () => {
    const controller = new AbortController();
    const stream = client.streamSearch(
      { query: "大厂产品转 AI 创业公司", sessionId: "session-1" },
      () => undefined,
      controller.signal,
    );

    // 服务端这条流会先推 run.started，再挂 8 秒。
    await sleep(20);
    controller.abort();

    const error = await stream.catch((caught: unknown) => caught);
    expect((error as Error).name).toBe("AbortError");
    expect(error).not.toBeInstanceOf(ApiError);
  }, 20_000);

  it("流中途被掐断时收敛成 ApiError，不把底层传输错误漏给界面", async () => {
    // 真实网络上很常见的一幕：服务端（或中间层）在流推到一半时断开。
    // 此时 `reader.read()` 会抛出底层实现的错误（undici 抛 `TypeError: terminated`，
    // 浏览器抛 `TypeError: Failed to fetch`）。如果让它原样冒出去，
    // `usePersonSearch` 会把 `error.message` 直接显示给用户，
    // 界面上就会出现一句英文技术错误——所以这里必须收敛成 ApiError。
    const response = await fetch(`${baseUrl}api/agent/search/dropped`, {
      method: "POST",
    });
    const droppedClient = new HttpApiClient({
      baseUrl,
      fetchImpl: async () => response,
    });

    const error = await droppedClient
      .streamSearch(
        { query: "大厂产品转 AI 创业公司", sessionId: "session-1" },
        () => undefined,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).retryable).toBe(true);
    expect((error as ApiError).message).not.toMatch(/terminated|fetch/i);
  }, 20_000);

  it("401 走真实错误信封：会话探测不触发全局刷新，业务接口触发", async () => {
    onUnauthorized.mockClear();

    await expect(client.getSession()).rejects.toMatchObject({
      code: API_ERROR_CODES.authExpired,
      status: 401,
      retryable: false,
    });
    // 会话探测自己就是授权状态的权威来源，它的 401 不该再要求「刷新会话」，
    // 否则会和 `useAuthSession` 依赖的 authEpoch 形成死循环。
    expect(onUnauthorized).not.toHaveBeenCalled();

    await expect(client.getCreator("auth-expired")).rejects.toMatchObject({
      status: 401,
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("非 JSON 错误体按真实状态码推断", async () => {
    await expect(client.getConsultationPackages()).rejects.toMatchObject({
      code: API_ERROR_CODES.persistenceUnavailable,
      status: 503,
      retryable: true,
    });
  });

  it("咨询 409 的 details 穿过真实错误信封到达上层", async () => {
    const error = await client
      .applyConsultationAction("c-conflict", {
        action: "confirm_mock_payment",
        actorRole: "seeker",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    // 关键：code 必须是精确码。若信封的 `.strict()` 不认 `details`，
    // 整条响应会退回按状态码推断，这里就会变成 "CONFLICT"。
    expect((error as ApiError).code).toBe(
      API_ERROR_CODES.invalidConsultationTransition,
    );
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).details).toEqual(SERVER_CONSULTATION);
  });

  it("背景资料在真实响应上过契约，并且明确标记为 background", async () => {
    const hot = await client.getHotTopics();
    expect(hot.unavailable).toBe(false);
    expect(hot.topics[0]).toMatchObject({
      scope: "background",
      source: "hot_list",
    });
  });

  it("领域检索返回人物形状时，契约在真实响应上直接拒绝", async () => {
    // 这条是「领域搜索不得退化成人物搜索」在真实链路上的证明：
    // 即使后端返回 200，只要 items 不是领域，前端就抛 INVALID_RESPONSE。
    const search = new URLSearchParams({ query: "AI 产品", limit: "8" });
    const response = await fetch(
      `${baseUrl}api/fields?${search.toString()}&degraded=1`,
    );
    const degradedClient = new HttpApiClient({
      baseUrl,
      fetchImpl: async () => response,
    });

    await expect(degradedClient.searchFields("AI 产品")).rejects.toMatchObject({
      code: API_ERROR_CODES.invalidResponse,
      retryable: false,
    });
  });

  it("领域目录、星图、人物资料与刷新恢复都走真实 HTTP", async () => {
    const featured = await client.getFeaturedFields();
    expect(featured.map((field) => field.id)).toEqual(["ai-product"]);

    const fields = await client.searchFields("AI 产品", 8);
    expect(fields[0]).toMatchObject({ name: "AI 产品", color: "violet" });

    const graph = await client.getFieldGraph("ai-product");
    expect(graph.topics[0].id).toBe("cold-start");
    // 领域人物只带白名单字段：不得把「问题找人」的 role / score / reason
    // 这类检索结论混进领域入口。
    expect(Object.keys(graph.people[0]).sort()).toEqual([
      "avatarTone",
      "avatarUrl",
      "headline",
      "id",
      "initial",
      "name",
      "profileUrl",
      "relevance",
      "topicIds",
    ]);

    const creator = await client.getCreator("creator-1");
    expect(creator.evidence).toEqual([]);
    expect(creator.profileUrl).toBe("https://www.zhihu.com/people/lin-jian-shan");

    const restored = await client.restoreRun(RUN_ID);
    expect(restored).toMatchObject({
      runId: RUN_ID,
      persistence: "saved",
      analyzedCount: PERSON_SEARCH_RESULT.analyzedContentCount,
      rejectedCount: PERSON_SEARCH_RESULT.rejectedContentCount,
      modelFallback: PERSON_SEARCH_RESULT.modelFallback,
      contextStatus: PERSON_SEARCH_RESULT.contextStatus,
    });
    expect(restored.cards[0].id).toBe(PERSON_SEARCH_RESULT.cards[0].id);

    expect(requests.map((item) => item.url)).toContain(
      "/api/fields/ai-product/graph",
    );
    // 尾斜杠被去掉，没有拼出 `//api/...`。
    expect(requests.every((item) => !item.url.startsWith("//"))).toBe(true);
  });
});
