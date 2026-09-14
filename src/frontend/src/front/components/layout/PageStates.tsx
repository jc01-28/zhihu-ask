import { CircleAlert, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/front/components/ui/button";
import { Skeleton } from "@/front/components/ui/skeleton";

/**
 * 受保护页面共用的加载骨架。
 *
 * 所有骨架都带一个 `role="status"` 的无障碍文本：屏幕阅读器需要知道
 * 「正在加载」而不是看到一个空白页。
 */
export function PageSkeleton({
  label,
  rows = 2,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border/80 bg-white/88">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-12 sm:px-6">
        <Skeleton className="h-10 w-2/3" />
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
      <span className="sr-only" role="status">
        {label}
      </span>
    </main>
  );
}

/**
 * 受保护页面共用的错误面板。
 *
 * 必须给出可执行动作：可重试时给「重试」，否则至少给一个明确的返回入口。
 */
export function ErrorPanel({
  title,
  message,
  onRetry,
  retryable = true,
  backTo,
  backLabel = "返回功能首页",
  extra,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retryable?: boolean;
  backTo?: string;
  backLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <div
        role="alert"
        className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center"
      >
        <h1 className="text-xl font-bold text-red-900">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-red-800">{message}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {retryable && onRetry && (
            <Button onClick={onRetry}>
              <RotateCcw /> 重试
            </Button>
          )}
          {backTo && (
            // ⚠️ 用 Link 而不是 <a href>：<a> 会整页刷新，把 SPA 的路由状态全丢掉
            // （表现就是「点了返回却像重新进了一次网站」）
            <Button variant="outline" asChild>
              <Link to={backTo}>{backLabel}</Link>
            </Button>
          )}
          {extra}
        </div>
      </div>
    </main>
  );
}

/** 空状态：说明为什么是空的，并给出下一步动作。 */
export function EmptyPanel({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-white px-6 py-12 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-50 text-primary">
        {icon}
      </span>
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * 行内错误提示：用于「页面主体还在，只有某个区块失败」的情况。
 * 与整页 `ErrorPanel` 区分开，避免把可用内容一起清空。
 */
export function InlineError({
  message,
  onRetry,
  retryLabel = "重试",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <div>
        <p>{message}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-1 font-semibold underline">
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
