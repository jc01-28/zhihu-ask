/**
 * 处理器 · 问题找人域
 *
 * 四个接口：
 *   POST /api/agent/search         → **NDJSON 流式**（六阶段进度 + 最终结果）
 *   GET  /api/agent/runs/:runId    → 刷新后恢复上一次搜索
 *   POST /api/compare              → 三栏对比（原文侧 vs Agent 侧）
 *   GET  /api/topics/hot           → 热榜选题
 *
 * 这一层的职责是**把 8 步链路的产物映射成前端契约的形状**，并承载流式协议。
 * 链路本身一行不改 —— 那是 e2e 与对照实验的共同基准。
 */

import { randomUUID } from 'node:crypto';
import { createRuntime } from '@/back/adapters';
import { loadRun, runExpiry, saveRun } from '@/back/adapters/run-store';
import { openSession, type OAuthSession } from '@/back/adapters/session';
import { httpsOrNull } from '@/back/domain/avatar';
import { toBackgroundDocuments, toCreatorCard } from '@/back/domain/creator-card';
import { createPhaseStream } from '@/back/domain/phases';
import { toSearchHitCard } from '@/back/domain/search-hit';
import type { PipelineStepEvent } from '@/back/framework/pipeline';
import type { SearchHit } from '@/back/framework/ports';
import { runAsk } from '@/back/steps';
import type { AskResult } from '@/back/domain/types';
import {
  API_ERROR_CODES,
  type ApiErrorEnvelope,
  type BackgroundDocument,
  type CompareResponse,
  type ContextSourceCounts,
  type ContextStatus,
  type DataMode,
  type HotTopicsResponse,
  type PersonSearchResult,
  type RunRestoreResponse,
  type SearchAgentEvent,
} from '@/shared/contract';
import { checkRate } from './rate-limit';
import { fail, ok, type HandlerResult } from './types';

/** 检索类接口的输入长度上限，与 `handleAsk` 保持同一口径 */
const MIN_QUERY_CHARS = Number(process.env.MIN_QUESTION_CHARS ?? 4);
const MAX_QUERY_CHARS = Number(process.env.MAX_QUESTION_CHARS ?? 300);
const MAX_SESSION_ID_CHARS = 100;

/** 链路内部错误。刻意不在前端公开错误码清单里 —— 走通用错误提示即可 */
const INTERNAL_ERROR = 'INTERNAL_ERROR';

const MAX_TOPICS = 12;
const MAX_COMPARE_HITS = 10;

function envelope(
  code: string,
  message: string,
  retryable = false,
  details?: unknown,
): ApiErrorEnvelope {
  return details === undefined
    ? { code, message, retryable }
    : { code, message, retryable, details };
}

const mode = (): 'live' | 'fixture' => (process.env.USE_FIXTURES === '1' ? 'fixture' : 'live');

/**
 * 契约里的 `provider` 是**数据源名**（`zhihu_search` / `fixture`），
 * 而不是运行模式名（`live` / `fixture`）。
 *
 * 两者容易混：模式回答「这次跑的是真数据还是样例」，
 * 数据源回答「这条内容从哪儿来的」。对证据溯源来说，后者才是要记住的信息。
 */
const provider = (): 'zhihu_search' | 'fixture' =>
  process.env.USE_FIXTURES === '1' ? 'fixture' : 'zhihu_search';

// ── 请求校验 ────────────────────────────────────────────────────────────

interface ParsedSearch {
  query: string;
  sessionId: string;
  mode: DataMode;
}

/**
 * 校验搜索请求。契约里 `searchRequestSchema` 是 `.strict()`：
 * **恰好 query / sessionId / mode 三个键**，多一个前端就会拒整条请求。
 *
 * 所以这里也主动拒绝多余字段 —— 与其让前端在解析时才发现，
 * 不如后端直接说清「你多传了 X」。
 */
