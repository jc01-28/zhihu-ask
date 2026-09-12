/**
 * Step 04 · Experience Event 抽取
 *
 * 全项目最关键的一步：从内容里抽出「这个人真的经历过什么」。
 * 计划书里最硬的那条约束在这里执行 —— 写过 ≠ 经历过：
 *   - firstPerson 标记是否第一人称叙述；
 *   - quote 必须是从原文里逐字摘录的片段，供 verify 步回溯；
 *   - 不确定就少抽，不要为了凑数编经历。
 *
 * 可升级方向：
 *   - 一次调用批处理多条内容（省额度）；
 *   - 加「时间护栏」：识别 from/to 的时间关系，避免把旧状态当现状；
 *   - 加「不确定性」字段，让抽取层自己报信心。
 */

import type { ExperienceEvent, ProblemProfile } from '@/domain/types';
import { SYS_INPUT, type Step } from '@/framework/pipeline';
import type { SearchHit } from '@/framework/ports';
import { clamp01, llmOrFallback } from './shared';

const MAX_HITS = 8;
const MAX_TEXT = 1500;

const SCHEMA = `{
  "events": [
    {
      "firstPerson": true,
      "from": "转变前状态",
      "to": "转变后状态",
      "decision": "当时做的关键判断",
      "constraints": ["当时受什么约束"],
      "timeHint": "时间线索，如 2023 年",
      "quote": "从原文逐字摘录的片段，必须原样出现在原文中",
      "relevance": 0.0
    }
  ]
}`;

const FIRST_PERSON_HINTS = ['我当时', '我在', '我是', '我最后', '我选择', '我接', '我拒', '我转'];
const TIME_HINTS = ['年', '去年', '前年', '三年', '两年', '个月', '当时', '后来', '现在'];

/** 没有 LLM 时的兜底：只做「第一人称 + 摘录」两件事，不做推断 */
function heuristic(hit: SearchHit, profile: ProblemProfile): ExperienceEvent[] {
  const text = hit.contentText;
  if (!text || text.length < 40) return [];

  const sentences = text.split(/(?<=[。！？；])/).filter((s) => s.trim().length > 12);
  const anchor = sentences.find((s) => FIRST_PERSON_HINTS.some((h) => s.includes(h)));
  if (!anchor) return [];

  const timeHint = TIME_HINTS.find((t) => text.includes(t)) ?? '';
  const constraints = profile.constraints.filter((c) => text.includes(c)).slice(0, 3);

  return [
    {
      id: `${hit.contentId}:0`,
      sourceContentId: hit.contentId,
      sourceUrl: hit.url,
      sourceTitle: hit.title,
      authorName: hit.authorName,
      firstPerson: true,
      from: '',
      to: '',
      decision: anchor.trim().slice(0, 120),
      constraints,
      timeHint,
      quote: anchor.trim().slice(0, 120),
      relevance: clamp01(hit.rankingScore),
    },
  ];
}

function coerce(
  raw: unknown,
  hit: SearchHit,
  fallback: ExperienceEvent[],
): ExperienceEvent[] {
  if (!raw || typeof raw !== 'object') return fallback;
  const list = (raw as { events?: unknown }).events;
  if (!Array.isArray(list)) return fallback;

  const events: ExperienceEvent[] = [];
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const r = item as Record<string, unknown>;
    const quote = typeof r.quote === 'string' ? r.quote.trim() : '';
    // 证据护栏：没有摘录就没有经历事件
    if (!quote) return;

    events.push({
      id: `${hit.contentId}:${index}`,
      sourceContentId: hit.contentId,
      sourceUrl: hit.url,
      sourceTitle: hit.title,
      authorName: hit.authorName,
      firstPerson: r.firstPerson !== false,
      from: typeof r.from === 'string' ? r.from : '',
      to: typeof r.to === 'string' ? r.to : '',
      decision: typeof r.decision === 'string' ? r.decision : '',
      constraints: Array.isArray(r.constraints)
        ? r.constraints.filter((c): c is string => typeof c === 'string').slice(0, 5)
        : [],
      timeHint: typeof r.timeHint === 'string' ? r.timeHint : '',
      quote,
      relevance: clamp01(typeof r.relevance === 'number' ? r.relevance : hit.rankingScore),
    });
  });

  return events.length ? events : fallback;
}

export const extractStep: Step = {
  name: 'events',
  from: ['recall', 'profile'],
  describe: '从内容中抽取可验证的经历事件（Experience Event）',
  optional: true,
  async run(input: { recall: SearchHit[]; profile: ProblemProfile }, ctx) {
    const hits = (input.recall ?? []).slice(0, MAX_HITS);
    const all: ExperienceEvent[] = [];

    for (const hit of hits) {
      const fallback = heuristic(hit, input.profile);
      const events = await llmOrFallback<ExperienceEvent[]>(
        ctx,
        {
          system:
            '你是经历抽取器。从一段知乎内容中，抽取作者「亲身经历过」的职业/人生决策事件。\n' +
            '严格规则：\n' +
            '1. 只抽第一人称的真实经历，旁观者评论、纯观点、方法论综述一律不要。\n' +
            '2. quote 必须从原文逐字摘录，不得改写、不得拼接、不得概括。\n' +
            '3. 原文没有明确经历时，返回 {"events": []}，不要为了凑数编造。\n' +
            '4. relevance 表示这段经历与用户问题的相关程度，0 到 1。',
          input: {
            userProblem: {
              currentState: input.profile.currentState,
              goal: input.profile.goal,
              needExperiences: input.profile.needExperiences,
            },
            content: {
              title: hit.title,
              author: hit.authorName,
              text: hit.contentText.slice(0, MAX_TEXT),
            },
          },
          schemaHint: SCHEMA,
          cacheKey: `extract:${hit.contentId}`,
          validate: (raw) => coerce(raw, hit, fallback),
        },
        () => fallback,
        `extract(${hit.contentId})`,
      );
      all.push(...events);
    }

    ctx.logger.info(`抽取到 ${all.length} 条经历事件（来自 ${hits.length} 条内容）`);
    return all;
  },
  // 缓存 key：内容 ID + 问题一起决定
  cacheKey: (input: { recall: SearchHit[]; profile: ProblemProfile }) =>
    `events:${input.profile.currentState}:${(input.recall ?? [])
      .slice(0, MAX_HITS)
      .map((h) => h.contentId)
      .join(',')}`,
};
