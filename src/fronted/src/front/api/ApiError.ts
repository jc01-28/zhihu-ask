import { API_ERROR_CODES, isAuthErrorCode } from "@/shared/contracts/errors";

export type ApiErrorInput = {
  code: string;
  message: string;
  status?: number;
  retryable?: boolean;
  /** 仅用于 409 这类需要让前端「回正」的场景，携带服务端当前状态。 */
  details?: unknown;
  cause?: unknown;
};

/**
 * 前端唯一的错误类型。
 *
 * 组件只根据 `code` / `retryable` / `status` 决定 UI，不接触原始 Response，
 * 也不会收到任何服务端堆栈或凭据。
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(input: ApiErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status ?? 0;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }

  get isAuthError(): boolean {
    return isAuthErrorCode(this.code) || this.status === 401;
  }
}

export function createAbortError(): DOMException {
  return new DOMException("请求已取消", "AbortError");
}

export function isAbortError(caught: unknown): boolean {
  if (!caught) return false;
  if (typeof DOMException !== "undefined" && caught instanceof DOMException) {
    return caught.name === "AbortError";
  }
  return (
    typeof caught === "object" &&
    caught !== null &&
    (caught as { name?: string }).name === "AbortError"
  );
}

/**
 * 把任意抛出物收敛成 ApiError。
 * 取消请求永远保持 AbortError 语义，交给调用方按「取消」而非「失败」处理。
 */
export function normalizeApiError(
  caught: unknown,
  fallback: { code: string; message: string; status?: number; retryable?: boolean },
): ApiError {
  if (caught instanceof ApiError) return caught;
  if (isAbortError(caught)) throw caught;
  const cause = caught instanceof Error ? caught : undefined;
  return new ApiError({
    code: fallback.code,
    message: fallback.message,
    status: fallback.status,
    retryable: fallback.retryable ?? true,
    cause,
  });
}

export function networErrorFrom(caught: unknown): ApiError {
  return normalizeApiError(caught, {
    code: API_ERROR_CODES.networkError,
    message: "网络不可用，请检查连接后重试。",
    retryable: true,
  });
}
