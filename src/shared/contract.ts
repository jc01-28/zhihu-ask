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

/**
 * `/api/agent/search` 的**对外响应** = 链路产物 + 展示层聚合。
 *
 * 为什么把 `phases` 放在这一层而不是塞进 `AskResult`：
 *   - `AskResult` 是**链路产物**，由 `08-explain` 构造，e2e 与评测都对着它断言 → 不该动
 *   - `phases` 是**展示口径**（6 阶段），由 handler 层从 `trace` 映射而来
 * 这样"改展示"和"改链路"彻底解耦：调阶段划分不需要重跑任何链路验证。
 */
export interface AskResponse extends AskResult {
  phases: AgentPhase[];
}

/** ── 领域域（专业领域社交）────────────────────────────────────────────── */

/**
 * 领域摘要。
 *
 * `memberCount` / `topicCount` 是**算出来的**，不是写死的 —— 它们来自
 * 「真实内容挂载到议题 → 聚合到作者」的结果，所以会随语料变化。
 * 领域本身（名称/简介/标签/关键词）是人工定义的，那是产品叙事，必须可控。
 */
export interface FieldSummary {
  id: string;
  name: string;
  /** 最多 240 字 */
  description: string;
  /**
   * 图标**名称**（≤40 字）。前端用白名单映射到具体图标，未知名称回退默认图标。
   * **不是** emoji、更不是 URL —— 避免任何字符串被当成资源路径或 HTML 用。
   */
  icon: string | null;
  /**
   * ⚠️ 只发**语义 token**，不发十六进制色值（见 `FIELD_COLOR_TOKENS`）。
   * 具体色值由前端的固定映射表决定。
   */
  color: FieldColorToken;
  /** 最多 6 个标签，每个最多 20 字 */
  tags: string[];
  memberCount: number;
  topicCount: number;
}

export interface TopicNode {
  id: string;
  name: string;
  description: string;
  /**
   * ⚠️ **取值固定在 0~1**，不是 0~1000。
   * 坐标系归一化之后，前端换布局（桌面星图 → 移动端聚类卡片）不需要后端配合。
   */
  position: { x: number; y: number };
}

/**
 * 星图里的人物节点。
 *
 * 只含「公开可见 + 与领域相关」的最小字段集：**不带证据、不带分数理由**。
 * 前端的 `.strict()` 要求恰好这 9 个字段 —— 多一个少一个都会被判为非法响应
 * （我一度给它加过 `position`，那会直接导致整条响应解析失败）。
 */
export interface PersonNode {
  id: string;
  name: string;
  headline: string;
  avatarUrl: string | null;
  /** 头像占位字：中文取首字，英文取首字母。最多 2 字 */
  initial: string;
  /** 头像底色。由 id 哈希决定 —— 同一个人在任何页面颜色都一样 */
  avatarTone: string;
  topicIds: string[];
  /** 与该领域的相关度，**0~100**（不是 0~1） */
  relevance: number;
  /**
   * 公开知乎主页地址。**必须由后端给出，前端不按姓名拼接。**
   * 允许 null：知乎搜索接口不返回作者主页标识，领域来源的人物可能没有地址。
   */
  profileUrl: string | null;
}

export interface FieldGraphResponse {
  field: FieldSummary;
  topics: TopicNode[];
  people: PersonNode[];
}

/**
 * 领域检索的响应。
 *
 * ⚠️ 字段名是 `items`，而且**没有 `total`** —— 前端 `.strict()` 只认 `items`。
 * 空结果不是错误：返回 `{ items: [] }`，由前端展示「没有匹配的领域」。
 * **领域检索永远不会退化成人物检索**：返回值一定是领域，这是两个功能的边界。
 */
export interface FieldListResponse {
  items: FieldSummary[];
}

/**
 * 领域主题色**白名单**。与前端 `FIELD_COLOR_TOKENS` 逐字对齐。
 *
 * ⚠️ 只发语义 token。这样即使某天有字符串被注入了 `color: "red; background: url(...)"`，
 * 它也不可能落进样式 —— 前端的 enum 校验会直接拒绝，而不是交给 CSS 去猜。
 */
