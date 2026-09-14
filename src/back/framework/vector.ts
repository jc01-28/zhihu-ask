/**
 * 框架层 · 语义召回（向量）
 *
 * 设计决策：**不上向量数据库**。
 * 理由：语料是几百篇量级，向量化一次后落盘 JSON、内存里算 cosine 是毫秒级。
 * 上 Chroma / Qdrant 只会引入一个需要运维的进程，对 hackathon 是纯浪费。
 * （超过 1 万条时再换 `sqlite-vec` —— 单文件、零服务，比 Chroma 省事。）
 *
 * Embedding 后端有三种实现，按可用性自动降级：
 *   1. OpenAI 兼容 `/embeddings`（配 EMBEDDING_BASE_URL + EMBEDDING_API_KEY）
 *   2. SenseNova / 其他 provider 的 embeddings 端点（复用 LLM_* 凭证）
 *   3. **HashEmbedder** —— 零依赖确定性降级（见下）
 *
 * 关于第 3 种：它不是「假装有语义」。它用「词元哈希 + 分桶」把文本投到固定维度空间，
 * 再对分桶做 L2 归一化。它捕捉的是**词元重合度**，只是把同样的信息投影到向量空间，
 * 所以它在这个实验里的作用是「让 B 组在没有外部 API 时也能跑出一份可复现的数字」，
 * 而**不能**用来宣称「语义召回有效」。关于这一点，评测报告里会被明确标注为
 * `embedder: hash-fallback`，结论不外推。
 *
 * 向量缓存：`sha256(text) → Float32Array`，落在磁盘 KV 里，避免重复调用。
 */

import { createHash } from 'node:crypto';
import type { Cache } from './ports';
import { fetchWithTimeout, LLM_TIMEOUT_MS } from './timeout';

export interface Embedder {
  readonly name: string;
  readonly dim: number;
  /** 批量向量化。实现方负责内部并发与缓存 */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** 这份向量能不能用来论证「语义召回有效」 */
  readonly semanticClaims: boolean;
}

/** ── 实现 1：hash 投影（确定性降级，零网络）───────────────────────────── */

const HASH_DIM = 256;

/**
 * 词元哈希投影。
 * 对每个词元取 sha1 的前 4 字节决定桶位，符号由第 5 字节决定（避免同名碰撞同向累加）。
 * 结果做 L2 归一化，于是 cosine 就等于「归一化后的词元重合度」。
 */
export class HashEmbedder implements Embedder {
  readonly name = 'hash-fallback';
  readonly dim = HASH_DIM;
  readonly semanticClaims = false;

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): Float32Array {
    const vec = new Float32Array(HASH_DIM);
    for (const term of tokenizeForVector(text)) {
      const hash = createHash('sha1').update(term).digest();
      const bucket = hash.readUInt32BE(0) % HASH_DIM;
      const sign = hash[4] % 2 === 0 ? 1 : -1;
      vec[bucket] += sign;
    }
    let norm = 0;
    for (let i = 0; i < vec.length; i += 1) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
    return vec;
  }
}

/**
 * 向量化用的切分：比 BM25 的 tokenize 更粗（保留 2 元即可）。
 * 三元滑窗在 256 维桶里碰撞太严重，反而降低区分度。
 */
