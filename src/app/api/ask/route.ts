import { askRoute } from '@/app/api/_ask-route';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * @deprecated 已迁移到 `POST /api/agent/search`（采用前端规格的命名）。
 *
 * 这个路径保留**只是为了兼容既有脚本**（`scripts/e2e.mjs`、`scripts/eval.mjs` 直接打它）。
 * 新代码一律用 `/api/agent/search`。等脚本都切过去后，这个文件可以删掉。
 */
export const POST = askRoute;
