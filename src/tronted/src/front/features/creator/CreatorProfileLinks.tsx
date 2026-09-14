import { ChevronRight, ExternalLink } from "lucide-react";

import { Button } from "@/front/components/ui/button";

/**
 * 人物名片底部的两个明确操作。
 *
 *  - 「查看知乎主页」只使用后端返回的 `profileUrl`。前端**不按姓名拼 URL**，
 *    也没有地址时不给一个看起来能用、实则是死链条的按钮；
 *  - 「开始私聊」由调用方负责幂等（同一人物在请求进行中只发一次），
 *    成功后跳到 `/app/chat/:conversationId`。
 *
 * 外链一律 `target="_blank"` + `rel="noopener noreferrer"`。
 */
export function CreatorProfileLinks({
  profileUrl,
  onChat,
  chatPending = false,
  chatLabel = "开始私聊",
}: {
  profileUrl: string | null;
  onChat?: () => void;
  chatPending?: boolean;
  chatLabel?: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {profileUrl ? (
        <Button asChild variant="outline" className="h-11 rounded-xl">
          <a href={profileUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> 查看知乎主页
          </a>
        </Button>
      ) : (
        <Button
          variant="outline"
          className="h-11 rounded-xl"
          disabled
          title="后端没有提供这个人的公开主页地址"
        >
          <ExternalLink /> 暂无公开主页
        </Button>
      )}

      {onChat ? (
        <Button
          className="h-11 rounded-xl"
          onClick={onChat}
          disabled={chatPending}
          aria-busy={chatPending}
        >
          {chatPending ? "正在创建会话…" : chatLabel} <ChevronRight />
        </Button>
      ) : (
        <Button className="h-11 rounded-xl" disabled title="当前视图不提供创建会话">
          {chatLabel} <ChevronRight />
        </Button>
      )}
    </div>
  );
}
