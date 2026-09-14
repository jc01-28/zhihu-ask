import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { Card, CardContent, CardHeader } from "@/front/components/ui/card";
import { cn } from "@/front/shared/cn";
import { describeFieldCounts } from "@/front/features/fields/field-search";
import { fieldColorClasses, fieldIcon } from "@/front/features/fields/field-theme";
import type { FieldSummary } from "@/shared/contracts/field";

export const FIELD_GRID_CLASS = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

/**
 * 领域卡片。
 *
 * 刻意**不展示人物头像**：头像与人物聚类属于星图页，卡片只表达「这个方向是什么」，
 * 否则用户在目录页就会开始判断「要不要找这个人」，而目录页并不提供那些判断依据。
 */
export function FieldCard({ field }: { field: FieldSummary }) {
  const colors = fieldColorClasses(field.color);
  const Icon = fieldIcon(field.icon);

  return (
    <Link
      to={`/app/fields/${encodeURIComponent(field.id)}`}
      className="group rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-label={`查看领域 ${field.name}`}
    >
      <Card
        className={cn(
          "card-enter h-full gap-0 overflow-hidden rounded-2xl py-0 shadow-sm transition-all",
          "group-hover:-translate-y-0.5 group-hover:shadow-[0_18px_48px_rgba(19,52,95,.12)]",
          colors.hoverBorder,
        )}
      >
        <span className={cn("h-1 w-full", colors.bar)} aria-hidden="true" />
        <CardHeader className="gap-3 px-5 pt-5 pb-3">
          <span className={cn("grid size-10 place-items-center rounded-xl", colors.chip)}>
            <Icon className="size-5" />
          </span>
          <h3 className="text-lg font-bold leading-tight">{field.name}</h3>
          <p className="text-sm leading-6 text-muted-foreground">{field.description}</p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4 px-5 pb-5">
          <div className="flex flex-wrap gap-1.5">
            {field.tags.map((tag) => (
              <span
                key={tag}
                className={cn("rounded-full border px-2 py-0.5 text-xs", colors.tag)}
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{describeFieldCounts(field.topicCount, field.memberCount)}</span>
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary">
              领域星图
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
