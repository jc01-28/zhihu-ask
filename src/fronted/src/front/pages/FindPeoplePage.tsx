import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Columns3 } from "lucide-react";

import { AppHeader } from "@/front/components/layout/AppHeader";
import { Button } from "@/front/components/ui/button";
import { useApiClient } from "@/front/app/api-context";
import type { AuthSessionView } from "@/shared/contracts/auth";
import type { CreatorCardData } from "@/shared/contracts/creator";

import { useStartConversation } from "@/front/features/chat/useConversation";
import { CompareDialog } from "@/front/features/compare/CompareDialog";
import { CreatorDetail } from "@/front/features/creator/CreatorDetail";
import { SearchPanel } from "@/front/features/search/SearchPanel";
import { usePersonSearch } from "@/front/features/search/usePersonSearch";
import { MAIN_QUERY } from "@/front/mocks/demo-data";

/**
 * 问题找人页（`/app/find`）。
 *
 * 这是「按问题检索」的唯一入口：输入处境 → 六阶段 Agent 检索 → 人物卡 → 私聊。
 * 它与领域入口互相独立：这里不会读取领域数据，领域页也不会把检索词改成人物搜索。
 */
export function FindPeoplePage({ session }: { session: AuthSessionView }) {
  const client = useApiClient();
  const navigate = useNavigate();
  const search = usePersonSearch(MAIN_QUERY);
  const startConversation = useStartConversation();

  const [hotTopics, setHotTopics] = useState<string[]>([]);
  const [selected, setSelected] = useState<CreatorCardData | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [lastRequested, setLastRequested] = useState<CreatorCardData | null>(null);

  // 热榜只是选题入口：不可用时静默隐藏，不影响找人。
  useEffect(() => {
    const controller = new AbortController();
    client
      .getHotTopics(controller.signal)
      .then((response) => {
        if (controller.signal.aborted || response.unavailable) return;
        setHotTopics(
          response.topics
            .map((topic) => topic.title)
            .filter((title) => title.length >= 4)
            .slice(0, 6),
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [client]);

  // WebMCP：浏览器不支持 document.modelContext 时静默不可用，卸载时取消注册。
  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(
      modelContext.registerTool(
        {
          name: "start_person_search",
          title: "搜索相关人物",
          description:
            "在知乎问人中搜索与指定职业决策问题相关的人物，并把结果展示在当前页面。",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", minLength: 4, maxLength: 300 } },
            required: ["query"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input: unknown) {
            if (
              !input ||
              typeof input !== "object" ||
              typeof (input as { query?: unknown }).query !== "string"
            ) {
              throw new Error("query 必须是字符串");
            }
            const result = await search.runSearch((input as { query: string }).query);
            return {
              status: result ? "completed" : "failed",
              cardCount: result?.cards.length ?? 0,
              modeUsed: result?.modeUsed ?? null,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [search]);

  const handleStartConversation = async (creator: CreatorCardData) => {
    setLastRequested(creator);
    const runId = search.state.result?.runId ?? null;
    const conversation = await startConversation.start(creator.id, runId);
    if (!conversation) return;
    setSelected(null);
    setLastRequested(null);
    // 记下来路，聊天页的「返回」才知道该回哪（见 ChatHeader / ChatPage 的 goBack）
    navigate(`/app/chat/${encodeURIComponent(conversation.id)}`, {
      state: { from: "/app/find" },
    });
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader session={session} />

      {/* 对比测试属于检索侧能力，因此挂在找人页而不是全局导航上。 */}
      <div className="border-b border-border/80 bg-white/70">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <p className="text-xs text-muted-foreground">
            描述你的处境，Agent 会检索知乎公开内容并给出可核验的证据
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCompareOpen(true)}
            className="shrink-0 text-muted-foreground"
          >
            <Columns3 /> 对比测试
          </Button>
        </div>
      </div>

      <SearchPanel
        controller={search}
        hotTopics={hotTopics}
        onOpenDetails={setSelected}
        onCreateConversation={(creator) => void handleStartConversation(creator)}
        pendingCreatorId={startConversation.pendingCreatorId}
        createError={
          startConversation.error
            ? {
                message: startConversation.error.message,
                retryable: startConversation.error.retryable,
              }
            : null
        }
        onRetryCreate={() => void startConversation.retry()}
      />

      <CreatorDetail
        creator={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        onChat={() => selected && void handleStartConversation(selected)}
        chatPending={
          Boolean(selected) && startConversation.pendingCreatorId === selected?.id
        }
      />

      <CompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        initialQuery={search.state.completedQuery ?? search.state.query}
      />

      {lastRequested && startConversation.error && (
        <p role="status" className="sr-only">
          为 {lastRequested.name} 创建会话失败，可以重试。
        </p>
      )}
    </main>
  );
}
