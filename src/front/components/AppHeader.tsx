'use client';

import { authLogoutUrl } from '@/front/api-client';
import type { AuthSessionResponse } from '@/shared/contract';

/**
 * 功能区的顶栏：Logo + 当前用户 + 授权状态 + 退出登录。
 *
 * 退出用**整页跳转**而不是 fetch —— 后端会 302 回 `/app?auth=required`，
 * 这样浏览器里的会话 cookie 一定被清掉，也不会有"点了没反应"的中间态。
 */
export function AppHeader({ session }: { session: AuthSessionResponse | null }) {
  const user = session?.user;

  return (
    <header className="border-b border-black/5 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 py-3">
        <a href="/app" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-[13px] font-medium text-white">
            问
          </span>
          <span className="text-[14px] font-medium text-ink-900">知乎问人</span>
        </a>

        <div className="flex items-center gap-2 text-[12px]">
          {session?.authenticated ? (
            <>
              <span className="rounded bg-brand-soft px-2 py-0.5 text-brand">
                {user?.displayName ? `已授权 · ${user.displayName}` : '已授权知乎账号'}
              </span>
              <a
                href={authLogoutUrl}
                className="rounded border border-black/10 px-2 py-0.5 text-ink-700 hover:border-brand hover:text-brand"
              >
                退出登录
              </a>
            </>
          ) : (
            <span className="rounded bg-black/5 px-2 py-0.5 text-ink-500">未授权</span>
          )}
        </div>
      </div>
    </header>
  );
}
