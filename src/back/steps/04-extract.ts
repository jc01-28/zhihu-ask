/**
 * Step 04 · Experience Event 抽取
 *
 * 全项目最关键的一步：从内容里抽出「这个人真的经历过什么」。
 * 计划书里最硬的那条约束在这里执行 —— 写过 ≠ 经历过：
 *   - firstPerson 标记是否第一人称叙述；
 *   - quote 必须是从原文里逐字摘录的片段，供 verify 步回溯；
 *   - 不确定就少抽，不要为了凑数编经历。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 两种模式（EXTRACT_MODE，默认 per-hit）—— 这个开关是被延迟逼出来的，
 * 而且**实测结论和直觉相反**：
 *
 *   per-hit ：每条内容各调一次（并发 4）。5 条内容 = 2 波调用。
 *   batch   ：一次调用处理全部内容，模型要回填 contentId。
 *
 * 实测（SenseNova sensenova-6.8-flash-lite，同一批 5 条内容）：
 *   per-hit → events 31.8s，抽出 5 条经历          ← 更好
 *   batch   → events 45.0s，只抽出 2 条经历        ← 更差
 *
 * 原因：batch 把 5×900 字的正文塞进一个 prompt，推理模型在长上下文上
 * 反而思考更久、且容易漏抽。所以**默认用 per-hit**，batch 只作为「上游
 * 按调用次数计费」时的备选。
 *
 * 真正压住 maxDuration 的杠杆是 EXTRACT_MAX_HITS（默认 4）：
 * 并发 4 + 4 条内容 = 1 波调用，events 步骤回落到单次调用耗时。
 * 如果候选覆盖不够再往上调，但要盯着整条链路耗时。
 * ══════════════════════════════════════════════════════════════════════
 *
 * 还可升级：
 *   - 加「时间护栏」：识别 from/to 的时间关系，避免把旧状态当现状；
 *   - 加「不确定性」字段，让抽取层自己报信心。
 */

import type { AskBoot } from '@/back/domain/experiment';
import { resolveExperiment } from '@/back/domain/experiment';
import type { ExperienceEvent, ProblemProfile } from '@/back/domain/types';
import { llmConcurrency, pMap } from '@/back/framework/concurrency';
import type { Step, StepContext } from '@/back/framework/pipeline';
import type { SearchHit } from '@/back/framework/ports';
import { clamp01, llmOrFallback } from './shared';

/** 环境变量仍可作为全局默认值；实验配置会覆盖它 */
const ENV_MAX_HITS = Number(process.env.EXTRACT_MAX_HITS || 4);
/** 按条模式：单条正文截断长度 */
const MAX_TEXT = 1500;
/** 批量模式：单条正文截断长度（总 prompt 更大，所以要压短一些） */
const MAX_TEXT_BATCH = 900;

const RULES =
  '严格规则：\n' +
  '1. 只抽第一人称的真实经历，旁观者评论、纯观点、方法论综述一律不要。\n' +
  '2. quote 必须从原文逐字摘录，不得改写、不得拼接、不得概括。\n' +
  '3. 原文没有明确经历时，不要为了凑数编造。\n' +
  '4. relevance 表示这段经历与用户问题的相关程度，0 到 1。';

