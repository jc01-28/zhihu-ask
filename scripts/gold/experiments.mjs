/**
 * 实验分组的人类可读描述（Node 侧镜像）
 *
 * ⚠️ 这里是**展示用的镜像**，不是配置的事实源。
 * 真正驱动流水线行为的配置在 `src/domain/experiment.ts`。
 * 之所以要镜像一份，是因为 Node 脚本跑不了 TypeScript（没有构建步骤）。
 *
 * 维护约定：改 `src/domain/experiment.ts` 的 label / hypothesis 时，
 * 同步改这里 —— 只影响报告里的文字，不影响实验行为。
 */
export const EXPERIMENTS = {
  A: {
    id: 'A',
    label: '纯关键词检索',
    hypothesis: '关键词能搜到相关内容，但搜不到「恰好经历过这件事的人」',
    recall: 'keyword',
  },
  B: {
    id: 'B',
    label: '纯语义检索（向量）',
    hypothesis: '语义召回能跨过措辞差异，但会把「谈过」的人和「做过」的人混在一起',
    recall: 'semantic',
  },
  C: {
    id: 'C',
    label: '完整链路（混合召回 + 经历抽取 + 证据校验）',
    hypothesis: '两路召回互补，加上「亲历 + 逐字证据」两个约束后，推荐的人更可能是真做过的人',
    recall: 'hybrid',
  },
};

export function resolveExperiment(id) {
  const found = EXPERIMENTS[id];
  if (!found) throw new Error(`未知的实验分组「${id}」`);
  return found;
}
