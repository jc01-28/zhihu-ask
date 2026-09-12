/**
 * 业务骨干层 · 流水线声明与入口
 *
 * 这里是「业务核心逻辑」的总装配：8 个步骤的先后顺序就是产品的核心链路。
 * 想调整链路（加一步、换顺序、并行化），只改这个数组。
 *
 * 关于「为什么是工作流而不是 agent runtime」——见 README 的架构说明。
 * 一句话：这条链路的每一步输入输出都可预先定义，没有一步需要模型自主决定
 * 「下一步做什么」。需要自主性的只有 Triage 的三路分支，而那是分类结果，不是决策。
 */

import { runPipeline, type Pipeline } from '@/framework/pipeline';
import type { AskResult } from '@/domain/types';
import { createLogger, createRuntime } from '@/adapters';
import { triageStep } from './01-triage';
import { profileStep } from './02-profile';
import { recallStep } from './03-recall';
import { extractStep } from './04-extract';
import { aggregateStep } from './05-aggregate';
import { rankStep } from './06-rank';
import { verifyStep } from './07-verify';
import { explainStep } from './08-explain';

export const askPipeline: Pipeline = {
  name: 'zhihu-ask',
  // ⚠️ 改动任何步骤逻辑后都要 +1，否则会拿到旧代码算出来的缓存结果
  version: '0.1.5',
  resultFrom: 'result',
  steps: [
    triageStep,   // 01 分诊：内容 / AI / 真人
    profileStep,  // 02 结构化：现状·目标·约束·检索词
    recallStep,   // 03 混合召回
    extractStep,  // 04 经历事件抽取（核心）
    aggregateStep,// 05 聚合回创作者
    rankStep,     // 06 重排
    verifyStep,   // 07 证据校验（护城河）
    explainStep,  // 08 解释生成 + 别问人路径
  ],
};

export interface RunAskOptions {
  getOAuthToken?: () => Promise<string | null>;
  /** 关掉缓存可以强制重跑，用于对照实验 */
  useCache?: boolean;
}

export async function runAsk(
  question: string,
  opts: RunAskOptions = {},
): Promise<AskResult> {
  const logger = createLogger('ask');
  const runtime = createRuntime({ getOAuthToken: opts.getOAuthToken, logger });

  const outcome = await runPipeline(askPipeline, question, runtime);

  if (!outcome.result) {
    throw new Error('流水线没有产出结果（result 步骤可能被跳过或失败）');
  }

  return {
    ...(outcome.result as Omit<AskResult, 'trace' | 'runId'>),
    trace: outcome.trace.map((t) => ({
      step: t.step,
      status: t.status,
      ms: t.ms,
      summary: t.summary ?? '',
    })),
    runId: outcome.runId,
  };
}

export { askPipeline as pipeline };
