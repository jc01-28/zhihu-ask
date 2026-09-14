import type { z } from "zod";

import type { ApiClient } from "@/front/api/ApiClient";
import { ApiError, networErrorFrom } from "@/front/api/ApiError";
import { parseNdjsonStream } from "@/front/api/ndjson";
import {
  isTerminalSearchEvent,
  searchAgentEventSchema,
  type SearchRunCompletedEvent,
} from "@/shared/contracts/agent";
import type { AuthSessionView } from "@/shared/contracts/auth";
import {
  consultationActionResponseSchema,
  conversationAgentEventSchema,
  conversationEnvelopeSchema,
  isTerminalConversationEvent,
  messageEnvelopeSchema,
  messageListResponseSchema,
  resetConversationResponseSchema,
  type ConversationAgentCompletedEvent,
  type ConversationAgentEvent,
  type Conversation,
  type Message,
} from "@/shared/contracts/conversation";
import {
  consultationPackageListSchema,
  type ConsultationAction,
  type ConsultationPackage,
} from "@/shared/contracts/consultation";
import {
  creatorCardSchema,
  type CreatorCardData,
} from "@/shared/contracts/creator";
import {
  fieldGraphResponseSchema,
  fieldListResponseSchema,
  type FieldGraphResponse,
  type FieldSummary,
} from "@/shared/contracts/field";
import {
  API_ERROR_CODES,
  apiErrorEnvelopeSchema,
  type ApiErrorEnvelope,
} from "@/shared/contracts/errors";
import {
  authSessionViewSchema,
  type SearchAgentEvent,
} from "@/shared/contracts";
import {
  compareResponseSchema,
  hotTopicsResponseSchema,
  runRestoreResponseSchema,
  searchRequestSchema,
  type CompareResponse,
  type HotTopicsResponse,
  type RunRestoreResponse,
  type SearchRequest,
} from "@/shared/contracts/search";

export type HttpApiClientOptions = {
  /** 默认空字符串：只发相对路径请求，浏览器不会出现跨站 Cookie 问题。 */
  baseUrl?: string;
  /** 任何 401 都收敛到这一处，触发全局会话刷新。 */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
};

const DEFAULT_ERROR: Record<number, { code: string; message: string }> = {
  400: { code: API_ERROR_CODES.invalidSearchRequest, message: "请求参数不正确。" },
  401: { code: API_ERROR_CODES.authRequired, message: "知乎授权已失效，请重新登录。" },
  403: { code: API_ERROR_CODES.demoRoleForbidden, message: "当前账号没有该操作权限。" },
  404: { code: API_ERROR_CODES.notFound, message: "请求的资源不存在或已过期。" },
  409: { code: "CONFLICT", message: "当前状态不允许这个操作。" },
  429: { code: API_ERROR_CODES.rateLimited, message: "请求过于频繁，请稍后重试。" },
  503: {
    code: API_ERROR_CODES.persistenceUnavailable,
    message: "服务暂时不可用，请稍后重试。",
  },
};

function fallbackForStatus(status: number): ApiErrorEnvelope {
  const known = DEFAULT_ERROR[status];
  return {
    code: known?.code ?? `HTTP_${status}`,
    message: known?.message ?? "请求失败，请稍后重试。",
    retryable: status >= 500 || status === 429,
  };
}

