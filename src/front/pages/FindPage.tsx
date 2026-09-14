'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/front/components/AppHeader';
import { RecommendationCard } from '@/front/components/RecommendationCard';
import { ask, fetchAuthSession } from '@/front/api-client';
import type { AskResponse, AuthSessionResponse } from '@/shared/contract';

/** 规格规定的问题长度区间。后端 `handleAsk` 已按同一个口径校验 */
const MIN_CHARS = 4;
const MAX_CHARS = 300;

const EXAMPLE_QUESTIONS = [
  '我在大厂做产品 7 年，收到一家 50 人 AI 创业公司产品负责人的 offer，固定薪资降 20% 但有期权和管理机会，同时我在这里晋升已经放缓，该不该去？',
  '从传统软件产品转 AI 产品，我 35 岁还有机会吗？应该怎么走？',
  '第一次被要求带团队，该不该接管理岗？我担心自己变成只会开会的人。',
];

const PHASE_SKELETON = [
  '读取授权上下文',
  '理解问题',
  '检索经历',
  '核验证据',
  '生成卡片',
  '保存结果',
];

/**
 * 页面六 · 问题找人（路由 `/app/find`）
 *
 * 这是当前唯一已跑通的功能，核心链路整体复用 `POST /api/agent/search`。
 *
 * 待接入（已列入 backlog，不是遗漏）：
 *   · 热榜选题 —— 后端 `hotList()` 端口已有，缺一个 `GET /api/agent/hot` 出口
 *   · 停止搜索 —— 需要后端支持取消（`AbortSignal` 已透传到 fetch，缺流水线侧响应）
 *   · 三栏对比弹窗 —— 需要 `POST /api/compare`（在线跑三组会 3 倍消耗检索额度，要加护栏）
 *   · 刷新恢复 —— 需要 `GET /api/agent/runs/:runId`
 */
export default function FindPage() {
  const [question, setQuestion] = useState(EXAMPLE_QUESTIONS[0]);
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState('');

  // 从首页带过来的问题（/app/find?q=...）。用 window.location 读，避免 useSearchParams
  // 带来的 Suspense 边界要求。
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get('q');
    if (preset) setQuestion(preset);
  }, []);

  useEffect(() => {
    fetchAuthSession()
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await ask({ question }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [question]);

  const trimmed = question.trim();
  const tooShort = trimmed.length < MIN_CHARS;
  const tooLong = trimmed.length > MAX_CHARS;

  return (
    <>
      <AppHeader session={session} />

      <main className="mx-auto max-w-3xl px-5 py-8">
        <a href="/app" className="text-[12px] text-ink-300 hover:text-brand">
          ← 返回功能首页
        </a>
        <h1 className="mt-3 text-[18px] font-medium tracking-tight text-ink-900">问题找人</h1>
        <p className="mt-1 text-[12px] text-ink-500">
          先判断该不该问人，再去找「经历真的对得上」的人。
        </p>

        <section className="mt-5 rounded-xl border border-black/10 bg-white p-4">
          <label htmlFor="q" className="text-[12px] font-medium text-ink-500">
            用你自己的话描述问题，带上你的处境和纠结点
          </label>
          <textarea
            id="q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={4}
            maxLength={MAX_CHARS}
            placeholder="例如：我在大厂做产品 7 年，收到一家 50 人 AI 创业公司的 offer……"
            className="mt-2 w-full resize-y rounded-lg border border-black/10 p-3 text-[13px] leading-6 outline-none focus:border-brand"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((example, index) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="rounded border border-black/10 px-2 py-1 text-[11px] text-ink-500 hover:border-brand hover:text-brand"
                >
                  示例 {index + 1}
                </button>
              ))}
            </div>
            <span
              className={`text-[11px] ${
                tooLong ? 'text-red-600' : 'text-ink-300'
              }`}
            >
              {trimmed.length} / {MAX_CHARS}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSearch}
              disabled={loading || tooShort || tooLong}
              className="rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? '正在找人…' : '开始找人'}
            </button>
            {tooShort ? (
              <span className="text-[12px] text-ink-300">请至少输入 {MIN_CHARS} 个字</span>
            ) : (
              <span className="text-[12px] text-ink-300">
                检索 → 抽取亲历 → 逐字核验证据 → 生成卡片
              </span>
            )}
          </div>
        </section>

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700"
          >
            {error}
          </p>
        ) : null}

        {loading ? <PhaseSkeleton /> : null}
        {result ? <ResultView result={result} /> : null}
      </main>
    </>
  );
}

