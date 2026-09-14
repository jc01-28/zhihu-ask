'use client';

import { useCallback, useEffect, useState } from 'react';
import { RecommendationCard } from '@/front/components/RecommendationCard';
import { ask as askApi, fetchOAuthStatus, oauthAuthorizeUrl } from '@/front/api-client';
import type { AskResult, OAuthStatusResponse } from '@/shared/contract';

const EXAMPLES = [
  '我在大厂做产品 7 年，收到一家 50 人 AI 创业公司产品负责人的 offer，固定薪资降 20% 但有期权和管理机会，同时我在这里晋升已经放缓，该不该去？',
  '从传统软件产品转 AI 产品，我 35 岁还有机会吗？应该怎么走？',
  '第一次被要求带团队，该不该接管理岗？我担心自己变成只会开会的人。',
];

/**
 * 主页面。
 *
 * 前端只与 `@/front/api-client` 打交道，不直接 `fetch`、也不 import 任何 `@/back/*`。
 * 所有类型来自 `@/shared/contract` —— 后端改字段时这一层不受影响。
 */
export default function HomePage() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState('');
  const [oauth, setOauth] = useState<OAuthStatusResponse | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setOauth(await fetchOAuthStatus());
    } catch {
      setOauth(null);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function handleAsk() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await askApi({ question }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header>
        <h1 className="text-[22px] font-medium tracking-tight text-ink-900">知乎问人</h1>
        <p className="mt-1 text-[13px] text-ink-500">
          让 AI 知道，什么时候应该把问题还给人。
        </p>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span
          className={`rounded px-2 py-0.5 ${
            oauth?.authorized ? 'bg-brand-soft text-brand' : 'bg-black/5 text-ink-500'
          }`}
        >
          {oauth?.authorized
            ? oauth.profile?.name
              ? `已授权 · ${oauth.profile.name}`
              : '已授权知乎账号'
            : '未授权'}
        </span>
        {!oauth?.authorized ? (
          <a
            href={oauthAuthorizeUrl}
            className="rounded border border-black/10 px-2 py-0.5 text-ink-700 hover:border-brand hover:text-brand"
          >
            授权知乎账号
          </a>
        ) : null}
        <span className="text-ink-300">
          {oauth?.profile?.headline ?? oauth?.note}
        </span>
      </div>

      {/* 凭证没配齐时直接把「缺什么、去哪拿」摆出来，省得去翻日志 */}
      {oauth?.credentials && !oauth.credentials.ready ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
          <span className="font-medium">凭证未配齐：</span>
          {oauth.credentials.missing.join('；')}
          <br />
          <span className="opacity-80">
            用户数据接口需要双凭证：开放平台 Access Secret（Bearer）+ 用户 OAuth token（X-OAuth-Token）。
            Access Secret 在 developer.zhihu.com/profile 生成。
          </span>
        </div>
      ) : null}

      {oauth?.credentials?.redirectIsLocalOnly ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
          <span className="font-medium">回调地址是本地地址，知乎无法回调。</span>
          需要先部署到有公网 HTTPS 域名的环境，再把该地址登记到开放平台白名单。
        </div>
      ) : null}

      <section className="mt-8 rounded-xl border border-black/10 bg-white p-4">
        <label htmlFor="q" className="text-[12px] font-medium text-ink-500">
          用你自己的话描述问题，带上你的处境和纠结点
        </label>
        <textarea
          id="q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={5}
          placeholder="例如：我在大厂做产品 7 年，收到一家 50 人 AI 创业公司的 offer……"
          className="mt-2 w-full resize-y rounded-lg border border-black/10 p-3 text-[13px] leading-6 outline-none focus:border-brand"
        />

        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((example, index) => (
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

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleAsk}
            disabled={loading || question.trim().length < 6}
            className="rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? '正在分诊与检索…' : '开始问人'}
          </button>
          <span className="text-[12px] text-ink-300">
            先判断该不该问人，再去找「经历真的对得上」的人
          </span>
        </div>
      </section>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? <PipelineSkeleton /> : null}

      {result ? <ResultView result={result} /> : null}
    </main>
  );
}

