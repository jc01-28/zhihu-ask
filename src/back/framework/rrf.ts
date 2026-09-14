/**
 * 框架层 · RRF（Reciprocal Rank Fusion）多路召回融合
 *
 * 为什么是 RRF 而不是「加权求和」：
 * 关键词分（BM25，取值 0~20+）与语义分（cosine，取值 0~1）量纲完全不同。
 * 加权求和就要先归一化，而归一化方式本身又成了一个拍脑袋的超参；
 * RRF 只用**名次**，天然免疫量纲问题，且对某一路召回的异常高分不敏感。
 *
 *   score(d) = Σ_{r ∈ 各路召回} 1 / (k + rank_r(d)),  k 默认 60
 *
 * k=60 是原论文（Cormack et al., 2009）的推荐值：它压平了头部名次的差距，
 * 使得「被两路都排在第 5」比「只被一路排在第 1」更吃香 —— 这正是我们想要的互补性。
 */

export interface RankedList {
  /** 这一路的名称，用于诊断 */
  label: string;
  /** 已按相关度降序排好的 id 列表 */
  ids: string[];
  /** 可选：参与融合的权重，默认 1 */
  weight?: number;
}

export interface FusedItem {
  id: string;
  /** 融合后的 RRF 分 */
  rrfScore: number;
  /** 每一路给它的名次（1-based）。缺席的路不出现 */
  ranks: Record<string, number>;
}

export function fuseRrf(
  lists: RankedList[],
  k = 60,
  limit?: number,
): FusedItem[] {
  const acc = new Map<string, FusedItem>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    // 同一路内可能因上游去重不彻底出现重复 id，只认第一次（最好名次）
    const seen = new Set<string>();
    list.ids.forEach((id, index) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const rank = index + 1;
      const item = acc.get(id) ?? { id, rrfScore: 0, ranks: {} };
      item.rrfScore += weight / (k + rank);
      item.ranks[list.label] = rank;
      acc.set(id, item);
    });
  }

  const fused = [...acc.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  return limit ? fused.slice(0, limit) : fused;
}
