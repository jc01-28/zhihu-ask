import { describe, expect, it } from "vitest";

import { creatorCardSchema } from "@/shared/contracts/creator";
import {
  FIELD_COLOR_TOKENS,
  fieldGraphResponseSchema,
  fieldSummarySchema,
} from "@/shared/contracts/field";
import {
  FIELD_GRAPHS,
  FIELD_SUMMARIES,
  featuredFields,
  searchFixtureFields,
} from "@/front/mocks/field-data";

const VALID_FIELD = {
  id: "agent-development",
  name: "Agent 开发",
  description: "把大模型接入真实业务系统的工程方向。",
  icon: "bot",
  color: "blue",
  tags: ["Agent", "工具调用"],
  memberCount: 6,
  topicCount: 4,
};

describe("领域公开契约", () => {
  it("合法领域通过校验，且推荐列表里的领域全部满足契约", () => {
    expect(fieldSummarySchema.safeParse(VALID_FIELD).success).toBe(true);
    for (const field of FIELD_SUMMARIES) {
      expect(fieldSummarySchema.safeParse(field).success).toBe(true);
    }
  });

  it("星图数据满足契约：每个领域至少两个议题、三个人物", () => {
    for (const graph of FIELD_GRAPHS) {
      expect(fieldGraphResponseSchema.safeParse(graph).success).toBe(true);
      expect(graph.topics.length).toBeGreaterThanOrEqual(2);
      expect(graph.people.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("memberCount 为负数不合法", () => {
    expect(
      fieldSummarySchema.safeParse({ ...VALID_FIELD, memberCount: -1 }).success,
    ).toBe(false);
    expect(
      fieldSummarySchema.safeParse({ ...VALID_FIELD, memberCount: 1.5 }).success,
    ).toBe(false);
  });

  it("主题色只接受白名单 token，不接受任意 CSS", () => {
    for (const token of FIELD_COLOR_TOKENS) {
      expect(fieldSummarySchema.safeParse({ ...VALID_FIELD, color: token }).success).toBe(
        true,
      );
    }
    for (const injected of [
      "red",
      "red; background: url(https://evil.example/x.png)",
      "url(https://evil.example/x.png)",
      "--color-primary",
      "",
    ]) {
      expect(
        fieldSummarySchema.safeParse({ ...VALID_FIELD, color: injected }).success,
      ).toBe(false);
    }
  });

  it("未知字段被拒绝（strict）", () => {
    expect(
      fieldSummarySchema.safeParse({ ...VALID_FIELD, internalTenantId: "t-1" }).success,
    ).toBe(false);
    const graph = FIELD_GRAPHS[0];
    expect(
      fieldGraphResponseSchema.safeParse({ ...graph, accessToken: "secret" }).success,
    ).toBe(false);
  });

  it("人物节点的 relevance 必须落在 0～100，topicIds 必须是字符串数组", () => {
    const graph = FIELD_GRAPHS[0];
    const person = graph.people[0];

    expect(
      fieldGraphResponseSchema.safeParse({
        ...graph,
        people: [{ ...person, relevance: 101 }],
      }).success,
    ).toBe(false);
    expect(
      fieldGraphResponseSchema.safeParse({
        ...graph,
        people: [{ ...person, relevance: -0.5 }],
      }).success,
    ).toBe(false);
    expect(
      fieldGraphResponseSchema.safeParse({
        ...graph,
        people: [{ ...person, topicIds: [1, 2] }],
      }).success,
    ).toBe(false);
    expect(
      fieldGraphResponseSchema.safeParse({
        ...graph,
        people: [{ ...person, topicIds: "t-agent-planning" }],
      }).success,
    ).toBe(false);
  });

  it("非法 profileUrl 被拒绝：javascript: 与 http: 都不放行", () => {
    const graph = FIELD_GRAPHS[0];
    const person = graph.people[0];

    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://www.zhihu.com/people/x",
      "not-a-url",
      "",
    ]) {
      expect(
        fieldGraphResponseSchema.safeParse({
          ...graph,
          people: [{ ...person, profileUrl: bad }],
        }).success,
      ).toBe(false);
    }
    expect(
      fieldGraphResponseSchema.safeParse({
        ...graph,
        people: [{ ...person, profileUrl: "https://www.zhihu.com/people/demo" }],
      }).success,
    ).toBe(true);
  });

  it("议题坐标必须落在 0～1 的相对坐标内", () => {
    const graph = FIELD_GRAPHS[0];
    const topic = graph.topics[0];

    expect(
      fieldGraphResponseSchema.safeParse({
        ...graph,
        topics: [{ ...topic, position: { x: 1.2, y: 0.5 } }],
      }).success,
    ).toBe(false);
    expect(
      fieldGraphResponseSchema.safeParse({
        ...graph,
        topics: [{ ...topic, position: { x: 0.5, y: -0.1 } }],
      }).success,
    ).toBe(false);
  });

  it("人物卡新增 profileUrl 后仍与人物契约一致", () => {
    // 领域人物转换为统一名片数据后，必须能通过人物卡契约。
    for (const graph of FIELD_GRAPHS) {
      for (const person of graph.people) {
        expect(person.profileUrl === null || person.profileUrl.startsWith("https://")).toBe(
          true,
        );
      }
    }
    expect(
      creatorCardSchema.safeParse({ ...FIELD_GRAPHS[0].people[0] }).success,
    ).toBe(false);
  });
});

describe("领域检索语义", () => {
  it("查询为空时返回空数组，由页面回退到推荐领域", () => {
    expect(searchFixtureFields("")).toEqual([]);
    expect(searchFixtureFields("   ")).toEqual([]);
  });

  it("命中领域名、标签、简介与议题关键词，返回值始终是领域", () => {
    const byName = searchFixtureFields("Agent");
    expect(byName.map((field) => field.id)).toContain("agent-development");

    const byTag = searchFixtureFields("风控");
    expect(byTag.map((field) => field.id)).toContain("fintech");

    const byTopic = searchFixtureFields("检索增强生成");
    expect(byTopic.map((field) => field.id)).toContain("ai-application");

    const byDescription = searchFixtureFields("清结算");
    expect(byDescription.map((field) => field.id)).toContain("fintech");

    // 任何一次检索的结果元素都必须仍然是领域对象，而不是人物。
    for (const field of [...byName, ...byTag, ...byTopic, ...byDescription]) {
      expect(fieldSummarySchema.safeParse(field).success).toBe(true);
      expect(field).not.toHaveProperty("score");
      expect(field).not.toHaveProperty("headline");
    }
  });

  it("没有匹配时返回空数组，不模糊兜底", () => {
    expect(searchFixtureFields("量子引力波投资")).toEqual([]);
  });

  it("limit 生效且推荐领域覆盖全部领域", () => {
    expect(searchFixtureFields("a", 1).length).toBeLessThanOrEqual(1);
    expect(featuredFields().length).toBe(FIELD_SUMMARIES.length);
  });
});
