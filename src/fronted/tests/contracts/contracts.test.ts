import { describe, expect, it } from "vitest";

import { AGENT_STEP_ORDER, searchAgentEventSchema } from "@/shared/contracts/agent";
import { authSessionViewSchema } from "@/shared/contracts/auth";
import { creatorCardSchema } from "@/shared/contracts/creator";
import { consultationSchema } from "@/shared/contracts/consultation";
import {
  consultationActionResponseSchema,
  conversationAgentEventSchema,
  messageSchema,
  type Message,
} from "@/shared/contracts/conversation";
import {
  apiErrorEnvelopeSchema,
  isAuthErrorCode,
  API_ERROR_CODES,
} from "@/shared/contracts/errors";
import {
  compareResponseSchema,
  personSearchResultSchema,
  runRestoreResponseSchema,
  searchRequestSchema,
} from "@/shared/contracts/search";
import { FIXTURE_CREATORS } from "@/front/mocks/demo-data";
import { buildMockCompareResponse, buildMockSearchResult } from "@/front/mocks/mock-search-result";
import { restoreResponseToResult } from "@/front/features/search/search-state";

const conversationId = "conversation-lin-zhixing-501";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m-1",
    conversationId,
    clientMessageId: null,
    sender: "agent",
    content: "演示回复",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("公开契约", () => {
  it("Fixture 人物卡满足严格契约", () => {
    for (const creator of FIXTURE_CREATORS) {
      expect(creatorCardSchema.safeParse(creator).success).toBe(true);
    }
  });

  it("没有证据的人物卡合法：领域来源的人物只有公开关联", () => {
    // 「暂无证据」是真实状态，契约允许为空数组，由界面如实展示而不是虚构证据。
    const fieldSourced = { ...FIXTURE_CREATORS[0], evidence: [] };
    expect(creatorCardSchema.safeParse(fieldSourced).success).toBe(true);
  });

  it("证据超过 3 条不合法", () => {
    const tooMany = {
      ...FIXTURE_CREATORS[0],
      evidence: [
        FIXTURE_CREATORS[0].evidence[0],
        FIXTURE_CREATORS[0].evidence[0],
        FIXTURE_CREATORS[0].evidence[0],
        FIXTURE_CREATORS[0].evidence[0],
      ],
    };
    expect(creatorCardSchema.safeParse(tooMany).success).toBe(false);
  });

  it("score 超出 0～100 不合法", () => {
    expect(creatorCardSchema.safeParse({ ...FIXTURE_CREATORS[0], score: 120 }).success).toBe(
      false,
    );
    expect(creatorCardSchema.safeParse({ ...FIXTURE_CREATORS[0], score: -1 }).success).toBe(
      false,
    );
  });

  it("非法 URL 不合法", () => {
    const badEvidence = {
      ...FIXTURE_CREATORS[0],
      evidence: [{ ...FIXTURE_CREATORS[0].evidence[0], url: "javascript:alert(1)" }],
    };
    expect(creatorCardSchema.safeParse(badEvidence).success).toBe(false);
    expect(
      creatorCardSchema.safeParse({ ...FIXTURE_CREATORS[0], avatarUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("对象契约使用 strict：多余字段会被拒绝", () => {
    expect(
      creatorCardSchema.safeParse({ ...FIXTURE_CREATORS[0], internalUserId: "u-1" }).success,
    ).toBe(false);
  });

  it("搜索请求校验 4～300 字", () => {
    expect(searchRequestSchema.safeParse({ query: "abc", sessionId: "s" }).success).toBe(false);
    expect(
      searchRequestSchema.safeParse({ query: "abcd", sessionId: "s" }).success,
    ).toBe(true);
    expect(
      searchRequestSchema.safeParse({ query: "a".repeat(301), sessionId: "s" }).success,
    ).toBe(false);
  });

  it("未知 Agent 阶段被拒绝", () => {
    expect(
      searchAgentEventSchema.safeParse({
        type: "step.started",
        step: "thinking_hard",
        message: "x",
      }).success,
    ).toBe(false);
    for (const step of AGENT_STEP_ORDER) {
      expect(
        searchAgentEventSchema.safeParse({ type: "step.started", step, message: "ok" }).success,
      ).toBe(true);
    }
  });

  it("搜索结果与对比响应结构正确", () => {
    const result = buildMockSearchResult("大厂产品转 AI 创业公司");
    expect(personSearchResultSchema.safeParse(result).success).toBe(true);
    const compare = buildMockCompareResponse("大厂产品转 AI 创业公司");
    expect(compareResponseSchema.safeParse(compare).success).toBe(true);
    expect(compare.raw.hits.length).toBeGreaterThan(0);
  });

  it("run 恢复响应拒绝非 UUID 的 runId，并要求带全摘要字段", () => {
    // 恢复响应必须带全「刷新后重建摘要」所需的字段，否则前端只能用默认值补，
    // 那就是在界面上伪造一次它并不知道的降级情况与上下文统计。
    const restore = {
      runId: "00000000-0000-4000-8000-000000000051",
      cards: FIXTURE_CREATORS,
      mode: "fixture" as const,
      contextStatus: "applied" as const,
      analyzedCount: 1,
      rejectedCount: 0,
      fallbackReason: null,
      modelFallback: true,
      contextSourceCounts: { creation: 3, followee: 5, collection: 2, favlist: 1 },
      searchedQueries: ["大厂产品转 AI 创业公司"],
      background: [],
      persistence: "saved" as const,
      createdAt: 1,
      expiresAt: 2,
    };
    expect(runRestoreResponseSchema.safeParse(restore).success).toBe(true);
    expect(runRestoreResponseSchema.safeParse({ ...restore, runId: "abc" }).success).toBe(false);
    expect(
      runRestoreResponseSchema.safeParse({ ...restore, expiresAt: -1 }).success,
    ).toBe(false);

    for (const missing of [
      "modelFallback",
      "contextSourceCounts",
      "searchedQueries",
      "background",
      "persistence",
    ] as const) {
      const { [missing]: _omitted, ...rest } = restore;
      expect(runRestoreResponseSchema.safeParse(rest).success).toBe(false);
    }

    // 能取回就说明当初存下来了，因此不接受 unavailable。
    expect(
      runRestoreResponseSchema.safeParse({ ...restore, persistence: "unavailable" }).success,
    ).toBe(false);
  });

  it("恢复响应可以无损还原成页面使用的搜索结果", () => {
    const result = buildMockSearchResult("大厂产品转 AI 创业公司");
    const run = runRestoreResponseSchema.parse({
      runId: result.runId,
      cards: result.cards,
      mode: result.modeUsed,
      contextStatus: result.contextStatus,
      analyzedCount: result.analyzedContentCount,
      rejectedCount: result.rejectedContentCount,
      fallbackReason: result.fallbackReason,
      modelFallback: result.modelFallback,
      contextSourceCounts: result.contextSourceCounts,
      searchedQueries: result.searchedQueries,
      background: result.background,
      persistence: "saved",
      createdAt: 1,
      expiresAt: 2,
    });

    expect(restoreResponseToResult(run)).toEqual(result);
  });

  it("错误 Message sender 被拒绝", () => {
    expect(messageSchema.safeParse(message({ sender: "agent" })).success).toBe(true);
    for (const sender of ["seeker", "creator", "agent", "system"] as const) {
      expect(messageSchema.safeParse(message({ sender })).success).toBe(true);
    }
    expect(
      messageSchema.safeParse({ ...message(), sender: "bot" }).success,
    ).toBe(false);
  });

  it("非法 Consultation status 被拒绝", () => {
    const base = {
      id: "c-1",
      status: "free_chat",
      packageId: null,
      amount: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(consultationSchema.safeParse(base).success).toBe(true);
    expect(consultationSchema.safeParse({ ...base, status: "paid" }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });

  it("咨询动作响应必须同时包含状态与系统消息", () => {
    const payload = {
      consultation: {
        id: "c-1",
        status: "proposed",
        packageId: "voice-30",
        amount: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      systemMessage: message({ sender: "system", content: "用户发起了付费咨询意向。" }),
    };
    expect(consultationActionResponseSchema.safeParse(payload).success).toBe(true);
    expect(
      consultationActionResponseSchema.safeParse({ consultation: payload.consultation }).success,
    ).toBe(false);
  });

  it("会话 Agent 流事件契约", () => {
    expect(
      conversationAgentEventSchema.safeParse({
        type: "agent.run.started",
        requestId: "00000000-0000-4000-8000-000000000022",
        userMessage: message({ sender: "seeker" }),
      }).success,
    ).toBe(true);
    expect(
      conversationAgentEventSchema.safeParse({
        type: "agent.message.delta",
        messageId: "m-2",
        delta: "第一句",
      }).success,
    ).toBe(true);
    expect(
      conversationAgentEventSchema.safeParse({ type: "agent.message.delta", messageId: "m-2" })
        .success,
    ).toBe(false);
  });

  it("错误信封与 401 判定", () => {
    const envelope = {
      code: API_ERROR_CODES.authExpired,
      message: "授权已过期",
      retryable: false,
    };
    const parsed = apiErrorEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    expect(isAuthErrorCode(API_ERROR_CODES.authExpired)).toBe(true);
    expect(isAuthErrorCode(API_ERROR_CODES.rateLimited)).toBe(false);
    expect(apiErrorEnvelopeSchema.safeParse({ code: "X", message: "y" }).success).toBe(false);
  });

  it("会话视图：未登录时 user 必须为 null", () => {
    expect(
      authSessionViewSchema.safeParse({ configured: true, authenticated: false, user: null })
        .success,
    ).toBe(true);
    expect(
      authSessionViewSchema.safeParse({
        configured: true,
        authenticated: true,
        user: { id: "u", displayName: "演示用户", avatarUrl: null },
      }).success,
    ).toBe(true);
    expect(
      authSessionViewSchema.safeParse({ configured: true, authenticated: false }).success,
    ).toBe(false);
  });
});
