/**
 * 处理器 · 领域域（专业领域社交）
 *
 * 三个接口，服务前端规格里的页四（领域目录）、页五（领域星图）与公共人物名片：
 *   GET /api/fields/featured          → 推荐领域列表
 *   GET /api/fields?query=&limit=     → 领域搜索（只返回领域，不返回人物）
 *   GET /api/fields/:fieldId/graph    → 星图（议题 + 人物，坐标由后端算好）
 *
 * 与框架解耦：不 import next/*。语料通过适配层拿，缓存带命名空间。
 */

import { cacheNamespace, createRuntime } from '@/back/adapters';
import {
  buildFieldIndex,
  layoutFieldGraph,
  searchFields,
  toFieldSummary,
  type FieldIndex,
} from '@/back/domain/field-graph';
import { FIELD_SEEDS, findFieldSeed } from '@/back/domain/fields';
import type { SearchHit } from '@/back/framework/ports';
import type { FieldGraphResponse, FieldSearchResponse } from '@/shared/contract';
import { fail, ok, type HandlerResult } from './types';

/**
 * 索引缓存。
 *
 * 建一次索引 = 7 个领域 × 语料条数 × 每议题若干关键词的字符串扫描。
 * 语料 180 条时这不便宜，而领域数据几乎不变 —— 所以按 TTL 缓存在进程内。
 *
 * ⚠️ 缓存 key 必须带**数据源 + 语料范围**（`cacheNamespace()`）：
 * 否则从 fixture 切到在线直连、或从 real 切到 synthetic 后，
 * 会继续返回上一份语料算出来的星图，而且看起来完全正常。
 */
let indexCache: { indexes: FieldIndex[]; builtAt: number; namespace: string } | null = null;

const INDEX_TTL_MS = Number(process.env.FIELD_INDEX_TTL_MS ?? 600000);

/** 供测试重置 */
export function __resetFieldIndexCache(): void {
  indexCache = null;
}

/**
 * 拿语料。**三条路径，按可靠性排序**：
 *
 * 1. `enumerateRealCorpus`（fixture 源有）—— **只要真实内容**，无视 `FIXTURE_CORPUS`。
 *    这是领域星图的正路：它展示的是「谁真的写过这个话题」，
 *    一旦混进合成语料里的虚构作者（「林一舟」那种），产品内核就废了，
 *    而且演示时没人能当场分辨哪个名字是编的。
 * 2. `enumerateCorpus`——没有上面那个能力的源，说明它本来就全是真实内容，全量取即可。
 * 3. 都没有（在线直连）：知乎搜索接口强制要求 Query，退化为「每个领域用别名 +
 *    首个议题关键词做一次检索」。结果必然不全，所以日志里必须说清楚 ——
 *    不能让人以为拿的是全集。
 */
async function loadCorpus(): Promise<SearchHit[]> {
  const runtime = createRuntime({ getOAuthToken: async () => null });
  const source = runtime.source;

  if (typeof source.enumerateRealCorpus === 'function') {
    return source.enumerateRealCorpus(500);
  }

  if (typeof source.enumerateCorpus === 'function') {
    return source.enumerateCorpus(500);
  }

  console.warn(
    '[fields] 当前数据源不支持全库枚举（在线直连模式），' +
      '改为按领域做有限检索 —— 星图结果可能不全，这属于已知降级。',
  );

  const merged = new Map<string, SearchHit>();
  for (const field of FIELD_SEEDS) {
    const query = [field.name, field.topics[0]?.keywords[0]].filter(Boolean).join(' ');
    try {
      for (const hit of await source.searchContents({ query, count: 10 })) {
        const key = hit.contentId || hit.url || hit.title;
        if (key && !merged.has(key)) merged.set(key, hit);
      }
    } catch (error) {
      console.warn(`[fields] 领域「${field.name}」检索失败：`, error);
    }
  }
  return [...merged.values()];
}

/** 拿到 7 个领域的索引（带缓存） */
async function loadIndexes(): Promise<FieldIndex[]> {
  const namespace = cacheNamespace();
  if (
    indexCache &&
    indexCache.namespace === namespace &&
    Date.now() - indexCache.builtAt < INDEX_TTL_MS
  ) {
    return indexCache.indexes;
  }

  const hits = await loadCorpus();
  const indexes = FIELD_SEEDS.map((field) => buildFieldIndex(field, hits));

  const people = indexes.reduce((sum, i) => sum + i.people.length, 0);
  console.info(
    `[fields] 领域索引已重建（命名空间 ${namespace}）：` +
      `${hits.length} 条语料 → ${FIELD_SEEDS.length} 个领域 / ${people} 人次挂靠`,
  );

  indexCache = { indexes, builtAt: Date.now(), namespace };
  return indexes;
}

// ── 推荐领域 ────────────────────────────────────────────────────────────

/**
 * 推荐领域列表。
 *
 * **按种子定义顺序返回**，不按人数排序 —— 展示顺序是产品决定（规格里列了固定 7 个），
 * 而 `memberCount` 只是附带信息。排序会把它变成一个不可控的东西。
 */
export async function handleFeaturedFields(): Promise<HandlerResult> {
  const indexes = await loadIndexes();
  return ok(indexes.map((index) => toFieldSummary(index.field, index)));
}

// ── 领域搜索 ────────────────────────────────────────────────────────────

export interface FieldSearchInput {
  query: string;
  limit: number;
}

export async function handleSearchFields(input: FieldSearchInput): Promise<HandlerResult> {
  const query = input.query.trim();
  if (!query) {
    return fail(
      400,
      '缺少查询词 query',
      '用法：/api/fields?query=训练大模型&limit=12。注意**这里只搜领域，不搜人物**',
    );
  }

  const indexes = await loadIndexes();
  const all = searchFields(indexes, query);

  // limit 来自查询串，可能是 'abc' 或负数 —— NaN 会让 slice 返回空数组，
  // 表现成「搜什么都搜不到」，比报错更难查。所以先判有限再把区间夹住。
  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.trunc(rawLimit), 50)) : 12;

  const body: FieldSearchResponse = { fields: all.slice(0, limit), total: all.length };
  return ok(body);
}

// ── 领域星图 ────────────────────────────────────────────────────────────

export async function handleFieldGraph(fieldId: string): Promise<HandlerResult> {
  const seed = findFieldSeed(fieldId);
  if (!seed) {
    return fail(
      404,
      `没有这个领域：${fieldId}`,
      `可用领域：${FIELD_SEEDS.map((f) => f.id).join(' / ')}`,
    );
  }

  const indexes = await loadIndexes();
  const index = indexes.find((i) => i.field.id === fieldId);
  if (!index) {
    // 理论上不会发生（索引是按 FIELD_SEEDS 建的），兜底避免 500
    return fail(500, `领域索引里缺少 ${fieldId}，请检查 FIELD_SEEDS 与索引构建是否一致`);
  }

  const { topics, people } = layoutFieldGraph(index);
  const body: FieldGraphResponse = {
    field: toFieldSummary(seed, index),
    topics,
    people,
  };
  return ok(body);
}
