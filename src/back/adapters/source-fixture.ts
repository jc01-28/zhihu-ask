/**
 * 适配器 · 本地 fixture 内容源
 *
 * 为什么要有它：知乎 Access Secret 要申请、OAuth app_key 要等审批、
 * 回调必须是公网 HTTPS。这些都不该挡住业务开发。
 * 打开 USE_FIXTURES=1，全链路立刻可跑，且结果完全确定（适合写测试与对照实验）。
 *
 * 检索策略：对 query 分词后按「命中词数 + 标题加权」排序。
 * 它不是高质量检索器 —— 那是业务骨干层要升级的事（关键词 + Embedding 混合召回），
 * 而正因为它是「朴素的关键词加权」，它恰好可以充当对照实验里的 Baseline A。
 *
 * ⚠️ 空 query 会返回**全部语料**（不排序）。语义召回需要它来枚举全库 ——
 * 这是刻意的：如果语义侧先被关键词过滤，B 组就退化成 A 组了，对照就失效了。
 */

import { tokenize } from '@/back/framework/llm-utils';
import type {
  ContentSource,
  Followee,
  HotItem,
  MyContentItem,
  MyProfile,
  SearchHit,
} from '@/back/framework/ports';
import baseData from '@/back/fixtures/sample-hits.json';
import goldData from '@/back/fixtures/gold-hits.json';

interface FixtureFile {
  hits: SearchHit[];
  followees: Followee[];
  hotList: HotItem[];
  myContents: MyContentItem[];
}

/**
 * 语料范围。**演示与评测必须用不同的范围**，否则指标会被污染：
 *   all       —— 三份全要（默认，向后兼容）
 *   synthetic —— 只要虚构语料（sample + gold）。对照实验/评测用，gold 标签只对它有效
 *   real      —— 只要真实语料（harvested）。产品演示用，界面上不该出现虚构作者
 */
export type CorpusScope = 'all' | 'synthetic' | 'real';

function readScope(): CorpusScope {
  const raw = (process.env.FIXTURE_CORPUS ?? 'all').trim().toLowerCase();
  if (raw === 'all' || raw === 'synthetic' || raw === 'real') return raw;
  console.warn(
    `[fixture] 无法识别的 FIXTURE_CORPUS="${raw}"，回退为 all（可选：all | synthetic | real）`,
  );
  return 'all';
}

/**
 * harvested-hits.json —— harvest.mjs 抓下来的真实知乎内容。
 * 动态 require 是刻意的：文件可能不存在（没跑过 harvest），静态 import 会让构建直接失败。
 */
function loadHarvested(): SearchHit[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/back/fixtures/harvested-hits.json') as { hits?: SearchHit[] };
    return mod.hits ?? [];
  } catch {
    return [];
  }
}

/**
 * hot-list.json —— harvest.mjs 抓下来的**真实**知乎热榜。
 *
 * ⚠️ 不能再用 `sample-hits.json` 里的占位热榜：那条数据的 URL 是
 * `https://www.zhihu.com/question/fixture-hot-1`，一眼假，演示时很致命。
 * 抓不到热榜时返回空数组 —— 空着比编造诚实。
 */
function loadRealHotList(): HotItem[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/back/fixtures/hot-list.json') as { items?: HotItem[] };
    return mod.items ?? [];
  } catch {
    return [];
  }
}

export interface FixtureComposition {
  scope: CorpusScope;
  synthetic: number;
  real: number;
  total: number;
}

/**
 * 组装语料库。
 *
 * ⚠️ 两个容易搞错的地方：
 *   1. gold-hits.json 里**不含 _gold 字段** —— 标注被物理隔离在 scripts/gold/labels.json，
 *      检索器看不到 ground truth。这是防作弊的关键。
 *   2. 真实语料与虚构语料**不能混着给用户看**。混在一起的结果是页面上同时出现真实作者
 *      和「林一舟」这种编出来的名字，看起来像 bug。所以用 FIXTURE_CORPUS 做隔离。
 */
