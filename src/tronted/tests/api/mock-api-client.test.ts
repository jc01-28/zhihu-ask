import { describe, expect, it } from "vitest";

import { MockApiClient } from "@/front/api/MockApiClient";
import { ApiError } from "@/front/api/ApiError";
import type { ConversationAgentEvent } from "@/shared/contracts/conversation";
import type { SearchAgentEvent } from "@/shared/contracts/agent";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import { AGENT_STEP_ORDER } from "@/shared/contracts/agent";
import { FIXTURE_CREATORS } from "@/front/mocks/demo-data";
import { deterministicUuid, MOCK_SEARCH_REQUEST_ID } from "@/front/mocks/mock-search-result";

function createClient(options: ConstructorParameters<typeof MockApiClient>[0] = {}) {
  return new MockApiClient({ stepDelayMs: 0, persist: false, ...options });
}

const query = "大厂产品转 AI 创业公司，值得找谁聊？";

async function createConversation(client: MockApiClient, creatorId = FIXTURE_CREATORS[0].id) {
  const search = await client.streamSearch(
    { query, sessionId: "s-1" },
    () => undefined,
  );
  return client.createConversation({
    creatorId,
    sourceRunId: search.runId,
  });
}

describe("MockApiClient", () => {
  it("按配置返回已授权 / 未授权 / 未配置三种会话", async () => {
    await expect(createClient().getSession()).resolves.toMatchObject({
      configured: true,
      authenticated: true,
    });
    await expect(
      createClient({ authState: "anonymous" }).getSession(),
    ).resolves.toMatchObject({ configured: true, authenticated: false, user: null });
    await expect(
      createClient({ authState: "unconfigured" }).getSession(),
    ).resolves.toMatchObject({ configured: false, authenticated: false });
  });

  it("搜索按 run.started → 六阶段 → run.completed 顺序发出事件", async () => {
    const client = createClient();
    const events: SearchAgentEvent[] = [];

    const completed = await client.streamSearch({ query, sessionId: "s-1" }, (event) =>
      events.push(event),
    );

    expect(events[0]).toEqual({
      type: "run.started",
      requestId: MOCK_SEARCH_REQUEST_ID,
    });
    const stepTypes = events
      .filter((event) => event.type !== "run.started" && event.type !== "run.completed")
      .map((event) =>
        event.type === "step.started" || event.type === "step.completed"
          ? `${event.type}:${event.step}`
          : event.type,
      );
    expect(stepTypes).toEqual(
      AGENT_STEP_ORDER.flatMap((step) => [
        `step.started:${step}`,
        `step.completed:${step}`,
      ]),
    );
    expect(events.at(-1)?.type).toBe("run.completed");
    expect(completed.result.cards).toHaveLength(3);
  });

  it("取消后不再继续发出事件", async () => {
    const client = createClient();
    const controller = new AbortController();
    const events: SearchAgentEvent[] = [];

    const promise = client.streamSearch(
      { query, sessionId: "s-1" },
      (event) => events.push(event),
      controller.signal,
    );
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toHaveLength(0);
  });

  it("空结果场景不硬凑人物", async () => {
    const client = createClient({ scenario: "empty-results" });
    const completed = await client.streamSearch({ query, sessionId: "s-1" }, () => undefined);
    expect(completed.result.cards).toHaveLength(0);
  });

  it("搜索失败场景既有 run.failed 事件也会抛出错误", async () => {
    const client = createClient({ scenario: "search-failed" });
    const events: SearchAgentEvent[] = [];

    await expect(
      client.streamSearch({ query, sessionId: "s-1" }, (event) => events.push(event)),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.rateLimited });
    expect(events.at(-1)?.type).toBe("run.failed");
  });

  it("query 少于 4 字被拒绝", async () => {
    const client = createClient();
    await expect(
      client.streamSearch({ query: "abc", sessionId: "s-1" }, () => undefined),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.invalidSearchRequest });
  });

  it("run 恢复：非法 UUID 400，未知 UUID 404", async () => {
    const client = createClient();
    await expect(client.restoreRun("not-a-uuid")).rejects.toMatchObject({ status: 400 });
    await expect(client.restoreRun(deterministicUuid(999999))).rejects.toMatchObject({
      code: API_ERROR_CODES.runNotFound,
    });
  });

  it("compare 返回原始命中与 Agent 结果", async () => {
    const client = createClient();
    const response = await client.compare({ query, sessionId: "s-1" });
    expect(response.raw.hits.length).toBeGreaterThan(0);
    expect(response.agent.cards.length).toBeGreaterThan(0);
  });

  it("创建会话是幂等的：同一 creator + runId 只产生一个会话", async () => {
    const client = createClient();
    const search = await client.streamSearch({ query, sessionId: "s-1" }, () => undefined);
    const first = await client.createConversation({
      creatorId: FIXTURE_CREATORS[0].id,
      sourceRunId: search.runId,
    });
    const second = await client.createConversation({
      creatorId: FIXTURE_CREATORS[0].id,
      sourceRunId: search.runId,
    });
    expect(second.id).toBe(first.id);
  });

  it("相同 clientMessageId 只产生一条消息", async () => {
    const client = createClient();
    const conversation = await createConversation(client);
    const first = await client.sendMessage(conversation.id, {
      clientMessageId: "local-1",
      actorRole: "seeker",
      content: "第一条",
    });
    const second = await client.sendMessage(conversation.id, {
      clientMessageId: "local-1",
      actorRole: "seeker",
      content: "第一条",
    });

    expect(second.id).toBe(first.id);
    const page = await client.listMessages(conversation.id);
    expect(page.items.filter((item) => item.clientMessageId === "local-1")).toHaveLength(1);
  });

  it("空消息与超长消息被拒绝", async () => {
    const client = createClient();
    const conversation = await createConversation(client);

    await expect(
      client.sendMessage(conversation.id, {
        clientMessageId: "empty",
        actorRole: "seeker",
        content: "   ",
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.invalidMessage });

    await expect(
      client.sendMessage(conversation.id, {
        clientMessageId: "long",
        actorRole: "seeker",
        content: "a".repeat(2001),
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.invalidMessage });
  });

  it("未开启答主演示时 creator 角色被拒绝", async () => {
    const client = createClient({ demoRoleSwitcher: false });
    const conversation = await createConversation(client);

    await expect(
      client.sendMessage(conversation.id, {
        clientMessageId: "creator-1",
        actorRole: "creator",
        content: "演示答主消息",
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.demoRoleForbidden, status: 403 });
  });

  it("未知会话统一 404", async () => {
    const client = createClient();
    await expect(client.getConversation("missing")).rejects.toMatchObject({
      code: API_ERROR_CODES.conversationNotFound,
      status: 404,
    });
    await expect(client.listMessages("missing")).rejects.toBeInstanceOf(ApiError);
  });

  it("Agent 流：先返回已保存的用户消息，再增量输出并完成", async () => {
    const client = createClient();
    const conversation = await createConversation(client);
    const events: ConversationAgentEvent[] = [];

    const completed = await client.streamConversationAgent(
      conversation.id,
      { clientMessageId: "agent-1", content: "我该先确认什么？" },
      (event) => events.push(event),
    );

    expect(events[0].type).toBe("agent.run.started");
    expect(
      events.filter((event) => event.type === "agent.message.delta").length,
    ).toBeGreaterThan(1);
    expect(events.at(-1)?.type).toBe("agent.message.completed");
    expect(completed.message.sender).toBe("agent");
    expect(completed.message.content).toContain("演示");

    // 用户消息只保存一次
    const page = await client.listMessages(conversation.id);
    expect(page.items.filter((item) => item.clientMessageId === "agent-1")).toHaveLength(1);
  });

  it("Agent 流中断场景会抛出可重试错误", async () => {
    const client = createClient({ scenario: "agent-stream-truncated" });
    const conversation = await createConversation(client);

    await expect(
      client.streamConversationAgent(
        conversation.id,
        { clientMessageId: "agent-2", content: "中断测试" },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: API_ERROR_CODES.streamIncomplete, retryable: true });
  });

  it("咨询动作按服务端状态机推进，并插入系统消息", async () => {
    const client = createClient();
    const conversation = await createConversation(client);

    const proposed = await client.applyConsultationAction(conversation.id, {
      action: "propose",
      actorRole: "seeker",
      packageId: "voice-30",
    });
    expect(proposed.consultation.status).toBe("proposed");
    expect(proposed.systemMessage.sender).toBe("system");

    const offer = await client.applyConsultationAction(conversation.id, {
      action: "create_offer",
      actorRole: "creator",
      packageId: "voice-30",
    });
    expect(offer.consultation.status).toBe("offer_created");

    const paid = await client.applyConsultationAction(conversation.id, {
      action: "confirm_mock_payment",
      actorRole: "seeker",
      packageId: "voice-30",
    });
    expect(paid.consultation.status).toBe("mock_paid");
    // 金额从套餐（分）取，而不是前端计算
    expect(paid.consultation.amount).toBe(9900);
  });

  it("非法状态转移返回 409 并带上当前状态", async () => {
    const client = createClient();
    const conversation = await createConversation(client);

    const error = await client
      .applyConsultationAction(conversation.id, {
        action: "cancel",
        actorRole: "seeker",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(API_ERROR_CODES.invalidConsultationTransition);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).details).toMatchObject({ status: "free_chat" });
  });

  it("reset 恢复初始消息与免费交流状态", async () => {
    const client = createClient();
    const conversation = await createConversation(client);
    await client.applyConsultationAction(conversation.id, {
      action: "propose",
      actorRole: "seeker",
    });

    const reset = await client.resetConversation(conversation.id);

    expect(reset.conversation.consultation.status).toBe("free_chat");
    expect(reset.messages).toHaveLength(3);
    const page = await client.listMessages(conversation.id);
    expect(page.items).toHaveLength(3);
  });

  it("消息分页支持向前加载更早的消息", async () => {
    const client = createClient({ messagePageSize: 2 });
    const conversation = await createConversation(client);

    const latest = await client.listMessages(conversation.id);
    expect(latest.items).toHaveLength(2);
    expect(latest.nextCursor).toBe("1");

    const older = await client.listMessages(conversation.id, latest.nextCursor ?? undefined);
    expect(older.items).toHaveLength(1);
    expect(older.nextCursor).toBeNull();
  });

  it("套餐返回分为单位的金额", async () => {
    const client = createClient();
    const packages = await client.getConsultationPackages();
    expect(packages.map((item) => item.amount)).toEqual([4900, 9900, 19900]);
    expect(packages.every((item) => item.currency === "CNY")).toBe(true);
  });

  it("热榜返回背景文档且标记为可用", async () => {
    const client = createClient();
    const response = await client.getHotTopics();
    expect(response.unavailable).toBe(false);
    expect(response.topics.length).toBeGreaterThan(0);
    expect(response.topics[0].scope).toBe("background");
  });
});
