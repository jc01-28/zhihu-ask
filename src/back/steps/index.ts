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

import { runPipeline, type Pipeline } from '@/back/framework/pipeline';
import type { AskResult } from '@/back/domain/types';
import {
  DEFAULT_EXPERIMENT,
  resolveExperiment,
  type AskBoot,
  type ExperimentId,
} from '@/back/domain/experiment';
import { cacheNamespace, createLogger, createRuntime } from '@/back/adapters';
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
  // 0.2.0：抽取改批量、召回改并发、出站请求加超时
  // 0.2.1：实测发现批量抽取更慢更漏 → 默认改回 per-hit，MAX_HITS 降到 4
  // 0.3.0：抽取预算改为「叙述性 × 相关性 + 作者分散」分配（真实数据上前 4 名根本没有
  //        第一人称经历，导致抽出 0 条；改为按是否像亲身经历来选片）
  // 0.4.0：启动输入从 string 改为 AskBoot（携带实验配置）；召回支持 keyword/semantic/hybrid
  //        + RRF 融合；抽取/校验/权重全部由实验配置驱动（A/B/C 对照实验的前置重构）
  // 0.5.0：语料范围可隔离（FIXTURE_CORPUS=all|synthetic|real，真实语料与虚构语料不再混用）；
  //        语义召回改用端口的 enumerateCorpus 能力，在线直连时降级为候选池重排且如实标注
  version: '0.5.0',
  resultFrom: 'result',
  steps: [
    triageStep,   // 01 分诊：内容 / AI / 真人
    profileStep,  // 02 结构化：现状·目标·约束·检索词
    recallStep,   // 03 混合召回（关键词 / 语义 / RRF 融合）
    extractStep,  // 04 经历事件抽取（核心；A/B 组跳过）
    aggregateStep,// 05 聚合回创作者
    rankStep,     // 06 重排（权重随实验配置）
    verifyStep,   // 07 证据校验（护城河；A/B 组跳过）
    explainStep,  // 08 解释生成 + 别问人路径
  ],
};

export interface RunAskOptions {
  getOAuthToken?: () => Promise<string | null>;
  /** 关掉缓存可以强制重跑，用于对照实验 */
  useCache?: boolean;
  /** 实验分组：A 纯关键词 / B 纯语义 / C 完整链路。默认 C */
  experiment?: ExperimentId;
}

export async function runAsk(
  question: string,
  opts: RunAskOptions = {},
): Promise<AskResult> {
  const logger = createLogger('ask');
  const runtime = createRuntime({ getOAuthToken: opts.getOAuthToken, logger });

  // 配置是数据不是代码：A/B/C 走同一条 runAsk，只是 boot 不同。
  // 这是对照实验可信的前提 —— 三组之间不能有任何实现差异。
  const experiment = resolveExperiment(opts.experiment ?? DEFAULT_EXPERIMENT);
  const boot: AskBoot = {
    question,
    experiment,
    useCache: opts.useCache !== false,
  };

  const outcome = await runPipeline(askPipeline, boot, runtime, {
    config: boot,
    // 换数据源 / 换语料范围后不能读到上一轮的缓存结果（见 cacheNamespace 的说明）
    cacheNamespace: cacheNamespace(),
  });

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
