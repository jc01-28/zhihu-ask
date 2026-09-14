'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/front/components/AppHeader';
import { AuthPanel } from '@/front/components/AuthPanel';
import { fetchAuthSession } from '@/front/api-client';
import type { AuthSessionResponse } from '@/shared/contract';

/** 规格里列的推荐领域（当前是静态展示，领域接口接通后改为 /api/fields/featured） */
const RECOMMENDED_FIELDS = [
  'Agent 开发',
  '金融科技',
  '数据建模',
  '产品与创业',
  '人工智能应用',
  '独立开发',
  '科研与工程实践',
];

const EXAMPLE_QUESTIONS = [
  '我在大厂做产品 7 年，收到一家 50 人 AI 创业公司产品负责人的 offer，固定薪资降 20% 但有期权和管理机会，同时我在这里晋升已经放缓，该不该去？',
  '从传统软件产品转 AI 产品，我 35 岁还有机会吗？应该怎么走？',
];

/**
 * 页面三 · 功能首页（路由 `/app`）
 *
 * 它同时是**授权门**：未授权时显示授权页，已授权时显示两个功能入口。
 * 三分支完全由 `GET /api/auth/session` 决定，页面上不拼任何状态。
 */
export default function AppHomePage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [authParam, setAuthParam] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState(EXAMPLE_QUESTIONS[0]);

  useEffect(() => {
    // ?auth= 表示「刚刚那次跳转的结果」，是**一次性**的，不是持续状态：
    // 读出来存进 state，然后把查询参数从地址栏清掉，避免刷新时反复弹提示。
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('auth');
    if (outcome) {
      setAuthParam(outcome);
      window.history.replaceState(null, '', '/app');
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setSession(await fetchAuthSession());
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取登录状态失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="mx-auto max-w-xl px-5 py-12 text-[13px] text-red-700">
        读取登录状态失败：{error}
      </p>
    );
  }

  if (!session) {
    return (
      <p className="mx-auto max-w-xl px-5 py-12 text-[13px] text-ink-500">正在读取登录状态…</p>
    );
  }

  // 未授权 → 授权页
  if (!session.authenticated) {
    return (
      <>
        <AppHeader session={session} />
        <AuthPanel session={session} authParam={authParam} />
      </>
    );
  }

  // 已授权 → 功能首页
  return (
    <>
      <AppHeader session={session} />

      <main className="mx-auto max-w-4xl px-5 py-8">
        {authParam === 'success' ? (
          <p className="mb-5 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-[12px] text-brand">
            授权成功，你现在可以读取自己的关注列表来补齐创作者主页链接了。
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {/* 板块一：专业领域社交 */}
          <section className="flex flex-col rounded-xl border border-black/10 bg-white p-5">
            <h2 className="text-[15px] font-medium text-ink-900">专业领域社交</h2>
            <p className="mt-1 text-[12px] leading-5 text-ink-500">
              探索专业领域、细分议题，以及正在实践和研究这些问题的人。
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {RECOMMENDED_FIELDS.map((field) => (
                <span
                  key={field}
                  className="rounded border border-black/10 px-2 py-0.5 text-[11px] text-ink-500"
                >
                  {field}
                </span>
              ))}
            </div>

            <a
              href="/app/fields"
              className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-center text-[13px] font-medium text-white hover:opacity-90"
            >
              进入专业领域
            </a>
          </section>

          {/* 板块二：问题找人 */}
          <section className="flex flex-col rounded-xl border border-black/10 bg-white p-5">
            <h2 className="text-[15px] font-medium text-ink-900">问题找人</h2>
            <p className="mt-1 text-[12px] leading-5 text-ink-500">
              描述你正在面对的具体问题，找到真正经历过或研究过相关问题的人。
            </p>

            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              aria-label="描述你的问题"
              className="mt-3 w-full resize-y rounded-lg border border-black/10 p-2.5 text-[12px] leading-5 outline-none focus:border-brand"
            />

            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLE_QUESTIONS.map((example, index) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="rounded border border-black/10 px-2 py-0.5 text-[11px] text-ink-500 hover:border-brand hover:text-brand"
                >
                  示例 {index + 1}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={question.trim().length < 4}
              onClick={() => router.push(`/app/find?q=${encodeURIComponent(question)}`)}
              className="mt-4 rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              开始找人
            </button>
          </section>
        </div>
      </main>
    </>
  );
}
