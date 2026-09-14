/**
 * 处理器 · 人物公开资料
 *
 * `GET /api/creators/:creatorId` —— **领域星图与问题找人共用这一个出口**，
 * 返回同一份 `CreatorCard`。前端两个入口打开的是同一个名片组件。
 *
 * ── 为什么需要一个「人物注册表」──────────────────────────────────────────
 * `personId` 是作者名的哈希（见 `avatar.ts` 的 `personIdOf`），**不可逆**。
 * 所以不能用 id 反查名字，只能反过来：把语料里出现过的作者都登记一遍，用 id 去查。
 *
 * 而语料有**两份**，分别服务两条路径：
 *   · `enumerateRealCorpus`（真实 harvested 语料）→ 领域星图的作者
 *   · `enumerateCorpus`（当前 scope 的检索语料）→ 找人链路的作者
 * 只登记一份，就会出现「星图点得开、找人点不开」这种一半坏的情况。
 * 所以注册表建在**两份的并集**上。
 */

import { cacheNamespace, createRuntime } from '@/back/adapters';
import { httpsOrNull, personIdOf } from '@/back/domain/avatar';
import { toFieldCreatorCard } from '@/back/domain/creator-card';
import { findPersonInIndexes, personRelevance, topicNamesOf } from '@/back/domain/field-graph';
import type { SearchHit } from '@/back/framework/ports';
import { API_ERROR_CODES, type CreatorCard } from '@/shared/contract';
import { loadFieldIndexes } from './fields';
import { fail, ok, type HandlerResult } from './types';

interface PersonRecord {
  id: string;
  name: string;
  headline: string;
  avatarUrl: string | null;
}

/** 与领域索引一样，按「数据源 + 语料范围」做缓存命名空间 */
let registryCache: { map: Map<string, PersonRecord>; builtAt: number; namespace: string } | null = null;

const REGISTRY_TTL_MS = Number(process.env.PERSON_REGISTRY_TTL_MS ?? 600000);

/** 供测试重置 */
export function __resetPersonRegistry(): void {
  registryCache = null;
}

async function loadRegistry(): Promise<Map<string, PersonRecord>> {
  const namespace = cacheNamespace();
  if (
    registryCache &&
    registryCache.namespace === namespace &&
    Date.now() - registryCache.builtAt < REGISTRY_TTL_MS
  ) {
    return registryCache.map;
  }

  const runtime = createRuntime({ getOAuthToken: async () => null });
  const source = runtime.source;
  const corpora: SearchHit[] = [];

  // 两份语料都取，取不到就跳过 —— 注册表缺一份只会少几个人，不该让接口整体失败
  for (const method of ['enumerateRealCorpus', 'enumerateCorpus'] as const) {
    if (typeof source[method] !== 'function') continue;
    try {
      corpora.push(...(await source[method](500)));
    } catch (error) {
      console.warn(`[creators] 读取语料 ${method} 失败（不影响其它来源）：`, error);
    }
  }

  const map = new Map<string, PersonRecord>();
  for (const hit of corpora) {
    if (!hit.authorName) continue;
    const id = personIdOf(hit.authorName);
    const existing = map.get(id);
    if (existing) {
      // 徽章/头像可能只有部分内容里有，取到非空的就补上
      if (!existing.headline && hit.authorBadgeText) existing.headline = hit.authorBadgeText;
      if (!existing.avatarUrl && hit.authorAvatar) existing.avatarUrl = hit.authorAvatar;
      continue;
    }
    map.set(id, {
      id,
      name: hit.authorName,
      headline: hit.authorBadgeText ?? '',
      avatarUrl: hit.authorAvatar || null,
    });
  }

  console.info(`[creators] 人物注册表已重建（${namespace}）：${map.size} 人`);
  registryCache = { map, builtAt: Date.now(), namespace };
  return map;
}

/**
 * 取一张人物卡。查不到返回 `null`。
 *
 * 抽成独立函数是因为**会话也要内嵌同一张卡**（`Conversation.creator`）——
 * 两处各查一次的话，名片和聊天页顶部的头像可能来自不同时刻的注册表，
 * 同一个人在两个页面显示不一致。
 */
export async function getCreatorCard(creatorId: string): Promise<CreatorCard | null> {
  const id = creatorId.trim();
  if (!id) return null;

  const record = (await loadRegistry()).get(id);
  if (!record) return null;

  // 如果这个人也挂在某个领域下，就带上领域语境（关联议题、领域相关度）
  const indexes = await loadFieldIndexes();
  const found = findPersonInIndexes(indexes, id);

  if (found) {
    const { index, person } = found;
    return toFieldCreatorCard({
      id: record.id,
      name: record.name,
      headline: record.headline || person.headline,
      avatarUrl: record.avatarUrl ?? person.avatarUrl,
      topicNames: topicNamesOf(index, person),
      relevance: personRelevance(index, person),
      fieldName: index.field.name,
    });
  }

  /**
   * 不在任何领域下的创作者（只在「找人」语料里出现过）。
   *
   * ⚠️ 这时**不能凭空编推荐理由和证据** —— 我们手上只有「他写过内容」这件事，
   * 没有关于他和某个问题的经历证据。所以如实给：无证据、无追问建议、
   * 局限里写明「这份资料来自公开内容，未针对具体问题核验」。
   */
  return toFieldCreatorCard({
    id: record.id,
    name: record.name,
    headline: record.headline,
    avatarUrl: record.avatarUrl,
    topicNames: [],
    relevance: 0,
    fieldName: '公开内容',
  });
}

export async function handleCreatorDetail(creatorId: string): Promise<HandlerResult> {
  const card = await getCreatorCard(creatorId);
  if (!card) {
    // 前端按 404 NOT_FOUND 处理：提示资料缺失，但**保留当前页面上下文**
    // （用户是从星图点进来的，把他弹回首页会很突兀）
    return fail(404, API_ERROR_CODES.notFound, '这位创作者的公开资料暂不可用', false);
  }
  return ok(card);
}
