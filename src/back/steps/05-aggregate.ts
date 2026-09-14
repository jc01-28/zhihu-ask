/**
 * Step 05 · 创作者聚合
 *
 * 把经历事件按作者聚合回「人」。这一步是「先内容、后人」路线的枢纽：
 * 知乎的搜索接口不返回作者主页标识，所以我们从内容侧出发反推人，
 * 再用 OAuth 拿到的关注列表去补主页链接与「你已关注」标记。
 *
 * ── 关于 Baseline A/B ──────────────────────────────────────────────────
 * A/B 组关掉了经历抽取（`extractExperience: false`），此时 events 是空的。
 * 但 A/B 必须仍然能推荐人 —— 它们就是「传统搜索式」的产品形态：
 * 搜到相关内容 → 直接推荐写这些内容的作者。所以这里补一条降级路径：
 * **把召回内容本身当作「一条经历」**（quote 取正文首句，decision 留空）。
 * 这样 A/B/C 的产物结构一致，评测脚本可以公平地比较同一个指标
 * （「Top 3 里有多少是真正经历过这件事的人」）——
 * 而 A/B 之所以会输，正是因为它们把「写得像」当成了「经历过」。
 *
 * ⚠️ 已知限制（务必在计划书里如实写明）：
 *   搜索接口只给 AuthorName（昵称）+ 头像，没有主页 URL / UrlToken，
 *   也没法按作者反查其全部作品。所以「看 TA 主页」这项对未关注的人是降级的。
 */

import type { AskBoot } from '@/back/domain/experiment';
import { resolveExperiment } from '@/back/domain/experiment';
import type { Candidate, ExperienceEvent } from '@/back/domain/types';
import { SYS_INPUT, type Step } from '@/back/framework/pipeline';
import type { Followee, SearchHit } from '@/back/framework/ports';

/** 正文首句截断长度：作为降级 quote，必须能在原文中定位到（见 07-verify） */
const FALLBACK_QUOTE_LEN = 80;

/**
 * 降级：把召回内容直接当作经历事件。
 * quote 从正文开头逐字取，所以它天然能通过证据回溯 —— 这正是要暴露的问题：
 * **「能找到证据」不等于「这条证据说明他经历过」**。
 * A/B 组的推荐理由全部有据可查，但推荐的人可能只是写过这个话题。
 */
function hitsToPseudoEvents(hits: SearchHit[]): ExperienceEvent[] {
  const events: ExperienceEvent[] = [];
  for (const hit of hits) {
    const text = (hit.contentText ?? '').trim();
    if (!text) continue;
    // 取第一句；取不到句号就截前 N 字
    const firstSentence = text.split(/(?<=[。！？])/)[0]?.trim() || text;
    const quote = firstSentence.slice(0, FALLBACK_QUOTE_LEN);
    if (quote.length < 6) continue;

    events.push({
      id: `${hit.contentId}:pseudo`,
      sourceContentId: hit.contentId,
      sourceUrl: hit.url,
      sourceTitle: hit.title,
      authorName: hit.authorName,
      firstPerson: false, // 诚实标注：我们并不知道
      from: '',
      to: '',
      decision: '',
      constraints: [],
      timeHint: '',
      quote,
      relevance: hit.rankingScore || 0,
    });
  }
  return events;
}

export const aggregateStep: Step = {
  name: 'candidates',
  from: ['events', 'recall', SYS_INPUT],
  describe: '把经历事件聚合回真实创作者',
  cacheKey: (input: { events: ExperienceEvent[]; recall: SearchHit[] }, ctx) => {
    const cfg = resolveExperiment((ctx.config as AskBoot | undefined)?.experiment?.id);
    const source = input.events?.length
      ? input.events.map((e) => e.id)
      : (input.recall ?? []).map((h) => h.contentId);
    return `candidates:${cfg.id}:${source.join(',')}`;
  },
  async run(
    input: { events: ExperienceEvent[]; recall: SearchHit[]; '@input': AskBoot },
    ctx,
  ) {
    const recall = input.recall ?? [];
    // A/B 组没有经历抽取 → 用召回内容本身作为降级事件，保证「能推荐人」
    const events = input.events?.length ? input.events : hitsToPseudoEvents(recall);
    if (!input.events?.length && events.length) {
      ctx.logger.info(
        `未做经历抽取（Baseline 检索组）→ 用 ${events.length} 条召回内容直接推荐作者`,
      );
    }

    const hitById = new Map(recall.map((h) => [h.contentId, h]));

    // 关注列表只用于补主页链接；没有 OAuth 授权时静默跳过
    let followees: Followee[] = [];
    try {
      followees = await ctx.source.myFollowees(50);
    } catch (error) {
      ctx.logger.warn(`读取关注列表失败（可能未授权 OAuth），跳过主页补齐：${(error as Error).message}`);
    }
    const followeeByName = new Map(followees.map((f) => [f.fullname, f]));

    const byAuthor = new Map<string, Candidate>();

    for (const event of events) {
      const author = event.authorName?.trim();
      if (!author) continue;

      let candidate = byAuthor.get(author);
      if (!candidate) {
        const hit = hitById.get(event.sourceContentId);
        const followee = followeeByName.get(author);

        candidate = {
          id: `author:${author}`,
          authorName: author,
          authorAvatar: hit?.authorAvatar ?? '',
          authorBadgeText: hit?.authorBadgeText ?? '',
          profileUrl: followee?.url ?? null,
          alreadyFollowed: Boolean(followee),
          headline: followee?.headline ?? null,
          experiences: [],
          sourceCount: 0,
          authorityLevel: 0,
          voteUpCount: 0,
          commentCount: 0,
          score: 0,
          scoreBreakdown: {},
          rejectedReasons: [],
        };
        byAuthor.set(author, candidate);
      }

      candidate.experiences.push(event);
      const hit = hitById.get(event.sourceContentId);
      if (hit) {
        candidate.sourceCount += 1;
        candidate.authorityLevel = Math.max(candidate.authorityLevel, hit.authorityLevel);
        candidate.voteUpCount += hit.voteUpCount;
        candidate.commentCount += hit.commentCount;
        if (!candidate.authorAvatar) candidate.authorAvatar = hit.authorAvatar;
        if (!candidate.authorBadgeText) candidate.authorBadgeText = hit.authorBadgeText;
      }
    }

    const candidates = [...byAuthor.values()];
    ctx.logger.info(
      `聚合出 ${candidates.length} 位候选创作者（其中 ${candidates.filter((c) => c.alreadyFollowed).length} 位你已关注）`,
    );
    return candidates;
  },
};
