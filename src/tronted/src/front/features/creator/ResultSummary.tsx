import { ShieldCheck } from "lucide-react";

import { Badge } from "@/front/components/ui/badge";
import type { ContextStatus, PersonSearchResult } from "@/shared/contracts/search";

const CONTEXT_LABEL: Record<ContextStatus, string> = {
  applied: "已应用授权上下文",
  partial: "已部分应用授权上下文",
  unavailable: "未应用授权上下文",
};

/**
 * 结果头部：把本次运行的真实模式、上下文状态与降级情况全部摊开说明。
 * 这里出现的每个数字都直接来自 API，不做任何二次推断。
 */
export function ResultSummary({ result }: { result: PersonSearchResult }) {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">
            本次找到 {result.cards.length} 位有内容证据的人选
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">
            每个推荐，都能看到为什么
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="bg-white">
            {result.modeUsed === "live" ? "知乎实时 API" : "演示数据兜底"}
          </Badge>
          <Badge variant="outline" className="bg-white">
            {CONTEXT_LABEL[result.contextStatus]}
          </Badge>
          <span>分析 {result.analyzedContentCount} 条内容</span>
          <span>·</span>
          <span>排除 {result.rejectedContentCount} 条弱证据</span>
        </div>
      </div>

      {result.modeUsed === "fixture" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          真实知乎 API 暂不可用（{result.fallbackReason ?? "已选择演示模式"}），当前显示虚构演示数据；人物、内容和聊天均不对应真实知乎用户。
        </div>
      )}
      {result.modeUsed === "live" && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-blue-800">
          当前人选由本次知乎公开内容搜索生成。相关度只表示内容匹配，不代表专业资质或咨询质量。
        </div>
      )}
      {result.modelFallback && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          问题理解阶段降级为确定性规则模型；查询方向仍来自你的问题与授权上下文。
        </div>
      )}
      {result.persistence === "unavailable" && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          本次未开启持久化：结果只在当前浏览器会话内有效，刷新后需要重新搜索。
        </div>
      )}
      {result.contextStatus !== "unavailable" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          授权上下文只用于理解问题和规划搜索方向（创作 {result.contextSourceCounts.creation} · 关注{" "}
          {result.contextSourceCounts.followee} · 收藏 {result.contextSourceCounts.collection} · 收藏夹{" "}
          {result.contextSourceCounts.favlist}），不会作为候选人经历。
        </p>
      )}
    </div>
  );
}
