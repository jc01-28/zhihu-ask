/**
 * Step 02 · Problem Profile 问题结构化
 *
 * 把用户的一段自然语言拆成可检索的结构：现状 / 目标 / 变化 / 约束 / 所需经历。
 * 同时产出 searchQueries —— 这是召回层的唯一输入，也是整个系统最值得调的地方。
 *
 * 可升级方向：
 *   - query 生成改成「多意图拆分 + 同义扩展」，并用对照实验评估召回增益；
 *   - 引入约束词典提高 constraints 抽取召回；
 *   - 把 needExperiences 作为「重排特征」直接喂给 rank 步。
 */

import type { AskBoot } from '@/back/domain/experiment';
import type { ProblemProfile, TriageResult } from '@/back/domain/types';
import { SYS_INPUT, type Step } from '@/back/framework/pipeline';
import { llmOrFallback } from './shared';

const SCHEMA = `{
  "currentState": "用户当前所处状态",
  "goal": "用户想达到的目标",
  "change": "正在发生或即将发生的变化",
  "constraints": ["个体约束，如薪资、家庭、地域、时间"],
  "needExperiences": ["需要什么样的亲身经历才能回答这个问题"],
  "stage": "所处人生/职业阶段",
  "searchQueries": ["用于检索知乎内容的短查询，3-4 条"]
}`;

/**
 * 领域词典。没有 LLM 时靠它生成检索词 —— 比「对原句做定长切块」靠谱得多，
 * 后者会产出「我在大厂做产」这类伪词，直接让召回归零。
 * 计划书面向职场/升学决策场景，这个词典覆盖第一批 P0 画像。
 */
const LEXICON = [
  '大厂', '创业公司', '创业', 'offer', '降薪', '涨薪', '期权', '股权',
  '晋升', '管理岗', '带团队', '技术管理', '转岗', '转型', '跳槽', '离职', '裸辞',
  '读研', '考研', '考公', '留学', '专业选择',
  '房贷', '家庭', '配偶', '孩子', '父母', '异地',
  'AI 产品', 'AI产品', '产品经理', '产品负责人', '技术负责人', '非科班',
  '应届', '校招', '实习', '职业选择', '职业规划', '能力曲线', '面试',
];

/** 按词典命中情况生成检索词；命中不足时退回原句截断 */
function buildQueries(question: string, hits: string[]): string[] {
  if (hits.length >= 2) {
    const [a, b, c] = hits;
    return [
      [a, b, c].filter(Boolean).join(' '),
      `${a} ${b} 经历`,
      `${a} ${b} 怎么选`,
      `${c ?? b} 复盘`,
    ].filter(Boolean);
  }

  if (hits.length === 1) {
    return [hits[0], `${hits[0]} 经历`, `${hits[0]} 复盘`, `${hits[0]} 后来怎么样了`];
  }

  const trimmed = question.replace(/[?？。！!，,]/g, '').slice(0, 16);
  return [trimmed, `${trimmed} 经历`, `${trimmed} 复盘`, `${trimmed} 怎么选`];
}

function heuristic(question: string): ProblemProfile {
  const stripped = question.replace(/[?？。！!]/g, '').trim();
  const hits = LEXICON.filter((word) => question.includes(word));

  // 「35 岁」「工作 7 年」这类信息对判断阶段很关键，单独抽
  const age = question.match(/(\d{2})\s*岁/);
  const years = question.match(/(\d{1,2})\s*年/);
  const stage = age
    ? `${age[1]} 岁`
    : years
      ? `有 ${years[1]} 年经验`
      : '未识别';

  return {
    currentState: stripped.slice(0, 80),
    goal: '获得可参考的真实经历，辅助做出判断',
    change: hits.slice(0, 3).join('、') || stripped.slice(0, 40),
    constraints: hits.slice(0, 5),
    // 要写成「具体的能力/经历」，因为它直接决定「不适合回答」这一栏的措辞
    needExperiences:
      hits.length >= 2
        ? [`从「${hits[0]}」转入「${hits[1]}」的亲身经历`, '做这个决定时的判断依据', '事后的复盘与代价']
        : ['与当前处境高度相似的真实决策经历'],
    stage,
    searchQueries: buildQueries(stripped, hits),
  };
}

function coerce(raw: unknown, fallback: ProblemProfile): ProblemProfile {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<ProblemProfile>;
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v : d);
  const arr = (v: unknown, d: string[]) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 8) : d;

  const queries = arr(r.searchQueries, fallback.searchQueries);
  return {
    currentState: str(r.currentState, fallback.currentState),
    goal: str(r.goal, fallback.goal),
    change: str(r.change, fallback.change),
    constraints: arr(r.constraints, fallback.constraints),
    needExperiences: arr(r.needExperiences, fallback.needExperiences),
    stage: str(r.stage, fallback.stage),
    searchQueries: queries.length ? queries : fallback.searchQueries,
  };
}

export const profileStep: Step = {
  name: 'profile',
  from: [SYS_INPUT, 'triage'],
  describe: '把自然语言问题拆成结构化检索意图',
  cacheKey: (input) => `profile:${JSON.stringify(input)}`,
  summarize: (output) => {
    const p = output as ProblemProfile | undefined;
    if (!p) return '';
    return `${p.searchQueries?.length ?? 0} 条检索词 · 阶段 ${p.stage}`;
  },
  async run(input: { '@input': AskBoot; triage: TriageResult }, ctx) {
    const question = input[SYS_INPUT].question;
    const baseline = heuristic(question);

    return llmOrFallback<ProblemProfile>(
      ctx,
      {
        system:
          '你是需求分析师。把用户的求助问题拆成结构化档案，用于检索知乎上的真实经历。\n' +
          '重点：constraints 要抓「个体约束」而不是话题；searchQueries 要写成适合检索短句，' +
          '不要照抄原问题，要覆盖「转变过程」「决策依据」「事后复盘」三个角度。',
        input: { question, triage: input.triage },
        schemaHint: SCHEMA,
        cacheKey: `profile:${question}`,
        validate: (raw) => coerce(raw, baseline),
      },
      () => baseline,
      'profile',
    );
  },
};
