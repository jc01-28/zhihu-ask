/**
 * 适配器 · 知乎开放平台 HTTP 内容源
 *
 * 事实依据（官方 zhihu skill 的 http-api.md / user-api.md，核验 2026-07-16）：
 *   - 内容检索：GET /api/v1/content/zhihu_search   返回 Title/ContentText/AuthorName/...
 *   - 全网检索：GET /api/v1/content/global_search
 *   - 热榜：    GET /api/v1/content/hot_list
 *   - 关注列表：GET /api/v1/user/followees   ← 只有这个接口带作者主页 URL / UrlToken
 *   - 本人创作：GET /api/v1/user/contents    ← 只有 Title + Summary，没有正文
 *
 * 鉴权：Authorization: Bearer <Access Secret> + X-Request-Timestamp（秒级）。
 * 若代表已授权用户访问，额外加 X-OAuth-Token: <OAuth access_token>。
 *
 * 额度：搜索类 1000/天、热榜 100/天。所有请求都过缓存 + 额度护栏。
 */

import type { DiskCache } from '@/back/framework/cache';
import { fetchWithTimeout } from '@/back/framework/timeout';
import type {
  ContentSource,
  Followee,
  HotItem,
  MyContentItem,
  MyProfile,
  QuotaGuard,
  SearchHit,
} from '@/back/framework/ports';

interface ZhihuEnvelope<T> {
  Code: number;
  Message: string;
  Data: T;
}

/**
 * 限流重试。
 * 实测：4 路查询并发打过去，有 2 路被 `Code=30001 rate limit exceeded` 拒掉 ——
 * 知乎的限流比「1000 次/天」这个日额度更细，对瞬时并发敏感。
 * 单路失败虽然被 onError 兜住了（链路不炸），但会白丢召回结果，
 * 现场演示时这条直接决定成败，所以隔一会儿重试一次。
 */
const RATE_LIMIT_CODES = new Set([30001, 30002]);
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_DELAY_MS = 900;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RawSearchItem {
  Title?: string;
  ContentType?: string;
  ContentID?: string;
  ContentText?: string;
  Url?: string;
  CommentCount?: number;
  VoteUpCount?: number;
  AuthorName?: string;
  AuthorAvatar?: string;
  AuthorBadgeText?: string;
  EditTime?: number;
  CommentInfoList?: { Content?: string }[];
  AuthorityLevel?: string;
  RankingScore?: number;
}

export interface ZhihuSourceOptions {
  cache: DiskCache;
  quota: QuotaGuard;
  /** 返回当前请求上下文里的 OAuth token；无授权时返回 null */
  getOAuthToken(): Promise<string | null>;
  baseUrl?: string;
  ttlMs?: number;
}

export class ZhihuHttpSource implements ContentSource {
  readonly name = 'zhihu-http';

  private readonly base: string;
  private readonly ttlMs: number;

  constructor(private readonly opts: ZhihuSourceOptions) {
    this.base = (opts.baseUrl || process.env.ZHIHU_API_BASE || 'https://developer.zhihu.com').replace(
      /\/$/,
      '',
    );
    this.ttlMs = opts.ttlMs ?? Number(process.env.CACHE_TTL_MS || 86400000);
  }

  /** 带签名、缓存、额度护栏的 GET */
  private async get<T>(
    path: string,
    params: Record<string, string | number | undefined>,
    bucket: string,
    withOAuth: boolean,
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') search.set(k, String(v));
    }
    const query = search.toString();
    const cacheKey = `zhihu:${bucket}:${path}?${query}`;

    const { value } = await this.opts.cache.getOrSet(cacheKey, this.ttlMs, async () => {
      await this.opts.quota.consume(bucket);
      return this.fetchOnce<T>(path, query, withOAuth);
    });

