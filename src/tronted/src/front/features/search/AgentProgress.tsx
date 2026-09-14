import { Bot, Check } from "lucide-react";

import {
  AGENT_STEP_META,
  type StepState,
} from "@/front/features/search/search-state";

/**
 * 六阶段工作轨迹。
 *
 * 阶段顺序只从 `AGENT_STEP_ORDER` 派生；服务端未上报的阶段永远保持 waiting，
 * 因此界面不会出现「看起来跑过、其实没有」的步骤。
 */
export function AgentProgress({
  steps,
  running,
}: {
  steps: StepState;
  running: boolean;
}) {
  return (
    <aside className="self-end rounded-[24px] border border-white/80 bg-white/84 p-5 shadow-[0_20px_70px_rgba(19,52,95,.1)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Bot className="size-4 text-primary" /> Agent 工作轨迹
        </p>
        <span className="text-xs text-muted-foreground">可解释 · 有证据</span>
      </div>
      <ol className="mt-4 space-y-1">
        {AGENT_STEP_META.map((meta, index) => {
          const step = steps[meta.name];
          return (
            <li
              key={meta.name}
              data-step={meta.name}
              data-status={step.status}
              className={`flex items-start gap-3 rounded-xl px-2 py-2.5 transition ${
                step.status === "running" ? "bg-blue-50" : ""
              }`}
            >
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-full ${
                  step.status === "done"
                    ? "bg-emerald-50 text-emerald-600"
                    : step.status === "running"
                      ? "bg-primary text-white"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {step.status === "done" ? (
                  <Check className="size-4" />
                ) : step.status === "running" ? (
                  <span className="size-2.5 animate-pulse rounded-full bg-white" />
                ) : (
                  <span className="text-xs font-bold">{index + 1}</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{meta.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {step.message}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {!running && (
        <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
          搜索开始后，这里会展示实际执行步骤，不公开模型内部思维过程。
        </p>
      )}
    </aside>
  );
}
