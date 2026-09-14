import type { ApiClient } from "@/front/api/ApiClient";
import { ApiError, createAbortError, isAbortError } from "@/front/api/ApiError";
import {
  AGENT_STEP_ORDER,
  type SearchAgentEvent,
  type SearchRunCompletedEvent,
} from "@/shared/contracts/agent";
import type { AuthSessionView } from "@/shared/contracts/auth";
import {
  consultationActionRequestSchema,
  agentMessageRequestSchema,
  messageSchema,
  type ConversationAgentCompletedEvent,
  type ConversationAgentEvent,
  type Conversation,
  type Message,
} from "@/shared/contracts/conversation";
import type {
  ConsultationAction,
  Consultation,
  ConsultationPackage,
  ConsultationStatus,
} from "@/shared/contracts/consultation";
import type { CreatorCardData } from "@/shared/contracts/creator";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import type { FieldGraphResponse, FieldSummary } from "@/shared/contracts/field";
import {
  searchRequestSchema,
  type CompareResponse,
  type HotTopicsResponse,
  type RunRestoreResponse,
  type SearchRequest,
} from "@/shared/contracts/search";

import {
  CONSULTATION_PACKAGES,
  DEFAULT_PACKAGE_ID,
  MOCK_USER,
  findCreatorCard,
} from "@/front/mocks/demo-data";
import {
  featuredFields,
  fieldPersonToCreatorCard,
  findFieldGraph,
  findFieldPerson,
  searchFixtureFields,
} from "@/front/mocks/field-data";
import {
  buildInitialMessages,
  buildMockConversation,
  buildMockConsultation,
  buildSystemMessage,
  buildAgentReplyDeltas,
  mockTimestamp,
} from "@/front/mocks/mock-conversation";
import {
  MOCK_AGENT_REQUEST_ID,
  MOCK_RUN_ID,
  MOCK_SEARCH_REQUEST_ID,
  MOCK_STEP_MESSAGES,
  buildMockCompareResponse,
  buildMockSearchResult,
} from "@/front/mocks/mock-search-result";

export const MOCK_AUTH_STATES = [
  "authenticated",
  "anonymous",
  "unconfigured",
] as const;

export type MockAuthState = (typeof MOCK_AUTH_STATES)[number];