/** 加载态：先把六个阶段摆出来，让等待可解释 */
function PhaseSkeleton() {
  return (
    <section className="mt-6 rounded-xl border border-black/10 bg-white p-4">
      <h2 className="text-[12px] font-medium text-ink-500">Agent 执行中</h2>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PHASE_SKELETON.map((label, index) => (
          <li
            key={label}
            className="rounded border border-black/5 bg-black/[0.02] px-2 py-1.5 text-[11px] text-ink-500"
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>
    </section>
  );
}

const ROUTE_LABEL: Record<string, string> = {
  content: '公开内容已足够 —— 别问人',
  ai: 'AI 可以直接回答 —— 别问人',
  human: '需要真人经历',
};

function ResultView({ result }: { result: AskResponse }) {
  return (
    <section className="mt-6 space-y-5">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-[12px] ${
              result.route === 'human' ? 'bg-brand-soft text-brand' : 'bg-black/5 text-ink-700'
            }`}
          >
            {ROUTE_LABEL[result.route] ?? result.route}
          </span>
          <span className="text-[12px] text-ink-500">{result.triageReason}</span>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
          <Metric label="召回内容" value={result.metrics.hitCount} />
          <Metric label="经历事件" value={result.metrics.eventCount} />
          <Metric label="候选创作者" value={result.metrics.candidateCount} />
          <Metric
            label="证据覆盖率"
            value={`${(result.metrics.evidenceCoverage * 100).toFixed(0)}%`}
          />
        </dl>

        <PhaseBoard phases={result.phases} />
        <TraceBoard trace={result.trace} runId={result.runId} />
      </div>

      {result.contentOnly.length ? (
        <div className="space-y-3">
          <h2 className="text-[13px] font-medium text-ink-900">
            先看这些内容，可能不用打扰真人
          </h2>
          {result.contentOnly.map((item) => (
            <article key={item.url} className="rounded-xl border border-black/10 bg-white p-4">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-brand hover:underline"
              >
                {item.title || '查看原文'}
              </a>
              <p className="mt-1 text-[12px] leading-5 text-ink-700">{item.quote}</p>
            </article>
          ))}
        </div>
      ) : null}

      {result.recommendations.length ? (
        <div className="space-y-4">
          <h2 className="text-[13px] font-medium text-ink-900">
            找到 {result.recommendations.length} 位经历对得上的人
          </h2>
          {result.recommendations.map((rec, index) => (
            <RecommendationCard key={rec.candidate.id} recommendation={rec} index={index} />
          ))}
        </div>
      ) : null}

      {result.route === 'human' && result.recommendations.length === 0 ? (
        <p className="rounded-xl border border-black/10 bg-white p-4 text-[13px] text-ink-500">
          这轮没有找到证据充分的候选人 —— 按信心护栏，宁可不推，也不编一个理由给你。
        </p>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-black/[0.03] px-3 py-2">
      <dt className="text-[11px] text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium text-ink-900">{value}</dd>
    </div>
  );
}

const PHASE_STYLE: Record<string, string> = {
  ok: 'border-brand/40 bg-brand-soft text-brand',
  cached: 'border-black/10 bg-black/[0.03] text-ink-500',
  running: 'border-brand/40 bg-brand-soft text-brand',
  skipped: 'border-amber-200 bg-amber-50 text-amber-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  pending: 'border-black/10 bg-white text-ink-300',
};

/** 六阶段 —— 产品叙事口径，前端直接渲染，不要自己聚合 trace */
function PhaseBoard({ phases }: { phases: AskResponse['phases'] }) {
  return (
    <section className="mt-4 border-t border-black/5 pt-3">
      <h3 className="text-[12px] font-medium text-ink-500">执行进度（6 阶段）</h3>
      <ol className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {phases.map((phase, index) => (
          <li
            key={phase.id}
            className={`rounded-lg border px-2.5 py-2 ${
              PHASE_STYLE[phase.status] ?? PHASE_STYLE.pending
            }`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-[11px] font-medium">
                {index + 1}. {phase.label}
              </span>
              <span className="text-[10px] opacity-70">
                {phase.ms > 0 ? `${phase.ms}ms` : ''}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] opacity-80" title={phase.summary}>
              {phase.summary || '—'}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 八步链路 —— 工程口径，折叠起来。演示时展开它讲"AI 到底做了什么" */
function TraceBoard({
  trace,
  runId,
}: {
  trace: AskResponse['trace'];
  runId: string;
}) {
  const totalMs = trace.reduce((sum, t) => sum + t.ms, 0);
  const cached = trace.filter((t) => t.status === 'cached').length;

  return (
    <details className="mt-3 border-t border-black/5 pt-3">
      <summary className="cursor-pointer text-[12px] font-medium text-ink-500">
        链路明细（{trace.length} 步 · {totalMs}ms
        {cached ? ` · ${cached} 步命中缓存` : ''}）
      </summary>
      <ol className="mt-2 space-y-1">
        {trace.map((entry, index) => (
          <li key={entry.step} className="flex items-baseline gap-2 text-[11px]">
            <span className="w-4 shrink-0 text-ink-300">{index + 1}</span>
            <span className="w-16 shrink-0 font-mono text-ink-700">{entry.step}</span>
            <span className="w-14 shrink-0 text-ink-300">{entry.status}</span>
            <span className="flex-1 truncate text-ink-500" title={entry.summary}>
              {entry.summary || '—'}
            </span>
            <span className="shrink-0 text-ink-300">{entry.ms}ms</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 font-mono text-[10px] text-ink-300">runId: {runId}</p>
    </details>
  );
}
