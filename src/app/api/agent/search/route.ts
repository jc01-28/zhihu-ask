import { askRoute } from '@/app/api/_ask-route';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 问题找人 —— 前端规格里的 `POST /api/agent/search`。路由壳，业务在 `@/back/handlers/ask`。
 *
 * ⚠️ 当前是**一次性返回**（统一信封 + `AskResponse`），不是规格里写的 NDJSON 流式。
 * 之所以能先这样：`AskResponse.phases` 已经是**六阶段聚合**，前端可以直接渲染进度条，
 * 视觉上差别不大。升级为流式只需要替换这个文件 —— 框架的 trace 本来就按步回调，
 * 业务层与链路一行都不用改。
 */
export const POST = askRoute;