export const FIELD_COLOR_TOKENS = [
  'blue',
  'cyan',
  'violet',
  'amber',
  'emerald',
  'rose',
  'indigo',
  'teal',
] as const;

export type FieldColorToken = (typeof FIELD_COLOR_TOKENS)[number];



/** ── 端点与信封 ──────────────────────────────────────────────────────── */

/** 全部对外端点。前端不要硬编码路径，统一从这里取。 */
export const API_ROUTES = {
  /** ── 授权域（前端规格写的是 /api/auth/*，我们按它对齐）── */
  /** 登录状态：configured / authenticated / user */
  session: '/api/auth/session',
  /** 发起知乎授权：整页跳转，不是 fetch */
  login: '/api/auth/zhihu/login',
  /** 知乎回调。⚠️ 这个路径必须与 ZHIHU_REDIRECT_URI 逐字符一致 */
  callback: '/api/auth/zhihu/callback',
  /** 退出登录 */
  logout: '/api/auth/zhihu/logout',

  /** ── 业务域 ── */
  /** 问题找人（一次返回）。规格里叫 /api/agent/search，后续会升级为 NDJSON 流式 */
  agentSearch: '/api/agent/search',
  /** @deprecated 旧路径，保留兼容；新代码请用 agentSearch */
  ask: '/api/ask',

  /** ── 领域域（专业领域社交）── */
  /** 推荐领域列表 */
  fieldsFeatured: '/api/fields/featured',
  /** 领域搜索：`?query=训练大模型&limit=12` */
  fields: '/api/fields',

  /** ── 系统 ── */
  health: '/api/health',
  imageProxy: '/api/image-proxy',
} as const;

/** 领域星图路径。带路径参数，所以是函数而不是常量 */
export const fieldGraphPath = (fieldId: string): string =>
  `${API_ROUTES.fields}/${encodeURIComponent(fieldId)}/graph`;

/**
 * 公开用户视图。
 * **不是** OAuth UID，也不是数据库主键 —— 前端只需要一个稳定的展示身份。
 */
export interface PublicUser {
  id: string;
  displayName: string;
  /** 必须是 https 绝对地址，或 null。前端会直接塞进 <img src> */
  avatarUrl: string | null;
}

/**
 * `GET /api/auth/session` 的响应。
 *
 * ⚠️ 前端用 zod `.strict()` 校验：**恰好这三个键**，多一个就整条判无效。
 * 所以「缺哪些凭证」「回调地址是否本地」这类**部署诊断信息不能放这里** ——
 * 它们属于运维视角，不是前端契约的一部分。需要查就去看 `GET /api/health`。
 *
 * 前端的三分支逻辑完全由它决定（不要在页面上拼状态）：
 *   configured=false                       → 显示「服务端未配置知乎授权」
 *   configured=true && authenticated=false → 显示授权入口
 *   authenticated=true                     → 显示功能首页
 */
export interface AuthSessionResponse {
  /** 服务端 OAuth 凭证是否齐备（含回调地址可用性） */
  configured: boolean;
  /** 用户是否已完成知乎授权 */
  authenticated: boolean;
  user: PublicUser | null;
}

/**
 * 知乎授权回调可能带回的状态，用于**一次性**提示。
 * 与前端 `AUTH_QUERY_STATUSES` 逐字对齐。
 */
export const AUTH_QUERY_STATUSES = [
  'success',
  'unconfigured',
  'required',
  'code_missing',
  'state_missing',
  'state_mismatch',
  'token_type_unsupported',
  'exchange_failed',
] as const;

export type AuthQueryStatus = (typeof AUTH_QUERY_STATUSES)[number];

/** 授权错误码的旧别名，保留给后端日志使用 */
export type AuthErrorCode = AuthQueryStatus;

/** 登录与退出一律使用**浏览器导航**，不通过 fetch 追踪 302 */
export const AUTH_LOGIN_PATH = '/api/auth/zhihu/login';
export const AUTH_LOGOUT_PATH = '/api/auth/zhihu/logout';

/** ── 六阶段进度 ────────────────────────────────────────────────────────── */

