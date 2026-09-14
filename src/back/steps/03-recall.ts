/**
 * Step 03 · 混合召回
 *
 * 三种模式由 `ExperimentConfig.recall` 决定 —— 这是 A/B/C 对照实验的核心变量：
 *   keyword  → Baseline A：多路关键词检索（知乎 search 接口 / fixture 加权匹配）
 *   semantic → Baseline B：向量召回（对整个语料库算 cosine，不依赖关键词命中）
 *   hybrid   → Version C：两路并行 → RRF 融合
 *
 * 为什么 C 组要做融合而不是「取并集」：
 * 关键词侧擅长「术语精确命中」（比如『期权 成熟期』），语义侧擅长「措辞不同但意思相同」
 * （用户说『画饼』，作者写『期望值几乎可以忽略』）。两者的排序依据不可比，
 * 所以用 RRF 只看名次做融合（见 framework/rrf.ts 的说明）。
 *
 * 额度提醒：keyword 模式每条 query 一次外部调用。默认 4 条 = 4 次/问题，
 * 1000 次/天大约够跑 250 个问题（加上缓存实际更省）。
 * semantic 模式**不调外部检索接口**，只在本地点积，所以它反而更省额度。
 */

import type { AskBoot } from '@/back/domain/experiment';
import { resolveExperiment } from '@/back/domain/experiment';
import { Bm25Index } from '@/back/framework/bm25';
import { pMap } from '@/back/framework/concurrency';
import { SYS_INPUT, type Step, type StepContext } from '@/back/framework/pipeline';
import type { ProblemProfile } from '@/back/domain/types';
import type { SearchHit } from '@/back/framework/ports';
import { fuseRrf, type RankedList } from '@/back/framework/rrf';
import { cosine, type Embedder } from '@/back/framework/vector';

const MAX_QUERIES = 4;
const PER_QUERY = 8;
/** 语义侧从全库里取多少条进融合 */
const SEMANTIC_TOP_K = 20;

function configOf(ctx: StepContext) {
  return resolveExperiment((ctx.config as AskBoot | undefined)?.experiment?.id);
}

/** 把 hit 拼成参与语义/BM25 打分的文本 */
function haystackOf(hit: SearchHit): string {
  // 标题权重高，所以重复一次；badge 也带上（「技术管理」这种领域标签很有信息量）
  return `${hit.title} ${hit.title} ${hit.authorBadgeText} ${hit.contentText}`;
}

export const recallStep: Step = {
  name: 'recall',
  from: ['profile', SYS_INPUT],
  describe: '按实验配置做关键词 / 语义 / 混合召回',
  cacheKey: (input: { profile: ProblemProfile }, ctx) => {
    const cfg = configOf(ctx);
    // ⚠️ 召回模式必须进 cache key，否则 A/B/C 三组会互相读到对方的缓存
    return `recall:${cfg.recall}:${cfg.rrfK}:${input.profile.searchQueries.join('||')}`;
  },
  summarize: (output: SearchHit[]) => {
    const hits = output ?? [];
    const kinds = new Set(hits.flatMap((h) => h.matchedBy ?? []));
    if (!kinds.size) return `${hits.length} 条内容`;
    return `${hits.length} 条内容（${[...kinds].join('+')}）`;
  },
  async run(input: { profile: ProblemProfile; '@input': AskBoot }, ctx) {
    const cfg = configOf(ctx);
    const boot = input[SYS_INPUT];
    const queries = input.profile.searchQueries.filter(Boolean).slice(0, MAX_QUERIES);
    const queriesToRun = queries.length ? queries : [boot.question];

    // 数据源能不能枚举全库，决定语义侧是「独立召回器」还是「重排器」，
    // 也决定两路能否并行：没有全库时语义侧必须等关键词的候选池。
    const enumerable = typeof ctx.source.enumerateCorpus === 'function';

    switch (cfg.recall) {
      case 'keyword':
        return keywordRecall(queriesToRun, ctx, []);

      case 'semantic': {
        if (enumerable) return semanticRecall(queriesToRun, ctx);
        // 在线直连没有全库 → 先跑一次关键词，只为搭一个候选池。
        // 这会让 B 组偏离「独立召回器」的设定，semanticRecall 会在日志与
        // matchedBy 上如实标注为降级，不要拿它当语义召回能力来解读。
        const pool = await keywordRecall(queriesToRun, ctx, []);
        return semanticRecall(queriesToRun, ctx, pool);
      }

      case 'hybrid':
      default: {
        let keywordHits: SearchHit[];
        let semanticHits: SearchHit[];

        if (enumerable) {
          // 语义侧有独立全库 → 两路互相独立，并行跑，谁慢只等谁
          [keywordHits, semanticHits] = await Promise.all([
            keywordRecall(queriesToRun, ctx, ['keyword']),
            semanticRecall(queriesToRun, ctx),
          ]);
        } else {
          // 在线直连：语义侧依赖关键词的池子 → 只能串行
          keywordHits = await keywordRecall(queriesToRun, ctx, ['keyword']);
          semanticHits = await semanticRecall(queriesToRun, ctx, keywordHits);
        }

        // 关键词侧已经有内部排序（rankingScore），语义侧按 cosine 排序；
        // 两边的 id 列表交给 RRF 融合，只看名次。
        const keywordList: RankedList = {
          label: 'keyword',
          ids: keywordHits.map((h) => h.contentId || h.url || h.title),
        };
        const semanticList: RankedList = {
          label: 'semantic',
          ids: semanticHits.map((h) => h.contentId || h.url || h.title),
        };

        const byId = new Map<string, SearchHit>();
        for (const hit of [...keywordHits, ...semanticHits]) {
          const key = hit.contentId || hit.url || hit.title;
          if (!byId.has(key)) byId.set(key, hit);
        }

        const fused = fuseRrf([keywordList, semanticList], cfg.rrfK);
        const merged: SearchHit[] = [];
        for (const item of fused) {
          const hit = byId.get(item.id);
          if (!hit) continue;
          merged.push({
            ...hit,
            // 融合分本身很小（~0.03），乘 100 更贴近原 rankingScore 的量纲，
            // 这样下游 04-extract 的选片公式无需改动
            rankingScore: Math.min(1, item.rrfScore * 100),
            matchedBy: Object.keys(item.ranks),
          });
        }

        ctx.logger.info(
          `混合召回 RRF(k=${cfg.rrfK})：关键词 ${keywordHits.length} + 语义 ${semanticHits.length} → 融合 ${merged.length}`,
        );
        return merged;
      }
    }
  },
};