export const MOCK_SCENARIOS = [
  "default",
  "empty-results",
  "search-failed",
  "agent-stream-failed",
  "agent-stream-truncated",
  "consultation-conflict",
  /** 领域检索失败：验证领域目录页的「重试」与「保留已有推荐」行为。 */
  "field-search-failed",
  /** 星图 404：验证领域详情页的错误态与返回目录入口。 */
  "field-graph-missing",
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export type MockApiClientOptions = {
  authState?: MockAuthState;
  /** 是否允许「答主视角」演示消息；真实后端可以拒绝该角色。 */
  demoRoleSwitcher?: boolean;
  /** 每两个流事件之间的间隔，测试传 0 让事件同步完成。 */
  stepDelayMs?: number;
  /** 消息分页大小，测试可以调小以覆盖「加载更多」。 */
  messagePageSize?: number;
  scenario?: MockScenario;
  /**
   * 是否把 Mock 的后端状态镜像到 sessionStorage。
   * 这样刷新页面（Mock 就是「后端」，内存会丢）仍能演示恢复流程。
   * 测试可以关闭它以避免用例之间互相污染。
   */
  persist?: boolean;
};

type PersistedState = {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  runs: RunRestoreResponse[];
  messageIdByClientId: Record<string, string>;
  counter: number;
};

const MOCK_BACKEND_KEY = "zhihu-wenren:mock-backend:v1";

const HOT_TOPIC_TITLES = [
  "降薪换期权到底值不值（演示）",
  "从大厂到创业公司的第一年（演示）",
  "第一次带团队最容易忽略的事（演示）",
  "AI 创业公司怎么判断真实需求（演示）",
];

/** Mock 需要模拟「非法状态转移」，因此显式声明每个角色允许的动作。 */
const ALLOWED_TRANSITIONS: Record<
  "seeker" | "creator",
  Partial<Record<ConsultationAction, ConsultationStatus[]>>
> = {
  seeker: {
    propose: ["free_chat"],
    cancel: ["proposed"],
    confirm_mock_payment: ["offer_created"],
  },
  creator: {
    create_offer: ["free_chat", "proposed"],
    withdraw_offer: ["offer_created"],
    start_consultation: ["mock_paid"],
  },
};

const SYSTEM_MESSAGES: Record<ConsultationAction, string> = {
  propose: "用户发起了付费咨询意向（模拟）。",
  cancel: "用户取消了咨询意向（模拟）。",
  create_offer: "答主创建了付费咨询方案（模拟）。",
  withdraw_offer: "答主撤回了咨询方案（模拟）。",
  confirm_mock_payment: "用户完成了模拟支付（模拟）。",
  start_consultation: "答主开始了本次模拟咨询（模拟）。",
};

function cloneMessage(message: Message): Message {
  return { ...message };
}

/**
 * 完全确定性的 Mock 后端。
 *
 * 它只实现 `ApiClient` 契约：用内存 Map 表达后端业务状态，
 * 不使用随机数，不访问网络，不读写任何真实凭据。
 */
export class MockApiClient implements ApiClient {
  private readonly authState: MockAuthState;
  private readonly demoRoleSwitcher: boolean;
  private readonly stepDelayMs: number;
  private readonly messagePageSize: number;
  private readonly scenario: MockScenario;
  private readonly persist: boolean;

  private conversations = new Map<string, Conversation>();
  private messages = new Map<string, Message[]>();
  private runs = new Map<string, RunRestoreResponse>();
  private messageIdByClientId = new Map<string, string>();
  private counter = 500;

  constructor(options: MockApiClientOptions = {}) {
    this.authState = options.authState ?? "authenticated";
    this.demoRoleSwitcher = options.demoRoleSwitcher ?? true;
    this.stepDelayMs = options.stepDelayMs ?? 90;
    this.messagePageSize = options.messagePageSize ?? 50;
    this.scenario = options.scenario ?? "default";
    this.persist = options.persist ?? true;
    if (this.persist) this.hydrate();
  }

  /* ------------------------------------------------------------------ */
  /* 内部工具                                                           */
  /* ------------------------------------------------------------------ */

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw createAbortError();
    if (ms > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(createAbortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    } else {
      await Promise.resolve();
    }
    if (signal?.aborted) throw createAbortError();
  }

  private emit<T>(onEvent: (event: T) => void, event: T, signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError();
    onEvent(event);
  }

  private hydrate(): void {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    try {
      const raw = window.sessionStorage.getItem(MOCK_BACKEND_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      for (const conversation of parsed.conversations ?? []) {
        this.conversations.set(conversation.id, conversation);
      }
      for (const [id, list] of Object.entries(parsed.messages ?? {})) {
        this.messages.set(id, list);
      }
      for (const run of parsed.runs ?? []) {
        this.runs.set(run.runId, run);
      }
      this.messageIdByClientId = new Map(
        Object.entries(parsed.messageIdByClientId ?? {}),
      );
      this.counter = parsed.counter ?? this.counter;
    } catch {
      // 镜像数据损坏时从干净状态开始，不影响主流程。
    }
  }

  private mirror(): void {
    if (!this.persist) return;
    if (typeof window === "undefined" || !window.sessionStorage) return;
    try {
      const state: PersistedState = {
        conversations: [...this.conversations.values()],
        messages: Object.fromEntries(this.messages),
        runs: [...this.runs.values()],
        messageIdByClientId: Object.fromEntries(this.messageIdByClientId),
        counter: this.counter,
      };
      window.sessionStorage.setItem(MOCK_BACKEND_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时静默降级。
    }
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.conversations.get(id);
    if (!conversation) {
      throw new ApiError({
        code: API_ERROR_CODES.conversationNotFound,
        message: "这个会话不存在或已过期。",
        status: 404,
        retryable: false,
      });
    }
    return conversation;
  }

  private listOf(conversationId: string): Message[] {
    return this.messages.get(conversationId) ?? [];
  }

  private appendMessage(conversationId: string, message: Message): void {
    const list = [...this.listOf(conversationId), message];
    this.messages.set(conversationId, list);
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      this.conversations.set(conversationId, {
        ...conversation,
        updatedAt: message.createdAt,
      });
    }
    this.mirror();
  }

  private saveUserMessage(
    conversationId: string,
    clientMessageId: string,
    content: string,
  ): Message {
    const existingId = this.messageIdByClientId.get(clientMessageId);
    if (existingId) {
      const found = this.listOf(conversationId).find(
        (message) => message.id === existingId,
      );
      if (found) return found;
    }
    const message: Message = messageSchema.parse({
      id: this.nextId(`${conversationId}-seeker`),
      conversationId,
      clientMessageId,
      sender: "seeker",
      content,
      createdAt: mockTimestamp(1000 + this.counter),
    });
    this.messageIdByClientId.set(clientMessageId, message.id);
    this.appendMessage(conversationId, message);
    return message;
  }

  /* ------------------------------------------------------------------ */
  /* 会话与检索                                                         */
  /* ------------------------------------------------------------------ */

  async getSession(signal?: AbortSignal): Promise<AuthSessionView> {
    await this.delay(this.stepDelayMs, signal);
    if (this.authState === "unconfigured") {
      return { configured: false, authenticated: false, user: null };
    }
    if (this.authState === "anonymous") {
      return { configured: true, authenticated: false, user: null };
    }
    return { configured: true, authenticated: true, user: MOCK_USER };
  }

  async getHotTopics(signal?: AbortSignal): Promise<HotTopicsResponse> {
    await this.delay(this.stepDelayMs, signal);
    return {
      unavailable: false,
      topics: HOT_TOPIC_TITLES.map((title, index) => ({
        scope: "background" as const,
        source: "hot_list" as const,
        title,
        excerpt: "热榜只作为提问参考，不参与人物推荐（演示数据）。",
        url: `https://www.zhihu.com/question/00000001${index}`,
        thumbnailUrl: null,
        publishedAt: 1_776_000_000 + index,
      })),
    };
  }

  async streamSearch(
    input: SearchRequest,
    onEvent: (event: SearchAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<SearchRunCompletedEvent> {
    const parsed = searchRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError({
        code: API_ERROR_CODES.invalidSearchRequest,
        message: "请把问题控制在 4～300 字之间。",
        status: 400,
        retryable: false,
      });
    }
    const query = parsed.data.query;

    await this.delay(this.stepDelayMs, signal);
    this.emit(
      onEvent,
      { type: "run.started", requestId: MOCK_SEARCH_REQUEST_ID },
      signal,
    );

    const stepsToRun =
      this.scenario === "search-failed" ? AGENT_STEP_ORDER.slice(0, 2) : AGENT_STEP_ORDER;

    for (const step of stepsToRun) {
      await this.delay(this.stepDelayMs, signal);
      this.emit(
        onEvent,
        { type: "step.started", step, message: MOCK_STEP_MESSAGES[step] },
        signal,
      );
      await this.delay(this.stepDelayMs, signal);
      this.emit(
        onEvent,
        { type: "step.completed", step, message: MOCK_STEP_MESSAGES[step] },
        signal,
      );
    }

    if (this.scenario === "search-failed") {
      const error = {
        code: API_ERROR_CODES.rateLimited,
        message: "演示模式：本次检索被限流，请稍后重试。",
        retryable: true,
      };
      this.emit(onEvent, { type: "run.failed", error }, signal);
      throw new ApiError({ ...error, status: 429 });
    }

    const result =
      this.scenario === "empty-results"
        ? buildMockSearchResult(query, "empty")
        : buildMockSearchResult(query);

    this.runs.set(result.runId ?? MOCK_RUN_ID, {
      runId: result.runId ?? MOCK_RUN_ID,
      cards: result.cards,
      mode: result.modeUsed,
      contextStatus: result.contextStatus,
      analyzedCount: result.analyzedContentCount,
      rejectedCount: result.rejectedContentCount,
      fallbackReason: result.fallbackReason?.slice(0, 80) ?? null,
      modelFallback: result.modelFallback,
      contextSourceCounts: result.contextSourceCounts,
      searchedQueries: result.searchedQueries,
      background: result.background,
      // 能存进 runs 就一定取得到，因此恢复响应里只能是 saved。
      persistence: "saved",
      createdAt: 1_776_000_000,
      expiresAt: 1_776_600_000,
    });
    this.mirror();

    const event: SearchRunCompletedEvent = {
      type: "run.completed",
      result,
      runId: result.runId,
      persistence: result.persistence,
    };
    this.emit(onEvent, event, signal);
    return event;
  }

  async restoreRun(runId: string, signal?: AbortSignal): Promise<RunRestoreResponse> {
    await this.delay(this.stepDelayMs, signal);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
      throw new ApiError({
        code: API_ERROR_CODES.invalidSearchRequest,
        message: "运行标识格式不正确。",
        status: 400,
        retryable: false,
      });
    }
    const run = this.runs.get(runId);
    if (!run) {
      throw new ApiError({
        code: API_ERROR_CODES.runNotFound,
        message: "这次搜索结果不存在或已过期。",
        status: 404,
        retryable: false,
      });
    }
    return run;
  }

  async compare(input: SearchRequest, signal?: AbortSignal): Promise<CompareResponse> {
    const parsed = searchRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError({
        code: API_ERROR_CODES.invalidSearchRequest,
        message: "请把问题控制在 4～300 字之间。",
        status: 400,
        retryable: false,
      });
    }
    await this.delay(this.stepDelayMs * 4, signal);
    return buildMockCompareResponse(parsed.data.query);
  }

  /* ------------------------------------------------------------------ */
  /* 专业领域                                                           */
  /* ------------------------------------------------------------------ */

  async getFeaturedFields(signal?: AbortSignal): Promise<FieldSummary[]> {
    await this.delay(this.stepDelayMs, signal);
    return featuredFields().map((field) => ({ ...field }));
  }

  async searchFields(
    query: string,
    limit = 8,
    signal?: AbortSignal,
  ): Promise<FieldSummary[]> {
    await this.delay(this.stepDelayMs, signal);
    if (this.scenario === "field-search-failed") {
      throw new ApiError({
        code: API_ERROR_CODES.fieldSearchFailed,
        message: "演示模式：领域检索暂时不可用，请稍后重试。",
        status: 503,
        retryable: true,
      });
    }
    // 领域检索只返回领域；这里不会退化成人物搜索。
    return searchFixtureFields(query, limit).map((field) => ({ ...field }));
  }

  async getFieldGraph(
    fieldId: string,
    signal?: AbortSignal,
  ): Promise<FieldGraphResponse> {
    await this.delay(this.stepDelayMs, signal);
    const graph = this.scenario === "field-graph-missing" ? null : findFieldGraph(fieldId);
    if (!graph) {
      throw new ApiError({
        code: API_ERROR_CODES.fieldNotFound,
        message: "这个领域不存在或已下线。",
        status: 404,
        retryable: false,
      });
    }
    return graph;
  }

  async getCreator(creatorId: string, signal?: AbortSignal): Promise<CreatorCardData> {
    await this.delay(this.stepDelayMs, signal);
    // 问题找人来源的人物带内容证据，优先返回。
    const card = findCreatorCard(creatorId);
    if (card) return card;
    const person = findFieldPerson(creatorId);
    if (person) return fieldPersonToCreatorCard(person);
    throw new ApiError({
      code: API_ERROR_CODES.notFound,
      message: "找不到这个人的公开资料。",
      status: 404,
      retryable: false,
    });
  }

  /* ------------------------------------------------------------------ */
  /* 会话与消息                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * 解析人物：先看本次搜索结果，再看问题找人的固定人物，最后看领域目录。
   *
   * 找不到就抛 404——绝不能像早期实现那样回退到「第一个人物」，
   * 否则用领域人物的 ID 建会话会拿到一个完全不相干的人的对话。
   */
  private resolveCreator(
    creatorId: string,
    sourceRunId: string | null,
  ): CreatorCardData {
    const run = sourceRunId ? this.runs.get(sourceRunId) : undefined;
    const fromRun = run?.cards.find((item) => item.id === creatorId);
    if (fromRun) return fromRun;

    const fixture = findCreatorCard(creatorId);
    if (fixture) return fixture;

    const person = findFieldPerson(creatorId);
    if (person) return fieldPersonToCreatorCard(person);

    throw new ApiError({
      code: API_ERROR_CODES.notFound,
      message: "找不到这个人的公开资料，无法创建会话。",
      status: 404,
      retryable: false,
    });
  }

  async createConversation(
    input: { creatorId: string; sourceRunId: string | null },
    signal?: AbortSignal,
  ): Promise<Conversation> {
    await this.delay(this.stepDelayMs, signal);

    const creator = this.resolveCreator(input.creatorId, input.sourceRunId ?? null);

    for (const conversation of this.conversations.values()) {
      if (
        conversation.creator.id === creator.id &&
        conversation.sourceRunId === (input.sourceRunId ?? null)
      ) {
        return conversation;
      }
    }

    const conversation = buildMockConversation({
      id: this.nextId(`conversation-${creator.id}`),
      creator,
      user: MOCK_USER,
      sourceRunId: input.sourceRunId ?? null,
      offsetSeconds: 100 + this.counter,
    });
    this.conversations.set(conversation.id, conversation);
    this.messages.set(
      conversation.id,
      buildInitialMessages(conversation.id, creator, 100 + this.counter),
    );
    this.mirror();
    return conversation;
  }

  async getConversation(id: string, signal?: AbortSignal): Promise<Conversation> {
    await this.delay(this.stepDelayMs, signal);
    return this.requireConversation(id);
  }

  async listMessages(
    id: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ items: Message[]; nextCursor: string | null }> {
    await this.delay(this.stepDelayMs, signal);
    this.requireConversation(id);
    const all = this.listOf(id);
    const end = cursor ? Math.min(Number(cursor), all.length) : all.length;
    const start = Math.max(0, end - this.messagePageSize);
    const items = all.slice(start, end).map(cloneMessage);
    return { items, nextCursor: start > 0 ? String(start) : null };
  }

  async sendMessage(
    id: string,
    input: {
      clientMessageId: string;
      actorRole: "seeker" | "creator";
      content: string;
    },
    signal?: AbortSignal,
  ): Promise<Message> {
    await this.delay(this.stepDelayMs, signal);
    this.requireConversation(id);

    const content = input.content.trim();
    if (!content || content.length > 2000) {
      throw new ApiError({
        code: API_ERROR_CODES.invalidMessage,
        message: "消息不能为空，且不超过 2000 字。",
        status: 400,
        retryable: false,
      });
    }
    if (input.actorRole === "creator" && !this.demoRoleSwitcher) {
      throw new ApiError({
        code: API_ERROR_CODES.demoRoleForbidden,
        message: "当前部署不允许发送演示答主消息。",
        status: 403,
        retryable: false,
      });
    }

    const existingId = this.messageIdByClientId.get(input.clientMessageId);
    if (existingId) {
      const existing = this.listOf(id).find((message) => message.id === existingId);
      if (existing) return existing;
    }

    const message = messageSchema.parse({
      id: this.nextId(`${id}-${input.actorRole}`),
      conversationId: id,
      clientMessageId: input.clientMessageId,
      sender: input.actorRole,
      content,
      createdAt: mockTimestamp(2000 + this.counter),
    });
    this.messageIdByClientId.set(input.clientMessageId, message.id);
    this.appendMessage(id, message);
    return message;
  }

  async streamConversationAgent(
    id: string,
    input: { clientMessageId: string; content: string },
    onEvent: (event: ConversationAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<ConversationAgentCompletedEvent> {
    const parsed = agentMessageRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError({
        code: API_ERROR_CODES.invalidMessage,
        message: "消息不能为空，且不超过 2000 字。",
        status: 400,
        retryable: false,
      });
    }
    this.requireConversation(id);

    await this.delay(this.stepDelayMs, signal);
    const userMessage = this.saveUserMessage(
      id,
      parsed.data.clientMessageId,
      parsed.data.content,
    );
    this.emit(
      onEvent,
      {
        type: "agent.run.started",
        requestId: MOCK_AGENT_REQUEST_ID,
        userMessage,
      },
      signal,
    );

    const messageId = this.nextId(`${id}-agent`);
    this.emit(onEvent, { type: "agent.message.started", messageId }, signal);

    const deltas = buildAgentReplyDeltas(
      this.requireConversation(id).creator,
      parsed.data.content,
    );
    // 中断场景要在最后一个分片之前断掉：真正的连接断开不会把尾句也送过来。
    const planned =
      this.scenario === "agent-stream-truncated" ? deltas.slice(0, -1) : deltas;
    const streamed: string[] = [];
    for (const delta of planned) {
      await this.delay(this.stepDelayMs, signal);
      streamed.push(delta);
      this.emit(onEvent, { type: "agent.message.delta", messageId, delta }, signal);
    }

    if (this.scenario === "agent-stream-truncated") {
      throw new ApiError({
        code: API_ERROR_CODES.streamIncomplete,
        message: "Agent 回复中断，请重试。",
        retryable: true,
      });
    }
    if (this.scenario === "agent-stream-failed") {
      this.emit(
        onEvent,
        {
          type: "agent.run.failed",
          requestId: MOCK_AGENT_REQUEST_ID,
          error: {
            code: API_ERROR_CODES.persistenceUnavailable,
            message: "演示模式：本次 Agent 回复保存失败。",
            retryable: true,
          },
        },
        signal,
      );
      throw new ApiError({
        code: API_ERROR_CODES.persistenceUnavailable,
        message: "演示模式：本次 Agent 回复保存失败。",
        status: 503,
        retryable: true,
      });
    }

    const message = messageSchema.parse({
      id: messageId,
      conversationId: id,
      clientMessageId: null,
      sender: "agent",
      content: streamed.join(""),
      createdAt: mockTimestamp(3000 + this.counter),
    });
    this.appendMessage(id, message);

    const event: ConversationAgentCompletedEvent = {
      type: "agent.message.completed",
      message,
    };
    this.emit(onEvent, event, signal);
    return event;
  }

  /* ------------------------------------------------------------------ */
  /* 咨询                                                               */
  /* ------------------------------------------------------------------ */

  async getConsultationPackages(
    signal?: AbortSignal,
  ): Promise<ConsultationPackage[]> {
    await this.delay(this.stepDelayMs, signal);
    return CONSULTATION_PACKAGES.map((item) => ({ ...item }));
  }

  async applyConsultationAction(
    id: string,
    input: {
      action: ConsultationAction;
      actorRole: "seeker" | "creator";
      packageId?: string;
    },
    signal?: AbortSignal,
  ) {
    await this.delay(this.stepDelayMs, signal);
    const conversation = this.requireConversation(id);

    // 演示「服务端已经改过状态」：前端拿到的旧状态提交动作时会被拒绝。
    if (this.scenario === "consultation-conflict") {
      throw new ApiError({
        code: API_ERROR_CODES.invalidConsultationTransition,
        message: "当前咨询状态不允许这个操作，已按服务端状态回正。",
        status: 409,
        retryable: false,
        details: conversation.consultation,
      });
    }

    const parsed = consultationActionRequestSchema.safeParse({
      action: input.action,
      actorRole: input.actorRole,
      packageId: input.packageId ?? conversation.consultation.packageId ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError({
        code: API_ERROR_CODES.invalidConsultationTransition,
        message: "这个咨询动作缺少必要参数。",
        status: 400,
        retryable: false,
        details: conversation.consultation,
      });
    }

    const allowed = ALLOWED_TRANSITIONS[input.actorRole][input.action];
    if (!allowed || !allowed.includes(conversation.consultation.status)) {
      throw new ApiError({
        code: API_ERROR_CODES.invalidConsultationTransition,
        message: "当前咨询状态不允许这个操作，已按服务端状态回正。",
        status: 409,
        retryable: false,
        details: conversation.consultation,
      });
    }

    const nextStatus: ConsultationStatus = (() => {
      switch (input.action) {
        case "propose":
          return "proposed";
        case "cancel":
        case "withdraw_offer":
          return "free_chat";
        case "create_offer":
          return "offer_created";
        case "confirm_mock_payment":
          return "mock_paid";
        case "start_consultation":
          return "consulting";
        default:
          return conversation.consultation.status;
      }
    })();

    const packageId = parsed.data.packageId ?? conversation.consultation.packageId;
    const selected = CONSULTATION_PACKAGES.find((item) => item.id === packageId);
    const amount =
      input.action === "confirm_mock_payment"
        ? (selected?.amount ?? null)
        : input.action === "withdraw_offer" || input.action === "cancel"
          ? null
          : conversation.consultation.amount;

    const consultation: Consultation = buildMockConsultation(
      id,
      nextStatus,
      packageId ?? null,
      amount,
      4000 + this.counter,
    );

    const systemMessage = buildSystemMessage(
      id,
      SYSTEM_MESSAGES[input.action],
      this.nextId(`${id}-system`),
      4000 + this.counter,
    );

    this.conversations.set(id, {
      ...conversation,
      consultation,
      updatedAt: systemMessage.createdAt,
    });
    this.appendMessage(id, systemMessage);
    this.mirror();

    return { consultation, systemMessage };
  }

  async resetConversation(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ conversation: Conversation; messages: Message[] }> {
    await this.delay(this.stepDelayMs, signal);
    const conversation = this.requireConversation(id);
    const resetConversation = {
      ...conversation,
      consultation: buildMockConsultation(
        id,
        "free_chat",
        DEFAULT_PACKAGE_ID,
        null,
        0,
      ),
    };
    const messages = buildInitialMessages(id, conversation.creator, 5000 + this.counter);
    this.conversations.set(id, resetConversation);
    this.messages.set(id, messages);
    this.mirror();
    return { conversation: resetConversation, messages };
  }

  /** 供测试与调试使用：判断取消是否被当作取消而不是失败。 */
  static isCancel(caught: unknown): boolean {
    return isAbortError(caught);
  }
}
