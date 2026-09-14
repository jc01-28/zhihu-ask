import AppHomePage from '@/front/pages/AppHomePage';

/**
 * 路由壳 —— 页面实现在 `src/front/pages/AppHomePage.tsx`。
 *
 * `/app` 同时是**授权门**与**功能首页**：
 * 未授权显示授权页，已授权显示两个功能入口（专业领域社交 / 问题找人）。
 */
export default function Page() {
  return <AppHomePage />;
}
