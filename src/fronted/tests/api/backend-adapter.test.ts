import { describe, expect, it } from "vitest";

import {
  mapBackendAskResult,
  mapBackendField,
  mapBackendFieldGraph,
} from "@/front/api/backend-adapter";

describe("backend response adapters", () => {
  it("把后端领域主题色和 emoji 图标映射到前端白名单", () => {
    expect(
      mapBackendField({
        id: "ai-app",
        name: "人工智能应用",
        description: "把模型能力落到业务里。",
        icon: "✨",
        color: "#7F77DD",
        tags: ["大模型"],
        memberCount: 3,
        topicCount: 2,
      }),
    ).toMatchObject({ icon: "sparkles", color: "violet" });
  });

  it("把后端 0~1000 星图坐标和 0~1 相关度转换成前端契约", () => {
    const graph = mapBackendFieldGraph({
      field: {
        id: "ai-app",
        name: "人工智能应用",
        description: "把模型能力落到业务里。",
        icon: "✨",
        color: "#7F77DD",
        tags: ["大模型"],
        memberCount: 1,
        topicCount: 1,
      },
      topics: [
        {
          id: "rag",
          name: "检索增强",
          description: "知识库与召回。",
          memberCount: 1,
          position: { x: 250, y: 750 },
        },
      ],
      people: [
        {
          id: "p-1",
          name: "张三",
          headline: "工程师",
          avatarUrl: null,
          initial: "张",
          avatarTone: "#2F6FED",
          topicIds: ["rag"],
          relevance: 0.8,
          position: { x: 640, y: 410 },
          profileUrl: "https://www.zhihu.com/people/zhang-san",
        },
      ],
    });

    expect(graph.topics[0].position).toEqual({ x: 0.25, y: 0.75 });
    expect(graph.people[0]).toMatchObject({
      relevance: 80,
      avatarTone: expect.stringContaining("from-"),
    });
    expect(Object.keys(graph.people[0])).not.toContain("position");
  });

  it("使用后端 quote 作为证据和背景文案，不伪造空摘要", () => {
    const result = mapBackendAskResult({
      runId: "run_backend_1",
      recommendations: [
        {
          candidate: {
            id: "p-1",
            authorName: "张三",
            authorAvatar: "",
            authorBadgeText: "工程师",
            profileUrl: "https://www.zhihu.com/people/zhang-san",
            authorityLevel: 3,
            score: 0.9,
          },
          whyRecommended: "有相关经验。",
          evidence: [
            {
              title: "我的转型记录",
              quote: "这是可核验的经历片段。",
              url: "https://www.zhihu.com/question/1",
            },
          ],
          relevantToYou: ["转型"],
          notGoodAt: [],
        },
      ],
      contentOnly: [
        {
          title: "公开讨论",
          quote: "这是背景资料原文。",
          url: "https://www.zhihu.com/question/2",
        },
      ],
      profile: { searchQueries: ["转型"] },
      metrics: { hitCount: 1, eventCount: 1, noEvidenceRate: 0 },
    });

    expect(result.cards[0].evidence[0].excerpt).toBe("这是可核验的经历片段。");
    expect(result.background[0].excerpt).toBe("这是背景资料原文。");
  });
});
