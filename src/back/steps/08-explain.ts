/**
 * Step 08 · 解释生成
 *
 * 把证据压缩成用户能读的推荐卡片。三条硬规则：
 *   1. 每条「为什么推荐」都必须挂在 evidence 上，否则不许外显；
 *   2. 必须给出「不适合回答什么」——诚实性是本产品相对 LinkedIn 类产品的差异点；
 *   3. 公开内容已足够时走「别问人」路径，主动劝退付费。
 *
 * 三种推荐角色刻意互补而非简单排序：
 *   经历最接近 / 关键维度最懂 / 另一种视角。
 */

import type { AskBoot } from '@/back/domain/experiment';
import { resolveExperiment } from '@/back/domain/experiment';
import type {
  AskResult,
  Candidate,
  ExperienceEvent,
  ProblemProfile,
  Recommendation,
  Route,
} from '@/back/domain/types';
import { SYS_INPUT, type Step } from '@/back/framework/pipeline';
import type { SearchHit } from '@/back/framework/ports';
import type { VerifyReport } from './07-verify';
import { clamp01 } from './shared';

const ROLES = [
  '推荐 1｜经历最接近',
  '推荐 2｜关键维度最懂',
  '推荐 3｜另一种视角',
];

/** 高赞阈值，仅用于观测「大 V 集中度」这个健康指标，不参与排序 */
const BIG_V_VOTE_THRESHOLD = 1000;

function profileUrlFor(candidate: Candidate): string {
  if (candidate.profileUrl) return candidate.profileUrl;
  // 搜索接口不给主页标识，只能降级为「在知乎搜索 TA」
  return `https://www.zhihu.com/search?q=${encodeURIComponent(candidate.authorName)}`;
}

function whyRecommended(candidate: Candidate): string {
  const best = [...candidate.experiences].sort((a, b) => b.relevance - a.relevance)[0];
  if (!best) return '';
  if (best.from && best.to) {
    return `曾经历「${best.from} → ${best.to}」，与你当前的处境高度相似。`;
  }
  if (best.decision) {
    return `在《${best.sourceTitle}》中记录了一段与你的问题直接相关的判断：${best.decision.slice(0, 60)}`;
  }
  return `在《${best.sourceTitle}》中有和你问题直接相关的亲身经历。`;
}

/**
 * 「不适合回答」。
 *
 * 判定原则：**只在有把握时才说不适合**。
 * 这里用「用户关心的约束是否在候选人的证据文本里出现过」做判定 ——
 * 正向可查、可解释，不会出现「说一个读过大厂转创业的人不懂大厂转创业」这种硬伤。
 * 不要用「needExperiences 是否被满足」来判断：那需要语义级匹配，
 * 在启发式模式下会产生大量假阴性，说出来就是错的。
 */
function notGoodAt(
  candidate: Candidate,
  profile: ProblemProfile,
  sourceTextOf: (contentId: string) => string,
): string[] {
  // 判定用「候选人的全部来源原文 + 抽取出的字段」，而不是只看抽出来的那一段，
  // 否则会因为抽取不完整而误判「没覆盖」。
  const pool = [
    ...candidate.experiences.flatMap((e) => [
      e.from,
      e.to,
      e.decision,
      e.constraints.join('，'),
      e.quote,
      sourceTextOf(e.sourceContentId),
    ]),
  ].join(' ');

  const uncovered = profile.constraints
    .filter((c) => c && !pool.includes(c))
    .slice(0, 3)
    .map((c) => `TA 的内容里没有覆盖你关心的「${c}」`);

  const notes = [...uncovered];

  if (!candidate.authorBadgeText) {
    notes.push('除内容外没有可核验的身份认证信息，请自行判断');
  }
  if (candidate.sourceCount <= 1) {
    notes.push('目前只找到 1 条相关公开内容，经历覆盖面可能有限');
  }
  return notes.slice(0, 4);
}

function relevantToYou(candidate: Candidate, profile: ProblemProfile): string[] {
  const text = candidate.experiences
    .flatMap((e) => [e.from, e.to, e.decision, e.constraints.join('，'), e.quote])
    .join(' ');

  const hits = profile.constraints.filter((c) => c && text.includes(c));
  const labels = hits.map((c) => `同样涉及「${c}」`);

  const transitions = candidate.experiences.filter((e) => e.from && e.to);
  if (transitions[0]) labels.push(`${transitions[0].from} → ${transitions[0].to}`);

  const withConstraints = candidate.experiences.find((e) => e.constraints.length);
  if (withConstraints) labels.push(`当时的约束：${withConstraints.constraints.join('、')}`);

  return labels.slice(0, 4);
}

