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
import { avatarToneOf, initialOf, personIdOf } from './avatar';
import type { FieldSeed, FieldTopicSeed } from './fields';

/**
 * 布局参数。**坐标系是归一化的 0~1**（前端契约如此），不是像素也不是 0~1000。
 * 这样前端换布局（桌面星图 → 移动端聚类卡片）完全不需要后端配合。
 */
const CENTER = 0.5;
/** 议题离领域中心的距离 */
const TOPIC_RADIUS = 0.28;
/** 标题命中权重：标题最能代表主题，正文里的词可能只是顺带一提 */
const TITLE_WEIGHT = 3;
/** 同一个关键词在正文里最多计几次 —— 防止一个反复出现的词独占分数 */
const MAX_BODY_HITS_PER_KEYWORD = 5;
/** 低于这个分数的人不进星图，避免噪声 */
const MIN_PERSON_SCORE = 3;

/**
 * 头像与标识的小工具已抽到 `./avatar`（人物卡那边也要用，放这里会变成反向依赖）。
 * 这里 re-export，保持既有引用不破。
 */
export { avatarToneOf, initialOf, personIdOf } from './avatar';

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

/**
 * 某人在该领域内的相关度，**0~100**。
 *
 * ⚠️ 与星图里用的是**同一套归一化**。分两处各写一遍的话，
 * 同一个人会在星图上显示 80、在人物名片里显示 0.8 —— 前后端立刻就会打架。
 */
export function personRelevance(index: FieldIndex, person: PersonAggregate): number {
  const maxScore = index.people.length ? totalScore(index.people[0]) : 1;
  return Math.round(
    Math.max(10, Math.min(100, (totalScore(person) / Math.max(1, maxScore)) * 100)),
  );
}

/** 该人关联的议题**名称**，按得分从高到低（与 `topicIds` 的排序一致） */
export function topicNamesOf(index: FieldIndex, person: PersonAggregate): string[] {
  return [...person.topicScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([topicId]) => index.field.topics.find((t) => t.id === topicId)?.name)
    .filter((name): name is string => Boolean(name));
}

/** 在全部领域索引里按 `personId` 找人 —— `GET /api/creators/:id` 用它 */
export function findPersonInIndexes(
  indexes: FieldIndex[],
  personId: string,
): { index: FieldIndex; person: PersonAggregate } | null {
  for (const index of indexes) {
    const person = index.people.find((p) => p.id === personId);
    if (person) return { index, person };
  }
  return null;
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

/** 收一位小数：JSON 里坐标稳定（1.2e-17 这种浮点噪声会让「两次请求是否一致」的断言变脆） */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 议题在半径 0.28 的圆上均匀分布，从正上方开始。坐标是 0~1 归一化值 */
export function layoutTopics(topicIds: string[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const n = topicIds.length;
  if (!n) return out;

  const start = -Math.PI / 2;
  topicIds.forEach((topicId, i) => {
    const angle = start + (2 * Math.PI * i) / n;
    out.set(topicId, {
      x: round3(CENTER + TOPIC_RADIUS * Math.cos(angle)),
      y: round3(CENTER + TOPIC_RADIUS * Math.sin(angle)),
    });
  });
  return out;
}

/**
 * 组装星图：议题节点 + 人物节点。
 *
 * ⚠️ **人物不带坐标**。前端契约里只有 `topics` 有 `position`，人物靠 `topicIds`
 * 自己排布（移动端要降级成聚类卡片，本来就该由前端决定位置）。
 * 我一度给人物也算过坐标，那会被前端的 `.strict()` 直接判为非法响应 —— 已删。
 */
export function layoutFieldGraph(
  index: FieldIndex,
): { topics: TopicNode[]; people: PersonNode[] } {
  const field = index.field;

  // 只保留「有人挂靠」的议题：空议题画在图上只会让人问「这里为什么没人」
  const activeTopics = field.topics.filter((t) => (index.topicMembers.get(t.id) ?? 0) > 0);
  const positions = layoutTopics(activeTopics.map((t) => t.id));

  const topics: TopicNode[] = activeTopics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    description: topic.description,
    position: positions.get(topic.id)!,
  }));

  const people: PersonNode[] = index.people.map((person) => ({
    id: person.id,
    name: person.name,
    headline: person.headline,
    avatarUrl: person.avatarUrl,
    initial: initialOf(person.name),
    avatarTone: avatarToneOf(person.id),
    topicIds: [...person.topicScores.keys()],
    // 与人物名片共用同一套归一化（见 personRelevance）
    relevance: personRelevance(index, person),
    /**
     * 知乎**搜索接口不返回作者主页标识**（见 DEVELOPER.md §9 的协议偏差），
     * 所以这里如实给 null，而不是按姓名拼一个知乎搜索链接 ——
     * 前端契约明确写了「不接受前端拼接」，拼出来的地址点进去大概率是错的人。
     * 接了 OAuth、能读关注列表之后，这里才有可能填上真实地址。
     */
    profileUrl: null,
  }));

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