function tokenizeForVector(text: string): string[] {
  const lowered = text.toLowerCase();
  const latin = lowered.match(/[a-z0-9_+#.-]{2,}/g) ?? [];
  const runs = lowered.match(/[\u4e00-\u9fa5]+/g) ?? [];
  const grams = new Set<string>();
  for (const run of runs) {
    if (run.length === 1) grams.add(run);
    for (let i = 0; i + 2 <= run.length; i += 1) grams.add(run.slice(i, i + 2));
  }
  return [...latin, ...grams];
}

/** ── 实现 2：OpenAI 兼容 /embeddings ──────────────────────────────────── */

export interface RemoteEmbedderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  cache?: Cache;
  /** 一次请求最多提交多少条文本 */
  batchSize?: number;
}

export class RemoteEmbedder implements Embedder {
  readonly name: string;
  dim = 0;
  readonly semanticClaims = true;
  private readonly batchSize: number;

  constructor(private readonly opts: RemoteEmbedderOptions) {
    this.name = `remote:${opts.model}`;
    this.batchSize = opts.batchSize ?? 16;
    if (!opts.baseUrl || !opts.apiKey) {
      throw new Error('RemoteEmbedder 需要 baseUrl 与 apiKey');
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // 逐条走缓存包装：`Cache` 端口只有 getOrSet，所以把「批内未命中」的收集
    // 放在 producer 外面做不了，这里改成「缓存命中则直接返回，未命中则记下来批量发」。
    // 用一次 getOrSet 的 producer 来「探查」会让未命中真的发起一次网络调用，
    // 所以改为维护一个进程内已取得的计数，仅用于避免重复的磁盘读。
    const out: Array<Float32Array | null> = new Array(texts.length).fill(null);
    const pending: { index: number; text: string }[] = [];

    for (const [index, text] of texts.entries()) {
      const hit = await this.readCached(text);
      if (hit) out[index] = hit;
      else pending.push({ index, text });
    }

    for (let i = 0; i < pending.length; i += this.batchSize) {
      const batch = pending.slice(i, i + this.batchSize);
      const vectors = await this.call(batch.map((b) => b.text));
      for (const [offset, vec] of vectors.entries()) {
        const target = batch[offset];
        out[target.index] = vec;
        this.cached.set(target.text, vec);
        void this.persist(target.text, vec);
      }
    }

    return out.map((v) => v ?? new Float32Array(this.dim || 1));
  }

  /** 进程内向量缓存：避免同一轮评测里反复读磁盘 */
  private readonly cached = new Map<string, Float32Array>();

  private cacheKey(text: string): string {
    return `embed:${this.opts.model}:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;
  }

  private async readCached(text: string): Promise<Float32Array | null> {
    const memo = this.cached.get(text);
    if (memo) return memo;
    if (!this.opts.cache) return null;

    // 借 getOrSet 读一次：producer 被调用说明真的没命中，此时返回空数组标记 miss，
    // 真正的网络请求留给下面的批量 call —— 这样一次 miss 不会打两次请求。
    try {
      const res = await this.opts.cache.getOrSet<number[]>(
        this.cacheKey(text),
        365 * 24 * 60 * 60 * 1000,
        async () => [],
      );
      const vec = toFloat32(res.value);
      if (vec) this.cached.set(text, vec);
      return vec;
    } catch {
      return null;
    }
  }

  private async persist(text: string, vec: Float32Array): Promise<void> {
    if (!this.opts.cache) return;
    try {
      const key = this.cacheKey(text);
      // 覆写：先让 getOrSet 因过期/缺失而建，再写我们的值
      await this.opts.cache.getOrSet(key, 0, async () => [...vec]);
    } catch {
      // 缓存写失败不影响主流程
    }
  }

  private async call(input: string[]): Promise<Float32Array[]> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/embeddings`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: this.opts.model, input }),
      timeoutMs: LLM_TIMEOUT_MS(),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`embeddings HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = JSON.parse(text) as {
      data?: { embedding?: number[]; index?: number }[];
    };
    const rows = body.data ?? [];
    if (!rows.length) throw new Error('embeddings 返回了空 data');

    const vectors = rows.map((r) => Float32Array.from(r.embedding ?? []));
    if (!this.dim && vectors[0]) this.dim = vectors[0].length;
    return vectors;
  }
}

function toFloat32(value: unknown): Float32Array | null {
  if (!Array.isArray(value) || !value.length) return null;
  return Float32Array.from(value as number[]);
}

/** ── 相似度 ────────────────────────────────────────────────────────────── */

/** 向量已 L2 归一化，所以点积即 cosine */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += a[i] * b[i];
  return dot;
}

/** ── 选择器 ────────────────────────────────────────────────────────────── */

export interface EmbedderSelection {
  embedder: Embedder;
  /** 是否因为凭证缺失而降级到 hash */
  degraded: boolean;
  reason: string;
}

/**
 * 按环境变量挑 embedding 后端。
 *
 * 优先级：
 *   1. 显式配置 EMBEDDING_BASE_URL + EMBEDDING_API_KEY + EMBEDDING_MODEL
 *   2. **默认降级到 HashEmbedder**
 *
 * ⚠️ 为什么不再「自动复用 LLM_* 凭证」：
 *   实测踩过 —— SenseNova 的 `LLM_BASE_URL` 没有 `/embeddings` 端点，
 *   自动复用会让 B/C 组直接 404 崩掉整条链路。
 *   **「OpenAI 兼容的 chat 端点」不等于「有 embeddings 端点」**，
 *   这两件事必须由人显式确认。所以默认走 hash 降级（永远不会失败），
 *   要用真 embeddings 就显式配 EMBEDDING_*。
 *
 * 这也让「降级」变成一件显式的事：报告里会标明 `hash-fallback`，
 * 结论不会被误当成「语义召回的真实能力」。
 */
export function pickEmbedder(cache?: Cache): EmbedderSelection {
  const explicitBase = process.env.EMBEDDING_BASE_URL?.trim();
  const explicitKey = process.env.EMBEDDING_API_KEY?.trim();
  const explicitModel = process.env.EMBEDDING_MODEL?.trim();

  // 只有当三个都配全时才用远程 —— 缺一个就说明没配好，宁可降级也不要半残
  if (explicitBase && explicitKey && explicitModel) {
    return {
      embedder: new RemoteEmbedder({
        baseUrl: explicitBase,
        apiKey: explicitKey,
        model: explicitModel,
        cache,
      }),
      degraded: false,
      reason: `EMBEDDING_* 已配置（model=${explicitModel}）`,
    };
  }

  const missing = [
    !explicitBase && 'EMBEDDING_BASE_URL',
    !explicitKey && 'EMBEDDING_API_KEY',
    !explicitModel && 'EMBEDDING_MODEL',
  ].filter(Boolean);

  return {
    embedder: new HashEmbedder(),
    degraded: true,
    reason: `未配置 ${missing.join(' / ')}，降级为 hash 投影（结论不外推为「语义召回能力」）`,
  };
}
