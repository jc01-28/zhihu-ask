export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * @deprecated 已迁移到 `GET /api/auth/session`。
 *
 * 字段也变了：`authorized` → `authenticated`，且把「凭证是否配齐」
 * 从嵌套的 `credentials.ready` 提成平级的 `configured` ——
 * 前端三分支判断因此不用再往下钻两层。
 */
export { GET } from '@/app/api/auth/session/route';
