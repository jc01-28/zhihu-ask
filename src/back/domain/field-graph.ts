/**
 * 领域域 · 从真实内容构建「人物 ↔ 议题」索引，并算出确定性布局
 *
 * 全是纯函数：不碰 IO、不碰框架、不依赖时间与随机源。
 * 好处有两个 —— 可以用固定语料断言结果；换缓存/换调度都不影响正确性。
 *
 * ── 数据是怎么来的 ──────────────────────────────────────────────────────
 *   领域 / 议题 / 关键词         → 人工定义（`fields.ts`，产品叙事必须可控）
 *   谁属于哪个议题、相关度多少   → **真实知乎内容算出来的**（本文件）
 * 所以「人物」永远不是编的 —— 这一点和 8 步链路的「证据驱动」是同一个内核。
 *
 * ── 坐标约定 ────────────────────────────────────────────────────────────
 *   0~1000 的正方形画布，中心 (500,500) 是**领域中心节点**。
 *   议题在半径 300 的圆上均匀分布；人物挂在各自**主要议题**的外圈。
 *   前端按容器尺寸等比缩放即可，不需要自己算布局。
 */

import type { SearchHit } from '@/back/framework/ports';
import type { FieldSummary, PersonNode, TopicNode } from '@/shared/contract';
import type { FieldSeed, FieldTopicSeed } from './fields';

const CANVAS = 1000;
const CENTER = CANVAS / 2;
/** 议题离领域中心的距离 */
const TOPIC_RADIUS = 300;
/** 人物再往外一圈 */
const PERSON_RADIUS_BASE = 110;
/** 标题命中权重：标题最能代表主题，正文里的词可能只是顺带一提 */
const TITLE_WEIGHT = 3;
/** 同一个关键词在正文里最多计几次 —— 防止一个反复出现的词独占分数 */
const MAX_BODY_HITS_PER_KEYWORD = 5;
/** 低于这个分数的人不进星图，避免噪声 */
const MIN_PERSON_SCORE = 3;

/** 头像底色候选。用固定调色板而不是随机色，保证同一人永远同色 */
const AVATAR_TONES = [
  '#2F6FED',
  '#1D9E75',
  '#D85A30',
  '#7F77DD',
  '#EF9F27',
  '#639922',
  '#A855F7',
  '#0E7490',
];

/** FNV-1a。要的是**跨环境确定性**，不是密码学强度 —— 所以不用 crypto */
function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 由字符串得到 0~1 的确定性伪随机数 */
function hashUnit(seed: string): number {
  return (hash32(seed) % 100000) / 100000;
}

/**
 * 人物 id：只由**作者名**决定，不含领域。
 * 这样同一个人出现在多个领域时 id 一致，前端可以据此去重或跳转到同一张名片。
 */
export function personIdOf(authorName: string): string {
  return `p_${hash32(authorName).toString(36)}`;
}

/** 头像占位字：中文取首字，英文取首字母 */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? '?';
  return first.toUpperCase();
}

export function avatarToneOf(id: string): string {
  return AVATAR_TONES[hash32(id) % AVATAR_TONES.length];
}

/** 统计关键词出现次数（大小写不敏感） */
function countOccurrences(haystack: string, needle: string, cap: number): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    if (count >= cap) break;
    from = idx + needle.length;
  }
  return count;
}

/**
 * 一条内容命中了哪些议题、各得多少分。
 *
 * 打分刻意很简单（标题 3 分/次，正文 1 分/次，正文单个词最多 5 次）：
 * 复杂权重在没有标注数据的情况下无法验证，反而更容易自我欺骗。
 */
export function matchTopics(
  hit: Pick<SearchHit, 'title' | 'contentText'>,
  topics: FieldTopicSeed[],
): { topicId: string; score: number }[] {
  const title = hit.title.toLowerCase();
  const body = hit.contentText.toLowerCase();
  const matched: { topicId: string; score: number }[] = [];

  for (const topic of topics) {
    let score = 0;
    for (const raw of topic.keywords) {
      const keyword = raw.toLowerCase().trim();
      if (!keyword) continue;
      score += TITLE_WEIGHT * countOccurrences(title, keyword, 100);
      score += countOccurrences(body, keyword, MAX_BODY_HITS_PER_KEYWORD);
    }
    if (score > 0) matched.push({ topicId: topic.id, score });
  }

  return matched;
}

// ── 索引 ────────────────────────────────────────────────────────────────

export interface PersonAggregate {
  id: string;
  name: string;
  headline: string;
  avatarUrl: string | null;
  /** 议题 id → 该人在此议题上的得分 */
  topicScores: Map<string, number>;
  /** 被计入的内容条数 */
  itemCount: number;
}

