/**
 * 框架层 · 流水线引擎
 *
 * 设计取向：这是一个**确定性工作流引擎**，不是 agent runtime。
 * 它不认识任何一个业务步骤，只负责：
 *   - 按声明顺序执行步骤
 *   - 每步的产物落盘（.artifacts/<runId>/），可回放、可对比、可写进评测报告
 *   - 每步独立缓存（省额度、让演示不依赖实时网络）
 *   - shouldRun 守卫（比如 Triage 判定「别问人」时，后面几步整体跳过）
 *   - optional 步骤失败不炸整条链（优雅降级）
 *
 * 业务方在 src/steps 里按 Step 接口写函数即可；将来想换成 LangGraph 之类，
 * 只需替换 runPipeline 这个 driver，步骤本身不用动。
 */

import { randomUUID } from 'node:crypto';
import { Cache, ContentSource, LlmClient, QuotaGuard } from './ports';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface StepContext {
  runId: string;
  source: ContentSource;
  llm: LlmClient;
  cache: Cache;
  quota: QuotaGuard;
  logger: Logger;
  /**
   * 本轮的实验配置（召回模式 / 重排权重 / 抽取预算）。
   * 框架不认识它的具体形状（`unknown`），业务步骤自己 cast 成 ExperimentConfig。
   *
   * 为什么放在 ctx 而不是 input：它不是「上游产物」，而是「本次运行的参数」——
   * 每个步骤都可能需要，且不随数据流改变。
   */
  config: unknown;
  /** 把中间产物落盘；框架在每步结束后自动调用 */
  saveArtifact(name: string, index: number, value: unknown): Promise<void>;
  /** 毫秒级时钟，便于测试注入 */
  now(): number;
}

export interface Step {
  /** 步骤名，同时作为产物在 artifacts 里的键 */
  name: string;
  /**
   * 依赖哪些步骤的产物。
   *   null       → 直接用流水线的初始输入
   *   'stepName' → 用该步骤的产物
   *   [...]      → 多输入，input 变成 { [stepName]: 产物 }
   */
  from: string | null | string[];
  /** 一句话说明，会出现在 trace 与控制台 */
  describe: string;
  /** 返回 false 则跳过本步（产物为 undefined） */
  shouldRun?(input: unknown, ctx: StepContext): boolean | Promise<boolean>;
  /** 失败是否容忍：true 时记录错误并继续，后续步骤拿到 undefined */
  optional?: boolean;
  /** 返回非 null 则启用结果缓存；建议把影响输出的输入都编进 key */
  cacheKey?(input: unknown, ctx: StepContext): string | null;
  /**
   * 给 trace 用的一句话摘要，让「链路」在界面上可见。
   * 不实现时会用 autoSummary 从产物形态自动推断。
   */
  summarize?(output: unknown): string;
  run(input: any, ctx: StepContext): Promise<unknown>;
}

export interface Pipeline {
  name: string;
  /**
   * 流水线版本。
   * ⚠️ 改动任何步骤的逻辑后都要把它 +1 —— 它会被拼进所有缓存 key。
   * 否则你会拿到「用旧代码算出来的」缓存结果，而且因为每一步都命中缓存，
   * trace 上看起来一切正常，极难排查。（这个坑我们在第一次调试时就踩到了。）
   */
  version: string;
  steps: Step[];
  /** 哪一个步骤的产物是最终对外的结果 */
  resultFrom: string;
}

export type StepStatus = 'ok' | 'cached' | 'skipped' | 'failed';

/**
 * 保留键：流水线的初始输入会被放进 artifacts 的这个键下。
 * 这样任何步骤都可以声明 from: [SYS_INPUT, ...] 拿到最原始的输入，
 * 而不必让上游步骤把它一层层抄下来。
 */
export const SYS_INPUT = '@input';

export interface TraceEntry {
  step: string;
  status: StepStatus;
  ms: number;
  /** 这一步产出了什么，用于在界面上把链路显性化 */
  summary?: string;
  error?: string;
}