/** ── 关键词侧 ──────────────────────────────────────────────────────────── */

async function keywordRecall(
  queriesToRun: string[],
  ctx: StepContext,
  matchedBy: string[],
): Promise<SearchHit[]> {
  const merged = new Map<string, SearchHit>();

  // 多路查询互相独立，并发跑能显著降低总延迟
  await pMap(
    queriesToRun,
    async (query) => {
      const hits = await ctx.source.searchContents({ query, count: PER_QUERY });
      for (const hit of hits) {
        const key = hit.contentId || hit.url || hit.title;
        const existing = merged.get(key);
        // 同一内容被多个 query 命中，说明相关度更高，累加分数
        if (existing) {
          existing.rankingScore = Math.min(1, existing.rankingScore + 0.15);
        } else {
          merged.set(key, { ...hit });
        }
      }
    },
    {
      // 并发压到 2：实测 4 路并发打知乎会撞 Code=30001 限流（4 路挂 2 路）。
      // 单路失败虽然被 onError 兜住了，但会白丢召回结果 —— 演示时不能赌这个。
      // 配合 HTTP 适配器里的限流退避重试，冷启动也很少再丢路。
      concurrency: 2,
      // 单路失败不影响整体：可能是额度、可能是该 query 无结果
      onError: (error, index) =>
        ctx.logger.warn(
          `关键词召回失败 query="${queriesToRun[index]}"：${(error as Error).message}`,
        ),
    },
  );

  const hits = [...merged.values()].sort((a, b) => b.rankingScore - a.rankingScore);
  if (matchedBy.length) for (const hit of hits) hit.matchedBy = matchedBy;

  ctx.logger.info(`关键词召回 ${hits.length} 条（${queriesToRun.length} 路查询）`);
  return hits;
}

/** ── 语义侧 ────────────────────────────────────────────────────────────── */

/** 按 baseUrl+model 缓存 embedder，避免每步重建（向量进程内缓存也随之复用） */
let embedderSingleton: Embedder | null = null;

async function getEmbedder(ctx: StepContext): Promise<Embedder> {
  if (embedderSingleton) return embedderSingleton;
  const { pickEmbedder } = await import('@/back/framework/vector');
  const selection = pickEmbedder(ctx.cache);
  embedderSingleton = selection.embedder;
  const note = selection.degraded
    ? `⚠️ 语义侧降级：${selection.reason}`
    : `语义侧后端：${selection.embedder.name}（${selection.reason}）`;
  ctx.logger.info(note);
  return embedderSingleton;
}

