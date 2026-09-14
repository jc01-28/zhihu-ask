import { createBrowserRouter, type RouteObject } from "react-router-dom";

import { RequireAuth } from "@/front/features/auth/RequireAuth";
import { LegacyChatRedirect } from "@/front/features/chat/LegacyChatRedirect";
import { ChatPage } from "@/front/pages/ChatPage";
import { FieldGraphPage } from "@/front/pages/FieldGraphPage";
import { FieldsPage } from "@/front/pages/FieldsPage";
import { FindPeoplePage } from "@/front/pages/FindPeoplePage";
import { LandingPage } from "@/front/pages/LandingPage";
import { NotFoundPage } from "@/front/pages/NotFoundPage";
import { PortalPage } from "@/front/pages/PortalPage";

/**
 * 路由表。
 *
 * 固定的七条业务路径：
 *   `/`                          项目推荐页（不访问任何业务 API）
 *   `/app`                       授权门禁 + 功能首页（两个入口）
 *   `/app/fields`                专业领域目录（推荐 + 领域检索）
 *   `/app/fields/:fieldId`       领域星图（议题筛选 + 人物名片）
 *   `/app/find`                  问题找人（六阶段 Agent 检索）
 *   `/app/chat/:conversationId`  虚拟私聊 + 咨询 + 私有 Agent 展示
 *
 * 另外两条不承载业务：
 *   `/chat/:conversationId`      旧路径，仅作兼容重定向，见 `LegacyChatRedirect`；
 *   `*`                          404。
 *
 * 注意：私聊用**会话 ID**，不是人物 ID —— 同一个人可以有多个会话。
 */
export const appRoutes: RouteObject[] = [
  { path: "/", element: <LandingPage /> },
  {
    path: "/app",
    element: (
      <RequireAuth>{(session) => <PortalPage session={session} />}</RequireAuth>
    ),
  },
  {
    path: "/app/find",
    element: (
      <RequireAuth>{(session) => <FindPeoplePage session={session} />}</RequireAuth>
    ),
  },
  {
    path: "/app/fields",
    element: (
      <RequireAuth>{(session) => <FieldsPage session={session} />}</RequireAuth>
    ),
  },
  {
    path: "/app/fields/:fieldId",
    element: (
      <RequireAuth>{(session) => <FieldGraphPage session={session} />}</RequireAuth>
    ),
  },
  { path: "/app/chat/:conversationId", element: <ChatPage /> },
  { path: "/chat/:conversationId", element: <LegacyChatRedirect /> },
  { path: "*", element: <NotFoundPage /> },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
