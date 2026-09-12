/**
 * 领域层 · 业务契约
 *
 * 这是整个项目的「接口冻结层」：所有步骤之间只通过这里的类型交换数据。
 * 好处是业务骨干可以并行开发 —— 只要不动这里的类型，改任何一个 step 都不会
 * 影响别人；也方便把中间产物直接扔给评测脚本算指标。
 */

import type { SearchHit } from '@/framework/ports';

/** 问题分诊结果：公开内容 / AI / 真人 */
export type Route = 'content' | 'ai' | 'human';

export interface TriageResult {
  route: Route;
  reason: string;
  /** 0-1，用于「信心护栏」 */
  confidence: number;
  signals: string[];
}

/** 用户问题的结构化表示 */
export interface ProblemProfile {
  /** 当前状态 */
  currentState: string;
  /** 想要达到的目标 */
  goal: string;
  /** 面临的变化 */
  change: string;
  /** 个体约束：薪资、家庭、地域、时间…… */
  constraints: string[];
  /** 需要什么样的经历才能回答 */
  needExperiences: string[];
  /** 所处阶段，如「工作 7 年」「应届」 */
  stage: string;
  /** 用于召回的检索词，由 profile 生成 */
  searchQueries: string[];
}

/**
 * Experience Event —— 本产品的核心数据对象。
 * 关键约束：「写过」≠「经历过」，所以必须有 firstPerson 与 quote。
 */
export interface ExperienceEvent {
  id: string;
  sourceContentId: string;
  sourceUrl: string;
  sourceTitle: string;
  authorName: string;
  /** 是否第一人称经历，而非旁观者观点 */
  firstPerson: boolean;
  /** 转变前 */
  from: string;
  /** 转变后 */
  to: string;
  /** 当时做的关键判断 */
  decision: string;
  constraints: string[];
  /** 时间线索，用于「时间护栏」 */
  timeHint: string;
  /** 原文证据片段，必须能在来源 contentText 中定位到 —— 证据护栏依赖它 */
  quote: string;
  /** 与当前问题的相关度 0-1 */
  relevance: number;
}

/** 候选创作者（由经历事件按作者聚合而来） */
export interface Candidate {
  id: string;
  authorName: string;
  authorAvatar: string;
  authorBadgeText: string;
  /** 由 OAuth 关注列表补齐；搜索接口本身不返回主页链接 */
  profileUrl: string | null;
  alreadyFollowed: boolean;
  headline: string | null;
  experiences: ExperienceEvent[];
  sourceCount: number;
  authorityLevel: number;
  voteUpCount: number;
  commentCount: number;
  score: number;
  scoreBreakdown: Record<string, number>;
  /** 证据校验没过的条目，只用于诊断，不外显 */
  rejectedReasons: string[];
}

export interface Recommendation {
  /** 推荐 1｜经历最接近 */
  role: string;
  candidate: Candidate;
  /** 为什么推荐（必须每条都能被 evidence 支撑） */
  whyRecommended: string;
  evidence: { title: string; url: string; quote: string }[];
  /** 与用户最相关的维度 */
  relevantToYou: string[];
  /** 不适合回答什么 —— 诚实性设计，也是差异化卖点 */
  notGoodAt: string[];
  nextActions: { label: string; href: string }[];
  /** 全部外显理由都通过证据校验 */
  verified: boolean;
}

export interface AskResult {
  question: string;
  route: Route;
  triageReason: string;
  profile: ProblemProfile | null;
  recommendations: Recommendation[];
  /** 「别问人」路径：公开内容已足够时直接给内容 */
  contentOnly: { title: string; url: string; quote: string }[];
  /** 指标体系，直接对应计划书 §6.2 */
  metrics: {
    hitCount: number;
    eventCount: number;
    candidateCount: number;
    /** 证据覆盖率：外显理由中可溯源的比例 */
    evidenceCoverage: number;
    /** 无证据陈述率：健康指标，越低越好 */
    noEvidenceRate: number;
    /** 大 V 集中度：推荐结果被高粉用户占据的程度 */
    bigVShare: number;
  };
  trace: { step: string; status: string; ms: number; summary: string }[];
  runId: string;
}

/** 步骤之间的数据流契约。键名必须与 Step.name 完全一致（引擎会校验）。 */
export interface Stages {
  question: string;
  triage: TriageResult;
  profile: ProblemProfile;
  /** 混合召回产物。注意步骤名是 recall，不是 hits。 */
  recall: SearchHit[];
  events: ExperienceEvent[];
  candidates: Candidate[];
  ranked: Candidate[];
  verified: Candidate[];
  result: AskResult;
}

export type StepName = keyof Stages;
