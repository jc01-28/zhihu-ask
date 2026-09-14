import { ArrowLeft, RotateCcw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import type { Conversation } from "@/shared/contracts/conversation";

import { CreatorAvatar } from "@/front/features/creator/CreatorCard";

/**
 * 聊天页页头。
 *
 * `sourceRunId` 只用来区分「来自本次搜索」与「演示人物」，
 * 两者都必须明确标注这是虚拟聊天演示。
 */
export function ChatHeader({
  conversation,
  onReset,
  resetting,
}: {
  conversation: Conversation;
  onReset: () => void;
  resetting: boolean;
}) {
  const fromSearch = Boolean(conversation.sourceRunId);
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * 自然回退：**从哪来回哪去**。
   *
   * ⚠️ 原来是 `<Link to="/">` —— 一个标着「返回搜索」的按钮却把人送回项目首页；
   * 而且写死目标意味着从**领域星图**点进来的用户会被扔到完全无关的页面。
   *
   * 优先回到 `state.from`（跳转方显式记录的来路）。
   *
   * ⚠️ 别用 `location.key === 'default'` 判断"有没有历史再回退"：MemoryRouter（全部单测）
   * 里初始 key 不是 'default'，`navigate(-1)` 会静默无效 —— 表现就是按钮点了没反应。
   *
   * 直达打开（没有 from）时兜底去「问题找人」；统一用 `replace`，
   * 返回不该在历史里再压一条记录。
   */
  const goBack = () => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? "/app/find", { replace: true });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={goBack} aria-label="返回上一页">
            <ArrowLeft />
          </Button>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-sm font-black text-white">
            问
          </span>
          <div className="flex min-w-0 items-center gap-3">
            <CreatorAvatar creator={conversation.creator} />
            <div className="min-w-0">
              <p className="truncate text-base font-bold">
                与 {conversation.creator.name} 的虚拟对话
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {conversation.creator.headline}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`hidden sm:inline-flex ${
              fromSearch
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {fromSearch ? "来自本次搜索" : "演示人物"}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={resetting}
            aria-busy={resetting}
          >
            <RotateCcw /> 重置
          </Button>
        </div>
      </div>
    </header>
  );
}
