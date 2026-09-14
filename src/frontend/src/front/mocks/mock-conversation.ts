import type { PublicUser } from "@/shared/contracts/auth";
import type { Consultation, ConsultationStatus } from "@/shared/contracts/consultation";
import type { CreatorCardData } from "@/shared/contracts/creator";
import type { Conversation, Message } from "@/shared/contracts/conversation";

import { DEFAULT_PACKAGE_ID } from "@/front/mocks/demo-data";

/**
 * Mock 会话数据构造器。
 *
 * 所有时间戳都从固定基准时间递增推导，而不是读取系统时钟，
 * 因此同一次演示流程里的消息顺序与时间展示完全可复现。
 */
const BASE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export function mockTimestamp(offsetSeconds: number): string {
  return new Date(BASE_TIME_MS + offsetSeconds * 1000).toISOString();
}

export function buildMockConsultation(
  conversationId: string,
  status: ConsultationStatus = "free_chat",
  packageId: string | null = DEFAULT_PACKAGE_ID,
  amount: number | null = null,
  offsetSeconds = 0,
): Consultation {
  return {
    id: `consultation-${conversationId}`,
    status,
    packageId:
      packageId === "text" || packageId === "voice-30" || packageId === "voice-60"
        ? packageId
        : null,
    amount,
    updatedAt: mockTimestamp(offsetSeconds),
  };
}

export function buildMockConversation(input: {
  id: string;
  creator: CreatorCardData;
  user: PublicUser;
  sourceRunId: string | null;
  offsetSeconds?: number;
}): Conversation {
  const offset = input.offsetSeconds ?? 0;
  return {
    id: input.id,
    user: input.user,
    creator: input.creator,
    sourceRunId: input.sourceRunId,
    consultation: buildMockConsultation(input.id, "free_chat", DEFAULT_PACKAGE_ID, null, offset),
    createdAt: mockTimestamp(offset),
    updatedAt: mockTimestamp(offset),
  };
}

/** 初始消息：一条系统说明 + 一条用户开场 + 一条答主（演示）回应。 */
export function buildInitialMessages(
  conversationId: string,
  creator: CreatorCardData,
  offsetSeconds = 0,
): Message[] {
  return [
    buildSystemMessage(
      conversationId,
      "这是虚拟聊天演示。所有消息都由 Mock API 生成，不会发送给真实知乎用户。",
      `${conversationId}-system-0`,
      offsetSeconds,
    ),
    {
      id: `${conversationId}-seeker-0`,
      conversationId,
      clientMessageId: null,
      sender: "seeker",
      content: "你好，我是通过「知域」看到你的。你的经历和我正在考虑的问题很接近。",
      createdAt: mockTimestamp(offsetSeconds + 1),
    },
    {
      id: `${conversationId}-creator-0`,
      conversationId,
      clientMessageId: null,
      sender: "creator",
      content: `你好，可以先说说你最难判断的是公司阶段、个人角色，还是回报风险？我是${creator.name}（演示人物）。`,
      createdAt: mockTimestamp(offsetSeconds + 2),
    },
  ];
}

export function buildSystemMessage(
  conversationId: string,
  content: string,
  id: string,
  offsetSeconds = 0,
): Message {
  return {
    id,
    conversationId,
    clientMessageId: null,
    sender: "system",
    content,
    createdAt: mockTimestamp(offsetSeconds),
  };
}

/** Agent 回复按句切分成多个 delta，用来验证流式增量展示。 */
export function buildAgentReplyDeltas(
  creator: CreatorCardData,
  userContent: string,
): string[] {
  const question = userContent.trim().slice(0, 24);
  return [
    `关于「${question}」，`,
    "可以先把它拆成三个可验证的问题：",
    "第一，你真正担心的是收入、成长速度，还是两年后的选择权；",
    `第二，${creator.name}（演示人物）公开内容里反复提到的核对项，你是否已经逐条确认；`,
    "第三，给最坏情况设一个可承受的下限，再决定要不要换。",
    "以上内容由 Mock Agent 生成，只用于演示流式交互，不是真实答主的答复。",
  ];
}
