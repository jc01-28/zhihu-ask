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

const AUTHORIZE_URL = 'https://openapi.zhihu.com/authorize';
const TOKEN_URL = 'https://openapi.zhihu.com/access_token';

export interface OAuthConfig {
  appId: string;
  appKey: string;
  redirectUri: string;
}

export function readOAuthConfig(): OAuthConfig | null {
  const appId = process.env.ZHIHU_APP_ID;
  const appKey = process.env.ZHIHU_APP_KEY;
  const redirectUri = process.env.ZHIHU_REDIRECT_URI;
  if (!appId || !appKey || !redirectUri) return null;
  return { appId, appKey, redirectUri };
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

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
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
