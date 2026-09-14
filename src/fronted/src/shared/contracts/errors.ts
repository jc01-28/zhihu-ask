import { z } from "zod";

/**
 * 前后端共同的错误信封。前端只解释 code，不依赖任何服务端堆栈或内部字段。
 */
export const apiErrorEnvelopeSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    /**
     * 可选的业务上下文，只给需要「回正」的接口用。
     *
     * 目前唯一的用途是 `INVALID_CONSULTATION_TRANSITION`：后端把**当前完整的
     * Consultation 对象**放在这里，前端用它把咨询面板改回服务端的真实状态，
     * 而不是自己推导下一状态。形状必须与 `consultationSchema` 一致，
     * 因为调用方会拿那个 Schema 去解析它。
     *
     * 这个字段必须声明出来：`.strict()` 会拒绝未声明的键，若这里没有 `details`，
     * 一个带 `details` 的 409 会让**整个信封**解析失败，于是 code 退化成按状态码
     * 推断的 `CONFLICT`，回正逻辑就永远不会被触发。
     */
    details: z.unknown().optional(),
  })
  .strict();

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

/** 前端需要区分处理的公开错误码。 */
export const API_ERROR_CODES = {
  invalidSearchRequest: "INVALID_SEARCH_REQUEST",
  invalidMessage: "INVALID_MESSAGE",
  authRequired: "ZHIHU_AUTH_REQUIRED",
  authExpired: "ZHIHU_AUTH_EXPIRED",
  demoRoleForbidden: "DEMO_ROLE_FORBIDDEN",
  runNotFound: "RUN_NOT_FOUND",
  fieldNotFound: "FIELD_NOT_FOUND",
  fieldSearchFailed: "FIELD_SEARCH_FAILED",
  conversationNotFound: "CONVERSATION_NOT_FOUND",
  conversationSourceUnavailable: "CONVERSATION_SOURCE_UNAVAILABLE",
  invalidConsultationTransition: "INVALID_CONSULTATION_TRANSITION",
  rateLimited: "RATE_LIMITED",
  persistenceUnavailable: "PERSISTENCE_UNAVAILABLE",
  notFound: "NOT_FOUND",
  /**
   * 以下为纯前端错误码，用于统一表达网络、流与解析失败，
   * 服务端不会返回这些值。
   */
  requestAborted: "REQUEST_ABORTED",
  streamIncomplete: "INCOMPLETE_STREAM",
  streamUnavailable: "STREAM_UNAVAILABLE",
  invalidResponse: "INVALID_RESPONSE",
  networkError: "NETWORK_ERROR",
  unknown: "UNKNOWN_ERROR",
  backendUnsupported: "BACKEND_UNSUPPORTED",
} as const;

export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/** 401 类错误需要收敛到统一的会话刷新逻辑。 */
export function isAuthErrorCode(code: string): boolean {
  return (
    code === API_ERROR_CODES.authRequired ||
    code === API_ERROR_CODES.authExpired ||
    code === "UNAUTHENTICATED"
  );
}