    return value;
  }

  private async fetchOnce<T>(
    path: string,
    query: string,
    withOAuth: boolean,
    attempt = 0,
  ): Promise<T> {
    const secret = process.env.ZHIHU_ACCESS_SECRET;
    if (!secret) {
      throw new Error('ZHIHU_ACCESS_SECRET 未配置：在 https://developer.zhihu.com/profile 生成');
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${secret}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
    };

    if (withOAuth) {
      const token = await this.opts.getOAuthToken();
      if (!token) throw new Error('该接口需要用户 OAuth 授权，当前会话没有可用 token');
      headers['X-OAuth-Token'] = token;
    }

    const url = `${this.base}${path}${query ? `?${query}` : ''}`;
    const res = await fetchWithTimeout(url, { headers, cache: 'no-store' });
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`知乎接口 HTTP ${res.status}：${text.slice(0, 200)}`);
    }

    const body = JSON.parse(text) as ZhihuEnvelope<T>;
    if (body.Code !== 0) {
      // 限流退避重试。递增等待，避免三路同时重试又撞上。
      if (RATE_LIMIT_CODES.has(body.Code) && attempt < RATE_LIMIT_RETRIES) {
        await sleep(RATE_LIMIT_DELAY_MS * (attempt + 1));
        return this.fetchOnce<T>(path, query, withOAuth, attempt + 1);
      }
      throw new Error(`知乎接口业务错误 Code=${body.Code} ${body.Message ?? ''}`);
    }
    return body.Data;
  }

  async searchContents(req: {
    query: string;
    count?: number;
    scope?: 'zhihu' | 'global';
  }): Promise<SearchHit[]> {
    const scope = req.scope ?? 'zhihu';

    if (scope === 'global') {
      const data = await this.get<{ Items?: RawSearchItem[] }>(
        '/api/v1/content/global_search',
        { Query: req.query, Count: Math.min(req.count ?? 10, 20) },
        'global_search',
        false,
      );
      return (data.Items ?? []).map(mapHit);
    }

    const data = await this.get<{ Items?: RawSearchItem[] }>(
      '/api/v1/content/zhihu_search',
      { Query: req.query, Count: Math.min(req.count ?? 10, 10) },
      'zhihu_search',
      false,
    );
    return (data.Items ?? []).map(mapHit);
  }

  async hotList(limit = 20): Promise<HotItem[]> {
    const data = await this.get<{ Items?: { Title?: string; Url?: string; Summary?: string }[] }>(
      '/api/v1/content/hot_list',
      { Limit: Math.min(limit, 30) },
      'hot_list',
      false,
    );
    return (data.Items ?? []).map((i) => ({
      title: i.Title ?? '',
      url: i.Url ?? '',
      summary: i.Summary ?? '',
    }));
  }

  async myFollowees(limit = 50): Promise<Followee[]> {
    const data = await this.get<{
      Items?: {
        Fullname?: string;
        UrlToken?: string;
        Url?: string;
        AvatarUrl?: string;
        Headline?: string;
        FollowerCount?: number;
      }[];
    }>('/api/v1/user/followees', { Offset: 0, Limit: Math.min(limit, 50) }, 'user_api', true);

    return (data.Items ?? []).map((i) => ({
      fullname: i.Fullname ?? '',
      urlToken: i.UrlToken ?? '',
      url: i.Url ?? '',
      avatarUrl: i.AvatarUrl ?? '',
      headline: i.Headline ?? '',
      followerCount: i.FollowerCount ?? 0,
    }));
  }

  async myContents(limit = 20): Promise<MyContentItem[]> {
    const data = await this.get<{
      Items?: {
        ContentType?: string;
        Url?: string;
        CreatedAt?: number;
        LikeCount?: number;
        CommentCount?: number;
        FavoriteCount?: number;
        Title?: string;
        Summary?: string;
      }[];
    }>(
      '/api/v1/user/contents',
      { ContentType: 'all', Limit: Math.min(limit, 50) },
      'user_api',
      true,
    );

    return (data.Items ?? []).map((i) => ({
      contentType: i.ContentType ?? '',
      url: i.Url ?? '',
      createdAt: i.CreatedAt ?? 0,
      likeCount: i.LikeCount ?? 0,
      commentCount: i.CommentCount ?? 0,
      favoriteCount: i.FavoriteCount ?? 0,
      title: i.Title ?? '',
      summary: i.Summary ?? '',
    }));
  }

  /**
   * 读当前授权用户的公开资料。
   *
   * 两个容易踩的点：
   *   1. 这个接口在 **openapi.zhihu.com**，不在 developer.zhihu.com —— 域名不同。
   *   2. 它依然要**双凭证**：Access Secret 鉴权调用方 + X-OAuth-Token 指明代表谁。
   *
   * 官方明确说 `/user` 没有正式响应 schema，所以这里对字段做多种命名兼容，
   * 读不到就返回 null，绝不编造。
   */
  async myProfile(): Promise<MyProfile | null> {
    const secret = process.env.ZHIHU_ACCESS_SECRET;
    if (!secret) return null;
    const token = await this.opts.getOAuthToken();
    if (!token) return null;

    const base = (process.env.ZHIHU_OPENAPI_BASE || 'https://openapi.zhihu.com').replace(/\/$/, '');

    const res = await fetchWithTimeout(`${base}/user`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        'X-OAuth-Token': token,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const payload = (await res.json()) as Record<string, unknown>;
    const source =
      (payload.data as Record<string, unknown> | undefined) ??
      (payload.Data as Record<string, unknown> | undefined) ??
      (payload.user as Record<string, unknown> | undefined) ??
      payload;

    if (!source || typeof source !== 'object') return null;

    const pick = (...keys: string[]): string | null => {
      for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim()) return value;
      }
      return null;
    };

    const profile: MyProfile = {
      name: pick('name', 'Fullname', 'fullname'),
      avatarUrl: pick('avatar_url', 'AvatarUrl', 'avatarUrl'),
      headline: pick('headline', 'Headline'),
      url: pick('url', 'Url'),
    };

    // 全空说明拿到了但没解析出任何字段，视为不可用，避免 UI 显示一个空壳
    return profile.name || profile.headline || profile.url ? profile : null;
  }
}

function mapHit(item: RawSearchItem): SearchHit {
  return {
    title: item.Title ?? '',
    contentType: item.ContentType ?? '',
    // ⚠️ 必须 String()：接口的 ContentID 是 JSON 数字，而且**可能是负数**
    // （实测 80 条里有 43 条是负数，如 -4385295227347437，与 URL 里的 answer id 也不是一回事）。
    // 直接赋值会让 string 类型字段在运行时装着 number，去重与追溯会前后不一致。
    contentId: item.ContentID == null ? '' : String(item.ContentID),
    contentText: item.ContentText ?? '',
    url: item.Url ?? '',
    commentCount: item.CommentCount ?? 0,
    voteUpCount: item.VoteUpCount ?? 0,
    authorName: item.AuthorName ?? '',
    authorAvatar: item.AuthorAvatar ?? '',
    authorBadgeText: item.AuthorBadgeText ?? '',
    editTime: item.EditTime ?? 0,
    comments: (item.CommentInfoList ?? [])
      .map((c) => c.Content ?? '')
      .filter(Boolean),
    authorityLevel: Number(item.AuthorityLevel ?? 1) || 1,
    rankingScore: item.RankingScore ?? 0,
  };
}
