import { creatorCardSchema, type CreatorCardData } from "@/shared/contracts/creator";
import type { FieldPerson } from "@/shared/contracts/field";

/** 将星图已有的公开人物字段转换为领域来源名片，避免因资料接口 404 阻断浏览。 */
export function fieldPersonToCreatorCard(
  person: FieldPerson,
  fieldName: string,
  topicNames: string[],
): CreatorCardData {
  return creatorCardSchema.parse({
    id: person.id,
    name: person.name,
    headline: person.headline,
    initial: person.initial,
    avatarTone: person.avatarTone,
    avatarUrl: person.avatarUrl,
    profileUrl: person.profileUrl,
    identityConfidence: "low",
    role: "领域相关",
    relevanceLevel:
      person.relevance >= 85
        ? "高度相关"
        : person.relevance >= 70
          ? "部分相关"
          : "补充视角",
    score: person.relevance,
    matchedDimensions: topicNames.slice(0, 4),
    reason: `来自「${fieldName}」领域：公开内容主要涉及${
      topicNames.length > 0 ? topicNames.join("、") : "该领域的多个议题"
    }。`,
    evidence: [],
    suitableQuestions: [],
    limitations: [
      "人物来自领域目录，只表示公开内容与议题相关，尚未核验其具体经历细节。",
      "领域相关度只用于排序展示，不代表可咨询程度或回答质量。",
    ],
  });
}
