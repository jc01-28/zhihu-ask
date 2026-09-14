/**
 * 处理器 · 会话 / 消息 / 咨询 / 会话内 Agent
 *
 * ── 一个先说清楚的设计决定：会话不强制登录 ──────────────────────────────
 * 前端路由里，聊天页 `/app/chat/:conversationId` 是**唯一没有 `RequireAuth`**
 * 的页面（`/app`、`/app/find`、`/app/fields/*` 都有）。这是明确的信号：
 * 私聊要能在未登录时使用。所以这里不能返回 401，否则页面一进去就死。
 *
 * 身份因此分两种：
 *   · 已授权 —— 用真实 `PublicUser`（由知乎主页地址派生，不用 OAuth UID）
 *   · 未授权 —— 用**访客身份**，由一枚 httpOnly 的 `zh_guest` cookie 稳定标识
 *
 * 「稳定」很重要：同一个浏览器刷新后必须还是同一个访客，
 * 否则刷新一次就换一个人，之前的会话全找不回来。
 */

import { createHash, randomUUID } from 'node:crypto';
import { createRuntime } from '@/back/adapters';
import {
  conversationIdOf,
  loadConversation,
  newMessageId,
  saveConversation,
  type ConversationRecord,
} from '@/back/adapters/conversation-store';
import { openSession } from '@/back/adapters/session';
import { loadRun } from '@/back/adapters/run-store';
import { pageLimit } from '@/back/framework/params';
import {
  CONSULTATION_PACKAGES,
  applyTransition,
  findPackage,
  transitionMessage,
} from '@/back/domain/consultation';
import { getCreatorCard } from './creators';
import { toPublicUser } from './auth';
import { checkRate } from './rate-limit';
import { API_ERROR_CODES, type Consultation, type Conversation, type ConversationAgentEvent, type ConversationMessage, type CreatorCard, type MessageSender, type PublicUser } from '@/shared/contract';
import { fail, ok, tooMany, type CookieInstruction, type HandlerResult } from './types';

/** 访客 cookie。**不是**登录态，只是一个稳定的匿名标识 */
export const GUEST_COOKIE = 'zh_guest';

const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const MAX_CONTENT_CHARS = 2000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** 是否允许「答主演示消息」。默认开：演示咨询流程必须能切到答主视角 */
const allowCreatorDemo = (): boolean =>
  process.env.CONVERSATION_ALLOW_CREATOR_DEMO !== '0';

/** 流式切分之间的间隔，让增量可见。测试里设为 0 */
const STREAM_DELAY_MS = Number(process.env.AGENT_STREAM_DELAY_MS ?? 12);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nowIso = (): string => new Date().toISOString();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ── 身份 ──────────────────────────────────────────────────────────────── */

interface Actor {
  userId: string;
  user: PublicUser;
}

function guestActor(guestId: string): Actor {
  return {
    userId: `guest_${guestId}`,
    user: {
      id: `guest_${guestId}`,
      displayName: '访客',
      avatarUrl: null,
    },
  };
}

/**
 * 解析当前操作者。
 *
 * `issueGuestCookie` 表示这次需要**新下发**一枚访客 cookie ——
 * 只在第一次进入时发生，之后浏览器会自动带上。
 */
interface ResolvedActor {
  actor: Actor;
  /** 需要新下发一枚访客 cookie（仅在首次进入时） */
  issueGuestCookie: boolean;
  /** issueGuestCookie 为真时的新 id */
  freshGuestId: string | null;
}

function resolveActor(
  sessionToken: string | undefined,
  guestId: string | undefined,
): ResolvedActor {
  const session = openSession(sessionToken);
  const real = toPublicUser(session?.profile);
  if (real) {
    return { actor: { userId: real.id, user: real }, issueGuestCookie: false, freshGuestId: null };
  }

  if (guestId && /^[a-f0-9]{16,64}$/i.test(guestId)) {
    return {
      actor: guestActor(guestId),
      issueGuestCookie: false,
      freshGuestId: null,
    };
  }

  const fresh = createHash('sha256')
    .update(`${randomUUID()}${Date.now()}`)
    .digest('hex')
    .slice(0, 24);
  return { actor: guestActor(fresh), issueGuestCookie: true, freshGuestId: fresh };
}

