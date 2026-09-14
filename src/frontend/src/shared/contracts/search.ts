import { z } from "zod";

import { creatorCardSchema } from "@/shared/contracts/creator";
import { httpsUrlSchema, nullableHttpsUrlSchema } from "@/shared/contracts/url";

export const dataModeSchema = z.enum(["fixture", "live", "auto"]);

export const searchRequestSchema = z
  .object({
    query: z.string().trim().min(4).max(300),
    sessionId: z.string().min(1).max(100),
    mode: dataModeSchema.optional(),
  })
  .strict();

/** 只有知乎公开搜索内容和 Fixture 可以进入人物候选证据链。 */
export const searchHitProviderSchema = z.enum(["zhihu_search", "fixture"]);

export const searchHitSchema = z
  .object({
    contentId: z.string().min(1),
    contentType: z.enum(["Answer", "Article", "Question", "Other"]),
    title: z.string().max(200),
    excerpt: z.string().max(800),
    url: httpsUrlSchema,
    commentCount: z.number().int().nonnegative(),
    voteUpCount: z.number().int().nonnegative(),
    editTime: z.number().nonnegative(),
    rankingScore: z.number(),
    author: z
      .object({
        syntheticId: z.string().min(1),
        name: z.string().min(1).max(80),
        avatarUrl: nullableHttpsUrlSchema,
        badgeText: z.string().max(100).nullable(),
        authorityLevel: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
        ]),
      })
      .strict(),
    sourceQuery: z.string().min(1).max(100),
    provider: searchHitProviderSchema,
  })
  .strict();

/** 背景资料（热榜 / 全网搜索）永远不参与人物推荐。 */
export const backgroundDocumentSchema = z
  .object({
    scope: z.literal("background"),
    source: z.enum(["global_search", "hot_list"]),
    title: z.string().max(200),
    excerpt: z.string().max(800),
    url: httpsUrlSchema,
    thumbnailUrl: nullableHttpsUrlSchema,
    publishedAt: z.number().nonnegative().nullable(),
  })
  .strict();

export const hotTopicsResponseSchema = z
  .object({
    topics: z.array(backgroundDocumentSchema),
    unavailable: z.boolean(),
  })
  .strict();

export const contextSourceCountsSchema = z
  .object({
    creation: z.number().int().nonnegative(),
    followee: z.number().int().nonnegative(),
    collection: z.number().int().nonnegative(),
    favlist: z.number().int().nonnegative(),
  })
  .strict();

export const contextStatusSchema = z.enum([
  "applied",
  "partial",
  "unavailable",
]);

export const personSearchResultSchema = z
  .object({
    cards: z.array(creatorCardSchema).max(3),
    modeUsed: z.enum(["live", "fixture"]),
    fallbackReason: z.string().nullable(),
    modelFallback: z.boolean(),
    contextStatus: contextStatusSchema,
    contextSourceCounts: contextSourceCountsSchema,
    searchedQueries: z.array(z.string()),
    background: z.array(backgroundDocumentSchema),
    analyzedContentCount: z.number().int().nonnegative(),
    rejectedContentCount: z.number().int().nonnegative(),
    runId: z.string().uuid().nullable(),
    persistence: z.enum(["saved", "unavailable"]),
  })
  .strict();

export const compareResponseSchema = z
  .object({
    modeUsed: z.enum(["live", "fixture"]),
    modelFallback: z.boolean(),
    contextStatus: contextStatusSchema,
    raw: z
      .object({
        queries: z.array(z.string()),
        hits: z.array(searchHitSchema),
      })
      .strict(),
    agent: personSearchResultSchema,
  })
  .strict();

/**
 * `GET /api/agent/runs/:runId` 的响应：刷新页面后重新取回一次已完成的搜索。
 *
 * 字段刻意与 `personSearchResultSchema` 一一对应（只是命名保留了运行视角），
 * 目的是让「刷新恢复」后的摘要与首次搜索**完全一致**。
 * 如果这里少给字段，前端就只能用 `false` / `0` / `[]` 去补——那等于在界面上
 * 伪造一次它并不知道的降级情况与上下文统计，属于必须避免的数据失真。
 */
export const runRestoreResponseSchema = z
  .object({
    runId: z.string().uuid(),
    cards: z.array(creatorCardSchema).max(3),
    mode: z.enum(["live", "fixture"]),
    contextStatus: contextStatusSchema,
    analyzedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    fallbackReason: z.string().max(80).nullable(),
    modelFallback: z.boolean(),
    contextSourceCounts: contextSourceCountsSchema,
    searchedQueries: z.array(z.string()),
    background: z.array(backgroundDocumentSchema),
    /** 能取回就说明当初存下来了，因此这里不接受 `unavailable`。 */
    persistence: z.literal("saved"),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();

export type DataMode = z.infer<typeof dataModeSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchHit = z.infer<typeof searchHitSchema>;
export type BackgroundDocument = z.infer<typeof backgroundDocumentSchema>;
export type HotTopicsResponse = z.infer<typeof hotTopicsResponseSchema>;
export type ContextSourceCounts = z.infer<typeof contextSourceCountsSchema>;
export type ContextStatus = z.infer<typeof contextStatusSchema>;
export type PersonSearchResult = z.infer<typeof personSearchResultSchema>;
export type CompareResponse = z.infer<typeof compareResponseSchema>;
export type RunRestoreResponse = z.infer<typeof runRestoreResponseSchema>;