function loadDb(): FixtureFile & { composition: FixtureComposition; harvestedHits: SearchHit[] } {
  const base = baseData as unknown as FixtureFile;
  const gold = (goldData as unknown as { hits?: SearchHit[] }).hits ?? [];
  const harvested = loadHarvested();

  const scope = readScope();

  if (scope === 'real' && harvested.length === 0) {
    // 不静默回退 —— 否则就是拿虚构语料冒充真实数据，属于最难发现的那类错误
    console.warn(
      '[fixture] FIXTURE_CORPUS=real 但 harvested-hits.json 不存在或为空，真实语料为空。' +
        '请先跑：node --env-file=.env.local scripts/harvest.mjs',
    );
  }

  const syntheticHits = scope === 'synthetic' || scope === 'all' ? [...base.hits, ...gold] : [];
  const realHits = scope === 'real' || scope === 'all' ? harvested : [];

  const byId = new Map<string, SearchHit>();
  for (const hit of [...syntheticHits, ...realHits]) {
    const key = hit.contentId || hit.url || hit.title;
    if (key && !byId.has(key)) byId.set(key, hit);
  }

  return {
    // 关注 / 热榜 / 本人创作仍取自 sample-hits.json（fixture 占位数据，与检索语料无关）
    ...base,
    hits: [...byId.values()],
    /**
     * **未按 scope 过滤**的真实语料，领域星图专用（见 `enumerateRealCorpus`）。
     *
     * ⚠️ 别和下面的 `composition.real` 搞混：
     *   harvestedHits    = 真实语料**一共有**多少条（与 scope 无关）
     *   composition.real = 当前检索**实际用了几条**真实内容（随 scope 变）
     * 领域星图要的是前者 —— 否则 `FIXTURE_CORPUS=synthetic` 时星图会全空（踩过）。
     */
    harvestedHits: [...harvested],
    composition: {
      scope,
      synthetic: syntheticHits.length,
      real: realHits.length,
      total: byId.size,
    },
  };
}

const db = loadDb();

/** 语料构成。供 /api/health 与排查用 —— 让「现在到底在跑哪份数据」随时可见 */
export function fixtureComposition(): FixtureComposition {
  return db.composition;
}

export class FixtureSource implements ContentSource {
  readonly name = 'fixture';

  async searchContents(req: { query: string; count?: number }): Promise<SearchHit[]> {
    const limit = req.count ?? 10;
    const q = (req.query ?? '').trim();

    // 空查询 = 「给我全部语料」，供语义召回枚举全库
    if (!q) return db.hits.slice(0, limit).map((h) => ({ ...h }));

    const terms = tokenize(q);
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
      .slice(0, limit)
      .map((s) => ({ ...s.hit, rankingScore: Math.min(1, s.score / 10) }));
  }

  /**
   * 枚举整个语料库 —— fixture 源的独有能力（数据就在内存里，不依赖任何 query）。
   * 语义召回靠它拿到全库做向量化，这样 B/C 组才「单独具备召回能力」。
   *
   * 知乎 HTTP 源**不实现**这个方法：搜索接口强制要求 Query。
   * 所以在线直连时语义召回会退化为「在关键词候选池里重排」，并在 trace 上标注出来。
   */
  async enumerateCorpus(limit = 500): Promise<SearchHit[]> {
    return db.hits.slice(0, limit).map((h) => ({ ...h }));
  }

  /**
   * 只枚举**真实**语料 —— 领域星图专用。
   *
   * 与 `enumerateCorpus` 的区别：它**无视 `FIXTURE_CORPUS`**，永远只回 harvested 的真实内容。
   * 原因见 `ContentSource.enumerateRealCorpus` 的注释：星图上出现虚构作者，
   * 「证据驱动」这个内核就废了，而且演示时没人能当场分辨哪个名字是编的。
   */
  async enumerateRealCorpus(limit = 500): Promise<SearchHit[]> {
    return db.harvestedHits.slice(0, limit).map((h) => ({ ...h }));
  }

  async hotList(limit = 20): Promise<HotItem[]> {
    return loadRealHotList().slice(0, limit);
  }

  async myFollowees(limit = 50): Promise<Followee[]> {
    return db.followees.slice(0, limit);
  }

  async myContents(limit = 20): Promise<MyContentItem[]> {
    return db.myContents.slice(0, limit);
  }

  async myProfile(): Promise<MyProfile | null> {
    // fixture 模式假装已授权，便于在没有凭证时也能开发「已授权」状态的界面
    return {
      name: '样例用户',
      avatarUrl: '',
      headline: 'fixture 模式下的模拟账号',
      url: 'https://www.zhihu.com/people/fixture-user',
    };
  }
}

/** 供评测脚本直接拿到语料规模 */
export function fixtureSize(): number {
  return db.hits.length;
}
