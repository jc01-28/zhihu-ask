import { z } from "zod";

import { apiErrorEnvelopeSchema } from "@/shared/contracts/errors";
import { personSearchResultSchema } from "@/shared/contracts/search";

export const agentStepSchema = z.enum([
  "loading_context",
  "understanding",
  "retrieving",
  "verifying",
  "ranking",
  "saving",
]);

export const searchAgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), requestId: z.string().uuid() }),
  z
    .object({
      type: z.enum(["step.started", "step.completed"]),
      step: agentStepSchema,
      message: z.string(),
      meta: z
        .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("run.completed"),
      result: personSearchResultSchema,
      runId: z.string().uuid().nullable(),
      persistence: z.enum(["saved", "unavailable"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("run.failed"),
      error: apiErrorEnvelopeSchema,
    })
    .strict(),
]);

export type AgentStep = z.infer<typeof agentStepSchema>;
export type SearchAgentEvent = z.infer<typeof searchAgentEventSchema>;
export type SearchRunCompletedEvent = Extract<
  SearchAgentEvent,
  { type: "run.completed" }
>;

/** 事件顺序固定：run.started → 六个阶段各 started/completed → run.completed。 */
export const AGENT_STEP_ORDER = [
  "loading_context",
  "understanding",
  "retrieving",
  "verifying",
  "ranking",
  "saving",
] as const satisfies readonly AgentStep[];

export function isTerminalSearchEvent(event: SearchAgentEvent): boolean {
  return event.type === "run.completed" || event.type === "run.failed";
}
