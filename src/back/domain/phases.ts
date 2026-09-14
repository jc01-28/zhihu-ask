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

/** 阶段定义：顺序即展示顺序，与前端 `AGENT_STEP_ORDER` 逐字一致 */
export const PHASE_DEFS: { id: AgentPhaseId; label: string }[] = [
  { id: 'loading_context', label: '读取授权上下文' },
  { id: 'understanding', label: '理解问题' },
  { id: 'retrieving', label: '检索经历' },
  { id: 'verifying', label: '核验证据' },
  { id: 'ranking', label: '重排候选' },
  { id: 'saving', label: '保存结果' },
];

/**
 * 8 步 → 6 阶段的归属。
 *
 * 注意 `question`（引擎的初始输入）不在表里 —— 它不是一个步骤，忽略即可。
 * 每个阶段覆盖哪些步骤是**可以调的产品决策**；改这里不需要碰任何步骤代码。
 *
 * ⚠️ **一个真实链路与展示顺序的错位，流式化时必须处理**：
 * 我们的链路实际是 `candidates → ranked → verified`，即**先重排、后校验**；
 * 而前端要求的阶段顺序是 `verifying → ranking`，**先校验、后重排**。
 * 现在一次性返回时无所谓（只在最后做一次汇总），但**升级成 NDJSON 流式时**，
 * `ranking` 的 `step.completed` 必须**在 `verifying` 之后**发出，
 * 否则前端进度条会倒退。要么调整链路顺序，要么在流式层做事件重排。
 */
const STEP_TO_PHASE: Record<string, AgentPhaseId> = {
  // 「理解问题」= 先判该不该问人，再把处境结构化
  triage: 'understanding',
  profile: 'understanding',

  // 「检索经历」= 先拿到内容，再从内容里抽「亲历事件」
  recall: 'retrieving',
  events: 'retrieving',

  // 「核验证据」= 聚合出候选，并逐条回溯校验
  candidates: 'verifying',
  verified: 'verifying',

  // 「重排候选」= 加权排序并生成最终的推荐卡片
  ranked: 'ranking',
  result: 'ranking',
};

/** 反向索引：阶段 → 它由哪些步骤构成 */
const PHASE_STEPS: Record<string, string[]> = Object.entries(STEP_TO_PHASE).reduce(
  (acc, [step, phase]) => {
    (acc[phase] ??= []).push(step);
    return acc;
  },
  {} as Record<string, string[]>,
);

const PHASE_MESSAGE: Record<AgentPhaseId, string> = {
  loading_context: '正在读取授权上下文',
  understanding: '正在理解你的处境',
  retrieving: '正在检索相关经历',
  verifying: '正在逐条核验证据',
  ranking: '正在重排候选',
  saving: '正在保存结果',
};

// ── 流式阶段发射器 ──────────────────────────────────────────────────────

export interface PhaseEvent {
  type: 'step.started' | 'step.completed';
  step: AgentPhaseId;
  message: string;
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * 把 8 步的**实时**事件，翻译成 6 阶段的**实时**事件流。
 *
 * ⚠️ 这里必须做缓冲，原因是链路顺序与展示顺序**交错**：
 *
 *   我们的链路：  … → candidates → ranked → verified → result
 *   阶段归属：    … → verifying  → ranking → verifying → ranking
 *   前端要的顺序：… → verifying → ranking（单向，不许倒退）
 *
 * 如果照搬引擎事件，前端会看到 `verifying → ranking → verifying` —— 进度条会**倒退**，
 * 看起来像出 bug 了。所以这里的策略是：
 *   · `started` 只在前一个阶段完成后才发（保证单调）
 *   · `completed` 等该阶段的**全部**步骤跑完才发
 * 代价是 `ranking` 的 started 会被推迟到 `verified` 之后 —— 展示上仍然连贯，
 * 而且**不撒谎**（前一个阶段确实还没验完）。
 */
export function createPhaseStream(send: (event: PhaseEvent) => void) {
  const startedSteps = new Set<string>();
  const completedSteps = new Set<string>();
  const phaseStarted = new Set<AgentPhaseId>();
  const phaseDone = new Set<AgentPhaseId>();
  const phaseMs = new Map<AgentPhaseId, number>();
  const phaseSummaries = new Map<AgentPhaseId, string[]>();
  /** 没有对应步骤的阶段（读取授权上下文 / 保存结果）先记下来，等轮到自己再发 */
  const pendingExternal = new Map<AgentPhaseId, string>();

  const order = PHASE_DEFS.map((d) => d.id);

  const isReady = (i: number) => order.slice(0, i).every((p) => phaseDone.has(p));

  function flush(): void {
    for (let i = 0; i < order.length; i += 1) {
      const phase = order[i];
      // 前一个阶段没完成，后面的绝不开跑 —— 这条保证进度单调
      if (!isReady(i)) break;
      if (phaseDone.has(phase)) continue;

      const steps = PHASE_STEPS[phase] ?? [];
      const external = pendingExternal.has(phase);

      // 启动条件：自己的步骤开始了，或者它是被外部标记完成的阶段
      if (!phaseStarted.has(phase)) {
        if (!external && !steps.some((s) => startedSteps.has(s))) break;
        phaseStarted.add(phase);
        send({ type: 'step.started', step: phase, message: PHASE_MESSAGE[phase] });
      }

      // 完成条件：自己的步骤**全部**跑完，或外部已标记完成
      if (steps.length ? !steps.every((s) => completedSteps.has(s)) : !external) break;

      phaseDone.add(phase);
      const externalSummary = pendingExternal.get(phase);
      pendingExternal.delete(phase);
      const own = (phaseSummaries.get(phase) ?? []).filter(Boolean).join(' · ');
      send({
        type: 'step.completed',
        step: phase,
        message: PHASE_MESSAGE[phase],
        meta: { ms: phaseMs.get(phase) ?? 0, summary: externalSummary || own },
      });
    }
  }

  return {
    stepStarted(step: string): void {
      startedSteps.add(step);
      flush();
    },
    stepCompleted(step: string, ms: number, summary: string): void {
      completedSteps.add(step);
      const phase = STEP_TO_PHASE[step];
      if (phase) {
        phaseMs.set(phase, (phaseMs.get(phase) ?? 0) + (ms ?? 0));
        if (summary) phaseSummaries.set(phase, [...(phaseSummaries.get(phase) ?? []), summary]);
      }
      flush();
    },
    /**
     * 标记一个**没有对应步骤**的阶段完成（读取授权上下文 / 保存结果）。
     *
     * ⚠️ 不会立刻发出 —— 只登记，等 `flush` 推进到它才发。
     * 否则「保存结果」会在前五个阶段还没跑完时抢先冒出来，进度条直接乱掉。
     */
    externalDone(phase: AgentPhaseId, summary: string): void {
      pendingExternal.set(phase, summary);
      flush();
    },
    /** 兜底：链路异常时把还没发的阶段补完，避免前端进度条永远卡在中间 */
    finish(): void {
      for (const phase of order) {
        if (phaseDone.has(phase)) continue;
        if (!phaseStarted.has(phase)) {
          phaseStarted.add(phase);
          send({ type: 'step.started', step: phase, message: PHASE_MESSAGE[phase] });
        }
        phaseDone.add(phase);
        send({
          type: 'step.completed',
          step: phase,
          message: PHASE_MESSAGE[phase],
          meta: { summary: '链路提前结束' },
        });
      }
    },
  };
}

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
    if (def.id === 'loading_context') {
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

    if (def.id === 'saving') {
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
