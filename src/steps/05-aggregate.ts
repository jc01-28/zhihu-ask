/**
 * Step 05 · 创作者聚合
 *
 * 把经历事件按作者聚合回「人」。这一步是「先内容、后人」路线的枢纽：
 * 知乎的搜索接口不返回作者主页标识，所以我们从内容侧出发反推人，
 * 再用 OAuth 拿到的关注列表去补主页链接与「你已关注」标记。
 *
 * ⚠️ 已知限制（务必在计划书里如实写明）：
 *   搜索接口只给 AuthorName（昵称）+ 头像，没有主页 URL / UrlToken，
 *   也没法按作者反查其全部作品。所以「看 TA 主页」这项对未关注的人是降级的。
 */

import type { Candidate, ExperienceEvent } from '@/domain/types';
import { SYS_INPUT, type Step } from '@/framework/pipeline';
import type { Followee, SearchHit } from '@/framework/ports';

export const aggregateStep: Step = {
  name: 'candidates',
  from: ['events', 'recall', SYS_INPUT],
  describe: '把经历事件聚合回真实创作者',
  cacheKey: (input: { events: ExperienceEvent[] }) =>
    `candidates:${(input.events ?? []).map((e) => e.id).join(',')}`,
  async run(
    input: { events: ExperienceEvent[]; recall: SearchHit[]; '@input': string },
    ctx,
  ) {
    const events = input.events ?? [];
    const hitById = new Map((input.recall ?? []).map((h) => [h.contentId, h]));

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
