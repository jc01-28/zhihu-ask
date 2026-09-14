'use client';

import { authLoginUrl } from '@/front/api-client';
import type { AuthErrorCode, AuthSessionResponse } from '@/shared/contract';

/** 授权结果 → 文案。键必须覆盖 `AuthErrorCode` 全集，漏一个 tsc 就会报错 */
const AUTH_NOTICE: Record<AuthErrorCode | 'success', { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  success: { tone: 'ok', text: '授权成功，正在进入功能区……' },
  required: { tone: 'warn', text: '需要授权知乎账号才能继续。' },
  unconfigured: { tone: 'error', text: '服务端未配置知乎授权，请联系部署者补齐凭证。' },
  code_missing: { tone: 'error', text: '授权回调里没有授权码，请重新发起授权。' },
  state_missing: {
    tone: 'error',
    text: '授权回调缺少 state 参数（知乎未回传）。当前为严格校验模式，请重新授权。',
  },
  state_mismatch: {
    tone: 'error',
    text: '授权校验失败：state 与本次会话不匹配，链接可能已过期或被篡改，请重新授权。',
  },
  token_type_unsupported: { tone: 'error', text: '知乎返回了不支持的令牌类型，请重新授权。' },
  exchange_failed: {
    tone: 'error',
    text: '换取访问令牌失败（凭证错误、授权码过期或网络问题），请稍后重试。',
  },
};

const TONE_CLASS = {
  ok: 'border-brand/30 bg-brand-soft text-brand',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
} as const;

const ABILITIES = [
  { title: '理解你的处境', desc: '把一段口语化的问题，结构化成现状、目标、变化与约束。' },
  { title: '核验内容证据', desc: '每条「他经历过 X」都必须能逐字回溯到原文，否则不说。' },
  { title: '推荐相关人物', desc: '找到经历对得上的人，而不是最会写这个话题的人。' },
];

export function AuthPanel({
  session,
  authParam,
}: {
  session: AuthSessionResponse;
  authParam: string | null;
}) {
  const notice = authParam && authParam in AUTH_NOTICE
    ? AUTH_NOTICE[authParam as AuthErrorCode | 'success']
    : null;

  // 服务端凭证没配齐：这时点授权也没用，直接说清楚缺什么
  const unconfigured = !session.configured;

  return (
    <section className="mx-auto max-w-xl px-5 py-14">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-[18px] font-medium text-white">
          问
        </div>
        <h1 className="mt-4 text-[20px] font-medium tracking-tight text-ink-900">
          从一个问题开始，找到领域内值得问的人
        </h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-ink-500">
          在专业领域中，找到真正做过、研究过或长期关注某个领域的人。
        </p>
      </div>

      {notice ? (
        <p
          role="alert"
          className={`mt-6 rounded-lg border px-3 py-2 text-[12px] leading-5 ${TONE_CLASS[notice.tone]}`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="mt-6 rounded-xl border border-black/10 bg-white p-5">
        <h2 className="text-[12px] font-medium text-ink-500">产品能力</h2>
        <dl className="mt-3 space-y-3">
          {ABILITIES.map((item) => (
            <div key={item.title}>
              <dt className="text-[13px] font-medium text-ink-900">{item.title}</dt>
              <dd className="mt-0.5 text-[12px] leading-5 text-ink-500">{item.desc}</dd>
            </div>
          ))}
        </dl>
      </div>

      {unconfigured ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] leading-5 text-amber-800">
          <span className="font-medium">服务端未配置知乎授权。</span>
          <br />
          <span className="opacity-80">
            三项凭证在知乎开放平台获取：App ID / App Key 一起发放，Access Secret 在
            developer.zhihu.com/profile 生成；回调地址必须是公网 HTTPS 域名。
            <br />
            具体缺什么请查 <code className="font-mono">GET /api/health</code> ——
            部署诊断信息刻意**不放在 session 接口里**，那个接口由前端契约严格校验。
          </span>
        </div>
      ) : null}

      <div className="mt-6">
        <a
          href={authLoginUrl}
          aria-disabled={unconfigured}
          className={`block rounded-lg px-4 py-2.5 text-center text-[13px] font-medium text-white ${
            unconfigured ? 'pointer-events-none bg-black/20' : 'bg-brand hover:opacity-90'
          }`}
        >
          使用知乎账号授权
        </a>
        <p className="mt-3 text-[11px] leading-5 text-ink-300">
          授权凭证（access token）全程加密保存在服务端 HttpOnly Cookie 里，
          浏览器脚本读不到、也不会出现在前端日志中。我们只会用它读取你的公开资料与关注列表。
        </p>
      </div>
    </section>
  );
}
