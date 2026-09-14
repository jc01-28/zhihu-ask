import type { Message, MessageSender } from "@/shared/contracts/conversation";

/** 临时项的时间只用于本地展示，服务端 Message 一到就被替换。 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 聊天消息的纯前端视图模型。
 *
 * 与服务端 Message 的区别只有两点：临时项（sending / failed）和流式标记。
 * 业务真相永远是服务端返回的 Message，临时项一旦被替换就彻底丢弃。
 */
export type ChatItemStatus = "sent" | "sending" | "failed";

export type ChatItem = {
  id: string;
  sender: MessageSender;
  content: string;
  createdAt: string;
  status: ChatItemStatus;
  clientMessageId: string | null;
  streaming: boolean;
};

export function localItemId(clientMessageId: string): string {
  return `local:${clientMessageId}`;
}

export function toChatItem(message: Message): ChatItem {
  return {
    id: message.id,
    sender: message.sender,
    content: message.content,
    createdAt: message.createdAt,
    status: "sent",
    clientMessageId: message.clientMessageId,
    streaming: false,
  };
}

export function createPendingUserItem(input: {
  clientMessageId: string;
  content: string;
  sender: Extract<MessageSender, "seeker" | "creator">;
}): ChatItem {
  return {
    id: localItemId(input.clientMessageId),
    sender: input.sender,
    content: input.content,
    createdAt: nowIso(),
    status: "sending",
    clientMessageId: input.clientMessageId,
    streaming: false,
  };
}

export function createPendingAgentItem(clientMessageId: string): ChatItem {
  return {
    id: localItemId(`agent:${clientMessageId}`),
    sender: "agent",
    content: "",
    createdAt: nowIso(),
    status: "sending",
    clientMessageId,
    streaming: true,
  };
}

export type ConversationItemsState = {
  items: ChatItem[];
  nextCursor: string | null;
  loadingOlder: boolean;
};

export function createInitialItemsState(): ConversationItemsState {
  return { items: [], nextCursor: null, loadingOlder: false };
}

export type ConversationItemsAction =
  | { type: "server.loaded"; messages: Message[]; nextCursor: string | null }
  | { type: "loading.older" }
  | { type: "older.loaded"; messages: Message[]; nextCursor: string | null }
  | {
      type: "pending.user";
      clientMessageId: string;
      content: string;
      sender: Extract<MessageSender, "seeker" | "creator">;
    }
  | { type: "user.confirmed"; message: Message }
  | { type: "server.appended"; message: Message }
  | { type: "pending.agent"; clientMessageId: string }
  | { type: "agent.started"; messageId: string }
  | { type: "agent.delta"; messageId: string; delta: string }
  | { type: "agent.completed"; message: Message }
  | { type: "agent.failed" }
  | { type: "agent.cancelled" }
  | { type: "retry.pending"; clientMessageId: string }
  | { type: "item.discarded"; itemId: string }
  | { type: "reset"; messages: Message[] };

/**
 * 去掉被服务端消息取代的旧项：
 * - 同 id：同一个服务端消息重复到达；
 * - 同 clientMessageId 且同发送方：临时气泡被确认。
 *
 * 必须同时比较发送方：Agent 的临时气泡与它对应的用户消息共用同一个
 * clientMessageId，只按 id 去重会把正在生成的 Agent 气泡一起删掉。
 */
function withoutDuplicates(items: ChatItem[], message: Message): ChatItem[] {
  return items.filter((item) => {
    if (item.id === message.id) return false;
    return !(
      message.clientMessageId &&
      item.clientMessageId === message.clientMessageId &&
      item.sender === message.sender
    );
  });
}

export function conversationItemsReducer(
  state: ConversationItemsState,
  action: ConversationItemsAction,
): ConversationItemsState {
  switch (action.type) {
    case "server.loaded":
      // 刷新恢复时以服务端快照为准，任何本地临时项都被丢弃。
      return {
        items: action.messages.map(toChatItem),
        nextCursor: action.nextCursor,
        loadingOlder: false,
      };
    case "loading.older":
      return { ...state, loadingOlder: true };
    case "older.loaded": {
      const known = new Set(state.items.map((item) => item.id));
      const older = action.messages
        .filter((message) => !known.has(message.id))
        .map(toChatItem);
      return {
        items: [...older, ...state.items],
        nextCursor: action.nextCursor,
        loadingOlder: false,
      };
    }
    case "pending.user":
      return {
        ...state,
        items: [
          ...state.items,
          createPendingUserItem({
            clientMessageId: action.clientMessageId,
            content: action.content,
            sender: action.sender,
          }),
        ],
      };
    case "user.confirmed":
      // 用服务端 Message 原子替换同 clientMessageId 的临时项。
      return {
        ...state,
        items: [...withoutDuplicates(state.items, action.message), toChatItem(action.message)],
      };
    case "server.appended":
      // 系统消息等内容没有对应的临时项，只需按 id 去重后追加。
      return {
        ...state,
        items: [
          ...state.items.filter((item) => item.id !== action.message.id),
          toChatItem(action.message),
        ],
      };
    case "pending.agent":
      return { ...state, items: [...state.items, createPendingAgentItem(action.clientMessageId)] };
    case "agent.started":
      return {
        ...state,
        items: state.items.map((item) =>
          item.streaming && item.id.startsWith("local:agent:")
            ? { ...item, id: action.messageId }
            : item,
        ),
      };
    case "agent.delta":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.messageId
            ? { ...item, content: item.content + action.delta }
            : item,
        ),
      };
    case "agent.completed":
      return {
        ...state,
        items: [...withoutDuplicates(state.items, action.message), toChatItem(action.message)],
      };
    case "agent.failed":
      // 所有还没被服务端确认的临时项都标记失败：
      // 若 agent.run.started 已经返回，用户消息已是 sent，不受影响。
      return {
        ...state,
        items: state.items.map((item) =>
          item.status === "sending"
            ? { ...item, status: "failed", streaming: false }
            : item,
        ),
      };
    case "agent.cancelled":
      // 用户主动停止：未成型的 Agent 气泡直接丢弃（它不是已保存的消息）；
      // 若用户消息还没被服务端确认，则标记失败以便重试。
      return {
        ...state,
        items: state.items
          .filter((item) => !(item.streaming && item.sender === "agent"))
          .map((item) =>
            item.status === "sending"
              ? { ...item, status: "failed", streaming: false }
              : item,
          ),
      };
    case "retry.pending":
      return {
        ...state,
        items: state.items.map((item) =>
          item.clientMessageId === action.clientMessageId && item.status === "failed"
            ? { ...item, status: "sending" }
            : item,
        ),
      };
    case "item.discarded":
      // 只允许丢弃从未确认过的本地临时项，已保存的服务端消息永不删除。
      return {
        ...state,
        items: state.items.filter(
          (item) => !(item.id === action.itemId && item.id.startsWith("local:")),
        ),
      };
    case "reset":
      return { items: action.messages.map(toChatItem), nextCursor: null, loadingOlder: false };
    default:
      return state;
  }
}

/** 发送中的用户消息在确认前不允许重复提交。 */
export function hasPendingItem(items: ChatItem[], clientMessageId: string): boolean {
  return items.some(
    (item) => item.clientMessageId === clientMessageId && item.status !== "sent",
  );
}