function parseSearchRequest(body: unknown): ParsedSearch | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: '请求体必须是 JSON 对象' };
  }
  const b = body as Record<string, unknown>;

  const extra = Object.keys(b).filter((k) => !['query', 'sessionId', 'mode'].includes(k));
  if (extra.length) {
    return { error: `请求体含未声明的字段：${extra.join('、')}（契约是 .strict()）` };
  }

  const query = typeof b.query === 'string' ? b.query.trim() : '';
  if (query.length < MIN_QUERY_CHARS || query.length > MAX_QUERY_CHARS) {
    return {
      error: `query 长度需在 ${MIN_QUERY_CHARS}~${MAX_QUERY_CHARS} 字之间（当前 ${query.length}）`,
    };
  }

  const sessionId = typeof b.sessionId === 'string' ? b.sessionId.trim() : '';
  if (!sessionId || sessionId.length > MAX_SESSION_ID_CHARS) {
    return { error: `sessionId 必填且不超过 ${MAX_SESSION_ID_CHARS} 字` };
  }

  const m = b.mode ?? 'auto';
  if (m !== 'fixture' && m !== 'live' && m !== 'auto') {
    return { error: 'mode 只能是 fixture / live / auto' };
  }

  return { query, sessionId, mode: m };
}

// ── 结果映射 ────────────────────────────────────────────────────────────

/**
 * 用户上下文的可用状态。
 *
 * ⚠️ 这是个**基于证据的推断**，不是从运行时长出来的字段，所以要写清楚依据：
 *   · 没有授权会话            → `unavailable`（我们连读的能力都没有）
 *   · 有会话，且读到过关注关系 → `applied`（确实用上了）
 *   · 有会话，但一条关注都没读到 → `partial`
 *     （可能是用户本来就没关注，也可能是那次读取失败了 —— 我们**无法区分**，
 *      所以给中间的 `partial` 而不是硬说 `applied` 骗前端）
 */
function contextStatusOf(core: AskResult, session: OAuthSession | null): ContextStatus {
  if (!session) return 'unavailable';
  const usedFollowee = core.recommendations.some((r) => r.candidate.alreadyFollowed);
  return usedFollowee ? 'applied' : 'partial';
}

/**
 * 上下文来源计数。
 *
 * 我们**只读关注列表**：知乎开放平台没有给「我的收藏 / 我的创作」这类接口的稳定入口，
 * 所以另外三项如实报 0，而不是编一个数字。
 */
function contextCountsOf(core: AskResult): ContextSourceCounts {
  const followed = new Set(
    core.recommendations.filter((r) => r.candidate.alreadyFollowed).map((r) => r.candidate.id),
  );
  return { creation: 0, followee: followed.size, collection: 0, favlist: 0 };
}

/** 降级原因。**没有降级就给 null**，不要为了填字段编一句话 */
function fallbackReasonOf(core: AskResult): string | null {
  if ((process.env.LLM_PROVIDER ?? '').toLowerCase() === 'none') {
    return '模型未配置，经历抽取与重排走确定性降级';
  }
  const failed = core.trace.filter((t) => t.status === 'failed');
  if (failed.length) return `${failed.length} 个步骤失败，已按降级路径继续`;
  const skipped = core.trace.filter((t) => t.status === 'skipped');
  if (skipped.length) return `${skipped.length} 个步骤被跳过`;
  return null;
}

function toPersonSearchResult(core: AskResult, session: OAuthSession | null): PersonSearchResult {
  const modeUsed = mode();
  return {
    cards: core.recommendations.slice(0, 3).map((rec) => toCreatorCard(rec, modeUsed)),
    modeUsed,
    fallbackReason: fallbackReasonOf(core),
    modelFallback: (process.env.LLM_PROVIDER ?? '').toLowerCase() === 'none',
    contextStatus: contextStatusOf(core, session),
    contextSourceCounts: contextCountsOf(core),
    searchedQueries: core.profile?.searchQueries ?? [],
    background: toBackgroundDocuments(core.contentOnly ?? []),
    analyzedContentCount: core.metrics.hitCount,
    // 「召回但没能抽出经历」的内容数 —— 界面上的「已排除内容」
    rejectedContentCount: Math.max(0, core.metrics.hitCount - core.metrics.eventCount),
    runId: core.runId,
    // 先给乐观值，保存失败时由调用方改写
    persistence: 'saved',
  };
}

// ── 热榜 ────────────────────────────────────────────────────────────────

/**
 * 热榜选题。
 *
 * ⚠️ **不可用时不是错误**。契约用 `unavailable: true` 作为降级信号
 * （前端据此隐藏整个热榜区），而不是返回 5xx 让前端弹红条 ——
 * 热榜只是「不知道问什么」时的参考，它挂了不该影响主流程。
 *
 * 同理，某一条拿不到 https 地址就**直接丢弃**：宁可少一条，
 * 也不要发一个会被前端契约拒绝、或点进去是坏页的链接。
 */
