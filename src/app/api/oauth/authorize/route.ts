import { NextResponse } from 'next/server';
import {
  authorizeUrl,
  inspectCredentials,
  isPlaceholderRedirect,
  readOAuthConfig,
} from '@/back/adapters/zhihu-oauth';
import { newState, STATE_COOKIE } from '@/back/adapters/session';

export const dynamic = 'force-dynamic';

/**
 * 跳转到知乎授权页。
 *
 * 两个硬约束（都不是代码问题，是平台限制）：
 *   1. redirect_uri 必须与开放平台登记的地址**逐字符一致**；
 *   2. 必须是**公网 HTTPS**，localhost / 127.0.0.1 只能预览页面、无法完成登录。
 */
export async function GET() {
  const config = readOAuthConfig();
  const report = inspectCredentials();

  if (!config) {
    return NextResponse.json(
      {
        error: 'OAuth 凭证不完整，无法发起授权',
        missing: report.missing,
        where: {
          appId: '知乎开放平台申请',
          appKey: '知乎开放平台申请（与 App ID 一起发放）',
          accessSecret: 'https://developer.zhihu.com/profile 生成',
        },
      },
      { status: 500 },
    );
  }

  if (report.redirectIsLocalOnly || isPlaceholderRedirect(config.redirectUri)) {
    const isLocal = report.redirectIsLocalOnly;
    return NextResponse.json(
      {
        error: isLocal ? '回调地址是本地地址，知乎无法回调' : '回调地址还是占位符，尚未换成真实域名',
        redirectUri: config.redirectUri,
        why: isLocal
          ? '知乎不接受 localhost / 127.0.0.1 作为回调地址，本地只能预览页面'
          : '占位符域名不会被知乎登记，跳过去也会失败',
        how: [
          '把应用部署到有公网 HTTPS 域名的平台（Vercel / Cloudflare / Sealos 等）',
          '把 ZHIHU_REDIRECT_URI 改成 https://<域名>/api/oauth/callback',
          '到知乎开放平台把这个地址登记进回调白名单（必须逐字符一致）',
        ],
      },
      { status: 400 },
    );
  }

  const state = newState();
  const response = NextResponse.redirect(authorizeUrl(config, state));

  // 知乎实测不回传 state；照常下发，回调时能校验就校验
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
