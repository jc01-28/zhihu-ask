import { useState } from "react";
import { ChevronRight, FileCheck2 } from "lucide-react";

import { Badge } from "@/front/components/ui/badge";
import { Button } from "@/front/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/front/components/ui/card";
import { Skeleton } from "@/front/components/ui/skeleton";
import type { CreatorCardData } from "@/shared/contracts/creator";

/**
 * 头像：不做任何图片代理。
 * 只有后端明确给出 `avatarUrl` 时才使用原生 img，加载失败回退到首字。
 */
export function CreatorAvatar({
  creator,
  size = "md",
}: {
  creator: CreatorCardData;
  size?: "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const dimension = size === "lg" ? "size-12" : "size-12";

  if (creator.avatarUrl && !failed) {
    return (
      <img
        src={creator.avatarUrl}
        alt={`${creator.name}的头像`}
        width={48}
        height={48}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${dimension} shrink-0 rounded-full object-cover shadow-sm`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${dimension} grid shrink-0 place-items-center rounded-full bg-gradient-to-br ${creator.avatarTone} text-sm font-bold text-white shadow-sm`}
    >
      {creator.initial}
    </span>
  );
}

export function ResultCard({
  creator,
  featured,
  onDetails,
  onChat,
  chatPending = false,
}: {
  creator: CreatorCardData;
  featured: boolean;
  onDetails?: () => void;
  onChat?: () => void;
  chatPending?: boolean;
}) {
  const chatLabel = chatPending ? "正在创建会话…" : "与 TA 聊聊";

  return (
    <Card
      className={`card-enter gap-4 rounded-2xl py-5 shadow-none ${
        featured
          ? "border-blue-200 bg-gradient-to-b from-blue-50/80 to-white"
          : "border-border bg-white"
      }`}
    >
      <CardHeader className="gap-4 px-5">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="bg-blue-50 text-blue-700">
            {creator.role}
          </Badge>
          <span className="text-xs text-muted-foreground">
            相关度 <strong className="text-base text-foreground">{creator.score}</strong>/100
          </span>
        </div>
        <div className="flex items-center gap-3">
          <CreatorAvatar creator={creator} />
          <div className="min-w-0">
            <CardTitle className="text-lg">{creator.name}</CardTitle>
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {creator.headline}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        <div className="flex flex-wrap gap-1.5">
          {creator.matchedDimensions.map((dimension) => (
            <Badge key={dimension} variant="outline" className="bg-white text-xs font-normal">
              {dimension}
            </Badge>
          ))}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{creator.reason}</p>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <FileCheck2 className="size-3.5 text-primary" /> {creator.evidence.length} 条内容证据
          </p>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {/* 领域来源的人物没有证据：如实说明，不用占位文案冒充证据。 */}
            {creator.evidence[0]?.title ?? "暂无内容证据，资料来自领域公开关联。"}
          </p>
        </div>
      </CardContent>
      <CardFooter className="grid grid-cols-2 gap-2 px-5">
        {onDetails ? (
          <Button variant="outline" onClick={onDetails}>
            查看证据
          </Button>
        ) : (
          <Button variant="outline" disabled title="对比预览中不可操作">
            查看证据
          </Button>
        )}
        {onChat ? (
          <Button onClick={onChat} disabled={chatPending} aria-busy={chatPending}>
            {chatLabel} <ChevronRight />
          </Button>
        ) : (
          <Button disabled title="对比预览中不可操作，请回到搜索结果页操作">
            {chatLabel} <ChevronRight />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export function ResultSkeletons() {
  return (
    <div className="grid gap-4 md:grid-cols-3" aria-label="正在生成人物卡">
      {[0, 1, 2].map((index) => (
        <Card key={index} className="gap-5 rounded-2xl py-5 shadow-none">
          <CardHeader className="px-5">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-5">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
