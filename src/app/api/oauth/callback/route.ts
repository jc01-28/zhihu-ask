export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * @deprecated 已迁移到 `GET /api/auth/zhihu/callback`。
 *
 * ⚠️ 新路径才是 `ZHIHU_REDIRECT_URI` 应该登记的那个。
 * 保留这个路径是为了兼容「已经按旧地址登记过回调」的部署环境。
 */
export { GET } from '@/app/api/auth/zhihu/callback/route';
