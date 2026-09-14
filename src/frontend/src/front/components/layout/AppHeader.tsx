import { Compass, House, LogOut, Search, ShieldCheck } from "lucide-react";
import { Link, NavLink } from "react-router-dom";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { cn } from "@/front/shared/cn";
import type { AuthSessionView } from "@/shared/contracts/auth";
import { AUTH_LOGOUT_PATH } from "@/shared/contracts/auth";

const NAV_ITEMS = [
  { to: "/app", label: "功能首页", icon: House, end: true },
  { to: "/app/fields", label: "专业领域", icon: Compass, end: false },
  { to: "/app/find", label: "问题找人", icon: Search, end: false },
] as const;

/**
 * 登录后页面的统一头部。
 *
 * 它只负责导航、当前用户与退出，不承载任何业务数据请求——
 * 会话状态由调用方通过 `RequireAuth` 传入，避免每个页面各查一次。
 */
export function AppHeader({ session }: { session: AuthSessionView }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/88 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/app" className="flex shrink-0 items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-black text-white shadow-[0_8px_24px_rgba(5,109,232,.24)]">
            问
          </span>
          <span className="hidden sm:block">
            <span className="block text-base font-bold leading-tight tracking-tight">
              知域
            </span>
            <span className="block text-xs text-muted-foreground">找到真正经历过的人</span>
          </span>
        </Link>

        <nav aria-label="主导航" className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors sm:px-3",
                  isActive
                    ? "bg-blue-50 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Badge
            variant="outline"
            className="hidden border-emerald-200 bg-emerald-50 text-emerald-700 sm:inline-flex"
          >
            <ShieldCheck /> {session.user?.displayName ?? "知乎账号已授权"}
          </Badge>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href={AUTH_LOGOUT_PATH}>
              <LogOut /> 退出
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
