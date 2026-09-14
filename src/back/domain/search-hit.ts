/**
 * 领域层 · 检索命中 → 对外窄形状
 *
 * `POST /api/compare` 的「原文侧」要把内部 `SearchHit` 摊给前端看。
 * 但内部形状带了不少**不该过线**的东西（`matchedBy` 召回归因、`comments` 精选评论、
 * `contentText` 全文），所以这里做一次收窄，而不是直接透传。
 *
 * 这也是一道安全边界：前端拿到什么，由这个映射说了算，而不是由上游数据源决定。
 */

import type { SearchHit } from '@/back/framework/ports';
import { personIdOf } from './avatar';
import type { SearchHitCard } from '@/shared/contract';

const VALID_TYPES = ['Answer', 'Article', 'Question'] as const;
const MAX_EXCERPT = 800;
const MAX_TITLE = 200;

function clip(text: string, max: number): string {
  const chars = Array.from(text ?? '');
  return chars.length <= max ? (text ?? '') : `${chars.slice(0, max - 1).join('')}…`;
}

/** 内容类型收敛到契约的四个取值之一。上游给什么奇怪的字符串都不会漏出去 */
function toContentType(raw: string): SearchHitCard['contentType'] {
  const hit = VALID_TYPES.find((t) => t.toLowerCase() === (raw ?? '').toLowerCase());
  return hit ?? 'Other';
}

/**
 * 作者名 → 稳定的公开标识。
 *
 * ⚠️ 用的是我们自己的 `personIdOf`，**不是知平的 UID** ——
 * 搜索结果里本来就没有 UID，而且 UID 属于内部标识，不该出现在对外契约里。
 * 好处是：这个 id 与人物卡、领域星图里的 id 完全一致，前端可以互相跳转。
 */
export function toSearchHitCard(
  hit: SearchHit,
  sourceQuery: string,
  provider: 'zhihu_search' | 'fixture',
): SearchHitCard {
  const level = Math.min(4, Math.max(1, Math.round(hit.authorityLevel || 1)));

  return {
    contentId: hit.contentId,
    contentType: toContentType(hit.contentType),
    title: clip(hit.title, MAX_TITLE),
    excerpt: clip(hit.contentText, MAX_EXCERPT),
    url: hit.url,
    commentCount: Math.max(0, hit.commentCount ?? 0),
    voteUpCount: Math.max(0, hit.voteUpCount ?? 0),
    editTime: Math.max(0, hit.editTime ?? 0),
    rankingScore: hit.rankingScore ?? 0,
    author: {
      syntheticId: personIdOf(hit.authorName || '未知作者'),
      name: hit.authorName || '未知作者',
      avatarUrl: hit.authorAvatar || null,
      badgeText: hit.authorBadgeText || null,
      authorityLevel: level as 1 | 2 | 3 | 4,
    },
    sourceQuery: clip(sourceQuery, 100),
    provider,
  };
}
