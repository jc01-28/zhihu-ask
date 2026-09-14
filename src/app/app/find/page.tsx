import FindPage from '@/front/pages/FindPage';

/**
 * 路由壳 —— 页面实现在 `src/front/pages/FindPage.tsx`。
 *
 * `/app/find` 是「问题找人」（前端规格里的页面六），复用 8 步核心链路，
 * 通过 `POST /api/agent/search` 取结果，并用 `AskResponse.phases` 渲染六阶段进度。
 */
export default function Page() {
  return <FindPage />;
}
