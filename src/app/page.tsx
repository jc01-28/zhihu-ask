import ProjectIntroPage from '@/front/pages/ProjectIntroPage';

/**
 * 路由壳 —— 页面实现在 `src/front/pages/ProjectIntroPage.tsx`。
 *
 * `/` 是**项目推荐页**（前端规格里的页面一）：只介绍项目、给两个跳转按钮，
 * 不做任何业务操作，也没有登录状态。功能全部在 `/app/*` 下。
 */
export default function Page() {
  return <ProjectIntroPage />;
}
