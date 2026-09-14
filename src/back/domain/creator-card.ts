/**
 * 领域层 · 人物卡映射
 *
 * 把我们的内部产物映射成前端契约的 `CreatorCardData`（17 个字段，`.strict()`）。
 *
 * **两个来源，同一张卡**：
 *   1. 「问题找人」的结果 —— 从 `Recommendation` 映射，带内容证据与推荐理由
 *   2. 「专业领域」的关联 —— 从领域索引映射，**只有公开关联、没有内容证据**
 * 前端两个入口打开的是同一个名片组件，所以形状必须完全一致。
 *
 * ── 两条不可越的线 ──────────────────────────────────────────────────────
 *   · **不许虚构证据**：没有可核验的证据就给空数组，前端会如实显示「暂无内容证据」。
 *   · **不求能把字段填满**：`suitableQuestions` / `limitations` 都允许为空，
 *     硬凑内容比留空更糟 —— 那是在编一个我们并不知道的判断。
 */

import type { Candidate, ExperienceEvent, Recommendation } from '@/back/domain/types';
import type {
  BackgroundDocument,
  CreatorCard,
  CreatorRole,
  Evidence,
  IdentityConfidence,
  RelevanceLevel,
} from '@/shared/contract';
import { avatarToneOf, httpsOrNull, initialOf, personIdOf } from './avatar';

/** 契约的字段长度上限。截断比被前端判非法响应好。 */
const MAX = {
  headline: 200,
  reason: 500,
  dimension: 40,
  question: 200,
  limitation: 200,
  evidenceTitle: 200,
  evidenceExcerpt: 180,
} as const;

