import { useRef } from "react";
import {
  ArrowRight,
  CircleAlert,
  Flame,
  RotateCcw,
  Search,
  Sparkles,
  Square,
} from "lucide-react";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { Card, CardContent } from "@/front/components/ui/card";
import { Textarea } from "@/front/components/ui/textarea";
import type { CreatorCardData } from "@/shared/contracts/creator";

import { AgentProgress } from "@/front/features/search/AgentProgress";
import type { PersonSearchController } from "@/front/features/search/usePersonSearch";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH } from "@/front/features/search/search-state";
import { BackgroundSection } from "@/front/features/creator/BackgroundSection";
import { EmptyEvidence } from "@/front/features/creator/EmptyEvidence";
import { ResultCard, ResultSkeletons } from "@/front/features/creator/CreatorCard";
import { ResultSummary } from "@/front/features/creator/ResultSummary";
import { SAMPLE_QUESTIONS } from "@/front/mocks/demo-data";

export type CreateConversationError = { message: string; retryable: boolean };

export function SearchPanel({
  controller,
  hotTopics,
  onOpenDetails,
  onCreateConversation,
  pendingCreatorId,
  createError,
  onRetryCreate,
}: {
  controller: PersonSearchController;
  hotTopics: string[];
  onOpenDetails: (creator: CreatorCardData) => void;
  onCreateConversation: (creator: CreatorCardData) => void;
  pendingCreatorId: string | null;
  createError: CreateConversationError | null;
  onRetryCreate: () => void;
}) {
  const { state, setQuery, runSearch, stopSearch, selectSample } = controller;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const running = state.status === "running";

  return (
    <>
      <section className="hero-grid border-b border-border/70">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-12">
          <div className="max-w-3xl">
            <Badge className="mb-4 bg-blue-50 text-blue-700 hover:bg-blue-50">
              <Sparkles /> 搜索 Agent
            </Badge>
            <h1 className="max-w-3xl text-4xl font-black leading-[1.13] tracking-[-0.04em] sm:text-5xl">
              不只是找答案，<span className="text-primary">找到值得问的人。</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              描述你的真实处境。Agent 会检索内容、识别相似经历并核验证据。
            </p>

            <Card className="mt-7 gap-4 rounded-[22px] border-blue-100 bg-white/94 py-4 shadow-[0_18px_60px_rgba(27,76,137,.12)]">
              <CardContent className="px-4 sm:px-5">
                <label htmlFor="question" className="mb-2 block text-sm font-semibold">
                  你现在想找什么样的人？
                </label>
                <Textarea
                  ref={textareaRef}
                  id="question"
                  value={state.query}
                  maxLength={MAX_QUERY_LENGTH}
                  disabled={running}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      void runSearch();
                    }
                  }}
                  className="min-h-28 resize-none rounded-xl border-0 bg-slate-50 px-4 py-3 text-base leading-7 shadow-none focus-visible:ring-2 focus-visible:ring-blue-200"
                />
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-muted-foreground">
                    推荐基于公开内容证据，不代表专业资质或结果保证（至少 {MIN_QUERY_LENGTH} 字）
                  </p>
                  {running ? (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={stopSearch}
                      className="h-11 rounded-xl px-6"
                    >
                      <Square className="size-3 fill-current" /> 停止搜索
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      onClick={() => void runSearch()}
                      className="h-11 rounded-xl bg-primary px-6 shadow-[0_10px_24px_rgba(5,109,232,.2)]"
                    >
                      <Search /> 开始找人 <ArrowRight />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="mt-4 flex flex-wrap gap-2">
              {SAMPLE_QUESTIONS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    selectSample(sample);
                    textareaRef.current?.focus();
                  }}
                  className="rounded-full border border-border bg-white px-3.5 py-2 text-sm text-muted-foreground transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  {sample}
                </button>
              ))}
            </div>

            {hotTopics.length > 0 && (
              <div className="mt-5 rounded-2xl border border-border bg-white/80 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Flame className="size-3.5 text-primary" /> 知乎热榜选题（仅作为提问参考，不参与人物推荐）
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {hotTopics.map((topic) => (
                    <button
                      key={topic}
                      type="button"
                      onClick={() =>
                        setQuery(`关于「${topic}」，我想找真实经历过的人聊聊我自己的处境`)
                      }
                      className="rounded-full bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <AgentProgress steps={state.steps} running={running} />
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
        {state.error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">这次没有搜成功</p>
              <p className="mt-1 text-red-700">{state.error.message}</p>
            </div>
            {state.error.retryable && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runSearch()}
                className="border-red-200 bg-white"
              >
                <RotateCcw /> 重试
              </Button>
            )}
          </div>
        )}

        {createError && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">没有创建成功对话</p>
              <p className="mt-1">{createError.message}</p>
              <p className="mt-1 text-xs text-amber-800">
                本次人物结果已保留，可以直接重试，不需要重新搜索。
              </p>
            </div>
            {createError.retryable && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetryCreate}
                className="border-amber-300 bg-white"
              >
                <RotateCcw /> 重试
              </Button>
            )}
          </div>
        )}

        {running && <ResultSkeletons />}

        {state.status === "idle" && (
          <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-6 py-10 text-center">
            <Search className="mx-auto size-6 text-primary" />
            <h2 className="mt-3 text-lg font-bold">输入问题后，结果会来自本次搜索</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              不预先展示固定人选。真实 API 可用时读取知乎公开内容；不可用时会明确标注演示数据兜底。
            </p>
          </div>
        )}

        {state.status === "done" && state.result && (
          <>
            <ResultSummary result={state.result} />
            {state.result.cards.length === 0 ? (
              <EmptyEvidence query={state.completedQuery ?? state.query} />
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                {state.result.cards.map((creator, index) => (
                  <ResultCard
                    key={creator.id}
                    creator={creator}
                    featured={index === 0}
                    onDetails={() => onOpenDetails(creator)}
                    onChat={() => onCreateConversation(creator)}
                    chatPending={pendingCreatorId === creator.id}
                  />
                ))}
              </div>
            )}
            <BackgroundSection documents={state.result.background} />
          </>
        )}
      </section>
    </>
  );
}
