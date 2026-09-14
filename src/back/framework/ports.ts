/**
 * 框架层 · 端口（Ports）
 *
 * 这一层只定义「接口」，不含任何业务概念，也不含任何实现。
 * 业务骨干层（src/steps）只能通过这里的接口触碰外部世界，
 * 因此换数据源、换模型、加缓存都不需要改动业务流程。
 *
 * 命名沿用 hexagon / ports-and-adapters：ports 是接口，adapters 是实现。
 */

/** ── 内容源 ───────────────────────────────────────────────────────────── */

/** 一次内容检索命中的单条内容。字段与知乎 zhihu_search / global_search 对齐。 */
export interface SearchHit {
  title: string;
  /** Answer / Article / Question ... */
  contentType: string;
  contentId: string;
  /** 知乎返回的正文或摘要。经历事件只能从这里抽。 */
  contentText: string;
  url: string;
  commentCount: number;
  voteUpCount: number;
  /** 搜索接口只给作者名，不给作者主页标识 —— 见 README「已知缺口」。 */
  authorName: string;
  authorAvatar: string;
  /** 认证文案，可用于可信度展示。 */
  authorBadgeText: string;
  /** 秒级时间戳 */
  editTime: number;
  /** 精选评论，可能为空数组 */
  comments: string[];
  /** 权威等级 1-4 */
  authorityLevel: number;
  /** 相关性分数 */
  rankingScore: number;
  /**
   * 这条内容被哪几路召回命中（'keyword' / 'semantic'）。
   * 混合召回时由 03-recall 填充，用于诊断与评测归因；单路召回时可能缺席。
   */
  matchedBy?: string[];
}

export interface HotItem {
  title: string;
  url: string;
  summary: string;
}

export interface Followee {
  fullname: string;
  /** 主页标识 —— 用户数据接口有，搜索结果没有 */
  urlToken: string;
  /** 主页链接 */
  url: string;
  avatarUrl: string;
  headline: string;
  followerCount: number;
}

export interface MyContentItem {
  contentType: string;
  url: string;
  createdAt: number;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  title: string;
  /** 注意：本人创作接口只返回标题与摘要，没有正文。 */
  summary: string;
}

/**
 * 当前授权用户的公开资料。
 * ⚠️ 知乎没有给 `/user` 一个正式响应 schema（官方文档原话），
 * 所以每个字段都可能缺失 —— 读不到就返回 null，绝不伪造。
 */
export interface MyProfile {
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  url: string | null;
}

/**
 * 内容源端口。两种实现：知乎真实接口 / 本地 fixture。
 * 业务层永远只依赖这个接口，所以没有凭证也能完整开发。
 */
export interface ContentSource {
  readonly name: string;
  /** 知乎站内检索 / 全网检索 */
  searchContents(req: {
    query: string;
    count?: number;
    scope?: 'zhihu' | 'global';
  }): Promise<SearchHit[]>;
  /**
   * 能否**枚举整个语料库**（不依赖任何 query）。这是语义召回的前提：
   * 它要把全库向量化，再对 query 算 cosine。
   *
   * 为什么把这件事做成**可选能力声明**，而不是在业务步骤里写 `if (USE_FIXTURES)`：
   * 本地 fixture 源可以枚举（数据就在内存里），知乎 HTTP 源**不能** ——
   * 搜索接口强制要求 Query，传空词会返回 `Code=10001 Query is required`（已实测）。
   * 这是**数据源的能力差异**，所以由端口声明，`03-recall` 据此决定是
   * 「全库语义召回」还是「在已召回候选里做语义重排」（降级，必须在 trace 上如实标注）。
   *
   * 不实现该方法的源 = 不支持枚举。
   */
  enumerateCorpus?(limit: number): Promise<SearchHit[]>;
  /**
   * 只枚举**真实**语料（不含合成 / 虚构内容）。
   *
   * 领域星图专用。理由：那里展示的是「**谁真的写过这个话题**」——
   * 一旦出现虚构作者（合成语料里的「林一舟」这种），整个「证据驱动」的内核就废了，
   * 而且演示时没人能当场分辨哪个名字是编的。
   *
   * 所以它**不受 `FIXTURE_CORPUS` 影响**：那个开关是为了隔离对照实验的语料，
   * 而领域域跟对照实验毫无关系。
   *
   * fixture 源实现它；HTTP 源不需要（它本来就全是真实内容），
   * 所以在线模式下用 `searchContents` 兜底。
   */
  enumerateRealCorpus?(limit: number): Promise<SearchHit[]>;
  hotList(limit?: number): Promise<HotItem[]>;
  /** 需要 OAuth 授权，查当前授权用户的关注列表 */
  myFollowees(limit?: number): Promise<Followee[]>;
  /** 需要 OAuth 授权，查当前授权用户的创作（仅标题+摘要） */
  myContents(limit?: number): Promise<MyContentItem[]>;
  /** 需要 OAuth 授权，读当前授权用户的公开资料；读不到返回 null */
  myProfile(): Promise<MyProfile | null>;
}

/** ── 大模型 ───────────────────────────────────────────────────────────── */

export interface LlmClient {
  readonly name: string;
  /** 自由文本生成 */
  complete(req: {
    system: string;
    input: unknown;
    cacheKey?: string;
    temperature?: number;
  }): Promise<string>;
  /**
   * 结构化生成：把 schemaHint 注入 system，解析并校验返回的 JSON。
   * 直答不支持 response_format，所以这里用「提示词约束 + 宽松解析 + 校验」兜底。
   */
  structured<T>(req: {
    system: string;
    input: unknown;
    schemaHint: string;
    cacheKey?: string;
    temperature?: number;
    validate?: (raw: unknown) => T;
  }): Promise<T>;
}

/** ── 缓存与配额 ───────────────────────────────────────────────────────── */

export interface Cache {
  getOrSet<T>(
    key: string,
    ttlMs: number,
    producer: () => Promise<T>,
  ): Promise<{ value: T; hit: boolean }>;
}

export interface QuotaGuard {
  /** 消耗一次额度；超限抛 QuotaExceededError */
  consume(bucket: string): Promise<void>;
  snapshot(): Promise<Record<string, number>>;
}

export class QuotaExceededError extends Error {
  constructor(
    readonly bucket: string,
    readonly limit: number,
  ) {
    super(`接口额度已用尽：${bucket}（上限 ${limit}/天）`);
    this.name = 'QuotaExceededError';
  }
}
