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
  hotList(limit?: number): Promise<HotItem[]>;
  /** 需要 OAuth 授权，查当前授权用户的关注列表 */
  myFollowees(limit?: number): Promise<Followee[]>;
  /** 需要 OAuth 授权，查当前授权用户的创作（仅标题+摘要） */
  myContents(limit?: number): Promise<MyContentItem[]>;
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
