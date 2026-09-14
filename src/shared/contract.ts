/**
 * 共享契约层 · 前后端**唯一**的交接点
 *
 * 这一层是接口冻结层：前端与后端都只依赖这里，互相不认识对方的实现。
 *
 * 依赖方向必须保持单向：
 *
 *       ┌──────────┐
 *       │   back   │ ──┐
 *       └──────────┘   │
 *                      ├──→  shared
 *       ┌──────────┐   │
 *       │  front   │ ──┘
 *       └──────────┘
 *
 * shared 不 import back、也不 import front —— 所以它可以被整体复制到另一个前端工程，
 * 前端因此可以在后端没就绪时先基于这份契约开发（配合 api-client 的 mock 开关）。
 *
 * ── 加字段的规矩 ──────────────────────────────────────────────────────
 *   1. **会过线**的类型（出现在 HTTP 响应体里）→ 写在这里
 *   2. **只在后端内部流转**的类型 → 写 `src/back/domain/types.ts`，不要放这里
 *   3. 改完这里，前端只需要动 `src/front/api-client.ts` 一处，不必翻 route 实现
 */

/** ── 路由分诊：公开内容 / AI / 真人 ────────────────────────────────────── */

export type Route = 'content' | 'ai' | 'human';

/** 实验分组。前端可显式指定，用于演示对照实验；不传则用后端默认组。 */
export type ExperimentId = 'A' | 'B' | 'C';

/** ── 问题结构化表示 ──────────────────────────────────────────────────── */

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

/** ── 核心数据对象 ────────────────────────────────────────────────────── */

/**
 * Experience Event —— 本产品的核心对象。
 * 关键约束：「写过」≠「经历过」，所以 firstPerson 与 quote 必须有。
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
  /** 原文证据片段，必须能在来源正文中定位到 —— 证据护栏依赖它 */
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
  /** 由 OAuth 关注列表补齐；知乎搜索接口本身不返回主页链接 */
  profileUrl: string | null;
  alreadyFollowed: boolean;
  headline: string | null;
  experiences: ExperienceEvent[];
  sourceCount: number;
  authorityLevel: number;
  voteUpCount: number;
  commentCount: number;
  score: number;
  /** 打分明细，前端「打分明细」折叠区直接用 */
  scoreBreakdown: Record<string, number>;
  /**
   * 证据校验没过的条目。
   * ⚠️ 这是**后端诊断字段**，给评测脚本与排查用 —— 前端不要展示它。
   * 将来的收敛方向：把它移出对外 DTO，只留在产物里（见 DEVELOPER.md「已知缺口」）。
   */
  rejectedReasons: string[];
}

export interface Recommendation {
  /** 推荐 1｜经历最接近 —— 三种角色刻意互补而非简单排序 */
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

/** ── 主响应体 ────────────────────────────────────────────────────────── */

export interface AskResult {
  question: string;
  route: Route;
  triageReason: string;
  profile: ProblemProfile | null;
  recommendations: Recommendation[];
  /** 「别问人」路径：公开内容已足够时直接给内容 */
  contentOnly: { title: string; url: string; quote: string }[];
  /** 本次运行的实验分组标识（A/B/C），评测报告据此归因 */
  experiment: { id: string; label: string; recall: string };
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
  /** 8 步链路的执行轨迹，界面上的「链路看板」直接渲染它 */
  trace: { step: string; status: string; ms: number; summary: string }[];
  runId: string;
}

/** ── 端点与信封 ──────────────────────────────────────────────────────── */

/** 全部对外端点。前端不要硬编码路径，统一从这里取。 */
export const API_ROUTES = {
  ask: '/api/ask',
  health: '/api/health',
  oauthAuthorize: '/api/oauth/authorize',
  oauthCallback: '/api/oauth/callback',
  oauthStatus: '/api/oauth/status',
  oauthLogout: '/api/oauth/logout',
  imageProxy: '/api/image-proxy',
} as const;

/**
 * 统一响应信封。**所有 `/api/*` 端点**都返回这个形状（含 `/api/health`）：
 *   成功 → `{ status: 'success', data: T }`
 *   失败 → `{ error: string, hint?: string }`
 *
 * 前端因此只需要判断一个字段就能区分成功/失败，完全不必了解内部细节。
 * 后端统一由 `back/handlers/types.ts` 的 `ok()` / `fail()` 构造，不要手拼。
 *
 * ⚠️ 这条规则是**刚确立**的：此前 /api/health 与 /api/oauth/status 返回的是裸对象，
 * 导致同一个前端要维护两套解析逻辑。改成统一信封后，`scripts/e2e.mjs`
 * 里那些「漏信封就报红」的断言就是这条契约的守门人。
 */
export type ApiEnvelope<T> =
  | { status: 'success'; data: T }
  | { error: string; hint?: string };

export interface AskRequest {
  question: string;
  /** 不传则用后端默认组（当前是 C 完整链路） */
  experiment?: ExperimentId;
}

export interface OAuthStatusResponse {
  authorized: boolean;
  note: string;
  /** 知乎 /user 没有正式 schema，字段都可能缺失 */
  profile?: { name: string | null; headline: string | null; url: string | null } | null;
  expiresInSeconds?: number;
  credentials?: {
    ready: boolean;
    missing: string[];
    redirectUri: string | null;
    redirectIsLocalOnly: boolean;
  };
  quotaUsedToday?: Record<string, number>;
}

export interface HealthResponse {
  ok: boolean;
  mode: 'fixtures' | 'live';
  configured: {
    accessSecret: boolean;
    oauth: boolean;
    oauthRedirect: string | null;
    sessionSecret: boolean;
    llmProvider: string;
  };
  /** 当前在跑哪份语料。演示前先看这里，避免真实/虚构作者混排。 */
  corpus: {
    scope: string;
    synthetic: number;
    real: number;
    total: number;
    source: string;
  };
  runtime: { dataDir: string; dataDirWritable: boolean; node: string };
  quotaUsedToday: Record<string, number>;
  time: string;
}
