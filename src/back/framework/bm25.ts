/**
 * 框架层 · 简化 BM25
 *
 * 为什么不用现成的：`minisearch` 要装依赖，而我们的语料是几百篇量级，
 * BM25 本体只有 60 行。更重要的是 —— 计划书里要讲清楚「我们比关键词强在哪」，
 * 那关键词侧就必须是一个**能说得清的检索器**，而不是一个黑盒排序。
 *
 * 公式（标准 BM25，k1=1.2, b=0.75）：
 *   score(D, Q) = Σ_{q∈Q} IDF(q) · f(q,D)·(k1+1) / (f(q,D) + k1·(1 - b + b·|D|/avgdl))
 *   IDF(q) = ln(1 + (N - n(q) + 0.5) / (n(q) + 0.5))
 *
 * 中文分词复用框架里已有的 `tokenize`（2~3 元滑窗 + 停用词），零依赖。
 */

import { tokenize } from './llm-utils';

export interface Bm25Doc {
  id: string;
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
  matchedTerms: string[];
}

interface IndexedDoc {
  id: string;
  /** 词 → 词频 */
  tf: Map<string, number>;
  /** 文档长度（词数） */
  length: number;
}

export class Bm25Index {
  private readonly docs: IndexedDoc[] = [];
  private readonly docFreq = new Map<string, number>();
  private readonly avgdl: number;
  readonly size: number;

  constructor(
    docs: Bm25Doc[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    for (const doc of docs) {
      const terms = tokenize(doc.text);
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.docs.push({ id: doc.id, tf, length: terms.length });
      // 文档频率：一个词在一篇文档里出现多次也只算一次
      for (const t of new Set(terms)) {
        this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      }
    }
    this.size = this.docs.length;
    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.avgdl = this.size ? total / this.size : 1;
  }

  private idf(term: string): number {
    const n = this.docFreq.get(term) ?? 0;
    return Math.log(1 + (this.size - n + 0.5) / (n + 0.5));
  }

  /** 对单条 query 打分，返回全部命中文档（按分降序） */
  search(query: string): Bm25Hit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];

    const hits: Bm25Hit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const f = doc.tf.get(term);
        if (!f) continue;
        matched.push(term);
        const denom = f + this.k1 * (1 - this.b + (this.b * doc.length) / this.avgdl);
        score += this.idf(term) * ((f * (this.k1 + 1)) / denom);
      }
      if (score > 0) hits.push({ id: doc.id, score, matchedTerms: matched });
    }
    return hits.sort((a, b) => b.score - a.score);
  }
}