export interface FieldIndex {
  field: FieldSeed;
  /** 议题 id → 人数（只有 >0 的才在表里） */
  topicMembers: Map<string, number>;
  people: PersonAggregate[];
  /** 人数字典序，用于稳定排序 */
  totalItems: number;
}

/**
 * 把语料挂到某个领域的议题上，并按作者聚合。
 *
 * 只有命中了该领域任一议题的内容才计入 —— 所以一个人的「领域相关度」是他
 * 在这个领域里写了多少、写得多准，而不是他写了多少。
 */
export function buildFieldIndex(field: FieldSeed, hits: SearchHit[]): FieldIndex {
  const byAuthor = new Map<string, PersonAggregate>();
  const topicMembers = new Map<string, number>();
  let totalItems = 0;

  for (const hit of hits) {
    if (!hit.authorName) continue;

    const matched = matchTopics(hit, field.topics);
    if (!matched.length) continue;

    totalItems += 1;
    const id = personIdOf(hit.authorName);
    let person = byAuthor.get(id);
    if (!person) {
      person = {
        id,
        name: hit.authorName,
        headline: hit.authorBadgeText ?? '',
        avatarUrl: hit.authorAvatar || null,
        topicScores: new Map(),
        itemCount: 0,
      };
      byAuthor.set(id, person);
    }

    // 同一个人在同一议题上有多篇内容 → 累加（写得多确实更相关）
    for (const { topicId, score } of matched) {
      person.topicScores.set(topicId, (person.topicScores.get(topicId) ?? 0) + score);
    }
    person.itemCount += 1;
    // 徽章可能第一篇为空、第二篇有，取到非空的就用
    if (!person.headline && hit.authorBadgeText) person.headline = hit.authorBadgeText;
    if (!person.avatarUrl && hit.authorAvatar) person.avatarUrl = hit.authorAvatar;
  }

  for (const person of byAuthor.values()) {
    const score = [...person.topicScores.values()].reduce((a, b) => a + b, 0);
    if (score < MIN_PERSON_SCORE) continue;
    for (const topicId of person.topicScores.keys()) {
      topicMembers.set(topicId, (topicMembers.get(topicId) ?? 0) + 1);
    }
  }

  const people = [...byAuthor.values()]
    .filter((p) => [...p.topicScores.values()].reduce((a, b) => a + b, 0) >= MIN_PERSON_SCORE)
    // 排序必须稳定：分数相同按 id，否则同一份数据两次请求顺序可能不同
    .sort((a, b) => totalScore(b) - totalScore(a) || a.id.localeCompare(b.id));

  return { field, topicMembers, people, totalItems };
}

function totalScore(person: PersonAggregate): number {
  return [...person.topicScores.values()].reduce((a, b) => a + b, 0);
}

/** 该人在本领域得分最高的议题 —— 决定他挂在星图的哪个方位 */
function primaryTopicOf(person: PersonAggregate): string | null {
  let best: string | null = null;
  let bestScore = -1;
  // 遍历 Map 的顺序即插入顺序，是确定的；同分时取 id 更小的那个保证稳定
  for (const [topicId, score] of person.topicScores) {
    if (score > bestScore || (score === bestScore && best !== null && topicId < best)) {
      best = topicId;
      bestScore = score;
    }
  }
  return best;
}

// ── 领域摘要 ────────────────────────────────────────────────────────────

export function toFieldSummary(field: FieldSeed, index: FieldIndex): FieldSummary {
  return {
    id: field.id,
    name: field.name,
    description: field.description,
    icon: field.icon,
    color: field.color,
    tags: field.tags,
    memberCount: index.people.length,
    // 议题数是「有人挂靠的议题数」，不是定义了几个 —— 空议题不该出现在目录里
    topicCount: index.topicMembers.size,
  };
}

// ── 布局 ────────────────────────────────────────────────────────────────

