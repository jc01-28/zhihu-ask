'use client';

/**
 * 页面一 · 项目推荐页（路由 `/`）
 *
 * 定位：项目的开始页，**不执行任何业务操作**，也没有登录状态。
 * 规格里明确写了「该页面不需要业务 API」—— 所以这里只消费两个公开环境变量。
 *
 * ⚠️ 环境变量必须用 `NEXT_PUBLIC_*` 前缀：规格里写的是 `VITE_GITHUB_URL`，
 * 那是 Vite 的约定，在 Next.js 里**不会被注入到浏览器**。
 */

/** 静态引用才会被构建期内联，不要用变量拼 key */
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL || 'https://github.com/jc01-28/zhihu-ask';
const LIVE_SITE_URL = process.env.NEXT_PUBLIC_LIVE_SITE_URL || '/app';

const HIGHLIGHTS = [
  { title: '领域聚类', desc: '把分散的内容与创作者，归拢成可探索的专业领域与议题。' },
  { title: '人物证据', desc: '每条推荐理由都必须能逐字回溯到原文，找不到证据就不说。' },
  { title: '专业交流', desc: '找到人之后，直接进入与本人或他的专业 Agent 的对话。' },
  { title: '私有知识库 Agent', desc: '每个人的经验都可以成为只对本人 Agent 可见的知识库。' },
];

const CAPABILITIES = [
  { title: '专业领域探索', desc: '按领域、议题、人物三层，看清一个方向上有谁在真正做事。' },
  { title: '基于问题找人', desc: '描述你正在面对的具体问题，找到经历过同样处境的人。' },
  { title: '与专业人士交流', desc: '不只看内容，还能继续把问题问下去。' },
];

export default function ProjectIntroPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <header className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-[18px] font-medium text-white">
          问
        </div>
        <h1 className="mt-4 text-[26px] font-medium tracking-tight text-ink-900">知乎问人</h1>
        <p className="mx-auto mt-3 max-w-xl text-[14px] leading-6 text-ink-700">
          在专业领域中，找到真正做过、研究过或长期关注某个领域的人。
        </p>
      </header>

      <section className="mt-10 rounded-xl border border-black/10 bg-white p-5">
        <h2 className="text-[12px] font-medium text-ink-500">项目简介</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <div key={item.title} className="rounded-lg bg-black/[0.03] px-3 py-3">
              <h3 className="text-[13px] font-medium text-ink-900">{item.title}</h3>
              <p className="mt-1 text-[12px] leading-5 text-ink-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-black/10 bg-white p-5">
        <h2 className="text-[12px] font-medium text-ink-500">产品特点</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="rounded-lg border border-black/5 px-3 py-3">
              <dt className="text-[13px] font-medium text-ink-900">{item.title}</dt>
              <dd className="mt-1 text-[12px] leading-5 text-ink-500">{item.desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-black/10 px-5 py-2.5 text-center text-[13px] font-medium text-ink-700 transition hover:border-brand hover:text-brand"
        >
          查看 GitHub 项目
        </a>
        <a
          href={LIVE_SITE_URL}
          className="rounded-lg bg-brand px-5 py-2.5 text-center text-[13px] font-medium text-white transition hover:opacity-90"
        >
          进入在线网站
        </a>
      </div>

      <p className="mt-6 text-center text-[11px] leading-5 text-ink-300">
        推荐理由全部可回溯到知乎原文；找不到证据时宁可不推，也不编一个理由。
      </p>
    </main>
  );
}
