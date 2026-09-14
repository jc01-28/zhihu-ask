import { describe, expect, it } from "vitest";

import { fieldPersonToCreatorCard } from "@/front/features/creator/field-person-card";
import { findFieldGraph } from "@/front/mocks/field-data";

describe("领域人物名片兜底", () => {
  it("保留星图公开资料且不虚构内容证据", () => {
    const graph = findFieldGraph("agent-development")!;
    const person = graph.people[0];
    const topicNames = graph.topics
      .filter((topic) => person.topicIds.includes(topic.id))
      .map((topic) => topic.name);

    const card = fieldPersonToCreatorCard(person, graph.field.name, topicNames);

    expect(card.name).toBe(person.name);
    expect(card.headline).toBe(person.headline);
    expect(card.evidence).toEqual([]);
    expect(card.role).toBe("领域相关");
    expect(card.matchedDimensions).toEqual(topicNames);
  });
});