/**
 * 从产物形态推断一句摘要。约定优于配置：
 * 数组报条数，候选人数组报人数，带 stats 的报校验比例，带 recommendations 的报卡片数。
 * 步骤想自定义就实现 Step.summarize。
 */
export function autoSummary(output: unknown): string {
  if (output === undefined || output === null) return '';
  if (Array.isArray(output)) return `${output.length} 条`;
  if (typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (Array.isArray(o.recommendations)) return `${o.recommendations.length} 张推荐卡片`;
    if (Array.isArray(o.candidates)) return `${o.candidates.length} 位候选`;
    if (o.stats && typeof o.stats === 'object') {
      const s = o.stats as Record<string, number>;
      const total = s.totalEvents ?? 0;
      const ok = s.traceableEvents ?? 0;
      return `${ok}/${total} 条证据可回溯`;
    }
    if (typeof o.route === 'string') return `路由 → ${o.route}`;
    if (typeof o.contentId === 'string') return '已抽取';
  }
  return '';
}

export interface PipelineOutcome {
  runId: string;
  artifacts: Record<string, unknown>;
  result: unknown;
  trace: TraceEntry[];
  totalMs: number;
}

/**
 * runId 必须是**标准 UUID**。
 *
 * 前端契约（`shared/contracts/search.ts`、`agent.ts`）用 `z.string().uuid()` 校验它。
 * 原来的「ISO 时间戳 + 随机串」格式（`2026-09-14T11-30-00-000Z-abc12`）会被直接判非法，
 * 而且**整个 `run.completed` 事件都会作废** —— 一次搜索的结果就此全丢，
 * 在后端却看不到任何异常（只是日志里一个 uuid 校验失败）。
 *
 * 可读性由 `.artifacts/<uuid>/` 的目录内容保证（每步产物都在里面），
 * 不需要把时间戳编进 id。
 */
function newRunId(): string {
  return randomUUID();
}

/**
 * 启动前校验流水线声明。
 *
 * 为什么必须在跑之前就拦住：步骤引用一个不存在的上游产物名时，
 * 引擎拿到的是 `undefined`，而大多数步骤会「优雅地」输出空结果 ——
 * 于是 trace 上每一步都是 ok，最终却什么都搜不到，极难排查。
 * 我们第一次调试时就被这个坑掉了十几分钟。
 */
export function validatePipeline(pipeline: Pipeline): void {
  const known = new Set<string>([SYS_INPUT]);
  const problems: string[] = [];

  for (const step of pipeline.steps) {
    if (step.name === SYS_INPUT) {
      problems.push(`步骤名不能使用保留键 ${SYS_INPUT}`);
    }
    if (known.has(step.name)) {
      problems.push(`步骤名重复：${step.name}`);
    }

    const refs =
      step.from === null ? [] : Array.isArray(step.from) ? step.from : [step.from];
    for (const ref of refs) {
      if (!known.has(ref)) {
        problems.push(
          `步骤「${step.name}」依赖了不存在的上游产物「${ref}」。` +
            `注意 from 必须是**步骤名**（step.name），不是业务概念名。` +
            `此刻已声明的产物：${[...known].join(', ')}`,
        );
      }
    }

    known.add(step.name);
  }

  if (!known.has(pipeline.resultFrom)) {
    problems.push(`resultFrom="${pipeline.resultFrom}" 不是任何步骤的产物`);
  }

  if (problems.length) {
    throw new Error(`流水线声明有误：\n- ${problems.join('\n- ')}`);
  }
}

/** 调用方（composition root）需要提供的东西：把 runId 交给它，由它决定产物落哪里 */
export interface ContextDeps {
  source: StepContext['source'];
  llm: StepContext['llm'];
  cache: StepContext['cache'];
  quota: StepContext['quota'];
  logger: StepContext['logger'];
  /**
   * 本轮的实验配置。留空给 `undefined`，步骤需自行兜底到默认值。
   * 由 `runPipeline` 的 `opts.config` 覆盖写进 StepContext。
   */
  config?: unknown;
  saveArtifact(runId: string, name: string, index: number, value: unknown): Promise<void>;
  now?(): number;
}