/**
 * 前端规格要的是 **6 个阶段**，而我们的链路是 **8 步**。
 *
 * 这里刻意把「链路口径」和「展示口径」分开：
 *   - `AskResult.trace` 保留 8 步原貌 —— e2e 与评测都指着它，不能动
 *   - `AskResult.phases` 是给界面看的 6 阶段聚合
 * 映射关系见 `back/domain/phases.ts`。改展示口径不需要碰核心链路。
 */
/**
 * 六阶段标识。**与前端 `agentStepSchema` 逐字对齐**（含顺序）：
 *
 *   loading_context → understanding → retrieving → verifying → ranking → saving
 *
 * ⚠️ 注意第 5 个是 `ranking`（重排），不是「生成卡片」。
 * 后端一度叫 `compose`，语义和第 5 个的预期不一致 —— 前端按 `ranking` 显示
 * 「正在重排候选」，后端却还在生成卡片，进度就会骗人。
 */
export type AgentPhaseId =
  | 'loading_context'
  | 'understanding'
  | 'retrieving'
  | 'verifying'
  | 'ranking'
  | 'saving';

export interface AgentPhase {
  id: AgentPhaseId;
  label: string;
  status: 'pending' | 'running' | 'ok' | 'cached' | 'skipped' | 'failed';
  ms: number;
  summary: string;
}


/**
 * 前后端共同的错误信封。
 *
 * ⚠️ **这个形状由前端契约决定，不是我们自选的。**
 * 前端在 `src/shared/contracts/errors.ts` 里用 zod `.strict()` 校验它 ——
 * **只允许这四个键**，多一个字段整条响应就会被判为 `INVALID_RESPONSE`。
 *
 * 历史教训：后端一度返回 `{ error, hint }`，前端那边直接全部解析失败。
 * 契约的消费方是前端，形状以它为准。
 */
export interface ApiErrorEnvelope {
  code: string;
  message: string;
  /** 前端的重试按钮要不要出现，完全看这个布尔 */
  retryable: boolean;
  /**
   * 可选业务上下文，只给需要「回正」的接口用。
   * 目前唯一用途是 `INVALID_CONSULTATION_TRANSITION`：把当前完整的 Consultation
   * 放进来，前端据此把面板改回服务端真实状态，而不是自己推导下一状态。
   */
  details?: unknown;
}

/**
 * 前端需要区分处理的公开错误码。
 * 与前端 `API_ERROR_CODES` 逐字对齐 —— 改这里必须同步改那边。
 */
export const API_ERROR_CODES = {
  invalidSearchRequest: 'INVALID_SEARCH_REQUEST',
  invalidMessage: 'INVALID_MESSAGE',
  authRequired: 'ZHIHU_AUTH_REQUIRED',
  authExpired: 'ZHIHU_AUTH_EXPIRED',
  demoRoleForbidden: 'DEMO_ROLE_FORBIDDEN',
  runNotFound: 'RUN_NOT_FOUND',
  fieldNotFound: 'FIELD_NOT_FOUND',
  fieldSearchFailed: 'FIELD_SEARCH_FAILED',
  conversationNotFound: 'CONVERSATION_NOT_FOUND',
  conversationSourceUnavailable: 'CONVERSATION_SOURCE_UNAVAILABLE',
  invalidConsultationTransition: 'INVALID_CONSULTATION_TRANSITION',
  rateLimited: 'RATE_LIMITED',
  persistenceUnavailable: 'PERSISTENCE_UNAVAILABLE',
  notFound: 'NOT_FOUND',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];


export interface AskRequest {
  question: string;
  /** 不传则用后端默认组（当前是 C 完整链路） */
  experiment?: ExperimentId;
}

/**
 * @deprecated 已被 `AuthSessionResponse` 取代。
 *
 * 旧接口 `GET /api/oauth/status` 的响应形状：字段名是 `authorized`，
 * 且把「凭证是否配齐」和「是否已授权」混在一个 `credentials` 子对象里。
 * 新口径按前端规格拆成**两个平级布尔**（`configured` / `authenticated`），
 * 前端三分支判断更直接。这里保留仅为兼容旧路由，新代码不要用。
 */
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
