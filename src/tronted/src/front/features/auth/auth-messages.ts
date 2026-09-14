import { AUTH_LOGIN_PATH, AUTH_LOGOUT_PATH } from "@/shared/contracts/auth";

/**
 * 知乎授权回调可能带回的状态文案。
 *
 * URL 参数只用于一次性提示；是否已登录始终以 getSession() 的返回值为准。
 */
export const AUTH_MESSAGES: Record<string, string> = {
  unconfigured: "当前部署缺少知乎授权配置，暂时无法进入。请先完成服务端配置。",
  required: "请先使用知乎账号完成授权，再进入找人页面。",
  code_missing: "知乎没有返回授权码，请重新发起授权。",
  state_missing: "授权校验缺少必要参数，请重新发起知乎授权。",
  state_mismatch: "授权校验未通过，请重新发起知乎授权。",
  token_type_unsupported: "知乎返回了暂不支持的令牌类型，请稍后重试或联系管理员。",
  exchange_failed: "授权码换取令牌失败，请稍后重试或检查应用配置。",
};

export function authMessageFor(status: string | null | undefined): string | null {
  if (!status || status === "success") return null;
  return AUTH_MESSAGES[status] ?? null;
}

export function isKnownAuthStatus(status: string): boolean {
  return status === "success" || status in AUTH_MESSAGES;
}

export { AUTH_LOGIN_PATH, AUTH_LOGOUT_PATH };
