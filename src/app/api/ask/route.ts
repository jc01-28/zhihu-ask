import { askRoute } from '@/app/api/_ask-route';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * **内部链路调试口**：返回链路的原始产物 `AskResult`（8 步 trace / route / metrics / 证据）。
 *
 * 为什么保留它，而不是被 `/api/agent/search` 取代：
 *   · `/api/agent/search` 返回的是**映射后的产品 DTO**（`PersonSearchResult`，NDJSON 流），
 *     它服务于界面；
 *   · 而**评测与 e2e 要看的是链路本身** —— `scripts/eval.mjs` 算 Top-3 有效人选率、
 *     证据覆盖率用的是 `recommendations[].candidate.experiences`，那是链路产物里的东西。
 * 两者服务不同读者，所以并存。**前端不要用这个口**：它没有流式、也没有契约保障。
 */
export const POST = askRoute;
