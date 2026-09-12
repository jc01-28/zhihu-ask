import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '知乎问人 · 让 AI 知道什么时候应该把问题还给人',
  description:
    '不是 AI 红娘，也不是新的付费咨询系统，而是一层建立在知乎内容、创作者与现有咨询能力之间的问题智能路由层。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