/**
 * 语义召回：对 query 算 cosine，取最接近的内容。分两种情形，**必须区分开**：
 *
 *   1. 数据源支持 `enumerateCorpus`（本地 fixture / 离线预热）
 *      → 对整个语料库向量化。此时语义侧是**独立召回器**，B 组和 A 组的差异才有意义，
 *        对照实验成立。
 *   2. 数据源不支持（在线直连知乎 HTTP 源）
 *      → **降级**：在关键词已召回的候选池里按 embedding 重排。语义侧这时只是重排器，
 *        不是召回器。所以 matchedBy 记成 `semantic(pool)` —— 界面上的链路看板会直接
 *        显示成「38 条内容（keyword+semantic(pool)）」，没人会把它误读成全库语义召回。
 *
 * 为什么不给 HTTP 源造一个假的「全库枚举」：搜索接口强制要求 Query，
 * 传空词返回 Code=10001；用「的」这类通用词顶替只会拿到一堆无关内容（已实测）。
 * 宁可诚实降级，也不制造一个看起来能用的假能力。
 */
async function semanticRecall(
  queriesToRun: string[],
  ctx: StepContext,
  fallbackPool?: SearchHit[],
): Promise<SearchHit[]> {
  // 整个函数包在 try 里：语义侧是「可选的增强」，任何失败都不该炸掉整条链路。
  // 实测踩过两次：LLM 服务的 /embeddings 404、以及真接口不支持空 query 枚举。
  try {
    let corpus: SearchHit[];
    let label = 'semantic';
    let degradedReason = '';

    if (typeof ctx.source.enumerateCorpus === 'function') {
      corpus = await loadCorpus(ctx);
    } else {
      corpus = fallbackPool ?? [];
      label = 'semantic(pool)';
      degradedReason =
        `当前数据源（${ctx.source.name}）不支持全库枚举，` +
        `改为在 ${corpus.length} 条关键词候选里重排`;
    }

    if (!corpus.length) {
      ctx.logger.warn(`语义召回：无可用的${label === 'semantic' ? '语料' : '候选池'}，返回 0 条`);
      return [];
    }

    if (degradedReason) {
      ctx.logger.warn(`语义侧降级：${degradedReason}。结论不外推为「语义召回能力」。`);
    }

    const embedder = await getEmbedder(ctx);
    const docVectors = await embedder.embed(corpus.map(haystackOf));
    const queryVectors = await embedder.embed(queriesToRun);

    const best = new Map<string, number>();
    for (const qvec of queryVectors) {
      for (const [di, dvec] of docVectors.entries()) {
        const sim = cosine(qvec, dvec);
        const key = corpus[di].contentId || corpus[di].url || corpus[di].title;
        const prev = best.get(key);
        // 多路 query 取最大值：只要有一路语义接近就够
        if (prev === undefined || sim > prev) best.set(key, sim);
      }
    }

    const hits = [...best.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, SEMANTIC_TOP_K)
      .map(([key, sim]) => {
        const hit = corpus.find((h) => (h.contentId || h.url || h.title) === key)!;
        return {
          ...hit,
          rankingScore: Math.max(0, Math.min(1, sim)),
          matchedBy: [label],
        };
      });

    ctx.logger.info(
      `语义召回 ${hits.length} 条（${label === 'semantic' ? '全库' : '候选池'} ${
        corpus.length
      } 条，embedder=${embedder.name}）`,
    );
    return hits;
  } catch (error) {
    ctx.logger.warn(
      `语义召回失败，本轮跳过语义侧（其余链路不受影响）：${(error as Error).message}`,
    );
    return [];
  }
}

/** 语料加载：进程内缓存，避免每条 query 重拉一次 */
let corpusSingleton: SearchHit[] | null = null;

async function loadCorpus(ctx: StepContext): Promise<SearchHit[]> {
  if (corpusSingleton) return corpusSingleton;
  const enumerate = ctx.source.enumerateCorpus;
  if (typeof enumerate !== 'function') {
    throw new Error(`${ctx.source.name} 不支持枚举语料库（未实现 enumerateCorpus）`);
  }
  // limit 给一个足够大的值，覆盖语料全集
  corpusSingleton = await enumerate.call(ctx.source, 500);
  return corpusSingleton;
}

/** 供评测脚本/测试重置进程内单例 */
export function __resetRecallCaches(): void {
  embedderSingleton = null;
  corpusSingleton = null;
}

// Bm25Index 目前只在离线评测里被直接用（fixture 源内部已有关键词加权），
// 这里 re-export 便于评测脚本从一处拿到检索器。
export { Bm25Index };
