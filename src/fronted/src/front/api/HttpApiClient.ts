import { z } from "zod";

import type { ApiClient } from "@/front/api/ApiClient";
import { ApiError, networErrorFrom } from "@/front/api/ApiError";
import { parseNdjsonStream } from "@/front/api/ndjson";
import { mapBackendAskResult, mapBackendFieldGraph, mapBackendFieldList, unwrapBackendEnvelope } from "@/front/api/backend-adapter";
import {
  isTerminalSearchEvent,
  searchAgentEventSchema,
  type SearchAgentEvent,
  type SearchRunCompletedEvent,
} from "@/shared/contracts/agent";
import { authSessionViewSchema, type AuthSessionView } from "@/shared/contracts/auth";
import {
  agentMessageRequestSchema,
  conversationAgentEventSchema,
  conversationEnvelopeSchema,
  consultationActionRequestSchema,
  consultationActionResponseSchema,
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
import { creatorCardSchema, type CreatorCardData } from "@/shared/contracts/creator";
import { fieldGraphResponseSchema, fieldListResponseSchema, type FieldGraphResponse, type FieldSummary } from "@/shared/contracts/field";
import { API_ERROR_CODES, apiErrorEnvelopeSchema, type ApiErrorEnvelope } from "@/shared/contracts/errors";
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

type HttpApiClientOptions = { baseUrl?: string; onUnauthorized?: () => void; fetchImpl?: typeof fetch };

const backendAuthSessionSchema = z.object({
  configured: z.boolean(),
  authenticated: z.boolean(),
  user: z.union([
    z.object({ name: z.string().nullable().optional(), avatarUrl: z.string().nullable().optional(), url: z.string().nullable().optional() }).passthrough(),
    z.object({ id: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }).passthrough(),
  ]).nullable(),
}).passthrough();

const DEFAULT_ERROR: Record<number, ApiErrorEnvelope> = {
  400: { code: API_ERROR_CODES.invalidSearchRequest, message: "请求参数不正确。", retryable: false },
  401: { code: API_ERROR_CODES.authRequired, message: "知乎授权已失效，请重新登录。", retryable: false },
  403: { code: API_ERROR_CODES.demoRoleForbidden, message: "当前账号没有该操作权限。", retryable: false },
  404: { code: API_ERROR_CODES.notFound, message: "请求的资源不存在。", retryable: false },
  429: { code: API_ERROR_CODES.rateLimited, message: "请求过于频繁，请稍后重试。", retryable: true },
  503: { code: API_ERROR_CODES.persistenceUnavailable, message: "服务暂时不可用，请稍后重试。", retryable: true },
};

function fallbackForStatus(status: number): ApiErrorEnvelope {
  return DEFAULT_ERROR[status] ?? { code: `HTTP_${status}`, message: "请求失败，请稍后重试。", retryable: status >= 500 || status === 429 };
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

  private async readError(response: Response): Promise<ApiErrorEnvelope> {
    try {
      const payload: unknown = await response.json();
      const parsed = apiErrorEnvelopeSchema.safeParse(payload);
      if (parsed.success) return parsed.data;
      if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
        const body = payload as { error: string; hint?: unknown };
        return { ...fallbackForStatus(response.status), message: body.error + (typeof body.hint === "string" ? ` ${body.hint}` : "") };
      }
    } catch {
      // Use the HTTP status fallback for non-JSON errors.
    }
    return fallbackForStatus(response.status);
  }

  private async send(path: string, init: RequestInit, refreshOnUnauthorized = true): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { credentials: "include", ...init });
    } catch (caught) {
      throw networErrorFrom(caught);
    }
    if (!response.ok) {
      const error = await this.readError(response);
      if (response.status === 401 && refreshOnUnauthorized) this.onUnauthorized?.();
      throw new ApiError({ ...error, status: response.status, details: error.details });
    }
    return response;
  }

  private async json<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}, transform?: (value: unknown) => unknown, refreshOnUnauthorized = true): Promise<T> {
    const response = await this.send(path, options, refreshOnUnauthorized);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ApiError({ code: API_ERROR_CODES.invalidResponse, message: "服务端返回的内容无法解析。", retryable: true, status: response.status }); }
    const value = transform ? transform(unwrapBackendEnvelope(payload)) : unwrapBackendEnvelope(payload);
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ApiError({ code: API_ERROR_CODES.invalidResponse, message: "服务端返回的内容不符合约定契约。", retryable: false, status: response.status, details: parsed.error.issues });
    return parsed.data;
  }

  async getSession(signal?: AbortSignal): Promise<AuthSessionView> {
    const payload = await this.json("/api/auth/session", backendAuthSessionSchema, { signal }, undefined, false);
    const backendUser = payload.user;
    const isPublicUser = backendUser && "displayName" in backendUser;
    return authSessionViewSchema.parse({ configured: payload.configured, authenticated: payload.authenticated, user: payload.authenticated ? { id: isPublicUser ? backendUser.id : backendUser?.url ?? backendUser?.name ?? "zhihu-user", displayName: isPublicUser ? backendUser.displayName : backendUser?.name ?? "知乎用户", avatarUrl: backendUser?.avatarUrl?.startsWith("https://") ? backendUser.avatarUrl : null } : null });
  }

  getHotTopics(signal?: AbortSignal): Promise<HotTopicsResponse> {
    return this.json("/api/topics/hot", hotTopicsResponseSchema, { signal });
  }

  async getFeaturedFields(signal?: AbortSignal): Promise<FieldSummary[]> { return (await this.json("/api/fields/featured", fieldListResponseSchema, { signal }, mapBackendFieldList)).items; }

  async searchFields(query: string, limit = 8, signal?: AbortSignal): Promise<FieldSummary[]> { const params = new URLSearchParams({ query: query.trim(), limit: String(limit) }); return (await this.json(`/api/fields?${params.toString()}`, fieldListResponseSchema, { signal }, mapBackendFieldList)).items; }

  getFieldGraph(fieldId: string, signal?: AbortSignal): Promise<FieldGraphResponse> { return this.json(`/api/fields/${encodeURIComponent(fieldId)}/graph`, fieldGraphResponseSchema, { signal }, mapBackendFieldGraph); }

  getCreator(creatorId: string, signal?: AbortSignal): Promise<CreatorCardData> {
    return this.json(
      `/api/creators/${encodeURIComponent(creatorId)}`,
      creatorCardSchema,
      { signal },
    );
  }

  async streamSearch(input: SearchRequest, onEvent: (event: SearchAgentEvent) => void, signal?: AbortSignal): Promise<SearchRunCompletedEvent> {
    const payload = searchRequestSchema.parse(input);
    const response = await this.send("/api/agent/search", {
      method: "POST",
      signal,
      headers: {
        Accept: "application/json, application/x-ndjson",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        query: payload.query,
        sessionId: payload.sessionId,
        mode: payload.mode ?? "auto",
      }),
    });
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json") && !contentType.includes("ndjson")) {
      let body: unknown;
      try { body = await response.json(); } catch { throw new ApiError({ code: API_ERROR_CODES.invalidResponse, message: "后端搜索返回的内容无法解析。", retryable: true }); }
      const result = mapBackendAskResult(unwrapBackendEnvelope(body));
      const requestId = globalThis.crypto?.randomUUID?.() ?? "00000000-0000-4000-8000-000000000000";
      onEvent({ type: "run.started", requestId });
      const steps = ["loading_context", "understanding", "retrieving", "verifying", "ranking", "saving"] as const;
      const messages = ["后端未提供个人授权上下文。", "后端已完成问题解析。", "后端已完成公开内容检索。", "后端已完成结果校验。", "后端已完成候选人排序。", result.persistence === "saved" ? "后端已保存本次结果。" : "后端未提供结果持久化。"];
      steps.forEach((step, index) => onEvent({ type: "step.completed", step, message: messages[index] }));
      const completed: SearchRunCompletedEvent = { type: "run.completed", result, runId: result.runId, persistence: result.persistence };
      const parsed = searchAgentEventSchema.safeParse(completed);
      if (!parsed.success || parsed.data.type !== "run.completed") throw new ApiError({ code: API_ERROR_CODES.invalidResponse, message: "后端搜索结果不符合前端展示契约。", retryable: false, details: parsed.success ? undefined : parsed.error.issues });
      onEvent(parsed.data);
      return parsed.data;
    }
    const terminal = await parseNdjsonStream<SearchAgentEvent>({ response, schema: searchAgentEventSchema, onEvent, signal, isTerminal: isTerminalSearchEvent });
    if (terminal.type === "run.failed") throw new ApiError({ code: terminal.error.code, message: terminal.error.message, retryable: terminal.error.retryable });
    if (terminal.type !== "run.completed") throw new ApiError({ code: API_ERROR_CODES.streamIncomplete, message: "搜索流没有返回完整结果。", retryable: true });
    return terminal;
  }

  restoreRun(runId: string, signal?: AbortSignal): Promise<RunRestoreResponse> {
    return this.json(
      `/api/agent/runs/${encodeURIComponent(runId)}`,
      runRestoreResponseSchema,
      { signal },
    );
  }

  compare(input: SearchRequest, signal?: AbortSignal): Promise<CompareResponse> {
    const payload = searchRequestSchema.parse(input);
    return this.json(
      "/api/compare",
      compareResponseSchema,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          query: payload.query,
          sessionId: payload.sessionId,
          mode: payload.mode ?? "auto",
        }),
      },
    );
  }

  createConversation(
    input: { creatorId: string; sourceRunId: string | null },
    signal?: AbortSignal,
  ): Promise<Conversation> {
    return this.json(
      "/api/conversations",
      conversationEnvelopeSchema,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(input),
      },
    ).then((result) => result.conversation);
  }

  getConversation(id: string, signal?: AbortSignal): Promise<Conversation> {
    return this.json(
      `/api/conversations/${encodeURIComponent(id)}`,
      conversationEnvelopeSchema,
      { signal },
    ).then((result) => result.conversation);
  }

  listMessages(
    id: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ items: Message[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "50");
    return this.json(
      `/api/conversations/${encodeURIComponent(id)}/messages?${params.toString()}`,
      messageListResponseSchema,
      { signal },
    );
  }

  sendMessage(
    id: string,
    input: {
      clientMessageId: string;
      actorRole: "seeker" | "creator";
      content: string;
    },
    signal?: AbortSignal,
  ): Promise<Message> {
    return this.json(
      `/api/conversations/${encodeURIComponent(id)}/messages`,
      messageEnvelopeSchema,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(input),
      },
    ).then((result) => result.message);
  }

  async streamConversationAgent(
    id: string,
    input: { clientMessageId: string; content: string },
    onEvent: (event: ConversationAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<ConversationAgentCompletedEvent> {
    const payload = agentMessageRequestSchema.parse(input);
    const response = await this.send(
      `/api/conversations/${encodeURIComponent(id)}/agent-runs`,
      {
        method: "POST",
        signal,
        headers: {
          Accept: "application/x-ndjson",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
      },
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
        ...terminal.error,
        status: response.status,
      });
    }
    if (terminal.type !== "agent.message.completed") {
      throw new ApiError({
        code: API_ERROR_CODES.streamIncomplete,
        message: "会话 Agent 流没有返回完整消息。",
        retryable: true,
        status: response.status,
      });
    }
    return terminal;
  }

  getConsultationPackages(signal?: AbortSignal): Promise<ConsultationPackage[]> {
    return this.json(
      "/api/consultation/packages",
      consultationPackageListSchema,
      { signal },
    ).then((result) => result.items);
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
    const payload = consultationActionRequestSchema.parse(input);
    return this.json(
      `/api/conversations/${encodeURIComponent(id)}/consultation/actions`,
      consultationActionResponseSchema,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      },
    );
  }

  resetConversation(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ conversation: Conversation; messages: Message[] }> {
    return this.json(
      `/api/conversations/${encodeURIComponent(id)}/reset`,
      resetConversationResponseSchema,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
}
