/**
 * 展示口径 · 六阶段
 *
 * 前端规格要 **6 个阶段**的进度，而我们的链路是 **8 步**。
 * 这里做映射，而不是去改链路，理由有两条：
 *
 *   1. 核心链路是 e2e（30 项）与对照实验（62 个请求）的共同基准，
 *      动它就要重跑所有验证 —— 收益却只是"数字对上了"。
 *   2. 「阶段」是**产品叙事**（给用户看进度条），「步骤」是**工程结构**
 *      （给开发者看每步产物与耗时）。两者诉求本来就不一样，分开才是对的。
 *
 * 于是映射表成为唯一事实源：前端**不要再自己聚合 `trace`**，
 * 直接用 `AskResponse.phases`。
 */

import type { AgentPhase, AgentPhaseId } from '@/shared/contract';

export interface TraceEntry {
  step: string;
  status: string;
  ms: number;
  summary: string;
}

/** 阶段定义：顺序即展示顺序 */
export const PHASE_DEFS: { id: AgentPhaseId; label: string }[] = [
  { id: 'context', label: '读取授权上下文' },
  { id: 'understand', label: '理解问题' },
  { id: 'retrieve', label: '检索经历' },
  { id: 'verify', label: '核验证据' },
  { id: 'compose', label: '生成卡片' },
  { id: 'persist', label: '保存结果' },
];

/**
 * 8 步 → 6 阶段的归属。
 *
 * 注意 `question`（引擎的初始输入）不在表里 —— 它不是一个步骤，忽略即可。
 * 每个阶段覆盖哪些步骤，是**可以调的产品决策**；改这里不需要碰任何步骤代码。
 */
const STEP_TO_PHASE: Record<string, AgentPhaseId> = {
  // 「理解问题」= 先判该不该问人，再把处境结构化
  triage: 'understand',
  profile: 'understand',

  // 「检索经历」= 先拿到内容，再从内容里抽出「亲历事件」
  recall: 'retrieve',
  events: 'retrieve',

  // 「核验证据」= 聚合出人 → 重排 → 逐条回溯校验
  candidates: 'verify',
  ranked: 'verify',
  verified: 'verify',

  // 「生成卡片」= 3 张互补角色卡片 + 「别问人」路径
  result: 'compose',
};

/** 聚合一个阶段的整体状态：失败优先，其次跳过，再看是否真执行过 */
function aggregateStatus(entries: TraceEntry[]): AgentPhase['status'] {
  if (!entries.length) return 'pending';
  if (entries.some((e) => e.status === 'failed')) return 'failed';
  if (entries.some((e) => e.status === 'skipped')) return 'skipped';
  if (entries.some((e) => e.status === 'ok')) return 'ok';
  if (entries.some((e) => e.status === 'cached')) return 'cached';
  return 'pending';
}

/**
 * 把 8 步 trace 映射成 6 阶段。
 *
 * `context` 与 `persist` 两阶段不来自 trace：
 *   - `context`（读取授权上下文）发生在流水线之前，由 route 层告知
 *   - `persist`（保存结果）由引擎统一做（每步产物都落盘），没有独立 trace 条目
 */
export function toPhases(
  trace: TraceEntry[] | undefined,
  opts: { authenticated: boolean },
): AgentPhase[] {
  const entries = trace ?? [];

  return PHASE_DEFS.map((def): AgentPhase => {
    if (def.id === 'context') {
      return {
        id: def.id,
        label: def.label,
        status: 'ok',
        ms: 0,
        summary: opts.authenticated
          ? '已授权：可读取你的关注列表，用于补齐创作者主页链接'
          : '未授权：仅使用公开检索，主页链接降级为「在知乎搜索 TA」',
      };
    }

    if (def.id === 'persist') {
      return {
        id: def.id,
        label: def.label,
        status: 'ok',
        ms: 0,
        summary: '每步中间产物已落盘，可按 runId 回放',
      };
    }

    const own = entries.filter((e) => STEP_TO_PHASE[e.step] === def.id);
    return {
      id: def.id,
      label: def.label,
      status: aggregateStatus(own),
      ms: own.reduce((sum, e) => sum + (e.ms ?? 0), 0),
      summary: own
        .map((e) => e.summary)
        .filter(Boolean)
        .join(' · '),
    };
  });
}
