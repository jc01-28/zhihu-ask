import { describe, expect, it, vi } from "vitest";

import { MockApiClient } from "@/front/api/MockApiClient";
import { HttpApiClient } from "@/front/api/HttpApiClient";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import {
  fieldGraphResponseSchema,
  fieldListResponseSchema,
  fieldSummarySchema,
} from "@/shared/contracts/field";
import { FIELD_SUMMARIES, findFieldGraph } from "@/front/mocks/field-data";

const FEATURED = { items: FIELD_SUMMARIES };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function createHttpClient(
  handler: (url: string, init: RequestInit) => Promise<Response>,
) {
  const fetchImpl = vi.fn(handler);
  const client = new HttpApiClient({
    baseUrl: "",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl };
}

function createMockClient(options: ConstructorParameters<typeof MockApiClient>[0] = {}) {
  return new MockApiClient({ stepDelayMs: 0, persist: false, ...options });
}

describe("HttpApiClient · 领域接口", () => {
  it("推荐领域走 /api/fields/featured 并逐项通过契约", async () => {
    const { client, fetchImpl } = createHttpClient(async () => jsonResponse(FEATURED));

    const fields = await client.getFeaturedFields();

    expect(String(fetchImpl.mock.calls[0][0])).toBe("/api/fields/featured");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    expect(fields).toHaveLength(FIELD_SUMMARIES.length);
    for (const field of fields) {
      expect(fieldSummarySchema.safeParse(field).success).toBe(true);
    }
  });

  it("领域检索把 query 与 limit 编码进查询串，返回领域列表", async () => {
    const { client, fetchImpl } = createHttpClient(async () =>
      jsonResponse({ items: [FIELD_SUMMARIES[0]] }),
    );

    const fields = await client.searchFields("Agent 开发", 3);

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "/api/fields?query=Agent+%E5%BC%80%E5%8F%91&limit=3",
    );
    expect(fields).toEqual([FIELD_SUMMARIES[0]]);
  });

  it("领域检索响应包含人物字段时按契约失败，而不是把人物当领域用", async () => {
    const { client } = createHttpClient(async () =>
      jsonResponse({ items: [{ id: "x", name: "某人", score: 90 }] }),
    );

    await expect(client.searchFields("x")).rejects.toMatchObject({
      code: API_ERROR_CODES.invalidResponse,
    });
  });

  it("星图接口对 fieldId 做 URL 编码，404 时收敛成 ApiError", async () => {
    const graph = findFieldGraph("agent-development");
    const { client, fetchImpl } = createHttpClient(async (url) => {
      if (String(url).includes("missing")) {
        return jsonResponse(
          {
            code: API_ERROR_CODES.fieldNotFound,
            message: "这个领域不存在或已下线。",
            retryable: false,
          },
          { status: 404 },
        );
      }
      return jsonResponse(graph);
    });

    const loaded = await client.getFieldGraph("agent development");
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "/api/fields/agent%20development/graph",
    );
    expect(fieldGraphResponseSchema.safeParse(loaded).success).toBe(true);

    await expect(client.getFieldGraph("missing")).rejects.toMatchObject({
      code: API_ERROR_CODES.fieldNotFound,
      status: 404,
      retryable: false,
    });
  });

  it("人物公开资料返回 404 时抛错，不会回退到别人", async () => {
    const { client } = createHttpClient(async () =>
      jsonResponse(
        { code: API_ERROR_CODES.notFound, message: "找不到这个人的公开资料。", retryable: false },
        { status: 404 },
      ),
    );

    await expect(client.getCreator("p-unknown")).rejects.toMatchObject({
      code: API_ERROR_CODES.notFound,
    });
  });

  it("领域列表响应的信封结构错误会被契约拦下", async () => {
    const { client } = createHttpClient(async () => jsonResponse(FIELD_SUMMARIES));

    await expect(client.getFeaturedFields()).rejects.toMatchObject({
      code: API_ERROR_CODES.invalidResponse,
    });
    expect(fieldListResponseSchema.safeParse(FIELD_SUMMARIES).success).toBe(false);
  });
});

describe("MockApiClient · 领域接口", () => {
  it("推荐领域与真实契约一致，且顺序稳定", async () => {
    const client = createMockClient();

    const first = await client.getFeaturedFields();
    const second = await client.getFeaturedFields();

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(5);
    expect(fieldListResponseSchema.safeParse({ items: first }).success).toBe(true);
  });

  it("领域检索按名称、标签与议题关键词命中，返回始终是领域", async () => {
    const client = createMockClient();

    for (const query of ["Agent", "风控", "清结算", "检索增强生成"]) {
      const fields = await client.searchFields(query);
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(fieldSummarySchema.safeParse(field).success).toBe(true);
      }
    }

    await expect(client.searchFields("量子引力波投资")).resolves.toEqual([]);
  });

  it("领域检索失败场景抛出可重试错误", async () => {
    const client = createMockClient({ scenario: "field-search-failed" });

    await expect(client.searchFields("Agent")).rejects.toMatchObject({
      code: API_ERROR_CODES.fieldSearchFailed,
      retryable: true,
    });
    // 失败场景只影响检索，不影响推荐领域。
    await expect(client.getFeaturedFields()).resolves.toHaveLength(
      FIELD_SUMMARIES.length,
    );
  });

  it("星图 404 场景与未知领域 id 都返回不可重试的 404", async () => {
    await expect(
      createMockClient({ scenario: "field-graph-missing" }).getFieldGraph(
        "agent-development",
      ),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.fieldNotFound, retryable: false });

    await expect(createMockClient().getFieldGraph("no-such-field")).rejects.toMatchObject({
      status: 404,
      retryable: false,
    });
  });

  it("人物公开资料区分领域来源与问题找人来源", async () => {
    const client = createMockClient();

    // 问题找人来源：带内容证据。
    const searchSourced = await client.getCreator("lin-zhixing");
    expect(searchSourced.evidence.length).toBeGreaterThan(0);
    expect(searchSourced.profileUrl).toContain("https://");

    // 领域来源：只给出公开关联，不虚构证据。
    const fieldSourced = await client.getCreator("p-lu-yanzhi");
    expect(fieldSourced.evidence).toEqual([]);
    expect(fieldSourced.role).toBe("领域相关");
    expect(fieldSourced.matchedDimensions).toContain("检索增强生成");

    await expect(client.getCreator("p-not-exist")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("用领域人物创建会话时不会串到别人身上", async () => {
    const client = createMockClient();

    const conversation = await client.createConversation({
      creatorId: "p-lu-yanzhi",
      sourceRunId: null,
    });

    expect(conversation.creator.id).toBe("p-lu-yanzhi");
    expect(conversation.creator.name).not.toBe("林知行");
    await expect(
      client.createConversation({ creatorId: "p-not-exist", sourceRunId: null }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("同一个领域人物重复创建会话时幂等返回同一个会话", async () => {
    const client = createMockClient();

    const first = await client.createConversation({
      creatorId: "p-xue-muran",
      sourceRunId: null,
    });
    const second = await client.createConversation({
      creatorId: "p-xue-muran",
      sourceRunId: null,
    });

    expect(second.id).toBe(first.id);
  });
});
