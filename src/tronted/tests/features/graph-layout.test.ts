import { describe, expect, it } from "vitest";

import {
  EDGE_MARGIN,
  GRAPH_VIEWBOX,
  OTHER_GROUP_ID,
  filterPeopleByTopic,
  layoutGraph,
  toViewBox,
} from "@/front/features/field-graph/graph-layout";
import { FIELD_GRAPHS, findFieldGraph } from "@/front/mocks/field-data";
import { fieldGraphResponseSchema } from "@/shared/contracts/field";

const agentGraph = findFieldGraph("agent-development")!;

describe("星图布局（纯函数）", () => {
  it("同一个输入永远得到同样的坐标", () => {
    const first = layoutGraph(agentGraph);
    const second = layoutGraph(agentGraph);

    expect(second).toEqual(first);
    expect(second.people.map((node) => [node.x, node.y])).toEqual(
      first.people.map((node) => [node.x, node.y]),
    );
  });

  it("不同领域之间也不会互相影响顺序", () => {
    const before = layoutGraph(agentGraph);
    layoutGraph(findFieldGraph("fintech")!);
    const after = layoutGraph(agentGraph);

    expect(after).toEqual(before);
  });

  it("每个人物只出现一次，且归属稳定", () => {
    const layout = layoutGraph(agentGraph);
    const ids = layout.people.map((node) => node.person.id);

    expect(new Set(ids).size).toBe(ids.length);
    // 顺序按议题分组重排（同一议题的人相邻），但集合必须与输入一致。
    expect([...ids].sort()).toEqual(
      [...agentGraph.people.map((person) => person.id)].sort(),
    );
    expect(layout.people.map((node) => `${node.topicId}:${node.person.id}`)).toEqual(
      layout.groups.flatMap((group) =>
        group.people.map((node) => `${node.topicId}:${node.person.id}`),
      ),
    );
  });

  it("所有坐标都在可视区域内", () => {
    for (const graph of FIELD_GRAPHS) {
      const layout = layoutGraph(graph);
      const points = [
        ...layout.topics.map((topic) => ({ x: topic.x, y: topic.y, what: topic.id })),
        ...layout.people.map((node) => ({
          x: node.x,
          y: node.y,
          what: node.person.id,
        })),
      ];
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
        expect(point.x).toBeLessThanOrEqual(1 - EDGE_MARGIN);
        expect(point.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
        expect(point.y).toBeLessThanOrEqual(1 - EDGE_MARGIN);
      }
    }
  });

  it("服务端给出的贴边坐标会被裁剪进可视区", () => {
    const clipped = fieldGraphResponseSchema.parse({
      ...agentGraph,
      topics: [
        { ...agentGraph.topics[0], position: { x: 0, y: 0 } },
        { ...agentGraph.topics[1], position: { x: 1, y: 1 } },
      ],
    });

    const layout = layoutGraph(clipped);

    expect(layout.topics[0].x).toBe(EDGE_MARGIN);
    expect(layout.topics[0].y).toBe(EDGE_MARGIN);
    expect(layout.topics[1].x).toBe(1 - EDGE_MARGIN);
    expect(layout.topics[1].y).toBe(1 - EDGE_MARGIN);
  });

  it("议题 ID 全部对不上的人物进入「其他」分组，而不是被丢弃或随机塞进议题", () => {
    const drifted = fieldGraphResponseSchema.parse({
      ...agentGraph,
      people: [
        ...agentGraph.people,
        {
          id: "p-drifted",
          name: "远程议题人物",
          headline: "关联了一个已经下线的议题",
          avatarUrl: null,
          initial: "远",
          avatarTone: "from-slate-700 to-slate-500",
          topicIds: ["t-offline-topic"],
          relevance: 55,
          profileUrl: null,
        },
        {
          id: "p-no-topic",
          name: "未归类人物",
          headline: "还没有归入任何议题",
          avatarUrl: null,
          initial: "未",
          avatarTone: "from-slate-700 to-slate-500",
          topicIds: [],
          relevance: 50,
          profileUrl: null,
        },
      ],
    });

    const layout = layoutGraph(drifted);
    const other = layout.groups.find((group) => group.id === OTHER_GROUP_ID);

    expect(other).toBeDefined();
    expect(other?.name).toBe("其他");
    expect(other?.topicId).toBeNull();
    expect(other?.people.map((node) => node.person.id)).toEqual([
      "p-drifted",
      "p-no-topic",
    ]);
    // 仍然出现在整体人物列表里：没有被静默丢掉。
    expect(layout.people.map((node) => node.person.id)).toContain("p-drifted");
  });

  it("没有「其他」人物时不生成「其他」分组", () => {
    const layout = layoutGraph(agentGraph);
    expect(layout.groups.some((group) => group.id === OTHER_GROUP_ID)).toBe(false);
    expect(layout.groups.map((group) => group.id)).toEqual(
      agentGraph.topics.map((topic) => topic.id),
    );
  });

  it("「其他」分组排在最后，且不与议题轨道重叠", () => {
    const drifted = fieldGraphResponseSchema.parse({
      ...agentGraph,
      people: [
        ...agentGraph.people,
        {
          id: "p-no-topic",
          name: "未归类人物",
          headline: "还没有归入任何议题",
          avatarUrl: null,
          initial: "未",
          avatarTone: "from-slate-700 to-slate-500",
          topicIds: [],
          relevance: 50,
          profileUrl: null,
        },
      ],
    });

    const layout = layoutGraph(drifted);
    const last = layout.groups[layout.groups.length - 1];
    const other = last.people[0];

    expect(last.id).toBe(OTHER_GROUP_ID);
    expect(other.y).toBeGreaterThan(0.85);
  });

  it("同一议题下多个人物均匀铺开，坐标互不相同", () => {
    const layout = layoutGraph(findFieldGraph("product-startup")!);
    const bucket = layout.people.filter((node) => node.topicId === "t-product-team");

    expect(bucket.length).toBeGreaterThan(1);
    const positions = bucket.map((node) => `${node.x.toFixed(4)}:${node.y.toFixed(4)}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("toViewBox 把相对坐标映射到 SVG 画布", () => {
    expect(toViewBox({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(toViewBox({ x: 1, y: 1 })).toEqual({
      x: GRAPH_VIEWBOX.width,
      y: GRAPH_VIEWBOX.height,
    });
    expect(toViewBox({ x: 0.5, y: 0.5 })).toEqual({
      x: GRAPH_VIEWBOX.width / 2,
      y: GRAPH_VIEWBOX.height / 2,
    });
  });
});

describe("议题筛选", () => {
  it("不筛选时返回全部人物", () => {
    const layout = layoutGraph(agentGraph);
    expect(filterPeopleByTopic(layout, null)).toHaveLength(layout.people.length);
  });

  it("按议题筛选时命中所有关联该议题的人物，包括跨议题的人", () => {
    const layout = layoutGraph(agentGraph);
    const matched = filterPeopleByTopic(layout, "t-agent-tooluse");

    expect(matched.map((node) => node.person.id).sort()).toEqual(
      ["p-he-zhiyuan", "p-luo-qi", "p-shen-yiran"],
    );
    // 跨议题人物（计划 + 工具调用）在两个议题里都出现。
    expect(
      filterPeopleByTopic(layout, "t-agent-planning").map((node) => node.person.id),
    ).toContain("p-shen-yiran");
  });

  it("「其他」筛选只返回没有议题归属的人物", () => {
    const layout = layoutGraph(agentGraph);
    expect(filterPeopleByTopic(layout, OTHER_GROUP_ID)).toEqual(
      layout.people.filter((node) => node.topicId === null),
    );
  });

  it("未知议题返回空列表，而不是退化成全部", () => {
    const layout = layoutGraph(agentGraph);
    expect(filterPeopleByTopic(layout, "t-does-not-exist")).toEqual([]);
  });
});
