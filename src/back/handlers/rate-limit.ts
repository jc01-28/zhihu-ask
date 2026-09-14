/**
 * 处理器 · 共享限流
 *
 * ⚠️ **必须是同一份计数器**：`/api/ask`（旧）与 `/api/agent/search`（新）打的是同一条链路，
 * 各建一个限流器的话，换个端点就能把额度用两遍 —— 限流等于没有。
 *
 * 默认 10 分钟 20 次/客户端：正常人够用，但能挡住「连点几十次把当天额度烧穿」。
 * 用 `ASK_RATE_LIMIT` / `ASK_RATE_WINDOW_MS` 调整，`ASK_RATE_LIMIT=0` 关闭。
 */

import { MemoryThrottle } from '@/back/framework/throttle';

const LIMIT = Number(process.env.ASK_RATE_LIMIT ?? 20);
const WINDOW_MS = Number(process.env.ASK_RATE_WINDOW_MS ?? 600000);

const throttle = new MemoryThrottle(LIMIT, WINDOW_MS);

export const rateLimitEnabled = LIMIT > 0;

export type RateVerdict = { ok: true } | { ok: false; retryAfterSec: number };

export function checkRate(clientKey: string): RateVerdict {
  if (!rateLimitEnabled) return { ok: true };
  const verdict = throttle.check(clientKey);
  return verdict.ok ? { ok: true } : { ok: false, retryAfterSec: verdict.retryAfterSec };
}
