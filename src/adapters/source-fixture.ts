/**
 * 适配器 · 本地 fixture 内容源
 *
 * 为什么要有它：知乎 Access Secret 要申请、OAuth app_key 要等审批、
 * 回调必须是公网 HTTPS。这些都不该挡住业务开发。
 * 打开 USE_FIXTURES=1，全链路立刻可跑，且结果完全确定（适合写测试与对照实验）。
 *
 * 检索策略：对 query 分词后按「命中词数 + 标题加权」排序。
 * 它不是高质量检索器 —— 那是业务骨干层要升级的事（关键词 + Embedding 混合召回）。
 */

import { tokenize } from '@/framework/llm-utils';
import type {
  ContentSource,
  Followee,
  HotItem,
  MyContentItem,
  SearchHit,
} from '@/framework/ports';
import data from '@/fixtures/sample-hits.json';

interface FixtureFile {
  hits: SearchHit[];
  followees: Followee[];
  hotList: HotItem[];
  myContents: MyContentItem[];
}

const db = data as unknown as FixtureFile;

export class FixtureSource implements ContentSource {
  readonly name = 'fixture';

  async searchContents(req: { query: string; count?: number }): Promise<SearchHit[]> {
    const terms = tokenize(req.query);
    const scored = db.hits.map((hit) => {
      const haystack = `${hit.title} ${hit.contentText} ${hit.authorBadgeText}`;
      const body = tokenize(haystack);
      let score = 0;
      for (const term of terms) {
        if (hit.title.includes(term)) score += 3;
        if (body.includes(term)) score += 1;
      }
      return { hit, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.hit.voteUpCount - a.hit.voteUpCount)
      .slice(0, req.count ?? 10)
      .map((s) => ({ ...s.hit, rankingScore: Math.min(1, s.score / 10) }));
  }

  async hotList(limit = 20): Promise<HotItem[]> {
    return db.hotList.slice(0, limit);
  }

  async myFollowees(limit = 50): Promise<Followee[]> {
    return db.followees.slice(0, limit);
  }

  async myContents(limit = 20): Promise<MyContentItem[]> {
    return db.myContents.slice(0, limit);
  }
}
