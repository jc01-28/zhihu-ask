export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * @deprecated 已迁移到 `GET|POST /api/auth/zhihu/logout`。
 * 新实现会 302 回 `/app?auth=required`，而不是返回 JSON。
 */
export { GET, POST } from '@/app/api/auth/zhihu/logout/route';
