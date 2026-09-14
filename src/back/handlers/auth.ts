/**
 * 处理器 · 授权域
 *
 * 口径按前端 `local.md` 对齐（原来是 `/api/oauth/*`，现在是 `/api/auth/*`）：
 *
 *   GET  /api/auth/session          → configured / authenticated / user
 *   GET  /api/auth/zhihu/login      → 302 到知乎授权页
 *   GET  /api/auth/zhihu/callback   → 302 回 /app?auth=success|错误码
 *   GET  /api/auth/zhihu/logout     → 清会话后 302 回 /app
 *
 * 三个设计决定：
 *   1. **授权结果统一回落到 `/app?auth=<码>`**，而不是像旧实现那样返回 JSON。
 *      这样用户永远落在能操作的页面上，前端读一个查询参数就能显示对应提示。
 *   2. **不 import any next/*** —— cookie 以「指令」形式回给 route 层去下发，
 *      所以整条授权流程都能在纯 node 测试里断言。
 *   3. `state_mismatch` 无条件拒绝（真 CSRF 防护）；`state_missing` 默认放行，
 *      原因见下面 REQUIRE_STATE 的注释 —— 这是规格与平台现实的冲突点。
 */

import { createHash } from 'node:crypto';
import { createRuntime } from '@/back/adapters';
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  newState,
  openSession,
  sealSession,
} from '@/back/adapters/session';
import {
  authorizeUrl,
  exchangeCode,
  inspectCredentials,
  isPlaceholderRedirect,
  pickAuthorizationCode,
  readOAuthConfig,
} from '@/back/adapters/zhihu-oauth';
import type { MyProfile } from '@/back/framework/ports';
import type { AuthErrorCode, AuthSessionResponse, PublicUser } from '@/shared/contract';
import { ok, redirect, type CookieInstruction, type HandlerResult } from './types';

/** 功能首页。授权成功/失败都回这里，前端读 `?auth=` 决定显示什么 */
const APP_HOME = '/app';

function backToApp(outcome: 'success' | AuthErrorCode): HandlerResult {
  return redirect(`${APP_HOME}?auth=${outcome}`);
}

/**
 * 是否**强制**要求回调回传 state。
 *
 * ⚠️ 默认关闭 —— 知乎回调当前不保证回传 state（见 DEVELOPER.md §9），
 * 强制校验会让所有人都登不进去。
 *
 * 但要注意区分两件事：
 *   - `state_missing`（回调压根没带）：平台行为，默认放行
 *   - `state_mismatch`（带了但对不上）：**真正的可疑信号，无条件拒绝**
 * 所以关掉这个开关并不等于关掉 CSRF 防护。
 */
const REQUIRE_STATE = process.env.ZHIHU_REQUIRE_STATE === '1';

const isProd = () => process.env.NODE_ENV === 'production';

// ── 登录状态 ────────────────────────────────────────────────────────────

export interface AuthSessionInput {
  /** 会话 cookie 的原始值（route 层从 Cookie 里取出） */
  sessionToken: string | undefined;
}

/**
 * 把知乎公开资料转成契约要求的 `PublicUser`。
 *
 * ⚠️ 知乎 `/user` **没有正式 schema**，字段可能全空。全空时返回 `null`，
 * 而不是编一个「知乎用户」的名字 —— 界面上出现一个不存在的人比空着更糟。
 *
 * `avatarUrl` 必须由我们这边把住 https：契约里这个字段会被**直接塞进 `<img src>`**，
 * 放行 `http:` 或 `data:` 就是注入面（前端 schema 也会拒，但后端不该把责任推过去）。
 */
function toPublicUser(profile: MyProfile | null | undefined): PublicUser | null {
  const name = profile?.name?.trim() ?? '';
  const url = profile?.url?.trim() ?? '';
  if (!name && !url) return null;

  const avatar = profile?.avatarUrl?.trim() ?? '';
  return {
    // 稳定的公开标识：由主页地址（缺失时退化为昵称）派生。
    // 刻意**不用 OAuth UID**，也不用 access token 的任何部分 —— 那属于凭据材料。
    id: `u_${createHash('sha256').update(url || name).digest('hex').slice(0, 12)}`,
    displayName: name || '知乎用户',
    avatarUrl: avatar.startsWith('https://') ? avatar : null,
  };
}

/**
 * 前端的三分支逻辑完全由这个响应决定，不要在页面上自己拼状态：
 *   configured=false                       → 「服务端未配置知乎授权」
 *   configured=true && authenticated=false → 显示授权入口
 *   authenticated=true                     → 显示功能首页
 *
 * ⚠️ 前端用 zod `.strict()` 校验，**恰好这三个键**。
 * 所以「缺哪些凭证」「回调地址是否本地」这类**部署诊断信息不放在这里** ——
 * 那是运维视角，需要查就看 `GET /api/health`。
 */
