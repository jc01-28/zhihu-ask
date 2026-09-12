import { NextResponse } from 'next/server';
import { authorizeUrl, readOAuthConfig } from '@/adapters/zhihu-oauth';
import { newState, STATE_COOKIE } from '@/adapters/session';

export const dynamic = 'force-dynamic';

/**
 * 跳转到知乎授权页。
 * 注意：redirect_uri 必须与开放平台登记的地址完全一致，且必须是公网 HTTPS。
 * localhost 只能预览页面，无法完成真实登录。
 */
export async function GET() {
  const config = readOAuthConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: 'OAuth 未配置',
        need: ['ZHIHU_APP_ID', 'ZHIHU_APP_KEY', 'ZHIHU_REDIRECT_URI'],
        apply: '向 product-platform@zhihu.com 申请 app_id / app_key',
      },
      { status: 500 },
    );
  }

  const state = newState();
  const response = NextResponse.redirect(authorizeUrl(config, state));

  // 知乎当前不保证回传 state；这里照常下发，回调时能校验就校验
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
