import { describe, expect, it } from "vitest";

import {
  FIELD_QUERY_MAX_LENGTH,
  describeFieldCounts,
  isSearchableFieldQuery,
  normalizeFieldQuery,
  planFieldQuery,
} from "@/front/features/fields/field-search";

describe("领域检索输入规则", () => {
  it("归一化去掉首尾空白并压缩连续空白", () => {
    expect(normalizeFieldQuery("  Agent   开发  ")).toBe("Agent 开发");
    expect(normalizeFieldQuery("\n\t风控\t")).toBe("风控");
    expect(normalizeFieldQuery("   ")).toBe("");
  });

  it("只有非空且不超长的查询才会真正发起检索", () => {
    expect(isSearchableFieldQuery("Agent")).toBe(true);
    expect(isSearchableFieldQuery("  ")).toBe(false);
    expect(isSearchableFieldQuery("a".repeat(FIELD_QUERY_MAX_LENGTH + 1))).toBe(false);
  });

  it("空查询回到推荐领域，而不是发起一次空搜索或报错", () => {
    expect(planFieldQuery("   ")).toEqual({ action: "clear" });
  });

  it("超长查询给出明确提示，不静默截断", () => {
    const plan = planFieldQuery("a".repeat(FIELD_QUERY_MAX_LENGTH + 1));
    expect(plan.action).toBe("invalid");
    expect(plan).toHaveProperty("message");
  });

  it("正常查询提交检索", () => {
    expect(planFieldQuery(" 检索增强生成 ")).toEqual({
      action: "search",
      query: "检索增强生成",
    });
  });

  it("计数文案包含议题数与人数，避免裸数字", () => {
    expect(describeFieldCounts(4, 6)).toBe("4 个议题 · 6 位可交流的人");
  });
});