export async function handleAuthSession(input: AuthSessionInput): Promise<HandlerResult> {
  const session = openSession(input.sessionToken);
  const report = inspectCredentials();

  // 「配齐了」不能只看环境变量是否存在：回调地址是占位符或本地地址时，
  // 点授权按钮**一定失败**。把它也算作未配置，前端因此可以放心地用
  // configured 一个布尔值决定按钮是否可点，而不会出现「按钮能点、点下去报错」。
  const redirectUri = report.redirectUri ?? '';
  const redirectUsable =
    Boolean(redirectUri) &&
    !report.redirectIsLocalOnly &&
    !isPlaceholderRedirect(redirectUri);

  const body: AuthSessionResponse = {
    configured: report.ready && redirectUsable,
    authenticated: Boolean(session),
    user: toPublicUser(session?.profile),
  };

  return ok(body);
}

// ── 发起授权 ────────────────────────────────────────────────────────────

export async function handleAuthLogin(): Promise<HandlerResult> {
  const config = readOAuthConfig();
  const report = inspectCredentials();

  if (!config || !report.ready) {
    console.warn('[auth] 授权未配置，缺：', report.missing.join('；'));
    return backToApp('unconfigured');
  }

  // 回调地址不可用是**平台限制**，不是代码问题：本地地址知乎永远回调不了
  if (report.redirectIsLocalOnly || isPlaceholderRedirect(config.redirectUri)) {
    console.warn(
      `[auth] 回调地址不可用：${config.redirectUri} —— ` +
        (report.redirectIsLocalOnly
          ? '本地地址，知乎无法回调（只能预览页面）'
          : '还是占位符，需要换成真实公网 HTTPS 域名并登记到开放平台白名单'),
    );
    return backToApp('unconfigured');
  }

  const state = newState();
  return redirect(authorizeUrl(config, state), [
    {
      name: STATE_COOKIE,
      value: state,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
        secure: isProd(),
      },
    },
  ]);
}

// ── 回调 ────────────────────────────────────────────────────────────────

export interface AuthCallbackInput {
  params: URLSearchParams;
  /** state cookie 的原始值 */
  stateCookie: string | undefined;
}

export async function handleAuthCallback(input: AuthCallbackInput): Promise<HandlerResult> {
  const code = pickAuthorizationCode(input.params);
  if (!code) {
    console.warn(
      '[auth] 回调没有授权码，收到的参数：',
      Object.fromEntries(input.params.entries()),
    );
    return backToApp('code_missing');
  }

  const config = readOAuthConfig();
  if (!config) return backToApp('unconfigured');

  const clearState: CookieInstruction = { name: STATE_COOKIE, value: '', remove: true };
  const returnedState = input.params.get('state');

  if (input.stateCookie) {
    if (!returnedState) {
      if (REQUIRE_STATE) {
        console.warn('[auth] 回调未回传 state，且已开启 ZHIHU_REQUIRE_STATE，拒绝本次登录');
        return redirect(`${APP_HOME}?auth=state_missing`, [clearState]);
      }
      // 知乎已知行为：不保证回传。放行，但留下日志痕迹便于排查。
      console.info('[auth] 回调未回传 state（知乎已知行为），放行本次登录');
    } else if (returnedState !== input.stateCookie) {
      // 带了 state 却对不上 —— 真可疑，无条件拒绝，不受 ZHIHU_REQUIRE_STATE 影响
      console.warn('[auth] state 不匹配，疑似 CSRF，拒绝登录');
      return redirect(`${APP_HOME}?auth=state_mismatch`, [clearState]);
    }
  }

  try {
    const { accessToken, expiresIn, tokenType } = await exchangeCode(config, code);

    if (tokenType && tokenType.toLowerCase() !== 'bearer') {
      console.warn(`[auth] 不支持的 token 类型：${tokenType}`);
      return redirect(`${APP_HOME}?auth=token_type_unsupported`, [clearState]);
    }

    // 顺手取一次用户资料随会话加密保存：状态查询就不用再打接口（省额度、降延迟）。
    // ⚠️ 知乎没有 `/user` 的正式 schema，读不到就是 null，不影响登录本身。
    let profile = null;
    try {
      const runtime = createRuntime({ getOAuthToken: async () => accessToken });
      profile = await runtime.source.myProfile();
    } catch (error) {
      console.warn('[auth] 读取用户资料失败（不影响登录）：', error);
    }

    const maxAge = Math.max(60, expiresIn - 60);

    return redirect(`${APP_HOME}?auth=success`, [
      {
        name: SESSION_COOKIE,
        value: sealSession({
          accessToken,
          expiresAt: Date.now() + maxAge * 1000,
          profile,
        }),
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge,
          secure: isProd(),
        },
      },
      clearState,
    ]);
  } catch (error) {
    console.error('[auth] 换取 token 失败：', error);
    return redirect(`${APP_HOME}?auth=exchange_failed`, [clearState]);
  }
}

// ── 退出 ────────────────────────────────────────────────────────────────

/**
 * 退出登录：清掉本地会话。
 * 注意知乎目前**没有提供 token 撤销接口**，所以只是本地登出，不涉及远端。
 */
export async function handleAuthLogout(): Promise<HandlerResult> {
  return redirect(`${APP_HOME}?auth=required`, [
    { name: SESSION_COOKIE, value: '', remove: true },
    { name: STATE_COOKIE, value: '', remove: true },
  ]);
}