function buildEvidence(experiences: ExperienceEvent[]) {
  return experiences.slice(0, 3).map((e) => ({
    title: e.sourceTitle,
    url: e.sourceUrl,
    quote: e.quote,
  }));
}

export const explainStep: Step = {
  name: 'result',
  from: ['verified', 'recall', 'profile', 'triage', SYS_INPUT],
  describe: '生成推荐卡片与「别问人」路径，并汇总指标',
  async run(
    input: {
      verified: VerifyReport;
      recall: SearchHit[];
      profile: ProblemProfile;
      triage: { route: Route; reason: string };
      '@input': AskBoot;
    },
    ctx,
  ): Promise<Omit<AskResult, 'trace' | 'runId'>> {
    const boot = input[SYS_INPUT];
    const question = boot.question;
    const cfg = resolveExperiment(boot.experiment?.id);
    const hits = input.recall ?? [];
    const hitById = new Map(hits.map((h) => [h.contentId, h]));
    const sourceTextOf = (contentId: string) => hitById.get(contentId)?.contentText ?? '';
    const profile = input.profile;
    const route = input.triage?.route ?? 'human';
    const verified = input.verified ?? {
      candidates: [],
      stats: { totalEvents: 0, traceableEvents: 0, droppedCandidates: 0, verified: false },
    };
    const experiment = { id: cfg.id, label: cfg.label, recall: cfg.recall };

    // 「别问人」路径：公开内容已足够，主动阻止不必要消费
    if (route !== 'human') {
      return {
        question,
        route,
        triageReason: input.triage?.reason ?? '',
        profile,
        recommendations: [],
        contentOnly: hits.slice(0, 3).map((h) => ({
          title: h.title,
          url: h.url,
          quote: h.contentText.slice(0, 200),
        })),
        experiment,
        metrics: {
          hitCount: hits.length,
          eventCount: verified.stats.totalEvents,
          candidateCount: 0,
          evidenceCoverage: 0,
          noEvidenceRate: 0,
          bigVShare: 0,
        },
      };
    }

    const recommendations: Recommendation[] = verified.candidates
      .slice(0, 3)
      .map((candidate, index) => ({
        role: ROLES[index] ?? `推荐 ${index + 1}`,
        candidate,
        whyRecommended: whyRecommended(candidate),
        evidence: buildEvidence(candidate.experiences),
        relevantToYou: relevantToYou(candidate, profile),
        notGoodAt: notGoodAt(candidate, profile, sourceTextOf),
        nextActions: [
          { label: '看相关内容', href: candidate.experiences[0]?.sourceUrl ?? '' },
          { label: candidate.profileUrl ? '看 TA 主页' : '在知乎搜索 TA', href: profileUrlFor(candidate) },
        ],
        // ⚠️ 只有 C 组真的做过逐字回溯。A/B 组即使有伪事件也不该标 verified。
        verified: cfg.verifyEvidence && candidate.experiences.length > 0,
      }));

    const totalEvents = verified.stats.totalEvents;
    const evidenceCoverage = totalEvents ? verified.stats.traceableEvents / totalEvents : 0;
    const bigVShare = recommendations.length
      ? recommendations.filter((r) => r.candidate.voteUpCount >= BIG_V_VOTE_THRESHOLD).length /
        recommendations.length
      : 0;

    ctx.logger.info(
      `[${cfg.id}] 生成 ${recommendations.length} 张推荐卡片，证据覆盖率 ${(evidenceCoverage * 100).toFixed(0)}%` +
        (verified.stats.verified ? '' : '（本组未做证据校验）'),
    );

    return {
      question,
      route,
      triageReason: input.triage?.reason ?? '',
      profile,
      recommendations,
      contentOnly: [],
      experiment,
      metrics: {
        hitCount: hits.length,
        eventCount: totalEvents,
        candidateCount: verified.candidates.length,
        evidenceCoverage: clamp01(evidenceCoverage),
        noEvidenceRate: clamp01(1 - evidenceCoverage),
        bigVShare: clamp01(bigVShare),
      },
    };
  },
};