export interface RunPipelineOptions {
  cacheTtlMs?: number;
  /** 本轮的实验配置，会作为 ctx.config 暴露给每个步骤 */
  config?: unknown;
  /**
   * 缓存命名空间：把「会改变结果的运行时环境」编进所有缓存 key。
   *
   * 框架不认识它的具体含义（数据源？语料范围？模型？），只当它是个不透明字符串 ——
   * 由装配根决定填什么。留空则不加后缀（向后兼容）。
   *
   * 为什么必须有：缓存是**落盘且跨进程共享**的。不加这段就会出现
   * 「切到真实语料后，仍然返回上一轮虚构语料算出来的结果」，
   * 而且每步都命中缓存、trace 全绿，看起来完全正常。这个坑真踩到了。
   */
  cacheNamespace?: string;
}

export async function runPipeline(
  pipeline: Pipeline,
  boot: unknown,
  ctx: ContextDeps,
  opts: RunPipelineOptions = {},
): Promise<PipelineOutcome> {
  validatePipeline(pipeline);

  const now = ctx.now ?? (() => Date.now());
  const startedAt = now();
  const runId = newRunId();
  const cacheTtlMs = opts.cacheTtlMs ?? 24 * 60 * 60 * 1000;

  const artifacts: Record<string, unknown> = { [SYS_INPUT]: boot };
  const trace: TraceEntry[] = [];

  const full: StepContext = {
    ...ctx,
    config: opts.config ?? ctx.config,
    runId,
    now,
    saveArtifact: (name: string, index: number, value: unknown) =>
      ctx.saveArtifact(runId, name, index, value),
  };

  for (const [index, step] of pipeline.steps.entries()) {
    const input =
      step.from === null
        ? boot
        : Array.isArray(step.from)
          ? Object.fromEntries(step.from.map((name) => [name, artifacts[name]]))
          : artifacts[step.from];
    const stepStart = now();
    const label = `${String(index + 1).padStart(2, '0')}-${step.name}`;

    try {
      if (step.shouldRun && !(await step.shouldRun(input, full))) {
        trace.push({ step: step.name, status: 'skipped', ms: now() - stepStart });
        ctx.logger.info(`跳过 ${label}：shouldRun=false`);
        continue;
      }

      const rawKey = step.cacheKey?.(input, full) ?? null;
      // 缓存 key = 流水线名 @ 版本 # 环境命名空间 : 步骤自己的 key
      //   版本      → 改步骤逻辑后 bump 即可整体失效
      //   命名空间  → 换数据源/换语料范围后不会读到对方的结果
      const ns = opts.cacheNamespace ? `#${opts.cacheNamespace}` : '';
      const key = rawKey ? `${pipeline.name}@${pipeline.version}${ns}:${rawKey}` : null;
      let status: StepStatus = 'ok';
      let output: unknown;

      if (key) {
        const res = await ctx.cache.getOrSet(key, cacheTtlMs, () =>
          step.run(input, full),
        );
        output = res.value;
        status = res.hit ? 'cached' : 'ok';
      } else {
        output = await step.run(input, full);
      }

      artifacts[step.name] = output;
      await full.saveArtifact(step.name, index, output);
      const summary = step.summarize ? step.summarize(output) : autoSummary(output);
      trace.push({ step: step.name, status, ms: now() - stepStart, summary });
      ctx.logger.info(
        `${label} ${status} (${now() - stepStart}ms)${summary ? ` · ${summary}` : ''}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace.push({ step: step.name, status: 'failed', ms: now() - stepStart, error: message });
      ctx.logger.error(`${label} failed: ${message}`);
      if (!step.optional) throw error;
    }
  }

  return {
    runId,
    artifacts,
    result: artifacts[pipeline.resultFrom],
    trace,
    totalMs: now() - startedAt,
  };
}
