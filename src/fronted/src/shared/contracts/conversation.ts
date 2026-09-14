import { z } from "zod";

import { publicUserSchema } from "@/shared/contracts/auth";
import { creatorCardSchema } from "@/shared/contracts/creator";
import {
  consultationSchema,
  consultationActionSchema,
} from "@/shared/contracts/consultation";
import { apiErrorEnvelopeSchema } from "@/shared/contracts/errors";

export const messageSenderSchema = z.enum([
  "seeker",
  "creator",
  "agent",
  "system",
]);

export const messageSchema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    clientMessageId: z.string().min(1).nullable(),
    sender: messageSenderSchema,
    content: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const conversationSchema = z
  .object({
    id: z.string().min(1),
    user: publicUserSchema,
    creator: creatorCardSchema,
    sourceRunId: z.string().uuid().nullable(),
    consultation: consultationSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const conversationEnvelopeSchema = z
  .object({ conversation: conversationSchema })
  .strict();

export const messageListResponseSchema = z
  .object({
    items: z.array(messageSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const messageEnvelopeSchema = z
  .object({ message: messageSchema })
  .strict();

export const resetConversationResponseSchema = z
  .object({
    conversation: conversationSchema,
    messages: z.array(messageSchema),
  })
  .strict();

export const agentMessageRequestSchema = z
  .object({
    clientMessageId: z.string().min(1).max(120),
    content: z.string().trim().min(1).max(2000),
  })
  .strict();

export const conversationAgentEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("agent.run.started"),
      requestId: z.string().uuid(),
      userMessage: messageSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("agent.message.started"), messageId: z.string().min(1) })
    .strict(),
  z
    .object({
      type: z.literal("agent.message.delta"),
      messageId: z.string().min(1),
      delta: z.string(),
    })
    .strict(),
  z
    .object({ type: z.literal("agent.message.completed"), message: messageSchema })
    .strict(),
  z
    .object({
      type: z.literal("agent.run.failed"),
      requestId: z.string().min(1),
      error: apiErrorEnvelopeSchema,
    })
    .strict(),
]);

export const consultationActionRequestSchema = z
  .object({
    action: consultationActionSchema,
    actorRole: z.enum(["seeker", "creator"]),
    packageId: z.string().min(1).optional(),
  })
  .strict();

export const consultationActionResponseSchema = z
  .object({
    consultation: consultationSchema,
    systemMessage: messageSchema,
  })
  .strict();

export type MessageSender = z.infer<typeof messageSenderSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type AgentMessageRequest = z.infer<typeof agentMessageRequestSchema>;
export type ConversationAgentEvent = z.infer<
  typeof conversationAgentEventSchema
>;
export type ConversationAgentCompletedEvent = Extract<
  ConversationAgentEvent,
  { type: "agent.message.completed" }
>;
export type ConsultationActionRequest = z.infer<
  typeof consultationActionRequestSchema
>;
export type ConsultationActionResponse = z.infer<
  typeof consultationActionResponseSchema
>;

export function isTerminalConversationEvent(
  event: ConversationAgentEvent,
): boolean {
  return (
    event.type === "agent.message.completed" ||
    event.type === "agent.run.failed"
  );
}