function guestCookie(id: string): CookieInstruction {
  return {
    name: GUEST_COOKIE,
    value: id,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: GUEST_COOKIE_MAX_AGE,
    },
  };
}

/** ── 消息构造 ──────────────────────────────────────────────────────────── */

function message(
  conversationId: string,
  sender: MessageSender,
  content: string,
  clientMessageId: string | null = null,
): ConversationMessage {
  return {
    id: newMessageId(),
    conversationId,
    clientMessageId,
    sender,
    content,
    createdAt: nowIso(),
  };
}

function newConsultation(): Consultation {
  return {
    id: `c_${randomUUID()}`,
    status: 'free_chat',
    packageId: null,
    amount: null,
    updatedAt: nowIso(),
  };
}

/**
 * 开场的系统消息。
 *
 * 这句话不是客套 —— 它把「对面是 Agent 不是真人」这件事在**第一屏**说清楚。
 * 产品诚实性要求 Agent 不得伪装成答主，而开场是最该说的地方。
 */
function openingMessage(conversationId: string, creatorName: string): ConversationMessage {
  return message(
    conversationId,
    'system',
    `你现在进入的是「${creatorName}」的会话。对方本人不在线时，由 TA 的 AI Agent 基于 TA 的公开内容代为回应；` +
      `Agent 的回答会标注来源，无法确认的地方会直说。你可以先描述你的处境。`,
  );
}

/** ── 接口 ──────────────────────────────────────────────────────────────── */

export interface ConversationActorInput {
  sessionToken: string | undefined;
  guestId: string | undefined;
}

export interface CreateConversationInput extends ConversationActorInput {
  creatorId: string;
  sourceRunId: string | null;
}

/**
 * 会话里内嵌哪一张人物卡。
 *
 * ⚠️ **必须优先用 `sourceRunId` 那次检索里的卡片**。
 * 只查注册表的话拿到的是「领域关联」版本：`evidence: []`、`role: 领域相关`、
 * `reason` 是「在「XX」下的公开内容与这些议题相关」—— 因为它只由语料作者在哪些
 * 议题下出现过推导，不携带逐条核验过的证据。
 *
 * 后果很具体：从搜索结果点「与 TA 聊聊」，那张卡明明有 3 条证据，
 * 存进会话的却是一张空证据卡；会话 Agent 的护栏看到 `evidence` 为空就**不调模型**，
 * 只会回「没有可引用内容」。等于「可署名、可引用、可追问」这条产品主张
 * 在最主要的使用路径上是断的。
 */
async function resolveCreatorForConversation(
  creatorId: string,
  sourceRunId: string | null,
): Promise<CreatorCard | null> {
  let creator = await getCreatorCard(creatorId);

  if (sourceRunId) {
    try {
      const run = await loadRun(sourceRunId);
      const fromRun = run?.result?.cards?.find((card) => card.id === creatorId);
      // 只在那张卡真的带证据时才覆盖 —— 没有证据的版本没有替换价值
      if (fromRun && fromRun.evidence.length > 0) creator = fromRun;
    } catch (error) {
      // 读不到就退回注册表版本：少带证据不该让「开会话」这件主要动作失败
      console.warn('[conversations] 读取来源运行的卡片失败，退回注册表版本：', error);
    }
  }

  return creator;
}

/**
 * `POST /api/conversations`
 *
 * **幂等**：同一个（用户, 人物, 来源运行）永远得到同一个会话。
 * 命中已有 → 200；新建 → 201。前端可以放心地重复调用（比如用户连点两次）。
 */
