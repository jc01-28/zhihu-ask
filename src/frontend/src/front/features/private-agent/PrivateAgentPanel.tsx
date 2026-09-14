import { BookLock, CircleAlert, Info, Lock, Sparkles } from "lucide-react";

import { Badge } from "@/front/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/front/components/ui/card";
import {
  PRIVATE_AGENT_DEMO_NOTICE,
  type PrivateAgentStatus,
  type PrivateAgentView,
} from "@/front/features/private-agent/private-agent-state";

const STATUS_CLASSES: Record<PrivateAgentStatus, string> = {
  configured: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-amber-200 bg-amber-50 text-amber-800",
  unconfigured: "border-slate-200 bg-slate-50 text-slate-600",
};

const STATUS_DOT: Record<PrivateAgentStatus, string> = {
  configured: "bg-emerald-500",
  partial: "bg-amber-500",
  unconfigured: "bg-slate-400",
};

/**
 * 私有知识库 Agent 展示区。
 *
 * 只消费本地夹具推导出的 `PrivateAgentView`，**不调用任何接口**：
 * 示例问题点击后只把文本填进输入框（`onPickQuestion`），不会自动发送，
 * 因此这个面板可以整块删掉而不影响聊天主流程。
 */
export function PrivateAgentPanel({
  view,
  onPickQuestion,
}: {
  view: PrivateAgentView;
  onPickQuestion: (question: string) => void;
}) {
  return (
    <Card className="gap-4 rounded-2xl py-5 shadow-none">
      <CardHeader className="px-5">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookLock className="size-5 text-primary" /> 私有知识库 Agent
          </CardTitle>
          <Badge
            variant="outline"
            className={STATUS_CLASSES[view.status]}
            aria-label={`私有知识库状态：${view.statusLabel}`}
          >
            <span className={`size-1.5 rounded-full ${STATUS_DOT[view.status]}`} aria-hidden="true" />
            {view.statusLabel}
          </Badge>
        </div>
        <p className="text-sm font-semibold">{view.name}</p>
      </CardHeader>

      <CardContent className="space-y-4 px-5">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="border-slate-200 bg-white text-xs font-normal">
            <Lock className="size-3" /> 仅答主授权后可见
          </Badge>
          <Badge variant="outline" className="border-slate-200 bg-white text-xs font-normal">
            仅供本人使用
          </Badge>
        </div>

        <section>
          <h3 className="text-xs font-bold text-slate-700">知识库主题</h3>
          {view.topics.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {view.topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                >
                  {topic}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              还没有任何主题被录入。
            </p>
          )}
        </section>

        <section>
          <h3 className="text-xs font-bold text-slate-700">可回答范围</h3>
          {view.scope.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {view.scope.map((item) => (
                <li key={item} className="text-xs leading-5 text-muted-foreground">
                  · {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">暂未划定范围。</p>
          )}
          <p className="mt-2 flex gap-1.5 text-xs leading-5 text-slate-500">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            {view.outOfScopeHint}
          </p>
        </section>

        {view.sampleQuestions.length > 0 && (
          <section>
            <h3 className="text-xs font-bold text-slate-700">示例问题（点击只填入输入框）</h3>
            <ul className="mt-2 space-y-1.5">
              {view.sampleQuestions.map((question) => (
                <li key={question}>
                  <button
                    type="button"
                    onClick={() => onPickQuestion(question)}
                    className="w-full rounded-xl border border-border bg-white px-3 py-2 text-left text-xs leading-5 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <Sparkles className="mr-1 inline size-3" />
                    {question}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-semibold text-slate-700">{view.boundary}</p>
            <p className="mt-1">{PRIVATE_AGENT_DEMO_NOTICE}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
