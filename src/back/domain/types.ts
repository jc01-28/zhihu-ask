/**
 * 领域层 · 后端**内部**类型
 *
 * 这里只放**不过线**的类型：步骤之间的数据流契约、分诊原始结果、重排权重。
 * 会出现在 HTTP 响应里的类型一律放在 `src/shared/contract.ts` —— 那是前后端的交接点。
 *
 * 为什么这样切：前端不该知道步骤之间怎么传数据，也不该依赖契约以外的任何结构。
 * 把它们挡在 back/ 里，前端就没法依赖实现细节。
 *
 * 依赖方向：back → shared（单向，不要反过来）
 */

import type { SearchHit } from '@/back/framework/ports';
import type {
  AskResult,
  Candidate,
  ExperienceEvent,
  ProblemProfile,
  Route,
} from '@/shared/contract';

// 对外契约在 back 内部统一从这一个入口取，业务步骤不用记两套路径
export type {
  AskResult,
  Candidate,
  ExperienceEvent,
  ProblemProfile,
  Recommendation,
  Route,
} from '@/shared/contract';

/** 问题分诊的原始结果。只有 route / reason 会过线，其余是后端内部信号。 */
export interface TriageResult {
  route: Route;
  reason: string;
  /** 0-1，用于「信心护栏」 */
  confidence: number;
  signals: string[];
}

/**
 * 重排权重。
 * 放在 domain 层（而不是 06-rank.ts）是为了避免「实验配置 ← 步骤实现 → 实验配置」
 * 的循环依赖：experiment.ts 需要这个形状，而 rank 步需要 experiment.ts 的配置。
 */
export interface RankingWeights {
  relevance: number;
  decisionSimilarity: number;
  evidenceRichness: number;
  constraintMatch: number;
  authority: number;
  longevity: number;
  sourceBreadth: number;
}

/**
 * 步骤之间的数据流契约。**后端内部，不过线。**
 * 键名必须与 Step.name 完全一致（引擎启动前会校验）。
 */
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
