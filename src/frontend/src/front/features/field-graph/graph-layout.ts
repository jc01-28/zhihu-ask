import type { FieldGraphResponse, FieldPerson } from "@/shared/contracts/field";

/**
 * 领域星图的确定性布局。
 *
 * 三条硬约束，全部可被单元测试直接验证：
 *
 *  1. **纯函数**：同样的输入永远得到同样的坐标。不使用随机数、时间或递增计数器，
 *     否则同一张星图在两次渲染之间会「跳一下」，也让截图与 E2E 无法稳定断言。
 *  2. **坐标始终在可视区域内**：所有输出的 x/y 都落在 `[EDGE_MARGIN, 1 - EDGE_MARGIN]`。
 *     服务端给的是 0～1 相对坐标，但仍可能贴边；这里做统一裁剪。
 *  3. **人物必有归属**：议题 ID 全部对不上（或议题为空）的人物进入「其他」分组，
 *     不会被丢弃，也不会被随机塞进某个议题。
 *
 * 人物位置由前端推导（后端只下发议题坐标），因此每个人只出现一次：
 * 归属取第一个可识别的议题，其余议题仍参与筛选。
 */

export const OTHER_GROUP_ID = "__other__";
export const OTHER_GROUP_NAME = "其他";

/** SVG 逻辑画布尺寸；真实渲染由 CSS 缩放，与坐标无关。 */
export const GRAPH_VIEWBOX = { width: 1000, height: 640 } as const;

/** 边缘留白：避免节点被裁掉一半。 */
export const EDGE_MARGIN = 0.06;

/** 人物围绕所属议题的默认轨道半径（相对坐标）。 */
const ORBIT_RADIUS = 0.115;

export type GraphTopicNode = {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
};

export type GraphPersonNode = {
  person: FieldPerson;
  /** 布局归属的议题；`null` 表示「其他」。 */
  topicId: string | null;
  /** 该人物关联的全部议题 ID，用于筛选与高亮。 */
  topicIds: string[];
  x: number;
  y: number;
};

export type GraphGroup = {
  id: string;
  name: string;
  /** 议题分组对应议题 ID；「其他」分组为 null。 */
  topicId: string | null;
  people: GraphPersonNode[];
};

export type GraphLayout = {
  center: { x: number; y: number };
  fieldName: string;
  topics: GraphTopicNode[];
  people: GraphPersonNode[];
  groups: GraphGroup[];
  /** 「其他」分组的 ID，供界面标注使用。 */
  otherGroupId: string;
};

function clamp(value: number): number {
  return Math.min(1 - EDGE_MARGIN, Math.max(EDGE_MARGIN, value));
}

/** 归一化坐标 → SVG 坐标。 */
export function toViewBox(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: point.x * GRAPH_VIEWBOX.width,
    y: point.y * GRAPH_VIEWBOX.height,
  };
}

/**
 * 把人物分配到议题分组。
 *
 * 返回的分组顺序与议题在契约中的顺序一致；「其他」分组固定放在最后，
 * 保证渲染顺序稳定。
 */
function groupPeople(topics: GraphTopicNode[], people: FieldPerson[]): GraphGroup[] {
  const buckets = new Map<string, FieldPerson[]>();
  for (const topic of topics) buckets.set(topic.id, []);
  const others: FieldPerson[] = [];

  for (const person of people) {
    // 只保留真实存在的议题 ID：服务端可能下发了已下线的议题。
    const known = person.topicIds.filter((id) => buckets.has(id));
    if (known.length === 0) {
      others.push(person);
      continue;
    }
    buckets.get(known[0])?.push(person);
  }

  const groups: GraphGroup[] = topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    topicId: topic.id,
    people: (buckets.get(topic.id) ?? []).map((person) => ({
      person,
      topicId: topic.id,
      topicIds: person.topicIds.filter((id) => buckets.has(id)),
      x: 0,
      y: 0,
    })),
  }));

  if (others.length > 0) {
    groups.push({
      id: OTHER_GROUP_ID,
      name: OTHER_GROUP_NAME,
      topicId: null,
      people: others.map((person) => ({
        person,
        topicId: null,
        topicIds: [],
        x: 0,
        y: 0,
      })),
    });
  }

  return groups;
}

/** 把一组人物均匀铺在以中心为圆心的圆周上，起点固定朝上。 */
function orbit(
  nodes: GraphPersonNode[],
  center: { x: number; y: number },
): GraphPersonNode[] {
  const count = nodes.length;
  if (count === 1) {
    return [{ ...nodes[0], x: clamp(center.x), y: clamp(center.y - ORBIT_RADIUS) }];
  }
  return nodes.map((node, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    return {
      ...node,
      x: clamp(center.x + Math.cos(angle) * ORBIT_RADIUS),
      y: clamp(center.y + Math.sin(angle) * ORBIT_RADIUS),
    };
  });
}

/** 「其他」分组沿底部排成一行，不与议题轨道重叠。 */
function bottomRow(nodes: GraphPersonNode[]): GraphPersonNode[] {
  const count = nodes.length;
  const y = 1 - EDGE_MARGIN;
  if (count === 1) return [{ ...nodes[0], x: 0.5, y }];
  const span = 0.7;
  const start = 0.15;
  return nodes.map((node, index) => ({
    ...node,
    x: clamp(start + (span * index) / (count - 1)),
    y,
  }));
}

export function layoutGraph(graph: FieldGraphResponse): GraphLayout {
  const topics: GraphTopicNode[] = graph.topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    description: topic.description,
    x: clamp(topic.position.x),
    y: clamp(topic.position.y),
  }));

  const positionByTopic = new Map(topics.map((topic) => [topic.id, topic]));

  const placedGroups = groupPeople(topics, graph.people).map((group) => {
    if (group.topicId === null) {
      return { ...group, people: bottomRow(group.people) };
    }
    const anchor = positionByTopic.get(group.topicId) ?? { x: 0.5, y: 0.5 };
    return { ...group, people: orbit(group.people, anchor) };
  });

  return {
    center: { x: 0.5, y: 0.5 },
    fieldName: graph.field.name,
    topics,
    people: placedGroups.flatMap((group) => group.people),
    groups: placedGroups,
    otherGroupId: OTHER_GROUP_ID,
  };
}

/**
 * 议题筛选。
 *
 * `null` 表示不筛选（全部人物）；`OTHER_GROUP_ID` 表示只看「其他」分组。
 * 一个关联多个议题的人物会被所有这些议题命中——这与星图上的高亮规则一致。
 */
export function filterPeopleByTopic(
  layout: GraphLayout,
  topicId: string | null,
): GraphPersonNode[] {
  if (!topicId) return layout.people;
  if (topicId === OTHER_GROUP_ID) {
    return layout.people.filter((node) => node.topicId === null);
  }
  return layout.people.filter((node) => node.topicIds.includes(topicId));
}

/**
 * 「其他」分组只用于布局，不参与议题筛选：
 * 它没有议题 ID，因此被排除在所有议题筛选之外是正确行为。
 */
export function topicIdsOf(layout: GraphLayout): string[] {
  return layout.topics.map((topic) => topic.id);
}
