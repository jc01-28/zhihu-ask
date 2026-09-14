import { Compass, RotateCcw, Search, Sparkles, SquareArrowOutUpRight, X } from "lucide-react";
import { Link } from "react-router-dom";

import { InlineError } from "@/front/components/layout/PageStates";
import { Button } from "@/front/components/ui/button";
import { Skeleton } from "@/front/components/ui/skeleton";
import { FIELD_GRID_CLASS, FieldCard } from "@/front/features/fields/FieldCard";
import { FIELD_QUERY_MAX_LENGTH } from "@/front/features/fields/field-search";
import type { FieldsController } from "@/front/features/fields/useFields";
import type { FieldSummary } from "@/shared/contracts/field";

/**
 * 骨架屏本身对读屏软件是噪音（`aria-hidden`），但加载这件事必须被播报，
 * 否则屏幕阅读器用户看到的是一个没有任何提示的空白页。
 */
function FieldGridSkeleton({ count = 6, label }: { count?: number; label: string }) {
  return (
    <>
      <div className={FIELD_GRID_CLASS} aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <Skeleton key={index} className="h-56 w-full rounded-2xl" />
        ))}
      </div>
      <span role="status" className="sr-only">
        {label}
      </span>
    </>
  );
}

function FieldGrid({ fields }: { fields: FieldSummary[] }) {
  return (
    <div className={FIELD_GRID_CLASS}>
      {fields.map((field) => (
        <FieldCard key={field.id} field={field} />
      ))}
    </div>
  );
}

/**
 * 专业领域目录。
 *
 * 交互约定：
 *  - 检索提交（回车或按钮）而不是每次击键都请求，行为可预测；
 *  - 检索为空时展示推荐领域，**不做**任何「顺手找人」的动作；
 *  - 推荐领域加载失败与检索失败是两个独立错误区，检索失败不会清掉推荐列表。
 */
export function FieldDirectory({ controller }: { controller: FieldsController }) {
  const {
    input,
    setInput,
    inputError,
    listState,
    featuredState,
    submit,
    retrySearch,
    clearSearch,
    retryFeatured,
  } = controller;

  const searching = listState.status === "loading";
  const showResults = listState.status !== "idle";

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10">
      <section className="card-enter">
        <h1 className="text-3xl font-black tracking-[-0.02em] sm:text-4xl">专业领域</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          先选方向，再看这个方向里的议题和人物。领域检索只在领域之间匹配，
          不会把检索词变成一次「找人」——找人请走「问题找人」。
        </p>

        <form
          className="mt-6 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={input}
              maxLength={FIELD_QUERY_MAX_LENGTH}
              onChange={(event) => setInput(event.target.value)}
              placeholder="检索领域，例如：Agent、风控、检索增强生成"
              aria-label="检索专业领域"
              className="h-11 w-full rounded-xl border border-input bg-white pl-9 pr-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="lg" className="h-11 rounded-xl px-6" disabled={searching}>
              <Search /> {searching ? "检索中" : "检索领域"}
            </Button>
            {showResults && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 rounded-xl"
                onClick={clearSearch}
              >
                <X /> 清空
              </Button>
            )}
          </div>
        </form>

        {inputError && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {inputError}
          </p>
        )}
      </section>

      {listState.status === "error" && (
        <div className="mt-6">
          <InlineError
            message={`「${listState.query}」的领域检索失败：${listState.message}`}
            onRetry={
              listState.retryable
                ? () => {
                    void retrySearch();
                  }
                : undefined
            }
            retryLabel="重新检索"
          />
        </div>
      )}

      {listState.status === "empty" && (
        <section className="mt-6 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-6 py-10 text-center">
          <Compass className="mx-auto size-6 text-primary" />
          <h2 className="mt-3 text-lg font-bold">没有匹配「{listState.query}」的领域</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            可以换一个更宽的关键词，或从下面的推荐领域开始。
            如果你的目标其实是找人，请到「问题找人」描述你的处境。
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={clearSearch}>
              <RotateCcw /> 回到推荐领域
            </Button>
            <Button asChild>
              <Link to="/app/find">
                <SquareArrowOutUpRight /> 去问题找人
              </Link>
            </Button>
          </div>
        </section>
      )}

      {searching && (
        <section className="mt-8">
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="size-4 text-primary" />
            正在检索「{listState.query}」
          </div>
          <FieldGridSkeleton count={3} label={`正在检索领域：${listState.query}`} />
        </section>
      )}

      {listState.status === "ready" && (
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">
              检索到 {listState.items.length} 个领域
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                「{listState.query}」
              </span>
            </h2>
            <Button variant="ghost" size="sm" onClick={clearSearch}>
              <X /> 清空
            </Button>
          </div>
          <FieldGrid fields={listState.items} />
        </section>
      )}

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="size-4 text-primary" /> 推荐领域
          </h2>
          {featuredState.status === "error" && (
            <Button variant="ghost" size="sm" onClick={retryFeatured}>
              <RotateCcw /> 重新加载推荐
            </Button>
          )}
        </div>

        {featuredState.status === "loading" && (
          <FieldGridSkeleton count={3} label="正在加载推荐领域" />
        )}

        {featuredState.status === "error" && (
          <InlineError
            message={`推荐领域加载失败：${featuredState.message}`}
            onRetry={featuredState.retryable ? retryFeatured : undefined}
          />
        )}

        {featuredState.status === "ready" && (
          <FieldGrid
            fields={
              // 检索命中时，推荐区不再重复展示已出现在结果里的领域。
              listState.status === "ready"
                ? featuredState.items.filter(
                    (field) => !listState.items.some((item) => item.id === field.id),
                  )
                : featuredState.items
            }
          />
        )}

        {featuredState.status === "ready" &&
          listState.status === "ready" &&
          featuredState.items.every((field) =>
            listState.items.some((item) => item.id === field.id),
          ) && (
            <p className="rounded-2xl border border-dashed border-border bg-white px-6 py-8 text-center text-sm text-muted-foreground">
              本次检索已经覆盖全部推荐领域。
            </p>
          )}
      </section>
    </div>
  );
}
