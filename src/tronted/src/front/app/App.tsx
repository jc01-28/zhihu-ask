import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";

import { ApiProvider } from "@/front/app/ApiProvider";
import { createAppRouter } from "@/front/app/router";
import { useReducedMotionAttribute } from "@/front/shared/motion";

/**
 * 应用外壳：注入唯一 ApiClient，并挂载路由。
 * 页面本身不感知当前使用的是 Mock 还是真实后端。
 */
export function App() {
  const router = useMemo(() => createAppRouter(), []);
  // 把动效偏好写成 `<html data-reduced-motion>`：CSS 与 E2E 都读同一个开关。
  useReducedMotionAttribute();

  return (
    <ApiProvider>
      <RouterProvider router={router} />
    </ApiProvider>
  );
}
