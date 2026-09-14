import type { CompareResponse, PersonSearchResult, SearchHit } from "@/shared/contracts/search";

import { FIXTURE_CREATORS } from "@/front/mocks/demo-data";

/** 确定性 UUID：Mock 不使用随机数，保证同一场景每次运行完全一致。 */
export function deterministicUuid(seed: number): string {
  const tail = seed.toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}

export const MOCK_RUN_ID = deterministicUuid(0x51);
export const MOCK_SEARCH_REQUEST_ID = deterministicUuid(0x11);
export const MOCK_AGENT_REQUEST_ID = deterministicUuid(0x22);

function backgroundDocuments(query: string) {
  return [
    {
      scope: "background" as const,
      source: "global_search" as const,
      title: "行业背景：AI 应用公司的人才结构变化（演示数据）",
      excerpt: `与「${query.slice(0, 24)}」相关的公开讨论整理，仅用于说明问题所处行业背景，不参与人物推荐。`,
      url: "https://www.zhihu.com/question/0000000001",
      thumbnailUrl: null,
      publishedAt: 1_776_000_000,
    },
    {
      scope: "background" as const,
      source: "hot_list" as const,
      title: "热榜观察：降薪换期权是不是一笔好交易（演示数据）",
      excerpt:
        "热榜讨论只说明话题热度，不能证明任何人的亲身经历，因此单独成区并明确标注来源。",
      url: "https://www.zhihu.com/question/0000000002",
      thumbnailUrl: null,
      publishedAt: 1_776_400_000,
    },
  ];
}

export const MOCK_SEARCH_HITS: SearchHit[] = [
  {
    contentId: "hit-1",
    contentType: "Answer",
    title: "从大厂到创业公司，我踩过的三个坑（演示数据）",
    excerpt:
      "原始检索结果不区分亲历与转述，需要人工逐条判断作者身份和内容可信度。",
    url: "https://www.zhihu.com/answer/000000001",
    commentCount: 42,
    voteUpCount: 1830,
    editTime: 1_776_000_000,
    rankingScore: 0.92,
    author: {
      syntheticId: "synthetic-hit-1",
      name: "匿名演示作者",
      avatarUrl: null,
      badgeText: null,
      authorityLevel: 2,
    },
    sourceQuery: "大厂产品转 AI 创业公司",
    provider: "fixture",
  },
  {
    contentId: "hit-2",
    contentType: "Article",
    title: "期权估值的那点事：为什么股数没有意义（演示数据）",
    excerpt:
      "原始结果里同时混合了亲身经历、专业分析和带推广倾向的内容，没有人物归类。",
    url: "https://zhuanlan.zhihu.com/p/000000002",
    commentCount: 18,
    voteUpCount: 640,
    editTime: 1_776_100_000,
    rankingScore: 0.84,
    author: {
      syntheticId: "synthetic-hit-2",
      name: "演示专栏作者",
      avatarUrl: null,
      badgeText: "演示标记",
      authorityLevel: 3,
    },
    sourceQuery: "降薪换期权 值不值",
    provider: "fixture",
  },
  {
    contentId: "hit-3",
    contentType: "Answer",
    title: "第一次带团队，最该先建立的其实是反馈节奏（演示数据）",
    excerpt: "同一条检索语句返回的内容跨度很大，需要证据判读后才能聚合到某个人身上。",
    url: "https://www.zhihu.com/answer/000000003",
    commentCount: 7,
    voteUpCount: 210,
    editTime: 1_776_200_000,
    rankingScore: 0.71,
    author: {
      syntheticId: "synthetic-hit-3",
      name: "演示回答者",
      avatarUrl: null,
      badgeText: null,
      authorityLevel: 1,
    },
    sourceQuery: "第一次做技术管理",
    provider: "fixture",
  },
];

export type MockSearchScenario = "default" | "empty" | "failed";

export function buildMockSearchResult(
  query: string,
  scenario: MockSearchScenario = "default",
): PersonSearchResult {
  const cards = scenario === "default" ? FIXTURE_CREATORS : [];
  return {
    cards,
    modeUsed: "fixture",
    fallbackReason:
      scenario === "failed"
        ? "演示模式：真实检索不可用"
        : "演示模式：未连接真实知乎 API",
    modelFallback: true,
    contextStatus: "applied",
    contextSourceCounts: {
      creation: 6,
      followee: 12,
      collection: 4,
      favlist: 2,
    },
    searchedQueries: [
      query.slice(0, 60),
      "大厂产品转 AI 创业公司",
      "降薪换期权 值不值",
    ],
    background: backgroundDocuments(query),
    analyzedContentCount: scenario === "default" ? 18 : 5,
    rejectedContentCount: scenario === "default" ? 11 : 5,
    runId: MOCK_RUN_ID,
    persistence: "saved",
  };
}

export function buildMockCompareResponse(query: string): CompareResponse {
  return {
    modeUsed: "fixture",
    modelFallback: true,
    contextStatus: "applied",
    raw: {
      queries: [query.slice(0, 60), "大厂产品转 AI 创业公司"],
      hits: MOCK_SEARCH_HITS,
    },
    agent: buildMockSearchResult(query),
  };
}

/** 六个阶段的公开文案：只说做了什么，不暴露模型内部思维。 */
export const MOCK_STEP_MESSAGES: Record<string, string> = {
  loading_context: "已读取授权上下文的最小必要字段（演示）。",
  understanding: "已提取处境、目标与关键约束（演示）。",
  retrieving: "已按 3 个检索方向寻找公开内容（演示）。",
  verifying: "已区分亲身经历、专业分析与第三方案例（演示）。",
  ranking: "已选出互补的相关人选（演示）。",
  saving: "演示结果已保存在当前会话（演示）。",
};

export const MOCK_AGENT_REPLY_PREFIX =
  "（演示回复，由 Mock API 生成，不代表真实答主观点）";
