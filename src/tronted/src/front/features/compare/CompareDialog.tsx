import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Columns3, ExternalLink, Loader2, Search } from "lucide-react";

import { useApiClient } from "@/front/app/api-context";
import { Button } from "@/front/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/front/components/ui/dialog";
import { Skeleton } from "@/front/components/ui/skeleton";
import type { PersonSearchResult, SearchHit } from "@/shared/contracts/search";

import { ResultCard } from "@/front/features/creator/CreatorCard";
import { ResultSummary } from "@/front/features/creator/ResultSummary";
import { MIN_QUERY_LENGTH } from "@/front/features/search/search-state";

export function CompareDialog({
  open,
  onOpenChange,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery: string;
}) {
  const client = useApiClient();
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<{ queries: string[]; hits: SearchHit[] } | null>(null);
  const [agent, setAgent] = useState<PersonSearchResult | null>(null);

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  const run = useCallback(async () => {
    const next = query.trim();
    if (next.length < MIN_QUERY_LENGTH) {
      setError("请至少输入 4 个字，让对比有意义。");
      return;
    }
    setLoading(true);
    setError(null);
    setRaw(null);
    setAgent(null);
    try {
      const data = await client.compare({
        query: next,
        sessionId: crypto.randomUUID(),
      });
      setRaw(data.raw);
      setAgent(data.agent);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "对比失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [client, query]);

  const trimmed = query.trim();
  const zhihuContentUrl = `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(trimmed)}`;
  const zhihuPeopleUrl = `https://www.zhihu.com/search?type=people&q=${encodeURIComponent(trimmed)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[1120px] overflow-y-auto sm:max-w-[1120px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Columns3 className="size-5 text-primary" /> 同一句话，三种检索方式
          </DialogTitle>
          <DialogDescription>
            同一个问题，看看「知乎原生搜索」「直接调 API」「我们的 Agent」分别给你什么。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void run();
              }}
              placeholder="描述你想找的人，例如：从大厂离职去创业又回来的"
              aria-label="对比用的检索问题"
              className="h-11 w-full rounded-xl border border-border bg-slate-50 pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            />
          </div>
          <Button
            size="lg"
            onClick={() => void run()}
            disabled={loading}
            className="h-11 rounded-xl bg-primary px-5"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Columns3 className="size-4" />
            )}
            开始对比
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {/* 第一栏：知乎原生搜索（诚实：链接跳转，不内嵌 iframe） */}
          <CompareColumn
            index="①"
            title="知乎原生搜索"
            tag="关键词 → 内容流"
            accent="border-slate-200 bg-slate-50/60"
          >
            <p className="text-sm leading-6 text-muted-foreground">
              在知乎直接搜这句话，返回的是一堆回答/文章。作者是谁、是否亲历、可不可信，都要你自己逐条翻找。
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {/*
                用 `Button asChild` 让样式落在 <a> 上，而不是 <a><button> 套一层。
                锚点里嵌 button 是非法嵌套：读屏会把它报成「链接里还有一个按钮」，
                键盘用户则会遇到两个都要 Tab 的可交互节点，而它们其实是同一个动作。
              */}
              <Button asChild variant="outline" className="w-full">
                <a href={zhihuContentUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" /> 在知乎搜内容
                </a>
              </Button>
              <Button asChild variant="ghost" className="w-full text-muted-foreground">
                <a href={zhihuPeopleUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" /> 在知乎搜用户（仅按名字/关键词）
                </a>
              </Button>
            </div>
            <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white/70 p-3 text-xs leading-5 text-muted-foreground">
              演示真相：原生搜索得到的是「内容」，不是「人」。它很难直接回答“符合这段描述的人是谁”。
            </p>
          </CompareColumn>

          {/* 第二栏：直接调 API（原始火海） */}
          <CompareColumn
            index="②"
            title="直接调用 API"
            tag={`原始检索 · ${raw ? `${raw.hits.length} 条` : "未获取"}`}
            accent="border-blue-100 bg-blue-50/50"
          >
            <p className="text-sm leading-6 text-muted-foreground">
              用同一组关键词直接打知乎检索 API：返回大量原始内容字段，未经聚合、没有人物归类。
            </p>
            <div className="mt-3 space-y-2">
              {loading &&
                [0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-xl" />
                ))}
              {!loading && raw && raw.hits.length === 0 && (
                <p className="text-xs text-muted-foreground">本次没有检索到原始内容。</p>
              )}
              {!loading &&
                raw?.hits.map((hit) => (
                  <article
                    key={hit.contentId}
                    className="rounded-xl border border-blue-100 bg-white/80 p-3"
                  >
                    <p className="line-clamp-2 text-sm font-semibold leading-5">{hit.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {hit.excerpt}
                    </p>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      @{hit.author.name} · {hit.voteUpCount} 赞 · {hit.commentCount} 评论 · 来自「
                      {hit.sourceQuery}」
                    </p>
                  </article>
                ))}
            </div>
            <p className="mt-3 rounded-xl border border-dashed border-blue-200 bg-white/70 p-3 text-xs leading-5 text-blue-700">
              数据量很大，但都是「散落的帖子」——人，得自己从里面捞。
            </p>
          </CompareColumn>

          {/* 第三栏：我们的 Agent */}
          <CompareColumn
            index="③"
            title="我们的 Agent"
            tag="检索 → 证据判读 → 定位到人"
            accent="border-emerald-200 bg-emerald-50/50"
          >
            <p className="text-sm leading-6 text-muted-foreground">
              同一个原始素材，Agent 做证据判读与按人聚合，直接给你「人」。
            </p>
            <div className="mt-3">
              {loading && <Skeleton className="h-40 w-full rounded-2xl" />}
              {!loading && agent && (
                <>
                  <ResultSummary result={agent} />
                  {agent.cards.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-3 text-xs text-muted-foreground">
                      本次原始内容没形成可回链的亲历证据，所以没有硬凑人物。
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {agent.cards.map((creator) => (
                        <ResultCard
                          key={creator.id}
                          creator={creator}
                          featured={false}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </CompareColumn>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          对比演示：②③ 两栏基于完全相同的原始检索结果——一个给你「火海」，一个给你「人」。
        </p>
      </DialogContent>
    </Dialog>
  );
}

function CompareColumn({
  index,
  title,
  tag,
  accent,
  children,
}: {
  index: string;
  title: string;
  tag: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-2xl border p-4 ${accent}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-bold">
          <span className="grid size-6 place-items-center rounded-lg bg-white/80 text-xs font-black text-slate-700">
            {index}
          </span>
          {title}
        </h3>
      </div>
      <p className="mt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {tag}
      </p>
      <div className="mt-2 flex-1">{children}</div>
    </div>
  );
}
