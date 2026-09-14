import {
  FIELD_COLOR_TOKENS,
  type FieldColorToken,
  type FieldGraphResponse,
  type FieldSummary,
} from "@/shared/contracts/field";
import type { CreatorCardData, Evidence } from "@/shared/contracts/creator";
import type {
  BackgroundDocument,
  PersonSearchResult,
} from "@/shared/contracts/search";

type RecordLike = Record<string, unknown>;

const COLOR_BY_HEX: Record<string, FieldColorToken> = {
  "#2F6FED": "blue",
  "#1D9E75": "emerald",
  "#D85A30": "rose",
  "#7F77DD": "violet",
  "#EF9F27": "amber",
  "#639922": "teal",
  "#A855F7": "violet",
  "#0E7490": "cyan",
};

const ICON_BY_BACKEND_VALUE: Record<string, string> = {
  "🤖": "bot",
  "✨": "sparkles",
  "💳": "landmark",
  "📊": "database",
  "🚀": "rocket",
  "🧩": "layers",
  "🔬": "shield",
};

const AVATAR_TONES = [
  "from-slate-950 to-slate-700",
  "from-blue-700 to-cyan-500",
  "from-violet-700 to-fuchsia-500",
  "from-emerald-700 to-teal-500",
] as const;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function httpsOrNull(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\//i.test(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

function avatarToneOf(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

function fieldColor(value: unknown, id: string): FieldColorToken {
  const raw = stringValue(value).trim();
  if ((FIELD_COLOR_TOKENS as readonly string[]).includes(raw)) return raw as FieldColorToken;
  const byHex = COLOR_BY_HEX[raw.toUpperCase()];
  if (byHex) return byHex;
  return FIELD_COLOR_TOKENS[Math.abs(id.length) % FIELD_COLOR_TOKENS.length];
}

export function unwrapBackendEnvelope(payload: unknown): unknown {
  const record = asRecord(payload);
  return record?.status === "success" && "data" in record ? record.data : payload;
}

export function mapBackendField(value: unknown): FieldSummary {
  const record = asRecord(value) ?? {};
  const id = stringValue(record.id, "unknown-field");
  const rawIcon = stringValue(record.icon).trim();
  return {
    id,
    name: stringValue(record.name, id),
    description: stringValue(record.description),
    icon: ICON_BY_BACKEND_VALUE[rawIcon] ?? (rawIcon || null),
    color: fieldColor(record.color, id),
    tags: stringArray(record.tags).slice(0, 6),
    memberCount: Math.max(0, Math.trunc(numberValue(record.memberCount))),
    topicCount: Math.max(0, Math.trunc(numberValue(record.topicCount))),
  };
}

function looksLikeBackendField(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(record && typeof record.id === "string" && typeof record.name === "string" && typeof record.description === "string");
}

export function mapBackendFieldList(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.every(looksLikeBackendField) ? { items: value.map(mapBackendField) } : value;
  }
  const record = asRecord(value);
  if (record && Array.isArray(record.items)) {
    return record.items.every(looksLikeBackendField) ? { items: record.items.map(mapBackendField) } : value;
  }
  if (record && Array.isArray(record.fields)) {
    return record.fields.every(looksLikeBackendField) ? { items: record.fields.map(mapBackendField) } : value;
  }
  return value;
}

function normalizeCoordinate(value: unknown): number {
  const numeric = numberValue(value);
  return clamp(Math.abs(numeric) > 1 ? numeric / 1000 : numeric, 0, 1);
}

export function mapBackendFieldGraph(value: unknown): FieldGraphResponse {
  const record = asRecord(value) ?? {};
  const topics = Array.isArray(record.topics)
    ? record.topics.map((item) => {
        const topic = asRecord(item) ?? {};
        return {
          id: stringValue(topic.id, "topic"),
          name: stringValue(topic.name, "未命名议题"),
          description: stringValue(topic.description),
          position: {
            x: normalizeCoordinate(asRecord(topic.position)?.x),
            y: normalizeCoordinate(asRecord(topic.position)?.y),
          },
        };
      })
    : [];
  const people = Array.isArray(record.people)
    ? record.people.map((item) => {
        const person = asRecord(item) ?? {};
        const id = stringValue(person.id, "unknown-person");
        const name = stringValue(person.name, id);
        const relevanceRaw = numberValue(person.relevance);
        return {
          id,
          name,
          headline: stringValue(person.headline),
          avatarUrl: httpsOrNull(person.avatarUrl),
          initial: stringValue(person.initial, initialOf(name)).slice(0, 2),
          // 后端返回的是十六进制色值；前端只允许固定的 Tailwind token，
          // 因此按人物 id 使用确定性安全色，而不把后端字符串拼进 className。
          avatarTone: avatarToneOf(id),
          topicIds: stringArray(person.topicIds).slice(0, 8),
          relevance: clamp(relevanceRaw <= 1 ? relevanceRaw * 100 : relevanceRaw, 0, 100),
          profileUrl: httpsOrNull(person.profileUrl),
        };
      })
    : [];
  return {
    field: mapBackendField(record.field),
    topics,
    people,
  };
}

function relevanceLevel(score: number): CreatorCardData["relevanceLevel"] {
  if (score >= 80) return "高度相关";
  if (score >= 55) return "部分相关";
  return "补充视角";
}

function identityConfidence(authorityLevel: number): CreatorCardData["identityConfidence"] {
  if (authorityLevel >= 4) return "high";
  if (authorityLevel >= 2) return "medium";
  return "low";
}

function roleForRecommendation(value: unknown, index: number): CreatorCardData["role"] {
  void value;
  return index === 0 ? "经历最接近" : index === 1 ? "关键维度" : "补充视角";
}

function mapEvidence(candidateId: string, raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 3).flatMap((item, index) => {
    const evidence = asRecord(item);
    if (!evidence) return [];
    const title = stringValue(evidence.title);
    if (!title) return [];
    return [{
      id: `${candidateId}-evidence-${index + 1}`,
      title,
      excerpt: stringValue(evidence.quote, title).slice(0, 180),
      kind: "专业分析",
      publishedAt: "",
      source: "zhihu_search",
      url: httpsOrNull(evidence.url),
    } satisfies Evidence];
  });
}

