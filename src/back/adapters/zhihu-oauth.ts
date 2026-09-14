/**
 * 适配器 · 知乎 OAuth
 *
 * 对齐官方实测结论（见 zhihu-hackathon skill 的 oauth.md）：
 *   - 授权入口：GET https://openapi.zhihu.com/authorize?redirect_uri=&app_id=&response_type=code
 *   - 回调参数实测是 authorization_code，不是文档里的 code；两者都要兼容。
 *   - 换取 token：POST https://openapi.zhihu.com/access_token，表单字段仍然叫 code。
 *   - grant_type 固定 authorization_code，不从回调读。
 *   - 回调实测不回传 state。
 *   - token 响应里业务字段 code:20000 表示成功，不要当错误。
 *
 * 重要：OAuth token 只用于「代表用户读他自己的数据」。调用内容接口时还要
 * 同时带开放平台 Access Secret（Authorization: Bearer），两者职责不同。
 */

import { fetchWithTimeout } from '@/back/framework/timeout';

const AUTHORIZE_URL = 'https://openapi.zhihu.com/authorize';
const TOKEN_URL = 'https://openapi.zhihu.com/access_token';

export interface OAuthConfig {
  appId: string;
  appKey: string;
  redirectUri: string;
}

export function readOAuthConfig(): OAuthConfig | null {
  const appId = process.env.ZHIHU_APP_ID;
  // 官方模板用 ZHIHU_OAUTH_APP_KEY 命名，是为了和开放平台 Access Secret 严格区分。
  // 两个名字都接受，避免因为改过名的环境变量而静默失效。
  const appKey = process.env.ZHIHU_OAUTH_APP_KEY || process.env.ZHIHU_APP_KEY;
  const redirectUri = process.env.ZHIHU_REDIRECT_URI;
  if (!appId || !appKey || !redirectUri) return null;
  return { appId, appKey, redirectUri };
}

/** 本地地址永远无法完成真实登录 —— 这是知乎的限制，不是配置问题 */
export function isLocalRedirect(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * 占位符域名：看着像配好了，其实一定注册不上。
 * 拦在本地比让用户跳到知乎再看一句看不懂的报错要好。
 */
export function isPlaceholderRedirect(uri: string): boolean {
  return /your-domain|example\.(com|invalid|org)|placeholder|xxx|待填|TODO/i.test(uri);
}

export interface CredentialReport {
  appId: boolean;
  appKey: boolean;
  accessSecret: boolean;
  redirectUri: string | null;
  redirectIsLocalOnly: boolean;
  ready: boolean;
  missing: string[];
}

/**
 * 自查三类凭证是否齐备。
 *
 * 为什么要单独做这个：知乎的三个凭证极易混淆，而且缺任何一个都会在
 * 完全不同的地方报错（app_key 缺 → 换 token 失败；Access Secret 缺 → 用户接口 401），
 * 排查时很容易方向跑偏。
 *
 *   App ID        —— 短数字，标识应用，进配置
 *   OAuth App Key —— 后端换 token 用
 *   Access Secret —— 开放平台调用方鉴权，所有用户数据接口都要（developer.zhihu.com/profile 生成）
 */
export function inspectCredentials(): CredentialReport {
  const appId = process.env.ZHIHU_APP_ID;
  const appKey = process.env.ZHIHU_OAUTH_APP_KEY || process.env.ZHIHU_APP_KEY;
  const accessSecret = process.env.ZHIHU_ACCESS_SECRET;
  const redirectUri = process.env.ZHIHU_REDIRECT_URI ?? null;

  const missing: string[] = [];
  if (!appId) missing.push('ZHIHU_APP_ID（知乎开放平台申请到的 App ID）');
  if (!appKey) missing.push('ZHIHU_OAUTH_APP_KEY（OAuth App Key，换 token 用）');
  if (!accessSecret) missing.push('ZHIHU_ACCESS_SECRET（developer.zhihu.com/profile 生成）');
  if (!redirectUri) missing.push('ZHIHU_REDIRECT_URI（公网 HTTPS 回调地址）');

  return {
    appId: Boolean(appId),
    appKey: Boolean(appKey),
    accessSecret: Boolean(accessSecret),
    redirectUri,
    redirectIsLocalOnly: redirectUri ? isLocalRedirect(redirectUri) : false,
    ready: missing.length === 0,
    missing,
  };
}

export function authorizeUrl(config: OAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('app_id', config.appId);
  url.searchParams.set('response_type', 'code');
  // 知乎当前不回传 state，带上只是为了将来支持时不改代码
  url.searchParams.set('state', state);
  return url.toString();
}

/** 从回调 query 里取授权码，兼容两种参数名 */
export function pickAuthorizationCode(params: URLSearchParams): string | null {
  return params.get('authorization_code') || params.get('code') || null;
}

export async function exchangeCode(
  config: OAuthConfig,
  code: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const form = new URLSearchParams();
  form.set('app_id', config.appId);
  form.set('app_key', config.appKey);
  form.set('grant_type', 'authorization_code');
  form.set('redirect_uri', config.redirectUri);
  form.set('code', code);

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    timeoutMs: 20000,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`换取 access_token 失败：HTTP ${res.status} ${text.slice(0, 200)}`);
  }

  const data = JSON.parse(text) as {
    access_token?: string;
    expires_in?: number;
    code?: number;
    data?: string;
  };

  // 业务字段 code:20000 是成功，不要误判为错误；以 access_token 是否存在为准
  if (!data.access_token) {
    throw new Error(`token 响应缺少 access_token：${JSON.stringify(data).slice(0, 300)}`);
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
  };
}
