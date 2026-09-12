import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { DiskQuotaGuard } from '@/framework/quota';
import { openSession, SESSION_COOKIE } from '@/adapters/session';
import { paths } from '@/adapters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 授权状态 + 当日额度。只回状态，绝不回 token。
 *
 * 注意一个真实缺口：知乎当前**没有**提供用户资料接口（/user 无正式 schema），
 * 所以授权成功后我们也拿不到用户昵称和头像，只能显示「已授权」。
 * 界面上不要假装知道用户是谁。
 */
export async function GET() {
  // Next 15 起 cookies() 变成异步 API，必须 await
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  const quota = new DiskQuotaGuard(paths.CACHE_DIR, {});

  return NextResponse.json({
    authorized: Boolean(session),
    expiresInSeconds: session ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)) : 0,
    quotaUsedToday: await quota.snapshot(),
    note: session
      ? '已授权：可读取你的关注列表用于补齐创作者主页链接'
      : '未授权：仍可使用搜索能力，但无法读取你的关注与收藏',
  });
}
