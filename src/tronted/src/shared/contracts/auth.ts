import { z } from "zod";

import { nullableHttpsUrlSchema } from "@/shared/contracts/url";

/** 后端生成的公开用户视图，不是 OAuth UID，也不是数据库内部主键。 */
export const publicUserSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1).max(80),
    avatarUrl: nullableHttpsUrlSchema,
  })
  .strict();

export const authSessionViewSchema = z
  .object({
    configured: z.boolean(),
    authenticated: z.boolean(),
    user: publicUserSchema.nullable(),
  })
  .strict();

export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthSessionView = z.infer<typeof authSessionViewSchema>;

/** 知乎授权回调可能带回的状态，用于一次性提示。 */
export const AUTH_QUERY_STATUSES = [
  "success",
  "unconfigured",
  "required",
  "code_missing",
  "state_missing",
  "state_mismatch",
  "token_type_unsupported",
  "exchange_failed",
] as const;

export type AuthQueryStatus = (typeof AUTH_QUERY_STATUSES)[number];

/** 登录与退出一律使用浏览器导航，不通过 fetch 追踪 302。 */
export const AUTH_LOGIN_PATH = "/api/auth/zhihu/login";
export const AUTH_LOGOUT_PATH = "/api/auth/zhihu/logout";
export const AUTH_CALLBACK_PATH = "/auth/callback";
