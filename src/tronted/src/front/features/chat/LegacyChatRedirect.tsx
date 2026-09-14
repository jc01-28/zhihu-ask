import { Navigate, useParams } from "react-router-dom";

/**
 * 旧聊天地址 `/chat/:conversationId` 的兼容入口。
 *
 * 它只做一件事：把会话 ID 搬到新路径 `/app/chat/:conversationId`。
 * 会话 ID 才是聊天页的业务 ID；人物的 `creatorId` 不允许出现在聊天路由里。
 */
export function LegacyChatRedirect() {
  const { conversationId } = useParams<{ conversationId: string }>();
  if (!conversationId) return <Navigate to="/app" replace />;
  return <Navigate to={`/app/chat/${encodeURIComponent(conversationId)}`} replace />;
}