/** 议题在半径 300 的圆上均匀分布，从正上方开始 */
export function layoutTopics(topicIds: string[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const n = topicIds.length;
  if (!n) return out;

  const start = -Math.PI / 2;
  topicIds.forEach((topicId, i) => {
    const angle = start + (2 * Math.PI * i) / n;
    out.set(topicId, {
      x: Math.round(CENTER + TOPIC_RADIUS * Math.cos(angle)),
      y: Math.round(CENTER + TOPIC_RADIUS * Math.sin(angle)),
    });
  });
  return out;
}

/**
 * 组装星图：议题节点 + 人物节点，全部带坐标。
 *
 * 人物挂在**主要议题**的方位上，角度加一点由 id 决定的抖动（避免叠成一列），
 * 半径也抖动一点。抖动是确定性的，所以刷新页面位置不会变 —— 这在演示时很重要。
 */
export function layoutFieldGraph(
  index: FieldIndex,
): { topics: TopicNode[]; people: PersonNode[] } {
  const field = index.field;

  // 只保留「有人挂靠」的议题：空议题画在图上只会让人问「这里为什么没人」
  const activeTopics = field.topics.filter((t) => (index.topicMembers.get(t.id) ?? 0) > 0);
  const positions = layoutTopics(activeTopics.map((t) => t.id));

  const topics: TopicNode[] = activeTopics.map((topic) => {
    const pos = positions.get(topic.id)!;
    return {
      id: topic.id,
      name: topic.name,
      description: topic.description,
      position: pos,
      memberCount: index.topicMembers.get(topic.id) ?? 0,
    };
  });

  const maxScore = index.people.length ? totalScore(index.people[0]) : 1;

  const people: PersonNode[] = index.people.map((person) => {
    const primary = primaryTopicOf(person);
    const anchor = primary ? positions.get(primary) : undefined;

    // 没有锚点时（不该发生，兜底）放到正上方
    const baseAngle = anchor
      ? Math.atan2(anchor.y - CENTER, anchor.x - CENTER)
      : -Math.PI / 2;
    const angle = baseAngle + (hashUnit(`${person.id}a`) - 0.5) * (Math.PI / 3);
    const radius = TOPIC_RADIUS + PERSON_RADIUS_BASE + hashUnit(`${person.id}r`) * 90;

    return {
      id: person.id,
      name: person.name,
      headline: person.headline,
      avatarUrl: person.avatarUrl,
      initial: initialOf(person.name),
      avatarTone: avatarToneOf(person.id),
      topicIds: [...person.topicScores.keys()],
      relevance: Math.max(0.15, Math.min(1, totalScore(person) / Math.max(1, maxScore))),
      position: {
        x: Math.round(CENTER + radius * Math.cos(angle)),
        y: Math.round(CENTER + radius * Math.sin(angle)),
      },
    };
  });

  return { topics, people };
}

// ── 领域搜索 ────────────────────────────────────────────────────────────

/**
 * 领域搜索。**只搜领域，永远不直接返回人物** ——
 * 这是「领域搜索 → 找领域」与「问题搜索 → 找人」两条路径的边界，
 * 破了这条边界，两个功能就糊在一起了。
 *
 * 打分刻意做成可解释的加权命中，而不是向量相似度：
 * 领域只有 7 个，人工可控，可解释比"更准"重要。
 */
export function scoreField(field: FieldSeed, query: string, index: FieldIndex): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  let score = 0;

  // 领域名 / 别名：命中即强信号
  if (field.name.toLowerCase().includes(q)) score += 40;
  for (const alias of field.aliases) {
    const a = alias.toLowerCase();
    if (a.includes(q)) score += 30;
    else if (q.includes(a)) score += 20;
  }

  // 标签与简介
  for (const tag of field.tags) if (tag.toLowerCase().includes(q)) score += 18;
  if (field.description.toLowerCase().includes(q)) score += 8;

  // 领域级搜索提示词：让**具体技术词**也能命中。
  // 规格里的原例 —— 输入「训练大模型」应同时命中「人工智能应用」与「Agent 开发」，
  // 后者既不是领域名也不是议题名，靠的就是 agent-dev 的 searchHints 里有「大模型」。
  for (const hint of field.searchHints) {
    const h = hint.toLowerCase();
    if (h.includes(q) || q.includes(h)) score += 25;
  }

  // 议题名与议题关键词 —— 这是「输入『训练大模型』也能搜到」的来源
  for (const topic of field.topics) {
    if (topic.name.toLowerCase().includes(q)) score += 22;
    if (topic.description.toLowerCase().includes(q)) score += 6;
    for (const keyword of topic.keywords) {
      if (keyword.toLowerCase().includes(q) || q.includes(keyword.toLowerCase())) score += 12;
    }
  }

  // ⚠️ 关键：没有任何文本命中就直接 0 分。
  // 不能在这里无条件叠加「人数加权」—— 那样每个领域都会 > 0，
  // 结果是「不存在的领域xyz」也能搜出全部 7 个领域。（这个 bug 真踩到过。）
  if (score === 0) return 0;

  // 有命中时，人数只做**微弱**加权：同样命中时，有人的领域排前面（空领域对用户没意义）
  return score + Math.min(6, index.people.length / 4);
}

/**
 * 领域检索 + 排序。返回**全部命中**（已排序），由调用方按 limit 截断。
 *
 * 这里不接 limit 参数，是为了让调用方能同时拿到「命中总数」与「前 N 条」——
 * 否则要先算一遍截断、再算一遍总数，同一份数据跑两遍。
 */
export function searchFields(indexes: FieldIndex[], query: string): FieldSummary[] {
  return indexes
    .map((index) => ({ index, score: scoreField(index.field, query, index) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index.field.id.localeCompare(b.index.field.id))
    .map((item) => toFieldSummary(item.index.field, item.index));
}
