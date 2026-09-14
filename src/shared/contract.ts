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
  description: string;
  /** 图标：用 emoji 或短字符，前端自行决定怎么渲染 */
  icon: string | null;
  /** 主题色（十六进制）。规格要求「不同专业领域可以使用不同主题色」 */
  color: string;
  tags: string[];
  memberCount: number;
  topicCount: number;
}

export interface TopicNode {
  id: string;
  name: string;
  description: string;
  /**
   * 画布坐标。**坐标系约定：0~1000 的正方形，中心 (500,500) 是领域中心节点。**
   * 前端按容器尺寸等比缩放即可，不需要自己算布局。
   */
  position: { x: number; y: number };
  memberCount: number;
}

export interface PersonNode {
  id: string;
  name: string;
  headline: string;
  avatarUrl: string | null;
  /** 头像占位字：取名字首字（中文）或首字母（英文） */
  initial: string;
  /** 头像底色。由 id 哈希决定 —— 同一个人在任何页面颜色都一样 */
  avatarTone: string;
  topicIds: string[];
  /** 与该领域的相关度 0~1，规格里用它决定头像大小 */
  relevance: number;
  /**
   * 画布坐标（与 TopicNode 同一坐标系）。
   *
   * ⚠️ 规格给的 PersonNode 里**没有**这个字段，这里是**超集**：
   * 位置由后端确定性算好，前端可以直接画；想自己按 topicIds 环绕排布也完全可以。
   * 之所以还是给出来 —— 「确定性布局」放在后端，前端就不用为移动端降级再实现一套。
   */
  position: { x: number; y: number };
}

export interface FieldGraphResponse {
  field: FieldSummary;
  topics: TopicNode[];
  people: PersonNode[];
}

export interface FieldSearchResponse {
  /** 命中的领域。**领域搜索只返回领域，永远不直接返回人物** —— 这是两个功能的边界 */
  fields: FieldSummary[];
  /** 命中总数（可能大于 fields.length，因为 limit 会截断） */
  total: number;
}



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
 * 授权错误码。
 *
 * 为什么要枚举而不是直接给文案：前端要按不同错误显示不同引导
 * （没配置 → 告诉运维；state 对不上 → 提示重试；换 token 失败 → 提示稍后再试）。
 * 让前端猜文案就等于把后端语义复制一份到前端，迟早不一致。
 */
export type AuthErrorCode =
  /** 服务端 OAuth 凭证没配齐 —— 前端显示「服务端未配置知乎授权」 */
  | 'unconfigured'
  /** 需要授权才能访问 —— 引导用户点授权按钮 */
  | 'required'
  /** 回调里没有授权码 */
  | 'code_missing'
  /** 回调没带 state（知乎不保证回传，见 DEVELOPER.md §9） */
  | 'state_missing'
  /** state 与 cookie 对不上，疑似 CSRF */
  | 'state_mismatch'
  /** 返回的 token 类型不是我们支持的那种 */
  | 'token_type_unsupported'
  /** 用 code 换 token 失败（凭证错 / code 过期 / 网络） */
  | 'exchange_failed';

export interface AuthUser {
  name: string | null;
  headline: string | null;
  url: string | null;
  avatarUrl: string | null;
}

/**
 * `GET /api/auth/session` 的响应。
 *
 * 前端的三分支逻辑完全由它决定（不要在页面上拼状态）：
 *   configured=false                       → 显示「服务端未配置知乎授权」
 *   configured=true && authenticated=false → 显示授权入口
 *   authenticated=true                     → 显示功能首页
 */
export interface AuthSessionResponse {
  /** 服务端 OAuth 凭证是否齐备（三项：App ID / App Key / 回调地址） */
  configured: boolean;
  /** 用户是否已完成知乎授权 */
  authenticated: boolean;
  /** 公开用户信息。知乎 /user 没有正式 schema，字段可能全为空 */
  user: AuthUser | null;
  /** configured=false 时缺哪些凭证，直接显示给开发者看 */
  missing: string[];
  /** 回调地址是否本地地址 —— 是的话知乎永远回调不了，只能预览页面 */
  redirectIsLocalOnly: boolean;
  /** 会话剩余有效秒数 */
  expiresInSeconds: number;
}

/** ── 六阶段进度 ────────────────────────────────────────────────────────── */

/**
 * 前端规格要的是 **6 个阶段**，而我们的链路是 **8 步**。
 *
 * 这里刻意把「链路口径」和「展示口径」分开：
 *   - `AskResult.trace` 保留 8 步原貌 —— e2e 与评测都指着它，不能动
 *   - `AskResult.phases` 是给界面看的 6 阶段聚合
 * 映射关系见 `back/domain/phases.ts`。改展示口径不需要碰核心链路。
 */
export type AgentPhaseId =
  | 'context'
  | 'understand'
  | 'retrieve'
  | 'verify'
  | 'compose'
  | 'persist';

export interface AgentPhase {
  id: AgentPhaseId;
  label: string;
  status: 'pending' | 'running' | 'ok' | 'cached' | 'skipped' | 'failed';
  ms: number;
  summary: string;
}


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
