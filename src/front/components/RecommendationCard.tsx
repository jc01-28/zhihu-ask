'use client';

import { imageProxyUrl } from '@/front/api-client';
import type { Recommendation } from '@/shared/contract';

/**
 * 推荐卡片。字段结构直接对应计划书 §4.3。
 * 注意「不适合回答」是必显项，不是彩蛋 —— 这是产品的诚实性设计。
 */
export function RecommendationCard({
  recommendation,
  index,
}: {
  recommendation: Recommendation;
  index: number;
}) {
  const { candidate } = recommendation;

  return (
    <article className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-start gap-3">
        {candidate.authorAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageProxyUrl(candidate.authorAvatar)}
            alt=""
            className="h-11 w-11 rounded-full bg-black/5 object-cover"
          />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-sm font-medium text-brand">
            {candidate.authorName.slice(0, 1)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-medium text-ink-900">{candidate.authorName}</h3>
            {candidate.authorBadgeText ? (
              <span className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] text-ink-700">
                {candidate.authorBadgeText}
              </span>
            ) : null}
            {candidate.alreadyFollowed ? (
              <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand">
                你已关注
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-500">
            {recommendation.role}
            {candidate.headline ? ` · ${candidate.headline}` : ''}
          </p>
        </div>

        <div className="text-right text-[11px] text-ink-300">
          <div>匹配 {Math.round(candidate.score * 100)}</div>
          <div>{candidate.sourceCount} 条内容证据</div>
        </div>
      </header>

      {recommendation.whyRecommended ? (
        <section className="mt-4">
          <h4 className="text-[12px] font-medium text-ink-500">为什么推荐</h4>
          <p className="mt-1 text-[13px] leading-6 text-ink-900">{recommendation.whyRecommended}</p>
        </section>
      ) : null}

      {recommendation.evidence.length ? (
        <section className="mt-4">
          <h4 className="text-[12px] font-medium text-ink-500">内容证据</h4>
          <ul className="mt-2 space-y-2">
            {recommendation.evidence.map((item) => (
              <li key={item.url + item.quote.slice(0, 12)} className="rounded-lg bg-black/[0.03] p-3">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] text-brand hover:underline"
                >
                  {item.title || '查看原文'}
                </a>
                <blockquote className="mt-1 border-l-2 border-brand/30 pl-2 text-[12px] leading-5 text-ink-700">
                  {item.quote}
                </blockquote>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {recommendation.relevantToYou.length ? (
          <section>
            <h4 className="text-[12px] font-medium text-ink-500">与你最相关</h4>
            <ul className="mt-1 space-y-1 text-[12px] text-ink-700">
              {recommendation.relevantToYou.map((line) => (
                <li key={line}>· {line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {recommendation.notGoodAt.length ? (
          <section>
            <h4 className="text-[12px] font-medium text-ink-500">不适合回答</h4>
            <ul className="mt-1 space-y-1 text-[12px] text-ink-500">
              {recommendation.notGoodAt.map((line) => (
                <li key={line}>· {line}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <footer className="mt-4 flex flex-wrap gap-2">
        {recommendation.nextActions
          .filter((action) => action.href)
          .map((action) => (
            <a
              key={action.label}
              href={action.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-black/10 px-3 py-1.5 text-[12px] text-ink-700 hover:border-brand hover:text-brand"
            >
              {action.label}
            </a>
          ))}
      </footer>

      <details className="mt-3 text-[11px] text-ink-300">
        <summary className="cursor-pointer">打分明细</summary>
        <ul className="mt-1 space-y-0.5">
          {Object.entries(candidate.scoreBreakdown).map(([key, value]) => (
            <li key={key}>
              {key}: {value.toFixed(3)}
            </li>
          ))}
        </ul>
      </details>
      <span className="sr-only">{index + 1}</span>
    </article>
  );
}
