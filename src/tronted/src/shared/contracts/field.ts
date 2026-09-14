import { z } from "zod";

import { nullableHttpsUrlSchema } from "@/shared/contracts/url";

/**
 * 领域主题色白名单。
 *
 * 主题色不进 CSS：服务端只返回下面这些**语义 token**，具体色值由前端的固定映射表
 * 决定。这样即使后端返回了 `color: "red; background: url(...)"` 也不可能落进
 * 样式字符串里——它在契约层就被拒绝了。
 */
export const FIELD_COLOR_TOKENS = [
  "blue",
  "cyan",
  "violet",
  "amber",
  "emerald",
  "rose",
  "indigo",
  "teal",
] as const;

export const fieldColorSchema = z.enum(FIELD_COLOR_TOKENS);

/** 议题在星图中的相对坐标，取值固定在 0～1，前端负责映射到实际视口。 */
export const fieldTopicPositionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

export const fieldTopicSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(40),
    description: z.string().max(200),
    position: fieldTopicPositionSchema,
  })
  .strict();

/**
 * 领域卡片。`icon` 是图标**名称**，前端用白名单映射到具体图标，
 * 未知名称回退到默认图标，不会被当作路径或 HTML 使用。
 */
export const fieldSummarySchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(40),
    description: z.string().max(240),
    icon: z.string().max(40).nullable(),
    color: fieldColorSchema,
    tags: z.array(z.string().min(1).max(20)).max(6),
    memberCount: z.number().int().nonnegative(),
    topicCount: z.number().int().nonnegative(),
  })
  .strict();

/** 领域检索的响应信封：返回值始终是领域列表，不是人物列表。 */
export const fieldListResponseSchema = z
  .object({ items: z.array(fieldSummarySchema) })
  .strict();

/**
 * 星图中的人物节点。
 *
 * 只包含「公开可见 + 与领域相关」的最小字段集合：不带证据、不带分数理由，
 * 也不带任何内部标识。`profileUrl` 必须由后端给出，前端不按姓名拼接主页地址。
 */
export const fieldPersonSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    headline: z.string().max(200),
    avatarUrl: nullableHttpsUrlSchema,
    initial: z.string().min(1).max(2),
    avatarTone: z.string().max(80),
    topicIds: z.array(z.string().min(1).max(64)).max(8),
    relevance: z.number().min(0).max(100),
    profileUrl: nullableHttpsUrlSchema,
  })
  .strict();

/** 领域星图：中心领域 + 议题节点 + 人物聚类。 */
export const fieldGraphResponseSchema = z
  .object({
    field: fieldSummarySchema,
    topics: z.array(fieldTopicSchema).min(1),
    people: z.array(fieldPersonSchema).min(1),
  })
  .strict();

export type FieldColorToken = z.infer<typeof fieldColorSchema>;
export type FieldTopic = z.infer<typeof fieldTopicSchema>;
export type FieldSummary = z.infer<typeof fieldSummarySchema>;
export type FieldListResponse = z.infer<typeof fieldListResponseSchema>;
export type FieldPerson = z.infer<typeof fieldPersonSchema>;
export type FieldGraphResponse = z.infer<typeof fieldGraphResponseSchema>;
