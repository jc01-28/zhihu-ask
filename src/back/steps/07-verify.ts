/**
 * Step 07 · 证据校验（Evidence Verify）
 *
 * 计划书的护城河在这里：所有「这个人经历过 X」的外显陈述，必须能回溯到原始内容。
 * 找不到证据就不说 —— 这一步是产品可信度的强制执行点，不是可选项。
 *
 * 注意：校验用的是「原文包含」这种确定性判断，而不是再问一次模型。
 * 用模型校验模型等于没校验。
 *
 * 可升级方向：
 *   - 语义级校验（同一事实的不同表述也算通过），但要保留确定性兜底；
 *   - 把 rejectedReasons 汇总成「无证据陈述率」的实时看板数据。
 */

import type { AskBoot } from '@/back/domain/experiment';
import { resolveExperiment } from '@/back/domain/experiment';
import type { Candidate, ExperienceEvent } from '@/back/domain/types';
import type { Step } from '@/back/framework/pipeline';
import type { SearchHit } from '@/back/framework/ports';
import { quoteIsTraceable } from './shared';

export interface VerifyReport {
  candidates: Candidate[];
  stats: {
    totalEvents: number;
    traceableEvents: number;
    droppedCandidates: number;
    /** 本组是否执行了证据校验（A/B 为 false，评测报告要如实标注） */
    verified: boolean;
  };
}

export const verifyStep: Step = {
  name: 'verified',
  from: ['ranked', 'recall'],
  describe: '逐条校验推荐理由能否回溯到原文',
  cacheKey: (input: { ranked: Candidate[] }, ctx) => {
    const cfg = resolveExperiment((ctx.config as AskBoot | undefined)?.experiment?.id);
    return `verified:${cfg.id}:${(input.ranked ?? []).map((c) => c.id).join(',')}`;
  },
  async run(
    input: { ranked: Candidate[]; recall: SearchHit[] },
    ctx,
  ): Promise<VerifyReport> {
    const cfg = resolveExperiment((ctx.config as AskBoot | undefined)?.experiment?.id);

    // Baseline A/B 不做证据校验 —— 这正是它们与 C 组的护城河差距。
    // 注意：此时 stats.verified=false 会进产物，评测报告据此标注「该组结论未经校验」。
    if (!cfg.verifyEvidence) {
      const candidates = (input.ranked ?? []).map((c) => ({
        ...c,
        rejectedReasons: [...c.rejectedReasons, 'Baseline 组未执行证据校验（verified=false）'],
      }));
      ctx.logger.info(`跳过证据校验（${cfg.id} 组，Baseline 不做逐字回溯）`);
      return {
        candidates,
        stats: { totalEvents: 0, traceableEvents: 0, droppedCandidates: 0, verified: false },
      };
    }

    const hitById = new Map((input.recall ?? []).map((h) => [h.contentId, h]));
    let totalEvents = 0;
    let traceableEvents = 0;
    let droppedCandidates = 0;

    const candidates: Candidate[] = [];

    for (const candidate of input.ranked ?? []) {
      const kept: ExperienceEvent[] = [];
      const rejected: string[] = [];

      for (const event of candidate.experiences) {
        totalEvents += 1;
        const source = hitById.get(event.sourceContentId);
        if (!source) {
          rejected.push(`内容 ${event.sourceContentId} 不在本次召回结果中，无法回溯`);
          continue;
        }
        if (!quoteIsTraceable(event.quote, source.contentText)) {
          rejected.push(`摘录在原文中定位不到：${event.quote.slice(0, 30)}…`);
          continue;
        }
        traceableEvents += 1;
        kept.push(event);
      }

      // 信心护栏：一条都没过的候选人，宁缺毋滥，直接不推
      if (kept.length === 0) {
        droppedCandidates += 1;
        continue;
      }

      candidates.push({ ...candidate, experiences: kept, rejectedReasons: rejected });
    }

    ctx.logger.info(
      `证据校验：${traceableEvents}/${totalEvents} 条可回溯，剔除 ${droppedCandidates} 位候选`,
    );

    return {
      candidates,
      stats: { totalEvents, traceableEvents, droppedCandidates, verified: true },
    };
  },
};
