/**
 * Step 01 · Triage 问题分诊
 *
 * 产品的第一性动作：判断这个问题该由公开内容、AI，还是真人来回答。
 * 这是「让 AI 知道什么时候应该把问题还给人」的落地处，也是整个方案最有辨识度的一步。
 *
 * 当前实现：情境词启发式 + LLM 判定，两者取更强信号。
 * 可升级方向：改成小样本分类、引入「不必要真人转介率」的反馈闭环。
 */

import type { TriageResult } from '@/domain/types';
import type { Step } from '@/framework/pipeline';
import { clamp01, llmOrFallback } from './shared';

/** 高度情境化信号：命中越多，越可能需要真人 */
const SITUATIONAL = [
  '该不该', '要不要', '怎么选', '如何选', '值不值', '值得吗', '接不接',
  '降薪', '涨薪', 'offer', '跳槽', '离职', '裸辞', '转岗', '转型', '换工作',
  '管理岗', '带团队', '晋升', '创业', '读研', '考研', '考公',
  '房贷', '家庭', '配偶', '老婆', '老公', '孩子', '父母', '35岁', '30岁',
  '我目前', '我现在', '我拿到', '我在想', '我很纠结',
];

/** 通用知识信号：命中说明公开内容/AI 足以回答 */
const GENERIC = [
  '是什么', '定义', '原理', '区别', '有哪些', '介绍一下', '什么意思',
  '历史', '怎么用', '教程', '入门', '排名', '对比',
];

const SCHEMA = `{
  "route": "content | ai | human",
  "reason": "一句话说明判断依据",
  "confidence": 0.0,
  "signals": ["判断依据关键词"]
}`;

function heuristic(question: string): TriageResult {
  const text = question.toLowerCase();
  const situational = SITUATIONAL.filter((w) => text.includes(w));
  const generic = GENERIC.filter((w) => text.includes(w));

  // 负向信号优先：通用知识问题不该占用真人
  if (generic.length > 0 && situational.length === 0) {
    return {
      route: 'content',
      reason: `问题命中通用知识信号（${generic.join('、')}），公开内容即可回答`,
      confidence: 0.7,
      signals: generic,
    };
  }

  if (situational.length >= 2) {
    return {
      route: 'human',
      reason: `问题包含多个情境化约束（${situational.slice(0, 4).join('、')}），答案依赖个体经历而非通用知识`,
      confidence: 0.65,
      signals: situational,
    };
  }

  if (situational.length === 1 && question.length > 20) {
    return {
      route: 'human',
      reason: `问题带有明确个人处境（${situational[0]}），倾向于需要真实经历参考`,
      confidence: 0.55,
      signals: situational,
    };
  }

  return {
    route: 'ai',
    reason: '未发现明显情境化约束，可由 AI 直接给出结构化回答',
    confidence: 0.5,
    signals: [],
  };
}

function coerce(raw: unknown, fallback: TriageResult): TriageResult {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<TriageResult>;
  const route = r.route === 'content' || r.route === 'ai' || r.route === 'human' ? r.route : fallback.route;
  return {
    route,
    reason: typeof r.reason === 'string' && r.reason.trim() ? r.reason : fallback.reason,
    confidence: clamp01(typeof r.confidence === 'number' ? r.confidence : fallback.confidence),
    signals: Array.isArray(r.signals) ? r.signals.map(String).slice(0, 8) : fallback.signals,
  };
}

export const triageStep: Step = {
  name: 'triage',
  from: null,
  describe: '判断问题该由公开内容 / AI / 真人回答',
  cacheKey: (input) => `triage:${String(input).slice(0, 200)}`,
  async run(question: string, ctx) {
    const baseline = heuristic(question);
    const result = await llmOrFallback<TriageResult>(
      ctx,
      {
        system:
          '你是知乎「问人」产品的问题分诊器。判断用户的问题应该由谁回答：\n' +
          '- content：答案已在公开内容里，直接给内容即可\n' +
          '- ai：是通用知识问题，AI 能高质量回答，不必打扰真人\n' +
          '- human：高度依赖个人处境与真实经历，只有经历过类似决策的人才能给出有价值的参考\n' +
          '倾向克制：能由内容或 AI 解决的问题，不要导向真人。',
        input: { question },
        schemaHint: SCHEMA,
        cacheKey: 'triage',
        validate: (raw) => coerce(raw, baseline),
      },
      () => baseline,
      'triage',
    );

    // 启发式给出更强的人类信号时，取更保守（更倾向真人）的一侧
    if (baseline.route === 'human' && result.route !== 'human' && baseline.signals.length >= 2) {
      return {
        ...baseline,
        reason: `${baseline.reason}（模型判定为 ${result.route}，但情境信号更强，保守路由到真人）`,
      };
    }
    return result;
  },
};
