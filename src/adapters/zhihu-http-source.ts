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

import type { DiskCache } from '@/framework/cache';
import type {
  ContentSource,
  Followee,
  HotItem,
  MyContentItem,
  QuotaGuard,
  SearchHit,
} from '@/framework/ports';

interface ZhihuEnvelope<T> {
  Code: number;
  Message: string;
  Data: T;
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

  private async fetchOnce<T>(path: string, query: string, withOAuth: boolean): Promise<T> {
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
    const res = await fetch(url, { headers, cache: 'no-store' });
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`知乎接口 HTTP ${res.status}：${text.slice(0, 200)}`);
    }

    const body = JSON.parse(text) as ZhihuEnvelope<T>;
    if (body.Code !== 0) {
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
}

function mapHit(item: RawSearchItem): SearchHit {
  return {
    title: item.Title ?? '',
    contentType: item.ContentType ?? '',
    contentId: item.ContentID ?? '',
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
