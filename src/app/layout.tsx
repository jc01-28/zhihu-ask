import type { Metadata } from 'next';

/**
 * 根布局。
 *
 * ⚠️ 这里是 Next 侧**唯一剩下的页面骨架** —— 页面本身已由 `src/frontend`（Vite SPA）
 * 提供，Next 只负责 `/api/**`。非 API 请求经 `next.config.mjs` 的 fallback rewrite
 * 落到 `public/spa/index.html`，那条路径**不经过这个布局**（`public/` 下是纯静态资源，
 * 直接 serve，不会被 `<html>` 再包一层）。
 *
 * 保留这个文件只是因为 Next 要求根路由必须有 layout。
 * 别往这里加全局样式或页面组件 —— 那会让人误以为 Next 还在承担界面职责。
 */
export const metadata: Metadata = {
  title: '知域 · 找到真正经历过的人',
  description: '从知乎真实内容中寻找有相似经历、值得进一步交流的人。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