function mapRecommendation(value: unknown, index: number): CreatorCardData | null {
  const recommendation = asRecord(value);
  const candidate = asRecord(recommendation?.candidate);
  if (!candidate) return null;
  const id = stringValue(candidate.id, `backend-person-${index + 1}`);
  const name = stringValue(candidate.authorName, id);
  const scoreRaw = numberValue(candidate.score);
  const score = clamp(scoreRaw <= 1 ? scoreRaw * 100 : scoreRaw, 0, 100);
  const evidence = mapEvidence(id, recommendation?.evidence);
  const relevant = stringArray(recommendation?.relevantToYou);
  const limitations = stringArray(recommendation?.notGoodAt);
  return {
    id,
    name,
    headline: stringValue(candidate.headline, stringValue(candidate.authorBadgeText)).slice(0, 200),
    initial: initialOf(name).slice(0, 2),
    avatarTone: avatarToneOf(id),
    avatarUrl: httpsOrNull(candidate.authorAvatar),
    profileUrl: httpsOrNull(candidate.profileUrl),
    identityConfidence: identityConfidence(numberValue(candidate.authorityLevel)),
    role: roleForRecommendation(recommendation?.role, index),
    relevanceLevel: relevanceLevel(score),
    score,
    matchedDimensions: relevant.slice(0, 4),
    reason: stringValue(recommendation?.whyRecommended, "后端返回了相关公开内容，但没有提供推荐说明。").slice(0, 500),
    evidence,
    suitableQuestions: relevant.slice(0, 3),
    limitations: limitations.slice(0, 4),
  };
}

function mapBackground(value: unknown): BackgroundDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const url = httpsOrNull(record?.url);
    const title = stringValue(record?.title);
    if (!record || !url || !title) return [];
    return [{
      scope: "background",
      source: "global_search",
      title,
      excerpt: stringValue(record.excerpt, stringValue(record.quote)).slice(0, 800),
      url,
      thumbnailUrl: httpsOrNull(record.thumbnailUrl),
      publishedAt: typeof record.publishedAt === "number" ? record.publishedAt : null,
    } satisfies BackgroundDocument];
  });
}

export function mapBackendAskResult(value: unknown): PersonSearchResult {
  const record = asRecord(value) ?? {};
  const metrics = asRecord(record.metrics) ?? {};
  const cards = Array.isArray(record.recommendations)
    ? record.recommendations
        .map((item, index) => mapRecommendation(item, index))
        .filter((item): item is CreatorCardData => item !== null)
        .slice(0, 3)
    : [];
  const rawRunId = stringValue(record.runId);
  const runId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawRunId)
    ? rawRunId
    : null;
  return {
    cards,
    modeUsed: "live",
    fallbackReason: null,
    modelFallback: false,
    contextStatus: "unavailable",
    contextSourceCounts: { creation: 0, followee: 0, collection: 0, favlist: 0 },
    searchedQueries: stringArray(asRecord(record.profile)?.searchQueries),
    background: mapBackground(record.contentOnly),
    analyzedContentCount: Math.max(0, Math.trunc(numberValue(metrics.hitCount))),
    rejectedContentCount: Math.max(
      0,
      Math.round(numberValue(metrics.eventCount) * numberValue(metrics.noEvidenceRate)),
    ),
    runId,
    persistence: runId ? "saved" : "unavailable",
  };
}
