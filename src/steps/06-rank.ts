/**
 * Step 06 · 重排
 *
 * 打分公式刻意做得可解释、可调参 —— 因为计划书要在这一层做对照实验。
 * 关键设计：**粉丝量不进公式**（只作为大 V 集中度这个健康指标的观测量），
 * 避免结果退化成粉丝排行榜。
 *
 * 权重建议在评测阶段用 Golden Set 调，别凭感觉调。
 */

import type { Candidate, ProblemProfile } from '@/domain/types';
import type { Step } from '@/framework/pipeline';
import { clamp01 } from './shared';

export interface RankingWeights {
  relevance: number;
  decisionSimilarity: number;
  evidenceRichness: number;
  constraintMatch: number;
  authority: number;
  longevity: number;
  sourceBreadth: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  relevance: 0.32,
  decisionSimilarity: 0.16,
  evidenceRichness: 0.18,
  constraintMatch: 0.16,
  authority: 0.08,
  longevity: 0.05,
  sourceBreadth: 0.05,
};

/** 决策相似度：from/to 是否描述了一类「转变」，而不只是零散经历 */
function decisionSimilarity(candidate: Candidate): number {
  const transitions = candidate.experiences.filter((e) => e.from && e.to).length;
  return clamp01(transitions / Math.max(candidate.experiences.length, 1));
}

/** 证据丰富度：有决策描述、有约束、摘录够长的经历更可信 */
function evidenceRichness(candidate: Candidate): number {
  if (!candidate.experiences.length) return 0;
  const perEvent =
    candidate.experiences.reduce((sum, e) => {
      let s = 0;
      if (e.decision) s += 0.4;
      if (e.constraints.length) s += 0.2;
      if (e.timeHint) s += 0.2;
      if (e.quote.length >= 30) s += 0.2;
      return sum + s;
    }, 0) / candidate.experiences.length;
  return clamp01(perEvent);
}

/** 约束匹配：候选人经历里的约束与用户约束重合越多，越值得推 */
function constraintMatch(candidate: Candidate, profile: ProblemProfile): number {
  if (!profile.constraints.length) return 0.5;
  const pool = candidate.experiences.flatMap((e) => [e.constraints.join(','), e.from, e.to, e.decision]).join(' ');
  const hit = profile.constraints.filter((c) => c && pool.includes(c)).length;
  return clamp01(hit / profile.constraints.length);
}

/** 时效性：经历事件的时间线索越新越好（简化实现，可换成真实时间戳） */
function longevity(candidate: Candidate, nowYear: number): number {
  const years = candidate.experiences
    .map((e) => {
      const m = e.timeHint.match(/(20\d{2})/);
      return m ? Number(m[1]) : null;
    })
    .filter((y): y is number => y !== null);

  if (!years.length) return 0.5;
  const latest = Math.max(...years);
  return clamp01(1 - (nowYear - latest) / 6);
}

export function scoreCandidate(
  candidate: Candidate,
  profile: ProblemProfile,
  weights: RankingWeights,
  nowYear: number,
): Candidate {
  const relevance =
    candidate.experiences.reduce((max, e) => Math.max(max, e.relevance), 0) || 0;

  const breakdown: Record<string, number> = {
    relevance: clamp01(relevance) * weights.relevance,
    decisionSimilarity: decisionSimilarity(candidate) * weights.decisionSimilarity,
    evidenceRichness: evidenceRichness(candidate) * weights.evidenceRichness,
    constraintMatch: constraintMatch(candidate, profile) * weights.constraintMatch,
    authority: clamp01(candidate.authorityLevel / 4) * weights.authority,
    longevity: longevity(candidate, nowYear) * weights.longevity,
    sourceBreadth: clamp01(candidate.sourceCount / 3) * weights.sourceBreadth,
  };

  return {
    ...candidate,
    scoreBreakdown: breakdown,
    score: Object.values(breakdown).reduce((a, b) => a + b, 0),
  };
}

export const rankStep: Step = {
  name: 'ranked',
  from: ['candidates', 'profile'],
  describe: '按决策相似度与证据强度重排候选',
  cacheKey: (input: { candidates: Candidate[]; profile: ProblemProfile }) =>
    `ranked:${input.profile.currentState}:${(input.candidates ?? []).map((c) => c.id).join(',')}`,
  async run(input: { candidates: Candidate[]; profile: ProblemProfile }, ctx) {
    const nowYear = new Date().getFullYear();
    const ranked = (input.candidates ?? [])
      .map((c) => scoreCandidate(c, input.profile, DEFAULT_WEIGHTS, nowYear))
      .sort((a, b) => b.score - a.score);

    if (ranked[0]) {
      ctx.logger.info(
        `重排完成，Top1=${ranked[0].authorName} score=${ranked[0].score.toFixed(3)}`,
      );
    }
    return ranked;
  },
};