/** 按字数安全截断（`Array.from` 按码点切，避免把 emoji / 代理对切成半个字符） */
function clip(text: string, max: number): string {
  const chars = Array.from(text ?? '');
  return chars.length <= max ? (text ?? '') : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * 内部角色名 → 契约角色枚举。
 *
 * 我们的角色串是「推荐 1｜经历最接近」这种**带序号的展示文案**；
 * 契约要的是稳定的语义枚举。所以这里做一次映射而不是直接透传 ——
 * 透传的话改一句文案就把契约破了。
 */
export function toCreatorRole(role: string): CreatorRole {
  if (role.includes('经历最接近')) return '经历最接近';
  if (role.includes('关键维度')) return '关键维度';
  if (role.includes('另一种视角') || role.includes('补充')) return '补充视角';
  return '领域相关';
}

/** 0~1 的分数 → 契约的三档相关度 */
function toRelevanceLevel(score01: number): RelevanceLevel {
  if (score01 >= 0.66) return '高度相关';
  if (score01 >= 0.4) return '部分相关';
  return '补充视角';
}

/**
 * 身份可信度。**看证据结构，不看粉丝量** —— 这是产品的核心立场。
 *
 * `high`：至少 2 条第一人称亲历证据（「写过」和「经历过」的区别就在这）
 * `medium`：有 1 条亲历，或至少 2 条能回溯的证据
 * `low`：其余（含领域关联来源）
 */
function toIdentityConfidence(experiences: ExperienceEvent[]): IdentityConfidence {
  const firstPerson = experiences.filter((e) => e.firstPerson).length;
  if (firstPerson >= 2) return 'high';
  if (firstPerson >= 1 || experiences.length >= 2) return 'medium';
  return 'low';
}

/** 一条经历 → 一条证据。必须是 https 或 null，否则前端会拒整条卡。 */
function toEvidence(event: ExperienceEvent, index: number): Evidence {
  return {
    // 证据 id 用来源内容 id 派生，保证同一条内容在不同卡片里 id 一致（前端可去重）
    id: `ev_${event.sourceContentId || index}_${event.id}`.slice(0, 120),
    title: clip(event.sourceTitle || '知乎内容', MAX.evidenceTitle),
    excerpt: clip(event.quote, MAX.evidenceExcerpt),
    // 第一人称 = 亲历；否则只是分析。**「反面案例」我们没有可靠信号，就不硬套** ——
    // 把一个普通分析标成反面案例，比不标更误导人。
    kind: event.firstPerson ? '亲身经历' : '专业分析',
    // 知乎搜索接口不返回结构化时间戳，只有正文里的时间线索
    publishedAt: event.timeHint || '时间未标注',
    source: (process.env.USE_FIXTURES === '1' ? 'fixture' : 'zhihu_search') as
      | 'fixture'
      | 'zhihu_search',
    url: httpsOrNull(event.sourceUrl),
  };
}

/**
 * 从经历里提炼「适合继续追问的问题」。
 *
 * 刻意**基于他自己的转变**来问，而不是生成泛泛的面试题 ——
 * 问题必须挂在可核验的事实上，否则就是在替他编立场。
 */
function toSuitableQuestions(experiences: ExperienceEvent[]): string[] {
  return experiences
    .filter((e) => e.firstPerson && e.to)
    .slice(0, 3)
    .map((e) => clip(`你从「${clip(e.from, 20)}」到「${clip(e.to, 20)}」这一步，当时最担心的是什么？`, MAX.question));
}

/** 「问题找人」的结果 → 人物卡 */
export function toCreatorCard(recommendation: Recommendation, mode: 'live' | 'fixture'): CreatorCard {
  void mode; // 证据的 source 由 USE_FIXTURES 决定，不跟随 experiment 组
  const c: Candidate = recommendation.candidate;
  const experiences = c.experiences ?? [];
  const score01 = Math.max(0, Math.min(1, c.score ?? 0));

  // ⚠️ 对外 id 必须用 `personIdOf`，**不能用内部的 `c.id`**。
  // 内部 `c.id` 是 `author:<名字>`（05-aggregate 拼的），而领域星图、`/api/creators`、
  // 会话创建查人用的都是 `personIdOf` 的 `p_<hash>` 体系。
  // 两者不一致时，前端拿卡片 id 去点「与 TA 聊聊」会拿到
  // 409 CONVERSATION_SOURCE_UNAVAILABLE —— 主流程直接断掉。
  // 作者名 → id 是纯哈希，跨领域一致，所以改这里不影响去重与跳转。
  const id = personIdOf(c.authorName);

  return {
    id,
    name: c.authorName,
    headline: clip(c.headline ?? c.authorBadgeText ?? '', MAX.headline),
    initial: initialOf(c.authorName),
    avatarTone: avatarToneOf(id),
    avatarUrl: httpsOrNull(c.authorAvatar),
    profileUrl: httpsOrNull(c.profileUrl),
    identityConfidence: toIdentityConfidence(experiences),
    role: toCreatorRole(recommendation.role),
    relevanceLevel: toRelevanceLevel(score01),
    score: Math.round(score01 * 100),
    matchedDimensions: (recommendation.relevantToYou ?? [])
      .slice(0, 4)
      .map((d) => clip(d, MAX.dimension)),
    reason: clip(recommendation.whyRecommended ?? '', MAX.reason),
    evidence: experiences.slice(0, 3).map(toEvidence),
    suitableQuestions: toSuitableQuestions(experiences),
    limitations: (recommendation.notGoodAt ?? [])
      .slice(0, 4)
      .map((l) => clip(l, MAX.limitation)),
  };
}

/** 领域关联来源 → 人物卡（**没有内容证据**，如实留空） */
export function toFieldCreatorCard(input: {
  id: string;
  name: string;
  headline: string;
  avatarUrl: string | null;
  /** 关联的议题名，用作「匹配维度」 */
  topicNames: string[];
  /** 0~100 的领域相关度 */
  relevance: number;
  /** 所在领域名，写进「局限」里说明来源 */
  fieldName: string;
}): CreatorCard {
  return {
    id: input.id,
    name: input.name,
    headline: clip(input.headline, MAX.headline),
    initial: initialOf(input.name),
    avatarTone: avatarToneOf(input.id),
    avatarUrl: httpsOrNull(input.avatarUrl),
    // 知乎搜索接口不返回作者主页标识，如实给 null；前端不按姓名拼接
    profileUrl: null,
    identityConfidence: 'low',
    // 领域目录只能说「公开内容与议题相关」，**不能说某人「经历最接近」**
    role: '领域相关',
    relevanceLevel: toRelevanceLevel(Math.max(0, Math.min(1, input.relevance / 100))),
    score: Math.round(Math.max(0, Math.min(100, input.relevance))),
    matchedDimensions: input.topicNames.slice(0, 4).map((t) => clip(t, MAX.dimension)),
    reason: clip(
      `在「${input.fieldName}」下的公开内容与这些议题相关：${input.topicNames.join('、')}。`,
      MAX.reason,
    ),
    // ⚠️ 空数组是**如实**的结果，不是占位：领域关联只有公开信息，没有逐条核验的内容证据。
    // 前端会显示「暂无内容证据」—— 不许为凑满而虚构。
    evidence: [],
    suitableQuestions: [],
    limitations: [
      clip('这份资料来自领域关联，只说明公开内容与议题相关，未核验具体经历。', MAX.limitation),
      clip('暂无逐条可回溯的内容证据。', MAX.limitation),
    ],
  };
}

/**
 * 我的「公开内容已足够」结果 → 前端的背景资料。
 *
 * 语义对齐说明：我们的 `contentOnly` 是「**这个问题不用问人，先看这些**」，
 * 前端的 `background` 是「热榜 / 全网搜索，**不参与人物推荐**」。
 * 两者的共同点是「不参与人物推荐的公开内容」，所以可以对齐。
 */
export function toBackgroundDocuments(
  items: { title: string; url: string; quote: string }[],
): BackgroundDocument[] {
  return items.slice(0, 6).map((item) => ({
    scope: 'background' as const,
    source: 'global_search' as const,
    title: clip(item.title || '知乎内容', MAX.evidenceTitle),
    excerpt: clip(item.quote, MAX.evidenceExcerpt),
    // 契约要求 https 绝对地址（不可为 null），非 https 的直接丢弃更安全
    url: httpsOrNull(item.url) ?? '',
    thumbnailUrl: null,
    publishedAt: null,
  })).filter((doc) => doc.url !== '');
}