export async function handleHotTopics(): Promise<HandlerResult> {
  const runtime = createRuntime({ getOAuthToken: async () => null });

  try {
    const items = await runtime.source.hotList(MAX_TOPICS);

    const topics: BackgroundDocument[] = items
      .map((item) => ({
        scope: 'background' as const,
        source: 'hot_list' as const,
        title: item.title,
        excerpt: item.summary,
        url: httpsOrNull(item.url) ?? '',
        thumbnailUrl: null,
        publishedAt: null,
      }))
      .filter((doc) => doc.url !== '');

    return ok({ topics, unavailable: false } satisfies HotTopicsResponse);
  } catch (error) {
    console.warn('[agent] 热榜不可用，按契约降级为空列表 + unavailable:true：', error);
    return ok({ topics: [], unavailable: true } satisfies HotTopicsResponse);
  }
}

// ── 流式搜索 ────────────────────────────────────────────────────────────

export interface AgentSearchInput {
  /** 已解析的请求体；`null` 表示 JSON 解析失败 */
  body: unknown;
  sessionToken: string | undefined;
  clientKey: string;
  /** NDJSON 推送函数。由 route 层提供，handler 只负责按协议发事件 */
  emit: (event: SearchAgentEvent) => void;
}

/**
 * 问题找人（NDJSON 流式）。
 *
 * **事件顺序固定**：`run.started` → 六阶段各 started/completed → `run.completed`。
 * 六阶段与 8 步的映射、以及「链路顺序与展示顺序交错」的处理见 `domain/phases.ts`。
 *
 * ⚠️ 失败也走**流内事件**（`run.failed`），HTTP 状态始终 200。
 * 理由：流一旦开始写，状态码就改不了了；契约里也有 `run.failed` 这个事件，
 * 说明前端本来就准备在流里处理错误。
 */
export async function handleAgentSearch(input: AgentSearchInput): Promise<void> {
  const requestId = randomUUID();
  const parsed = parseSearchRequest(input.body);

  if ('error' in parsed) {
    input.emit({
      type: 'run.failed',
      error: envelope(API_ERROR_CODES.invalidSearchRequest, parsed.error),
    });
    return;
  }

  input.emit({ type: 'run.started', requestId });

  const verdict = checkRate(input.clientKey);
  if (!verdict.ok) {
    input.emit({
      type: 'run.failed',
      error: envelope(
        API_ERROR_CODES.rateLimited,
        `请求过于频繁，请 ${verdict.retryAfterSec} 秒后再试`,
        true,
      ),
    });
    return;
  }

  const session = openSession(input.sessionToken);
  const phases = createPhaseStream((event) => input.emit(event));

  // 第 1 阶段发生在流水线之前，所以由这里直接收尾
  phases.externalDone(
    'loading_context',
    session
      ? '已授权：可读取你的关注列表，用于补齐创作者主页链接'
      : '未授权：仅使用公开检索，主页链接降级为「在知乎搜索 TA」',
  );

  try {
    const core = await runAsk(parsed.query, {
      getOAuthToken: async () => session?.accessToken ?? null,
      onStep: (event: PipelineStepEvent) => {
        if (event.phase === 'started') phases.stepStarted(event.step);
        else phases.stepCompleted(event.step, event.ms ?? 0, event.summary ?? '');
      },
    });

    const createdAt = Date.now();
    const expiresAt = runExpiry(createdAt);
    const mapped = toPersonSearchResult(core, session);

    // 第 6 阶段：保存结果。**存不下来不算失败** —— 用户要的是结果，保存只是锦上添花
    const saved = await saveRun({
      runId: core.runId,
      createdAt,
      expiresAt,
      result: mapped,
    });
    const persistence = saved ? 'saved' : 'unavailable';

    phases.externalDone(
      'saving',
      saved ? '结果已保存，刷新后可恢复' : '结果未能保存（磁盘不可写），本次仍可正常查看',
    );
    phases.finish();

    input.emit({
      type: 'run.completed',
      result: { ...mapped, persistence, runId: saved ? core.runId : null },
      runId: saved ? core.runId : null,
      persistence,
    });
  } catch (error) {
    // 兜底把没发的阶段补完，避免前端进度条永远卡在中间
    phases.finish();
    console.error('[agent] 搜索失败：', error);
    input.emit({
      type: 'run.failed',
      error: envelope(
        INTERNAL_ERROR,
        error instanceof Error ? error.message : '未知错误',
        true,
      ),
    });
  }
}

