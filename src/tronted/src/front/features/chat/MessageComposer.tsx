import { MessageCircle, Send, Square, UserRound } from "lucide-react";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/front/components/ui/tabs";
import { Textarea } from "@/front/components/ui/textarea";

export const MAX_MESSAGE_LENGTH = 2000;

export function MessageComposer({
  draft,
  onDraftChange,
  onSend,
  onCancelStream,
  streaming,
  sending,
  viewerRole,
  onViewerRoleChange,
  roleSwitcherEnabled,
  suggestedQuestions,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCancelStream: () => void;
  streaming: boolean;
  sending: boolean;
  viewerRole: "seeker" | "creator";
  onViewerRoleChange: (role: "seeker" | "creator") => void;
  roleSwitcherEnabled: boolean;
  suggestedQuestions: string[];
}) {
  const busy = sending || streaming;

  return (
    <div className="border-t border-border bg-white p-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold">对话</p>
          <p className="text-xs text-muted-foreground">
            {viewerRole === "seeker"
              ? "你的问题会由 AI Agent 即时回应，并明确标注为 AI"
              : "你正在以「答主（演示）」身份手动发送消息"}
          </p>
        </div>
        {roleSwitcherEnabled ? (
          <Tabs
            value={viewerRole}
            onValueChange={(value) => onViewerRoleChange(value as "seeker" | "creator")}
          >
            <TabsList>
              <TabsTrigger value="seeker">
                <UserRound /> 用户视角
              </TabsTrigger>
              <TabsTrigger value="creator">
                <MessageCircle /> 答主视角
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <Badge variant="outline">当前部署未开启答主演示</Badge>
        )}
      </div>

      {viewerRole === "seeker" && suggestedQuestions.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {suggestedQuestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onDraftChange(question)}
              className="shrink-0 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 hover:border-blue-200"
            >
              {question}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
        className="flex items-end gap-2"
      >
        <Textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSend();
            }
          }}
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label="消息输入框"
          placeholder={
            viewerRole === "seeker" ? "输入你想咨询的问题…" : "输入一条模拟答主回复…"
          }
          className="min-h-12 resize-none rounded-xl"
        />
        {streaming ? (
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label="停止生成"
            onClick={onCancelStream}
            className="rounded-xl"
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-lg"
            aria-label="发送消息"
            disabled={!draft.trim() || busy}
            className="rounded-xl"
          >
            <Send />
          </Button>
        )}
      </form>
    </div>
  );
}