const SCHEMA_PER_HIT = `{
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

const SCHEMA_BATCH = `{
  "events": [
    {
      "contentId": "必须原样回填输入里那条内容的 contentId",
      "firstPerson": true,
      "from": "转变前状态",
      "to": "转变后状态",
      "decision": "当时做的关键判断",
      "constraints": ["当时受什么约束"],
      "timeHint": "时间线索",
      "quote": "从该条 contentId 对应的原文里逐字摘录",
      "relevance": 0.0
    }
  ]
}`;

// ── 无 LLM 时的兜底：只做「第一人称 + 摘录」两件事，不做推断 ──────────────

const FIRST_PERSON_HINTS = ['我当时', '我在', '我是', '我最后', '我选择', '我接', '我拒', '我转'];
const TIME_HINTS = ['年', '去年', '前年', '三年', '两年', '个月', '当时', '后来', '现在'];

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

// ── 输出校验 ───────────────────────────────────────────────────────────

interface RawEvent {
  contentId?: unknown;
  firstPerson?: unknown;
  from?: unknown;
  to?: unknown;
  decision?: unknown;
  constraints?: unknown;
  timeHint?: unknown;
  quote?: unknown;
  relevance?: unknown;
}

function toEvent(raw: RawEvent, hit: SearchHit, index: number): ExperienceEvent | null {
  const quote = typeof raw.quote === 'string' ? raw.quote.trim() : '';
  // 证据护栏：没有摘录就没有经历事件
  if (!quote) return null;

  return {
    id: `${hit.contentId}:${index}`,
    sourceContentId: hit.contentId,
    sourceUrl: hit.url,
    sourceTitle: hit.title,
    authorName: hit.authorName,
    firstPerson: raw.firstPerson !== false,
    from: typeof raw.from === 'string' ? raw.from : '',
    to: typeof raw.to === 'string' ? raw.to : '',
    decision: typeof raw.decision === 'string' ? raw.decision : '',
    constraints: Array.isArray(raw.constraints)
      ? raw.constraints.filter((c): c is string => typeof c === 'string').slice(0, 5)
      : [],
    timeHint: typeof raw.timeHint === 'string' ? raw.timeHint : '',
    quote,
    relevance: clamp01(typeof raw.relevance === 'number' ? raw.relevance : hit.rankingScore),
  };
}

function validatePerHit(raw: unknown, hit: SearchHit, fallback: ExperienceEvent[]): ExperienceEvent[] {
  if (!raw || typeof raw !== 'object') return fallback;
  const list = (raw as { events?: unknown }).events;
  if (!Array.isArray(list)) return fallback;

  const events = list
    .map((item, i) => toEvent((item ?? {}) as RawEvent, hit, i))
    .filter((e): e is ExperienceEvent => e !== null);

  return events.length ? events : fallback;
}

/**
 * 批量模式的校验：
 *   contentId 必须能对上输入 —— 对不上就丢弃。
 *   因为 verify 步要按 contentId 找到原文才能回溯 quote；
 *   contentId 丢了证据链就断了，这种情况下宁可不要这条事件。
 */
function validateBatch(raw: unknown, hitById: Map<string, SearchHit>): ExperienceEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { events?: unknown }).events;
  if (!Array.isArray(list)) return [];

  const events: ExperienceEvent[] = [];
  list.forEach((item, index) => {
    const rawEvent = (item ?? {}) as RawEvent;
    const contentId = typeof rawEvent.contentId === 'string' ? rawEvent.contentId : '';
    const hit = hitById.get(contentId);
    if (!hit) return; // contentId 缺失或对不上 → 丢弃，不猜
    const event = toEvent(rawEvent, hit, index);
    if (event) events.push(event);
  });
  return events;
}

// ── 抽取预算分配 ───────────────────────────────────────────────────────

/** 强第一人称信号：出现即说明作者在讲自己做过的事 */
const STRONG_FIRST_PERSON = ['我当时', '我最后', '我选择', '我决定', '我接', '我拒', '我转', '我也曾', '我当时也'];

/** 弱信号：叙述性线索 */
const WEAK_NARRATIVE = ['我', '去年', '前年', '当时', '后来', '纠结', '复盘', '后悔', '踩坑', '当年'];

/** 反信号：指南/评测/资讯类，通常没有亲身经历 */
const GUIDE_LIKE = ['指南', '教程', '科普', '汇总', '盘点', '榜单', '是什么', '有哪些', '如何评价', '值得吗'];

/**
 * 决定把「抽取预算」花在哪几条内容上。
 *
 * 为什么不能直接用召回排序的前 N 条：**这是全项目最贵的一步**（每条内容一次 LLM 调用），
 * 而召回按「与问题的相关性」排序，不是按「有没有亲身经历」排序。
 *
 * 实测踩过：真实数据一次运行召回 16 条，相关性最高的前 2 条是政策解读和行业综述
 * （正文里连一个「我」都没有），而真正带第一人称经历、讲到「我当时也纠结了很久」的那条
 * 排在第 15。把预算花在前几名上，等于用最贵的算力处理最没用的内容 —— 那次抽出 0 条经历。
 *
 * 所以先用**便宜的正则**判断哪条值得花**昂贵的模型调用**，同时用作者分散保证候选广度。
 * 这就是「写过 ≠ 经历过」在产品最贵那一步上的落地。
 */
export function scoreForExtraction(hit: SearchHit): number {
  const text = hit.contentText ?? '';
  if (!text) return 0;

  let score = 0;

  for (const kw of STRONG_FIRST_PERSON) if (text.includes(kw)) score += 3;
  for (const kw of WEAK_NARRATIVE) if (text.includes(kw)) score += 1;
  // 弱信号容易靠单字「我」堆分，设个上限
  score = Math.min(score, 14);

  // 反信号：标题像指南/资讯的，扣分
  if (GUIDE_LIKE.some((kw) => hit.title.includes(kw))) score -= 4;

  // 正文太短没有叙述空间；太长也不加分（我们只截前 1500 字）
  if (text.length < 120) score -= 3;
  else if (text.length >= 300) score += 1;

  return score;
}

/**
 * 选出要花抽取预算的内容：叙述性 × 相关性，且作者尽量分散。
 * 顺序不影响后续逻辑（经历事件自带 contentId），所以这里可以自由重排。
 */
export function selectHitsForExtraction(hits: SearchHit[], max: number): SearchHit[] {
  if (hits.length <= max) return hits;

  const maxRanking = hits.reduce((m, h) => Math.max(m, h.rankingScore || 0), 0) || 1;
  const scored = hits.map((hit) => ({
    hit,
    // 叙述性占 6 成权重：这一步要的是「经历」，不是「相关」
    score: (scoreForExtraction(hit) / 14) * 0.6 + ((hit.rankingScore || 0) / maxRanking) * 0.4,
  }));

  scored.sort((a, b) => b.score - a.score);

  // 第一轮：每个作者最多 1 条（保证候选广度 —— 产出是「三个互补的人」）
  const picked: SearchHit[] = [];
  const perAuthor = new Map<string, number>();
  const used = new Set<string>();
  for (const { hit } of scored) {
    if (picked.length >= max) break;
    const author = hit.authorName || hit.contentId;
    if (perAuthor.has(author)) continue;
    perAuthor.set(author, 1);
    used.add(hit.contentId);
    picked.push(hit);
  }

  // 第二轮：预算还有剩，允许同一作者再进第 2 条（保证深度）
  for (const { hit } of scored) {
    if (picked.length >= max) break;
    if (used.has(hit.contentId)) continue;
    const author = hit.authorName || hit.contentId;
    if ((perAuthor.get(author) ?? 0) >= 2) continue;
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
    used.add(hit.contentId);
    picked.push(hit);
  }

  return picked;
}

// ── 两种执行模式 ───────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  '你是经历抽取器。从一段知乎内容中，抽取作者「亲身经历过」的职业/人生决策事件。\n' + RULES;

async function runPerHit(
  hits: SearchHit[],
  profile: ProblemProfile,
  ctx: StepContext,
): Promise<ExperienceEvent[]> {
  const batches = await pMap(
    hits,
    async (hit) => {
      const fallback = heuristic(hit, profile);
      return llmOrFallback<ExperienceEvent[]>(
        ctx,
        {
          system: SYSTEM_PROMPT,
          input: {
            userProblem: {
              currentState: profile.currentState,
              goal: profile.goal,
              needExperiences: profile.needExperiences,
            },
            content: {
              title: hit.title,
              author: hit.authorName,
              text: hit.contentText.slice(0, MAX_TEXT),
            },
          },
          schemaHint: SCHEMA_PER_HIT,
          cacheKey: `extract:${hit.contentId}`,
          validate: (raw) => validatePerHit(raw, hit, fallback),
        },
        () => fallback,
        `extract(${hit.contentId})`,
      );
    },
    {
      concurrency: llmConcurrency(),
      onError: (error, index) =>
        ctx.logger.warn(`抽取失败（第 ${index + 1} 条）${(error as Error).message}`),
    },
  );

  return batches
    .filter((events): events is ExperienceEvent[] => Array.isArray(events))
    .flat();
}

async function runBatch(
  hits: SearchHit[],
  profile: ProblemProfile,
  ctx: StepContext,
): Promise<ExperienceEvent[]> {
  const hitById = new Map(hits.map((h) => [h.contentId, h]));

  return llmOrFallback<ExperienceEvent[]>(
    ctx,
    {
      system:
        SYSTEM_PROMPT +
        '\n5. 输入里可能有**多条**内容，每条带一个 contentId。' +
        '每条事件必须回填它来自哪条内容的 contentId，不得张冠李戴。' +
        '某条内容没有第一人称经历，就不要为它产出事件。',
      input: {
        userProblem: {
          currentState: profile.currentState,
          goal: profile.goal,
          needExperiences: profile.needExperiences,
        },
        contents: hits.map((hit) => ({
          contentId: hit.contentId,
          title: hit.title,
          author: hit.authorName,
          text: hit.contentText.slice(0, MAX_TEXT_BATCH),
        })),
      },
      schemaHint: SCHEMA_BATCH,
      cacheKey: `extract-batch:${profile.currentState}:${hits.map((h) => h.contentId).join(',')}`,
      validate: (raw) => {
        const parsed = validateBatch(raw, hitById);
        // 解析失败或全部对不上：退回逐条的启发式（不再调模型），保证链路不断
        return parsed.length ? parsed : hits.flatMap((h) => heuristic(h, profile));
      },
    },
    () => hits.flatMap((h) => heuristic(h, profile)),
    'extract(batch)',
  );
}

/** 从实验配置读抽取预算；A/B 组没有经历抽取，预算为 0 */
function maxHitsFrom(ctx: StepContext): number {
  const cfg = resolveExperiment((ctx.config as AskBoot | undefined)?.experiment?.id);
  if (!cfg.extractExperience) return 0;
  return cfg.extractMaxHits || ENV_MAX_HITS;
}

export const extractStep: Step = {
  name: 'events',
  from: ['recall', 'profile'],
  describe: '从内容中抽取可验证的经历事件（Experience Event）',
  optional: true,
  // Baseline A/B 只做检索，不做经历抽取 —— 这正是它们与 C 组的核心差异
  shouldRun: (_input, ctx) =>
    resolveExperiment((ctx.config as AskBoot | undefined)?.experiment?.id).extractExperience,
  async run(input: { recall: SearchHit[]; profile: ProblemProfile }, ctx) {
    const maxHits = maxHitsFrom(ctx);
    // 先按作者分散，再花抽取预算 —— 产出是「三个互补的人」，不是「三条最相关的内容」
    const hits = selectHitsForExtraction(input.recall ?? [], maxHits || ENV_MAX_HITS);
    if (!hits.length) {
      ctx.logger.info('没有召回内容，跳过抽取');
      return [];
    }

    const mode = process.env.EXTRACT_MODE || 'per-hit';
    const events =
      mode === 'per-hit' || hits.length === 1
        ? await runPerHit(hits, input.profile, ctx)
        : await runBatch(hits, input.profile, ctx);

    const authors = new Set(events.map((e) => e.authorName));
    ctx.logger.info(
      `抽取到 ${events.length} 条经历事件（${mode === 'per-hit' ? '逐条' : '批量'}模式，` +
        `从 ${hits.length}/${input.recall?.length ?? 0} 条内容中，覆盖 ${authors.size} 位作者）`,
    );
    return events;
  },
  // 缓存 key 必须用「真正被抽的那些内容」，否则选片策略变了却命中旧缓存
  cacheKey: (input: { recall: SearchHit[]; profile: ProblemProfile }, ctx) => {
    const mode = process.env.EXTRACT_MODE || 'per-hit';
    const maxHits = maxHitsFrom(ctx) || ENV_MAX_HITS;
    const ids = selectHitsForExtraction(input.recall ?? [], maxHits)
      .map((h) => h.contentId)
      .join(',');
    return `events:${mode}:${input.profile.currentState}:${ids}`;
  },
};
