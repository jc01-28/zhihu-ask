import { z } from "zod";

import { nullableHttpsUrlSchema } from "@/shared/contracts/url";

/** 证据只能来自知乎公开内容或 Fixture，用户上下文与背景资料不得写入。 */
export const evidenceKindSchema = z.enum(["亲身经历", "专业分析", "反面案例"]);

export const evidenceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().max(200),
    excerpt: z.string().max(180),
    kind: evidenceKindSchema,
    publishedAt: z.string(),
    source: z.enum(["zhihu_search", "fixture"]),
    url: nullableHttpsUrlSchema,
  })
  .strict();

export const creatorCardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    headline: z.string().max(200),
    initial: z.string().max(2),
    avatarTone: z.string(),
    avatarUrl: nullableHttpsUrlSchema,
    /**
     * 公开知乎主页地址，由后端给出。前端不按姓名拼接，也不接受非 https。
     * 领域来源的人物可能没有主页地址，因此允许 null。
     */
    profileUrl: nullableHttpsUrlSchema,
    identityConfidence: z.enum(["high", "medium", "low"]),
    /**
     * 人物在本次场景中的角色。
     *
     * 前三项属于「问题找人」的检索角色；`领域相关` 属于「专业领域」入口——
     * 领域目录只能说明公开内容与议题相关，不能说某人「经历最接近」。
     */
    role: z.enum(["经历最接近", "关键维度", "补充视角", "领域相关"]),
    relevanceLevel: z.enum(["高度相关", "部分相关", "补充视角"]),
    score: z.number().min(0).max(100),
    matchedDimensions: z.array(z.string().max(40)).max(4),
    reason: z.string().max(500),
    /**
     * 允许为空：领域来源的人物只有公开关联，没有可核验的内容证据。
     * 空数组表示「暂无证据」，前端必须如实展示，不得为凑满而虚构证据。
     */
    evidence: z.array(evidenceSchema).max(3),
    suitableQuestions: z.array(z.string().max(200)).max(3),
    limitations: z.array(z.string().max(200)).max(4),
  })
  .strict();

export type Evidence = z.infer<typeof evidenceSchema>;
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
export type CreatorCardData = z.infer<typeof creatorCardSchema>;
