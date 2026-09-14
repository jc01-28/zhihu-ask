import { ChevronRight, ExternalLink, Info } from "lucide-react";

import { Badge } from "@/front/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/front/components/ui/sheet";
import type { CreatorCardData } from "@/shared/contracts/creator";

import { CreatorAvatar } from "@/front/features/creator/CreatorCard";
import { CreatorProfileLinks } from "@/front/features/creator/CreatorProfileLinks";

/** 人物名片的来源。领域来源没有内容证据，展示规则与检索来源不同。 */
export type CreatorDetailSource = "search" | "field";

/**
 * 统一人物名片抽屉。
 *
 * 两个入口（领域星图 / 问题找人）打开的是同一个抽屉，但内容按来源区分：
 *  - `search`：相关度、匹配维度、推荐理由、逐条内容证据；
 *  - `field` ：领域相关度、关联议题、公开简介。
 *
 * 关键约束：**领域来源没有证据时不虚构证据**。契约允许 `evidence` 为空数组，
 * 这里如实说明「暂无内容证据」，并解释为什么没有，而不是用占位文字凑满版式。
 */
export function CreatorDetail({
  creator,
  open,
  onOpenChange,
  onChat,
  chatPending = false,
  source = "search",
}: {
  creator: CreatorCardData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChat?: () => void;
  chatPending?: boolean;
  source?: CreatorDetailSource;
}) {
  const fromField = source === "field";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto bg-white sm:max-w-[500px]">
        {creator && (
          <>
            <SheetHeader className="border-b border-border px-6 py-5">
              <div className="flex items-center gap-3">
                <CreatorAvatar creator={creator} />
                <div>
                  <SheetTitle className="text-xl">{creator.name}</SheetTitle>
                  <SheetDescription className="mt-1">{creator.headline}</SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="space-y-6 px-6 py-4">
              <section>
                <div className="flex items-center justify-between gap-2">
                  <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                    {creator.role}
                  </Badge>
                  <span className="text-sm font-semibold">
                    {fromField ? "领域相关度" : "相关度"} {creator.score}/100
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{creator.reason}</p>
              </section>

              {creator.matchedDimensions.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold">
                    {fromField ? "关联议题" : "匹配维度"}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {creator.matchedDimensions.map((dimension) => (
                      <Badge key={dimension} variant="outline">
                        {dimension}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {fromField ? (
                <section>
                  <h3 className="text-sm font-bold">领域关联</h3>
                  <div className="mt-3 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-700">暂无内容证据</p>
                      <p className="mt-1">
                        领域目录只说明这个人的公开内容与该方向相关，没有经过逐条核验的内容证据，
                        因此这里不展示证据列表。相关度只用于排序展示，不代表可咨询程度。
                      </p>
                    </div>
                  </div>
                </section>
              ) : (
                <section>
                  <h3 className="text-sm font-bold">内容证据</h3>
                  <div className="mt-3 space-y-3">
                    {creator.evidence.map((evidence) => (
                      <article
                        key={evidence.id}
                        className="rounded-xl border border-border bg-slate-50/60 p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className="bg-white">
                            {evidence.kind}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {evidence.publishedAt}
                          </span>
                        </div>
                        <h4 className="mt-3 text-sm font-semibold leading-6">
                          {evidence.title}
                        </h4>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          “{evidence.excerpt}”
                        </p>
                        {evidence.url ? (
                          <a
                            href={evidence.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                          >
                            <ExternalLink className="size-3" /> 查看知乎原文
                          </a>
                        ) : (
                          <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                            <ExternalLink className="size-3" /> Fixture 演示证据，无真实外链
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {creator.suitableQuestions.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold">适合问 TA</h3>
                  <ul className="mt-2 space-y-2">
                    {creator.suitableQuestions.map((question) => (
                      <li
                        key={question}
                        className="flex gap-2 text-sm leading-6 text-muted-foreground"
                      >
                        <ChevronRight className="mt-1 size-3.5 shrink-0 text-primary" />
                        {question}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-bold text-amber-900">边界说明</h3>
                <ul className="mt-2 space-y-1.5">
                  {creator.limitations.map((limitation) => (
                    <li key={limitation} className="text-xs leading-5 text-amber-900">
                      {limitation}
                    </li>
                  ))}
                </ul>
              </section>

              <CreatorProfileLinks
                profileUrl={creator.profileUrl}
                onChat={onChat}
                chatPending={chatPending}
              />

              {!creator.profileUrl && (
                <p className="text-center text-xs leading-5 text-muted-foreground">
                  后端没有为这个人提供公开主页地址，因此不生成知乎链接。
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
