export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * @deprecated 已迁移到 `GET /api/auth/zhihu/login`（采用前端规格的命名）。
 * 保留这个路径只是为了兼容旧链接，新代码请用新路径。
 */
export { GET } from '@/app/api/auth/zhihu/login/route';
