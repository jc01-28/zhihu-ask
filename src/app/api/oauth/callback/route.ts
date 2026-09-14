import { NextRequest, NextResponse } from 'next/server';
import { createRuntime } from '@/back/adapters';
import { exchangeCode, pickAuthorizationCode, readOAuthConfig } from '@/back/adapters/zhihu-oauth';
import { SESSION_COOKIE, STATE_COOKIE, sealSession } from '@/back/adapters/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OAuth 回调。
 * 官方实测要点（见 README「OAuth 已知偏差」）：
 *   - 回调参数是 authorization_code，老文档写 code，两个都要接；
 *   - 换 token 的表单字段仍然叫 code；
 *   - 回调可能不回传 state，所以 state 只能「有就校验」；
 *   - token 响应里 code:20000 是成功，不能当错误。
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = pickAuthorizationCode(params);

  if (!code) {
    return NextResponse.json(
      {
        error: '回调里没有授权码',
        hint: '知乎回调用的是 authorization_code 参数；若为空请检查 redirect_uri 是否与登记值一致',
        received: Object.fromEntries(params.entries()),
      },
      { status: 400 },
    );
  }

  const config = readOAuthConfig();
  if (!config) {
    return NextResponse.json({ error: 'OAuth 未配置，无法换取 token' }, { status: 500 });
  }

  // state 校验：官方回调目前不保证回传，缺失时放行但在响应里标注
  const returnedState = params.get('state');
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  const stateChecked = Boolean(returnedState && cookieState && returnedState === cookieState);

  try {
    const { accessToken, expiresIn } = await exchangeCode(config, code);

    // 顺手取一次用户资料存进会话：状态查询就不用再打接口了。
    // ⚠️ 知乎没有 `/user` 的正式 schema，读不到就是 null，不影响登录本身。
    let profile = null;
    try {
      const runtime = createRuntime({ getOAuthToken: async () => accessToken });
      profile = await runtime.source.myProfile();
    } catch (error) {
      console.warn('[oauth/callback] 读取用户资料失败（不影响登录）：', error);
    }

    const response = NextResponse.redirect(
      new URL(`/?authorized=1&stateChecked=${stateChecked ? '1' : '0'}`, request.url),
    );

    response.cookies.set(
      SESSION_COOKIE,
      sealSession({
        accessToken,
        expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
        profile,
      }),
      {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.max(60, expiresIn - 60),
        secure: process.env.NODE_ENV === 'production',
      },
    );

    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : '换取 token 失败';
    console.error('[oauth/callback]', error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