function PipelineSkeleton() {
  const steps = ['01 分诊', '02 结构化', '03 混合召回', '04 经历抽取', '05 聚合创作者', '06 重排', '07 证据校验', '08 生成解释'];
  return (
    <section className="mt-8 rounded-xl border border-black/10 bg-white p-4">
      <h2 className="text-[12px] font-medium text-ink-500">流水线执行中</h2>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((step) => (
          <li key={step} className="rounded border border-black/5 bg-black/[0.02] px-2 py-1.5 text-[11px] text-ink-500">
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResultView({ result }: { result: AskResult }) {
  const routeLabel: Record<string, string> = {
    content: '公开内容已足够 —— 别问人',
    ai: 'AI 可以直接回答 —— 别问人',
    human: '需要真人经历',
  };

  return (
    <section className="mt-8 space-y-5">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-[12px] ${
              result.route === 'human' ? 'bg-brand-soft text-brand' : 'bg-black/5 text-ink-700'
            }`}
          >
            {routeLabel[result.route] ?? result.route}
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

        <PipelineBoard trace={result.trace} runId={result.runId} />
      </div>

      {result.contentOnly.length ? (
        <div className="space-y-3">
          <h2 className="text-[13px] font-medium text-ink-900">先看这些内容，可能不用打扰真人</h2>
          {result.contentOnly.map((item) => (
            <article key={item.url} className="rounded-xl border border-black/10 bg-white p-4">
              <a href={item.url} target="_blank" rel="noreferrer" className="text-[13px] text-brand hover:underline">
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

/** 步骤名 → 中文标签。顺序与 back/steps/index.ts 里的声明一致。 */
const STEP_LABELS: Record<string, string> = {
  triage: '分诊',
  profile: '结构化',
  recall: '混合召回',
  events: '经历抽取',
  candidates: '聚合创作者',
  ranked: '重排',
  verified: '证据校验',
  result: '生成卡片',
};

const STATUS_STYLE: Record<string, string> = {
  ok: 'border-brand/40 bg-brand-soft text-brand',
  cached: 'border-black/10 bg-black/[0.03] text-ink-500',
  skipped: 'border-amber-200 bg-amber-50 text-amber-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
};

const STATUS_TEXT: Record<string, string> = {
  ok: '执行',
  cached: '缓存',
  skipped: '跳过',
  failed: '失败',
};

/**
 * 流水线看板 —— 把「链路」直接摆在页面上。
 * 每一步的产物数量都来自框架的 trace，不是手写的展示数据。
 */
function PipelineBoard({
  trace,
  runId,
}: {
  trace: { step: string; status: string; ms: number; summary: string }[];
  runId: string;
}) {
  const totalMs = trace.reduce((sum, t) => sum + t.ms, 0);
  const cached = trace.filter((t) => t.status === 'cached').length;

  return (
    <section className="mt-4 border-t border-black/5 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium text-ink-500">
          链路（{trace.length} 步 · {totalMs}ms
          {cached ? ` · ${cached} 步命中缓存` : ''}）
        </h3>
        <span className="font-mono text-[10px] text-ink-300">{runId}</span>
      </div>

      <ol className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {trace.map((entry, index) => (
          <li
            key={entry.step}
            className={`rounded-lg border px-2.5 py-2 ${
              STATUS_STYLE[entry.status] ?? STATUS_STYLE.cached
            }`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-[11px] font-medium">
                {String(index + 1).padStart(2, '0')} {STEP_LABELS[entry.step] ?? entry.step}
              </span>
              <span className="text-[10px] opacity-70">
                {STATUS_TEXT[entry.status] ?? entry.status}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] opacity-80" title={entry.summary}>
              {entry.summary || '—'}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
