/**
 * Step 03 · 混合召回
 *
 * 用 profile.searchQueries 多路检索，合并去重。
 * 这是「关键词 + 语义」里的关键词侧 —— 语义侧（Embedding）留给你按计划书补：
 *   在 merge 之前，对每题额外跑一次向量召回，把两边做 RRF 融合。
 *
 * 额度提醒：每条 query 一次调用。默认 4 条 = 4 次/问题，
 * 1000 次/天大约够跑 250 个问题（加上缓存实际更省）。
 */

import type { ProblemProfile } from '@/domain/types';
import { SYS_INPUT, type Step } from '@/framework/pipeline';
import type { SearchHit } from '@/framework/ports';

const MAX_QUERIES = 4;
const PER_QUERY = 8;

export const recallStep: Step = {
  name: 'recall',
  from: ['profile', SYS_INPUT],
  describe: '多路检索知乎内容并合并去重',
  cacheKey: (input: { profile: ProblemProfile }) =>
    `recall:${input.profile.searchQueries.join('||')}`,
  async run(input: { profile: ProblemProfile; '@input': string }, ctx) {
    const queries = input.profile.searchQueries.filter(Boolean).slice(0, MAX_QUERIES);
    const queriesToRun = queries.length ? queries : [input[SYS_INPUT]];

    const merged = new Map<string, SearchHit>();

    for (const query of queriesToRun) {
      try {
        const hits = await ctx.source.searchContents({ query, count: PER_QUERY });
        for (const hit of hits) {
          const key = hit.contentId || hit.url || hit.title;
          const existing = merged.get(key);
          // 同一内容被多个 query 命中，说明相关度更高，累加分数
          if (existing) {
            existing.rankingScore = Math.min(1, existing.rankingScore + 0.15);
          } else {
            merged.set(key, hit);
          }
        }
      } catch (error) {
        // 单路失败不影响整体：可能是额度、可能是该 query 无结果
        ctx.logger.warn(`召回失败 query="${query}"：${(error as Error).message}`);
      }
    }

    const hits = [...merged.values()].sort((a, b) => b.rankingScore - a.rankingScore);
    ctx.logger.info(`召回 ${hits.length} 条内容（${queriesToRun.length} 路查询）`);
    return hits;
  },
};
