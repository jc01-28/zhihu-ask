import type { AuthSessionView } from "@/shared/contracts/auth";
import type { SearchAgentEvent, SearchRunCompletedEvent } from "@/shared/contracts/agent";
import type {
  ConversationAgentCompletedEvent,
  ConversationAgentEvent,
  ConsultationActionResponse,
  Conversation,
  Message,
} from "@/shared/contracts/conversation";
import type { ConsultationAction, ConsultationPackage } from "@/shared/contracts/consultation";
import type { CreatorCardData } from "@/shared/contracts/creator";
import type { FieldGraphResponse, FieldSummary } from "@/shared/contracts/field";
import type {
  CompareResponse,
  HotTopicsResponse,
  RunRestoreResponse,
  SearchRequest,
} from "@/shared/contracts/search";

/**
 * 页面与 feature 唯一可见的后端边界。
 *
 * 真实 HTTP 实现与 Mock 实现必须同时满足这个接口，并使用同一份 Zod 契约；
 * 组件只通过 `useApiClient()` 取得实例，不判断当前是 Mock 还是真实后端。
 */
export interface ApiClient {
  getSession(signal?: AbortSignal): Promise<AuthSessionView>;

  getHotTopics(signal?: AbortSignal): Promise<HotTopicsResponse>;

  /* ---------------------------------------------------------------- */
  /* 专业领域                                                          */
  /* ---------------------------------------------------------------- */

  /** 推荐领域；调用方不要在这里做人物搜索。 */
  getFeaturedFields(signal?: AbortSignal): Promise<FieldSummary[]>;

  /**
   * 领域检索：按名称、标签、简介与议题关键词匹配。
   * 返回值**始终**是领域列表，不是人物列表。
   */
  searchFields(
    query: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<FieldSummary[]>;

  /** 领域星图：中心领域 + 议题节点 + 人物聚类。 */
  getFieldGraph(fieldId: string, signal?: AbortSignal): Promise<FieldGraphResponse>;

  /**
   * 人物公开资料。
   *
   * 领域来源的人物没有内容证据，返回的 `evidence` 为空数组；
   * `profileUrl` 只能来自后端，前端不得按姓名拼接。
   */
  getCreator(creatorId: string, signal?: AbortSignal): Promise<CreatorCardData>;

  /* ---------------------------------------------------------------- */
  /* 问题找人                                                          */
  /* ---------------------------------------------------------------- */

  streamSearch(
    input: SearchRequest,
    onEvent: (event: SearchAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<SearchRunCompletedEvent>;

  restoreRun(runId: string, signal?: AbortSignal): Promise<RunRestoreResponse>;

  compare(input: SearchRequest, signal?: AbortSignal): Promise<CompareResponse>;

  createConversation(
    input: { creatorId: string; sourceRunId: string | null },
    signal?: AbortSignal,
  ): Promise<Conversation>;

  getConversation(id: string, signal?: AbortSignal): Promise<Conversation>;

  listMessages(
    id: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ items: Message[]; nextCursor: string | null }>;

  sendMessage(
    id: string,
    input: {
      clientMessageId: string;
      actorRole: "seeker" | "creator";
      content: string;
    },
    signal?: AbortSignal,
  ): Promise<Message>;

  streamConversationAgent(
    id: string,
    input: { clientMessageId: string; content: string },
    onEvent: (event: ConversationAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<ConversationAgentCompletedEvent>;

  getConsultationPackages(signal?: AbortSignal): Promise<ConsultationPackage[]>;

  applyConsultationAction(
    id: string,
    input: {
      action: ConsultationAction;
      actorRole: "seeker" | "creator";
      packageId?: string;
    },
    signal?: AbortSignal,
  ): Promise<ConsultationActionResponse>;

  resetConversation(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ conversation: Conversation; messages: Message[] }>;
}