export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly onUnauthorized?: () => void;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.onUnauthorized = options.onUnauthorized;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async readErrorEnvelope(response: Response): Promise<ApiErrorEnvelope> {
    try {
      const payload: unknown = await response.json();
      const parsed = apiErrorEnvelopeSchema.safeParse(payload);
      if (parsed.success) return parsed.data;
    } catch {
      // 非 JSON 错误体：退回按状态码推断。
    }
    return fallbackForStatus(response.status);
  }

  private async send(
    path: string,
    init: RequestInit,
    options: { refreshOnUnauthorized?: boolean } = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        credentials: "include",
        ...init,
      });
    } catch (caught) {
      throw networErrorFrom(caught);
    }

    if (!response.ok) {
      const envelope = await this.readErrorEnvelope(response);
      // 会话探测（`GET /api/auth/session`）自己的 401 就是答案本身，
      // 不是「会话过期了」这个事件：它必须跳过全局刷新。
      //
      // 否则会形成死循环——401 → 自增 authEpoch → 会话探测重新执行 → 又是 401。
      // 用 Mock 后端永远看不到它（Mock 不会返回 401），只有接上真实后端、
      // 且会话真的失效时才会暴露：3 秒内会打出几百次请求。
      if (response.status === 401 && options.refreshOnUnauthorized !== false) {
        this.onUnauthorized?.();
      }
      throw new ApiError({
        code: envelope.code,
        message: envelope.message,
        retryable: envelope.retryable,
        status: response.status,
        // 必须把 details 带上去：少数接口（目前是咨询 409）靠它把界面回正到
        // 服务端的真实状态。丢掉它不会报错，只会让那条分支在真实后端下永不生效。
        details: envelope.details,
      });
    }

    return response;
  }

  private async requestJson<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      schema: z.ZodType<T>;
      signal?: AbortSignal;
      accept?: string;
      /** 传 `false` 表示这个请求的 401 属于业务答案，不触发全局会话刷新。 */
      refreshOnUnauthorized?: boolean;
    },
  ): Promise<T> {
    const response = await this.send(
      path,
      {
        method: options.method ?? "GET",
        signal: options.signal,
        headers: {
          Accept: options.accept ?? "application/json",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json; charset=utf-8" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { refreshOnUnauthorized: options.refreshOnUnauthorized },
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError({
        code: API_ERROR_CODES.invalidResponse,
        message: "服务端返回的内容无法解析。",
        retryable: true,
        status: response.status,
      });
    }

    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError({
        code: API_ERROR_CODES.invalidResponse,
        message: "服务端返回的内容不符合约定契约。",
        retryable: false,
        status: response.status,
        details: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  private async openStream(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.send(path, {
      method: "POST",
      signal,
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
  }

  getSession(signal?: AbortSignal): Promise<AuthSessionView> {
    return this.requestJson("/api/auth/session", {
      schema: authSessionViewSchema,
      signal,
      // 会话探测是授权状态的权威来源：它的 401 表示「未授权」，
      // 而不是「刚才还有效的会话失效了」。见 `send()` 里的说明。
      refreshOnUnauthorized: false,
    });
  }

  getHotTopics(signal?: AbortSignal): Promise<HotTopicsResponse> {
    return this.requestJson("/api/topics/hot", {
      schema: hotTopicsResponseSchema,
      signal,
    });
  }

  /* ------------------------------------------------------------------ */
  /* 专业领域                                                           */
  /* ------------------------------------------------------------------ */

  async getFeaturedFields(signal?: AbortSignal): Promise<FieldSummary[]> {
    const payload = await this.requestJson("/api/fields/featured", {
      schema: fieldListResponseSchema,
      signal,
    });
    return payload.items;
  }

  async searchFields(
    query: string,
    limit = 8,
    signal?: AbortSignal,
  ): Promise<FieldSummary[]> {
    const search = new URLSearchParams({ query, limit: String(limit) });
    const payload = await this.requestJson(`/api/fields?${search.toString()}`, {
      schema: fieldListResponseSchema,
      signal,
    });
    // 字段搜索的返回永远是领域：即使后端返回了人物，契约也会在这里直接拒绝。
    return payload.items;
  }

  getFieldGraph(
    fieldId: string,
    signal?: AbortSignal,
  ): Promise<FieldGraphResponse> {
    return this.requestJson(
      `/api/fields/${encodeURIComponent(fieldId)}/graph`,
      { schema: fieldGraphResponseSchema, signal },
    );
  }

  getCreator(creatorId: string, signal?: AbortSignal): Promise<CreatorCardData> {
    return this.requestJson(`/api/creators/${encodeURIComponent(creatorId)}`, {
      schema: creatorCardSchema,
      signal,
    });
  }

  async streamSearch(
    input: SearchRequest,
    onEvent: (event: SearchAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<SearchRunCompletedEvent> {
    const payload = searchRequestSchema.parse(input);
    const response = await this.openStream("/api/agent/search", payload, signal);
    const terminal = await parseNdjsonStream<SearchAgentEvent>({
      response,
      schema: searchAgentEventSchema,
      onEvent,
      signal,
      isTerminal: isTerminalSearchEvent,
    });

    if (terminal.type === "run.failed") {
      throw new ApiError({
        code: terminal.error.code,
        message: terminal.error.message,
        retryable: terminal.error.retryable,
      });
    }
    if (terminal.type !== "run.completed") {
      throw new ApiError({
        code: API_ERROR_CODES.streamIncomplete,
        message: "搜索流没有返回完整结果。",
        retryable: true,
      });
    }
    return terminal;
  }

  restoreRun(runId: string, signal?: AbortSignal): Promise<RunRestoreResponse> {
    return this.requestJson(`/api/agent/runs/${encodeURIComponent(runId)}`, {
      schema: runRestoreResponseSchema,
      signal,
    });
  }

  async compare(
    input: SearchRequest,
    signal?: AbortSignal,
  ): Promise<CompareResponse> {
    const payload = searchRequestSchema.parse(input);
    return this.requestJson("/api/compare", {
      method: "POST",
      body: payload,
      schema: compareResponseSchema,
      signal,
    });
  }

  async createConversation(
    input: { creatorId: string; sourceRunId: string | null },
    signal?: AbortSignal,
  ): Promise<Conversation> {
    const payload = await this.requestJson("/api/conversations", {
      method: "POST",
      body: input,
      schema: conversationEnvelopeSchema,
      signal,
    });
    return payload.conversation;
  }

  async getConversation(id: string, signal?: AbortSignal): Promise<Conversation> {
    const payload = await this.requestJson(
      `/api/conversations/${encodeURIComponent(id)}`,
      { schema: conversationEnvelopeSchema, signal },
    );
    return payload.conversation;
  }

  listMessages(
    id: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ items: Message[]; nextCursor: string | null }> {
    const search = new URLSearchParams({ limit: "50" });
    if (cursor) search.set("cursor", cursor);
    return this.requestJson(
      `/api/conversations/${encodeURIComponent(id)}/messages?${search.toString()}`,
      { schema: messageListResponseSchema, signal },
    );
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
    const payload = await this.requestJson(
      `/api/conversations/${encodeURIComponent(id)}/messages`,
      { method: "POST", body: input, schema: messageEnvelopeSchema, signal },
    );
    return payload.message;
  }

  async streamConversationAgent(
    id: string,
    input: { clientMessageId: string; content: string },
    onEvent: (event: ConversationAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<ConversationAgentCompletedEvent> {
    const response = await this.openStream(
      `/api/conversations/${encodeURIComponent(id)}/agent-runs`,
      input,
      signal,
    );
    const terminal = await parseNdjsonStream<ConversationAgentEvent>({
      response,
      schema: conversationAgentEventSchema,
      onEvent,
      signal,
      isTerminal: isTerminalConversationEvent,
    });

    if (terminal.type === "agent.run.failed") {
      throw new ApiError({
        code: terminal.error.code,
        message: terminal.error.message,
        retryable: terminal.error.retryable,
      });
    }
    if (terminal.type !== "agent.message.completed") {
      throw new ApiError({
        code: API_ERROR_CODES.streamIncomplete,
        message: "Agent 回复流没有完整结束。",
        retryable: true,
      });
    }
    return terminal;
  }

  async getConsultationPackages(
    signal?: AbortSignal,
  ): Promise<ConsultationPackage[]> {
    const payload = await this.requestJson("/api/consultation/packages", {
      schema: consultationPackageListSchema,
      signal,
    });
    return payload.items;
  }

  applyConsultationAction(
    id: string,
    input: {
      action: ConsultationAction;
      actorRole: "seeker" | "creator";
      packageId?: string;
    },
    signal?: AbortSignal,
  ) {
    return this.requestJson(
      `/api/conversations/${encodeURIComponent(id)}/consultation/actions`,
      {
        method: "POST",
        body: input,
        schema: consultationActionResponseSchema,
        signal,
      },
    );
  }

  resetConversation(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ conversation: Conversation; messages: Message[] }> {
    return this.requestJson(
      `/api/conversations/${encodeURIComponent(id)}/reset`,
      { method: "POST", schema: resetConversationResponseSchema, signal },
    );
  }
}