export async function handleCreateConversation(
  input: CreateConversationInput,
): Promise<HandlerResult> {
  const creatorId = input.creatorId?.trim() ?? '';
  if (!creatorId) {
    return fail(400, API_ERROR_CODES.invalidMessage, '缺少 creatorId');
  }

  // sourceRunId 只接受 uuid 或 null。非法值直接拒，否则会出现
  // 「会话建了，但永远关联不到那次搜索」这种查不出原因的问题。
  const sourceRunId = input.sourceRunId?.trim() || null;
  if (sourceRunId && !UUID_RE.test(sourceRunId)) {
    return fail(400, API_ERROR_CODES.invalidMessage, 'sourceRunId 必须是 uuid 或 null');
  }

  const { actor, issueGuestCookie, freshGuestId } = resolveActor(
    input.sessionToken,
    input.guestId,
  );

  const creator = await resolveCreatorForConversation(creatorId, sourceRunId);
  if (!creator) {
    // 409（不是 404）：人物存在过、但当前资料不可用 —— 重试有可能变好，
    // 所以给重试，前端保留人物结果并让聊天按钮显示可重试错误。
    return fail(
      409,
      API_ERROR_CODES.conversationSourceUnavailable,
      '这位创作者当前的公开资料不可用，暂时无法开启会话',
      true,
    );
  }

  const id = conversationIdOf(actor.userId, creatorId, sourceRunId);
  const existing = await loadConversation(id);
  if (existing) {
    return withGuest(ok({ conversation: existing.conversation }), issueGuestCookie, freshGuestId);
  }

  const conversation: Conversation = {
    id,
    user: actor.user,
    creator,
    sourceRunId,
    consultation: newConsultation(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const record: ConversationRecord = {
    conversation,
    messages: [openingMessage(id, creator.name)],
    updatedAtMs: Date.now(),
  };

  const saved = await saveConversation(record);
  if (!saved) {
    return fail(
      503,
      API_ERROR_CODES.persistenceUnavailable,
      '会话无法保存，请稍后重试',
      true,
    );
  }

  return withGuest(
    { status: 201, body: { conversation } },
    issueGuestCookie,
    freshGuestId,
  );
}

function withGuest(
  result: HandlerResult,
  issue: boolean,
  guestId: string | null,
): HandlerResult {
  if (!issue || !guestId) return result;
  return { ...result, cookies: [...(result.cookies ?? []), guestCookie(guestId)] };
}

/** `GET /api/conversations/:id` */
export async function handleGetConversation(id: string): Promise<HandlerResult> {
  const record = await loadConversation(id);
  if (!record) {
    return fail(404, API_ERROR_CODES.conversationNotFound, '会话不存在或已过期', false);
  }
  return ok({ conversation: record.conversation });
}

export interface ListMessagesInput {
  id: string;
  cursor: string | null;
  limit: string | null;
}

/** `GET /api/conversations/:id/messages?cursor=&limit=` */
export async function handleListMessages(input: ListMessagesInput): Promise<HandlerResult> {
  const record = await loadConversation(input.id);
  if (!record) {
    return fail(404, API_ERROR_CODES.conversationNotFound, '会话不存在或已过期', false);
  }

  // ⚠️ 不能写 Number(input.limit)：缺省（null）会得到 0，再被夹成 1，
  // 表现成「消息列表只回一条」这种极难联想到的症状。见 framework/params.ts。
  const limit = pageLimit(input.limit, DEFAULT_LIMIT, MAX_LIMIT);

  // 游标是上一条消息的 id。用 id 而不是下标：消息数组会被裁剪/重置，
  // 下标会指向错的消息，id 不会。
  let start = 0;
  if (input.cursor) {
    const idx = record.messages.findIndex((m) => m.id === input.cursor);
    if (idx >= 0) start = idx + 1;
  }

  const items = record.messages.slice(start, start + limit);
  const hasMore = start + limit < record.messages.length;

  return ok({
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  });
}

export interface SendMessageInput extends ConversationActorInput {
  id: string;
  clientMessageId: string;
  actorRole: string;
  content: string;
}

/** `POST /api/conversations/:id/messages` */
export async function handleSendMessage(input: SendMessageInput): Promise<HandlerResult> {
  const record = await loadConversation(input.id);
  if (!record) {
    return fail(404, API_ERROR_CODES.conversationNotFound, '会话不存在或已过期', false);
  }

  const clientMessageId = input.clientMessageId?.trim() ?? '';
  if (!clientMessageId || clientMessageId.length > 120) {
    return fail(400, API_ERROR_CODES.invalidMessage, 'clientMessageId 必须是 1~120 个字符');
  }

  const content = input.content?.trim() ?? '';
  if (!content) {
    return fail(400, API_ERROR_CODES.invalidMessage, '消息内容不能为空');
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return fail(
      400,
      API_ERROR_CODES.invalidMessage,
      `消息过长（${content.length} 字），请压缩到 ${MAX_CONTENT_CHARS} 字以内`,
    );
  }

  if (input.actorRole !== 'seeker' && input.actorRole !== 'creator') {
    return fail(400, API_ERROR_CODES.invalidMessage, 'actorRole 只能是 seeker 或 creator');
  }

  if (input.actorRole === 'creator' && !allowCreatorDemo()) {
    // 前端按 403 隐藏答主演示操作 —— 是「不该显示」，不是「操作失败」
    return fail(
      403,
      API_ERROR_CODES.demoRoleForbidden,
      '当前服务端未开启答主演示',
      false,
    );
  }

  // 幂等：同一个 clientMessageId 重复提交直接返回已存的那条，不产生第二条。
  // 这是前端断线重发的安全网 —— 没有它，一次网络抖动就会发两遍。
  const dup = record.messages.find((m) => m.clientMessageId === clientMessageId);
  if (dup) return ok({ message: dup });

  const msg = message(input.id, input.actorRole as MessageSender, content, clientMessageId);
  const next: ConversationRecord = {
    ...record,
    messages: [...record.messages, msg],
    updatedAtMs: Date.now(),
    conversation: { ...record.conversation, updatedAt: nowIso() },
  };

  if (!(await saveConversation(next))) {
    return fail(503, API_ERROR_CODES.persistenceUnavailable, '消息无法保存，请稍后重试', true);
  }

  return ok({ message: msg });
}

/** `POST /api/conversations/:id/reset` */
export async function handleResetConversation(id: string): Promise<HandlerResult> {
  const record = await loadConversation(id);
  if (!record) {
    return fail(404, API_ERROR_CODES.conversationNotFound, '会话不存在或已过期', false);
  }

  const messages = [openingMessage(id, record.conversation.creator.name)];
  const conversation: Conversation = {
    ...record.conversation,
    consultation: newConsultation(),
    updatedAt: nowIso(),
  };

  const next: ConversationRecord = { conversation, messages, updatedAtMs: Date.now() };
  if (!(await saveConversation(next))) {
    return fail(503, API_ERROR_CODES.persistenceUnavailable, '会话无法重置，请稍后重试', true);
  }

  // 规格：reset 成功后前端**整体替换** conversation 与 messages
  return ok({ conversation, messages });
}

/** `GET /api/consultation/packages` */
export function handleConsultationPackages(): HandlerResult {
  return ok({ items: CONSULTATION_PACKAGES });
}

export interface ConsultationActionInput {
  id: string;
  action: string;
  actorRole: string;
  packageId?: string;
}

/**
 * `POST /api/conversations/:id/consultation/actions`
 *
 * 状态机由后端持有：前端只提交动作。非法流转返回 409，并把**当前完整的
 * Consultation** 放进 `details` —— 前端据此把面板「回正」到服务端真实状态，
 * 而不是自己猜。只回状态字符串是不够的，packageId/amount 一样可能已经变了。
 */
export async function handleConsultationAction(
  input: ConsultationActionInput,
): Promise<HandlerResult> {
  const record = await loadConversation(input.id);
  if (!record) {
    return fail(404, API_ERROR_CODES.conversationNotFound, '会话不存在或已过期', false);
  }

  if (input.actorRole !== 'seeker' && input.actorRole !== 'creator') {
    return fail(400, API_ERROR_CODES.invalidMessage, 'actorRole 只能是 seeker 或 creator');
  }

  const result = applyTransition({
    action: input.action as never,
    actorRole: input.actorRole as never,
    packageId: input.packageId,
    current: record.conversation.consultation.status,
  });

  if (!result.ok) {
    return fail(
      409,
      API_ERROR_CODES.invalidConsultationTransition,
      result.reason,
      false,
      // details 里放完整对象，供前端回正
      record.conversation.consultation,
    );
  }

  const prev = record.conversation.consultation;
  let { packageId, amount } = prev;

  if (result.package === null) {
    packageId = null;
    amount = null;
  } else if (result.package !== 'keep') {
    packageId = result.package.packageId;
    amount = result.package.amount;
  }

  const consultation: Consultation = {
    ...prev,
    status: result.status,
    packageId,
    amount,
    updatedAt: nowIso(),
  };

  const systemMessage = message(
    input.id,
    'system',
    transitionMessage(
      input.action as never,
      result.status,
      packageId ? findPackage(packageId)?.name : undefined,
    ),
  );

  const next: ConversationRecord = {
    conversation: { ...record.conversation, consultation, updatedAt: nowIso() },
    messages: [...record.messages, systemMessage],
    updatedAtMs: Date.now(),
  };

  if (!(await saveConversation(next))) {
    return fail(503, API_ERROR_CODES.persistenceUnavailable, '状态无法保存，请稍后重试', true);
  }

  return ok({ consultation, systemMessage });
}

/** ── 会话内 Agent（NDJSON）──────────────────────────────────────────────── */

export interface AgentRunInput {
  id: string;
  clientMessageId: string;
  content: string;
  clientKey: string;
}

/**
 * 组装给 Agent 的上下文。
 *
 * **只用人物卡上已有的证据**，不外扩检索 —— 这是「私有 Agent」的边界：
 * 它代表的是这个人的已知公开内容，不是全网。越界会让「可溯源」这件事失效。
 */
function buildAgentContext(record: ConversationRecord): string {
  const { creator } = record.conversation;
  const lines: string[] = [];

  lines.push(`答主：${creator.name}${creator.headline ? `（${creator.headline}）` : ''}`);
  if (creator.matchedDimensions.length) {
    lines.push(`匹配维度：${creator.matchedDimensions.join('；')}`);
  }
  if (creator.reason) lines.push(`推荐理由：${creator.reason}`);

  if (creator.evidence.length) {
    lines.push('可引用的公开内容：');
    for (const e of creator.evidence) {
      lines.push(`- [${e.kind}] ${e.title}：${e.excerpt}${e.url ? `（来源：${e.url}）` : ''}`);
    }
  }

  const recent = record.messages.slice(-6);
  if (recent.length) {
    lines.push('最近对话：');
    for (const m of recent) lines.push(`- ${m.sender}: ${m.content}`);
  }

  return lines.join('\n');
}

/**
 * 没有证据时的回复。
 *
 * ⚠️ 这条路径是**刻意的**：领域来源的人物只有公开关联、没有可核验内容。
 * 这时如果让模型自由发挥，产出的就是一段听起来很像、但无处溯源的回答 ——
 * 正是这个产品最不能做的事。所以宁可直说没有。
 */
function noEvidenceReply(creatorName: string): string {
  return (
    `我是「${creatorName}」的 AI Agent。关于你的这个问题，我手上没有可核验的公开内容可以引用，` +
    `所以不能替 TA 给出具体建议 —— 编一段听起来合理的回答，比直接说不知道更糟。\n\n` +
    `你可以把问题说得再具体一点（处境、纠结点、已经试过什么），` +
    `我会基于 TA 公开写过的部分来判断能不能回答；不能的话我会直说。`
  );
}

const AGENT_SYSTEM = `你是某位知乎创作者的 AI Agent，代表 TA 与提问者交流。

硬性约束：
1. 只能基于「可引用的公开内容」回答，不得编造经历、数字、机构名或时间；
2. 内容里没有的信息，直说「这个我没有可引用的内容」，然后给出你**能**确定的部分；
3. 明确区分「TA 写过的」与「你的推断」，推断必须标注；
4. 回答用中文，200 字以内，直接回应提问者的处境，不要复述问题；
5. 不要自称是答主本人。`;

/**
 * `POST /api/conversations/:id/agent-runs`
 *
 * 协议见 `ConversationAgentEvent`。三件事要守住：
 *   · `agent.run.started` 必须带回**服务端已保存的**用户消息（前端用它替换临时气泡）
 *   · `delta` 只用于增量展示，**只有 `agent.message.completed` 是完成态**
 *   · 失败要发 `agent.run.failed`，不能让前端干等一个永远不来的 completed
 */
export async function runConversationAgent(
  input: AgentRunInput,
  emit: (event: ConversationAgentEvent) => void,
): Promise<void> {
  const requestId = randomUUID();

  const record = await loadConversation(input.id);
  if (!record) {
    emit({
      type: 'agent.run.failed',
      requestId,
      error: {
        code: API_ERROR_CODES.conversationNotFound,
        message: '会话不存在或已过期',
        retryable: false,
      },
    });
    return;
  }

  const content = input.content?.trim() ?? '';
  const clientMessageId = input.clientMessageId?.trim() ?? '';

  if (!clientMessageId || !content || content.length > MAX_CONTENT_CHARS) {
    emit({
      type: 'agent.run.failed',
      requestId,
      error: {
        code: API_ERROR_CODES.invalidMessage,
        message: 'clientMessageId 或 content 不合法（content 需 1~2000 字）',
        retryable: false,
      },
    });
    return;
  }

  // 与搜索共用同一份计数：两者烧的是同一个 LLM 与知乎额度
  const verdict = checkRate(input.clientKey);
  if (!verdict.ok) {
    emit({
      type: 'agent.run.failed',
      requestId,
      error: {
        code: API_ERROR_CODES.rateLimited,
        message: `请求过于频繁，请 ${verdict.retryAfterSec} 秒后再试`,
        retryable: true,
      },
    });
    return;
  }

  // 用户消息先落库（前端用 run.started 里的这条替换本地临时气泡）
  const existing = record.messages.find((m) => m.clientMessageId === clientMessageId);
  const userMessage =
    existing ?? message(input.id, 'seeker', content, clientMessageId);

  let working: ConversationRecord = existing
    ? record
    : {
        ...record,
        messages: [...record.messages, userMessage],
        updatedAtMs: Date.now(),
        conversation: { ...record.conversation, updatedAt: nowIso() },
      };

  await saveConversation(working);
  emit({ type: 'agent.run.started', requestId, userMessage });

  const messageId = newMessageId();
  emit({ type: 'agent.message.started', messageId });

  const { creator } = working.conversation;
  let reply: string;

  if (!creator.evidence.length) {
    reply = noEvidenceReply(creator.name);
  } else {
    try {
      const runtime = createRuntime();
      reply = await runtime.llm.complete({
        system: AGENT_SYSTEM,
        input: {
          上下文: buildAgentContext(working),
          提问者的问题: content,
        },
        temperature: 0.4,
      });
      if (!reply?.trim()) throw new Error('模型返回空内容');
    } catch (error) {
      // 模型不可用时**不伪装成答主在说话**，如实告知
      reply =
        `我是「${creator.name}」的 AI Agent。刚才生成回应时模型不可用，` +
        `所以这次没有回答（不是 TA 没看到）。你可以稍后重试。`;
      console.warn('[conversation-agent] LLM 不可用：', error);
    }
  }

  // 端口没有真正的流式接口，所以按句切分模拟增量。
  // 这不影响协议正确性：前端只依赖「delta 拼接」与「completed 原子替换」两件事。
  for (const chunk of splitForStream(reply)) {
    emit({ type: 'agent.message.delta', messageId, delta: chunk });
    if (STREAM_DELAY_MS > 0) await sleep(STREAM_DELAY_MS);
  }

  const agentMessage: ConversationMessage = {
    id: messageId,
    conversationId: input.id,
    clientMessageId: null,
    sender: 'agent',
    content: reply,
    createdAt: nowIso(),
  };

  working = {
    ...working,
    messages: [...working.messages, agentMessage],
    updatedAtMs: Date.now(),
    conversation: { ...working.conversation, updatedAt: nowIso() },
  };
  await saveConversation(working);

  emit({ type: 'agent.message.completed', message: agentMessage });
}

/** 按句读边界切分，让增量看起来像自然输出而不是随机截断 */
function splitForStream(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if ('。！？；\n'.includes(ch) || buf.length >= 12) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}
