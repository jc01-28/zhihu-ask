/**
 * 领域层 · 实验配置
 *
 * 为什么要有这一层：
 * 对照实验的可信度取决于「同一套代码 + 不同配置」。
 * 如果三组对照各自改代码，评审完全可以质疑「你比的不是召回策略，是两次不同的实现」。
 * 所以把所有随实验变化的东西（召回模式、重排权重、抽取预算）集中到这里，
 * 由 runAsk 一次性透传给相关步骤。
 *
 * 三个基线（对应计划书 §6.1）：
 *   A  纯关键词：BM25/多路关键词检索 → 按作者聚合 → 取前 3 位作者，**不做经历抽取、不做证据校验**
 *   B  纯语义：向量召回（embedding cosine）→ 其余同 A
 *   C  完整链路：关键词 + 向量 → RRF 融合 → 经历抽取 → 可解释重排 → 证据校验 → 解释生成
 */

import type { RankingWeights } from '@/back/domain/types';
import type { ExperimentId } from '@/shared/contract';

/**
 * 实验分组标识的事实源在 `src/shared/contract.ts` —— 因为前端要能指定分组做演示，
 * 所以它属于对外契约，不属于后端内部类型。这里 re-export 让后端引用路径保持单一。
 */
export type { ExperimentId };

/** 召回策略 */
export type RecallMode =
  /** 只用关键词侧（当前线上逻辑：知乎 search 接口 + 命中词加权） */
  | 'keyword'
  /** 只用语义侧（向量 cosine，对语料全集打分） */
  | 'semantic'
  /** 关键词 + 语义 → RRF 融合 */
  | 'hybrid';

export interface ExperimentConfig {
  id: ExperimentId;
  /** 人类可读名称，进日志与报告 */
  label: string;
  /** 一句话说明这组配置在验证什么 */
  hypothesis: string;
  recall: RecallMode;
  /** 是否做经历事件抽取（A/B 组关掉，模拟「只给你人，不给你证据」） */
  extractExperience: boolean;
  /** 是否做证据逐字回溯校验（护城河，A/B 组关掉） */
  verifyEvidence: boolean;
  /** 重排权重；A/B 组退化成「看谁被搜到得多」 */
  weights: RankingWeights;
  /** 抽取预算 */
  extractMaxHits: number;
  /** RRF 融合常数（只在 hybrid 下生效） */
  rrfK: number;
}

/**
 * 重排权重：按实验分组。
 * A/B 是「检索层基线」，没有经历数据可算，所以权重全押在 relevance 上 ——
 * 这恰恰暴露了「只排序、不验证」的弱点，是 C 组要打的靶子。
 */
export const WEIGHTS_RETRIEVAL_ONLY: RankingWeights = {
  relevance: 1,
  decisionSimilarity: 0,
  evidenceRichness: 0,
  constraintMatch: 0,
  authority: 0,
  longevity: 0,
  sourceBreadth: 0,
};

export const WEIGHTS_FULL: RankingWeights = {
  relevance: 0.32,
  decisionSimilarity: 0.16,
  evidenceRichness: 0.18,
  constraintMatch: 0.16,
  authority: 0.08,
  longevity: 0.05,
  sourceBreadth: 0.05,
};

export const EXPERIMENTS: Record<ExperimentId, ExperimentConfig> = {
  A: {
    id: 'A',
    label: 'Baseline A · 纯关键词检索',
    hypothesis: '关键词能搜到相关内容，但搜不到「恰好经历过这件事的人」',
    recall: 'keyword',
    extractExperience: false,
    verifyEvidence: false,
    weights: WEIGHTS_RETRIEVAL_ONLY,
    extractMaxHits: 0,
    rrfK: 60,
  },
  B: {
    id: 'B',
    label: 'Baseline B · 纯语义检索',
    hypothesis: '语义召回能跨过措辞差异，但会把「谈过」的人和「做过」的人混在一起',
    recall: 'semantic',
    extractExperience: false,
    verifyEvidence: false,
    weights: WEIGHTS_RETRIEVAL_ONLY,
    extractMaxHits: 0,
    rrfK: 60,
  },
  C: {
    id: 'C',
    label: 'Version C · 完整链路（关键词 + 语义 + 经历抽取 + 证据校验）',
    hypothesis: '两路召回互补，加上「亲历 + 逐字证据」两个约束后，推荐的人更可能是真做过的人',
    recall: 'hybrid',
    extractExperience: true,
    verifyEvidence: true,
    weights: WEIGHTS_FULL,
    extractMaxHits: 4,
    rrfK: 60,
  },
};

/** 线上默认走完整链路 */
export const DEFAULT_EXPERIMENT: ExperimentId = 'C';

export function resolveExperiment(id?: ExperimentId | string): ExperimentConfig {
  const key = (id ?? DEFAULT_EXPERIMENT) as ExperimentId;
  const found = EXPERIMENTS[key];
  if (!found) {
    throw new Error(
      `未知的实验分组「${String(id)}」。可选：${Object.keys(EXPERIMENTS).join(' / ')}`,
    );
  }
  return found;
}

/**
 * 流水线的启动输入。
 *
 * 之前这里只是一个 string，导致「跑 A/B/C」必须改代码 —— 那样对照就不干净了。
 * 现在配置是数据，不是代码。
 */
export interface AskBoot {
  question: string;
  experiment: ExperimentConfig;
  /** 关掉缓存，强制重跑（写评测报告时必须开，否则三组之间会串缓存） */
  useCache: boolean;
}
