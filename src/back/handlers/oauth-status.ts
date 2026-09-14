/**
 * 处理器 · 知乎授权状态
 *
 * 只回状态，**绝不回 token**。
 *
 * 用户资料在 OAuth 回调时取一次并随加密会话保存，所以这里读它是免费的。
 * 注意 `/user` 没有正式 schema，profile 可能为 null —— 界面要能优雅显示「已授权」。
 */

import { paths } from '@/back/adapters';
import { openSession } from '@/back/adapters/session';
import { inspectCredentials } from '@/back/adapters/zhihu-oauth';
import { DiskQuotaGuard } from '@/back/framework/quota';
import type { OAuthStatusResponse } from '@/shared/contract';
import { ok, type HandlerResult } from './types';

export interface OAuthStatusInput {
  /** 会话 cookie 的原始值（route 层从 Cookie 里取出） */
  sessionToken: string | undefined;
}

export async function handleOAuthStatus(input: OAuthStatusInput): Promise<HandlerResult> {
  const session = openSession(input.sessionToken);
  const quota = new DiskQuotaGuard(paths.CACHE_DIR, {});
  const credentials = inspectCredentials();

  const body: OAuthStatusResponse = {
    authorized: Boolean(session),
    profile: session?.profile ?? null,
    expiresInSeconds: session
      ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000))
      : 0,
    credentials: {
      ready: credentials.ready,
      missing: credentials.missing,
      redirectUri: credentials.redirectUri,
      redirectIsLocalOnly: credentials.redirectIsLocalOnly,
    },
    quotaUsedToday: await quota.snapshot(),
    note: session
      ? '已授权：可读取你的关注列表用于补齐创作者主页链接'
      : '未授权：仍可使用搜索能力，但无法读取你的关注与收藏',
  };

  return ok(body);
}