// ── 刷新恢复 ────────────────────────────────────────────────────────────

export async function handleRunRestore(runId: string): Promise<HandlerResult> {
  const run = await loadRun(runId);
  if (!run) {
    // 前端按 404 RUN_NOT_FOUND 处理：**静默清掉本地运行指针，回到 idle** ——
    // 用户没做错事（只是刷新得晚了一点），不该弹红条
    return fail(404, API_ERROR_CODES.runNotFound, '这次搜索结果已过期或不存在', false);
  }

  const body: RunRestoreResponse = {
    runId: run.runId,
    cards: run.result.cards,
    mode: run.result.modeUsed,
    contextStatus: run.result.contextStatus,
    analyzedCount: run.result.analyzedContentCount,
    rejectedCount: run.result.rejectedContentCount,
    fallbackReason: run.result.fallbackReason,
    modelFallback: run.result.modelFallback,
    contextSourceCounts: run.result.contextSourceCounts,
    searchedQueries: run.result.searchedQueries,
    background: run.result.background,
    // 能取回就说明当初确实存下来了
    persistence: 'saved',
    createdAt: run.createdAt,
    expiresAt: run.expiresAt,
  };
  return ok(body);
}

// ── 三栏对比 ────────────────────────────────────────────────────────────

export interface CompareInput {
  body: unknown;
  sessionToken: string | undefined;
  clientKey: string;
}

/**
 * 三栏对比：左边「**用你原话直接检索**」的结果，右边「完整 Agent 链路」的结果。
 *
 * 这个接口的存在意义就是把产品的价值摆出来：同一批内容，
 * 为什么 Agent 挑出来的人不一样 —— 因为中间多了经历抽取、证据核验与可解释重排。
 *
 * ⚠️ 它会**跑两遍检索**（原文侧 + 完整链路），额度消耗是单次搜索的两倍多，
 * 所以受限流保护，前端也不该在页面加载时自动调用 —— 只应由用户显式点「对比」触发。
 */
export async function handleCompare(input: CompareInput): Promise<HandlerResult> {
  const parsed = parseSearchRequest(input.body);
  if ('error' in parsed) {
    return fail(400, API_ERROR_CODES.invalidSearchRequest, parsed.error);
  }

  const verdict = checkRate(input.clientKey);
  if (!verdict.ok) {
    return fail(429, API_ERROR_CODES.rateLimited, `请求过于频繁，请 ${verdict.retryAfterSec} 秒后再试`, true);
  }

  const session = openSession(input.sessionToken);

  try {
    // 原文侧：**不加任何理解与扩词**，直接用用户原话检索 —— 这正是要对比的基线
    const runtime = createRuntime({ getOAuthToken: async () => session?.accessToken ?? null });
    let rawHits: SearchHit[] = [];
    try {
      rawHits = await runtime.source.searchContents({
        query: parsed.query,
        count: MAX_COMPARE_HITS,
      });
    } catch (error) {
      console.warn('[agent] 对比接口的原文侧检索失败，按空结果继续：', error);
    }

    const core = await runAsk(parsed.query, {
      getOAuthToken: async () => session?.accessToken ?? null,
    });
    const mapped = toPersonSearchResult(core, session);

    const body: CompareResponse = {
      modeUsed: mode(),
      modelFallback: mapped.modelFallback,
      contextStatus: mapped.contextStatus,
      raw: {
        // 「不扩词」这件事本身就是对比的一部分，所以这里只有一个词
        queries: [parsed.query],
        hits: rawHits.slice(0, MAX_COMPARE_HITS).map((hit) =>
          toSearchHitCard(hit, parsed.query, provider()),
        ),
      },
      agent: mapped,
    };
    return ok(body);
  } catch (error) {
    console.error('[agent] 对比失败：', error);
    return fail(
      500,
      INTERNAL_ERROR,
      error instanceof Error ? error.message : '未知错误',
      true,
    );
  }
}
