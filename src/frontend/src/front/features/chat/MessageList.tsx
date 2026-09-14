import { Bot, CircleAlert, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/front/components/ui/button";
import type { ChatItem } from "@/front/features/chat/conversation-state";

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function senderLabel(sender: ChatItem["sender"]): string {
  switch (sender) {
    case "seeker":
      return "用户";
    case "creator":
      return "答主（演示）";
    case "agent":
      return "AI Agent";
    default:
      return "系统";
  }
}

/**
 * 消息列表。
 *
 * `seeker`、`creator`、`agent`、`system` 使用不同气泡语义：
 * Agent 永远标注为 AI Agent，不会被画成真实答主。
 */
export function MessageList({
  items,
  viewerRole,
  nextCursor,
  loadingOlder,
  onLoadOlder,
  onRetry,
  onDiscard,
  retryDisabled,
}: {
  items: ChatItem[];
  viewerRole: "seeker" | "creator";
  nextCursor: string | null;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry: () => void;
  onDiscard: (itemId: string) => void;
  retryDisabled: boolean;
}) {
  return (
    <div
      className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 p-4 sm:p-6"
      aria-label="会话消息"
    >
      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="bg-white"
          >
            {loadingOlder ? "正在加载…" : "加载更早的消息"}
          </Button>
        </div>
      )}

      {items.length === 0 && (
        <p className="pt-10 text-center text-sm text-muted-foreground">
          还没有消息，先说一句你的处境吧。
        </p>
      )}

      {items.map((item) => {
        if (item.sender === "system") {
          return (
            <div
              key={item.id}
              className="mx-auto max-w-lg rounded-full bg-slate-200/70 px-4 py-2 text-center text-xs text-slate-600"
            >
              {item.content}
            </div>
          );
        }

        if (item.sender === "agent") {
          return (
            <div key={item.id} className="flex justify-start">
              <div
                className={`max-w-[82%] rounded-2xl border px-4 py-3 text-sm leading-6 ${
                  item.status === "failed"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-blue-100 bg-blue-50/70 text-foreground"
                }`}
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <Bot className="size-3.5" /> AI Agent
                  {item.streaming && <span className="text-muted-foreground">· 正在生成</span>}
                </p>
                <p className="mt-1 whitespace-pre-wrap">
                  {item.content || (item.streaming ? "…" : "")}
                </p>
                {item.status === "failed" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-xs">
                      <CircleAlert className="size-3.5" /> 这条回复没有完成
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRetry}
                      disabled={retryDisabled}
                      className="border-red-200 bg-white"
                    >
                      <RotateCcw /> 重试
                    </Button>
                  </div>
                )}
                {item.status === "sent" && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {timeLabel(item.createdAt)}
                  </p>
                )}
              </div>
            </div>
          );
        }

        const own = item.sender === viewerRole;
        return (
          <div key={item.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                item.status === "failed"
                  ? "rounded-br-md border border-red-200 bg-red-50 text-red-800"
                  : own
                    ? "rounded-br-md bg-primary text-white"
                    : "rounded-bl-md border border-border bg-white text-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{item.content}</p>
              <p
                className={`mt-1 text-[11px] ${
                  own && item.status !== "failed" ? "text-blue-100" : "text-muted-foreground"
                }`}
              >
                {senderLabel(item.sender)} · {timeLabel(item.createdAt)}
                {item.status === "sending" && " · 发送中"}
              </p>
              {item.status === "failed" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRetry}
                    disabled={retryDisabled}
                    className="border-red-200 bg-white"
                  >
                    <RotateCcw /> 重试
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDiscard(item.id)}
                    className="text-red-700"
                  >
                    <Trash2 /> 删除
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
