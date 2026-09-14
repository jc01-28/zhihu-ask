#!/usr/bin/env node
/**
 * 端到端集成测试
 *
 * 设计原则：
 *   1. **零新增依赖** —— 用 Node 内置 http + 全局 fetch，不引测试框架。
 *      理由是这个项目只有 3 个生产依赖，为了跑测试引入 vitest/jest 不划算。
 *   2. **打真实 HTTP，不 mock** —— 起一个真的 next 进程，走真的路由。
 *      流水线类项目的 bug 大多在「数据流名字对不上」这种地方，单元测试抓不到。
 *   3. **默认用 fixture + 关掉 LLM** —— 让测试快速且确定（~3 秒）。
 *      要验证真实模型链路时用 --live-llm，那是另一件事（慢、且受模型波动影响）。
 *   4. **验证产品最核心的不变式**：每条外显的证据都必须在源文里逐字可查。
 *      这是整个产品的立身之本，必须有自动化测试守住。
 *
 * 用法：
 *   node scripts/e2e.mjs                 # 快速模式：fixture + 无 LLM
 *   node scripts/e2e.mjs --live-llm      # 真实模型模式（用 .env.local 里的配置）
 *   node scripts/e2e.mjs --with-throttle # 额外验证限流（会打满 20 次请求）
 */

import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT || 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const LIVE_LLM = process.argv.includes('--live-llm');
const WITH_THROTTLE = process.argv.includes('--with-throttle');
/**
 * --fresh 会先清掉 .cache/。
 *
 * 为什么必须有：磁盘缓存会把「真实模型测试」悄悄变成假测试 ——
 * 我们第一次跑 --live-llm 时全链路 0.0 秒返回，因为上一步 fixture 测试的
 * LLM 结果已经被缓存了，模型根本没被调用。要真的验证模型链路，必须先清缓存。
 */
const FRESH = process.argv.includes('--fresh');

const cases = [];

function check(name, ok, detail = '') {
  cases.push({ name, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? `\n       ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n【${title}】`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(pathname, init) {
  const res = await fetch(`${BASE}${pathname}`, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, body, headers: res.headers };
}

/**
 * 带超时的 POST。
 *
 * ⚠️ `/api/agent/search` 返回的是 **NDJSON 流**（`application/x-ndjson`），
 * 不是单个 JSON —— 这里把它收敛成统一的形状：
 *   · `body`      = `run.completed.result`（失败时为 null），让其它用例不用关心流
 *   · `events`    = 逐行解析出的事件数组，**流式协议本身也需要被验证**
 *   · `errorCode` = `run.failed` 里的错误码（HTTP 状态恒为 200，见路由注释）
 *
 * 显式设超时是必须的：一旦被测服务因为外部依赖挂住，我们要得到一个**命名的失败用例**，
 * 而不是让整个测试脚本崩掉、把后面的用例也一起吞掉。
 */
async function postAsk(question, pathname = '/api/agent/search', timeoutMs = 180000) {
  try {
    /**
     * ⚠️ 两个端点的请求字段名**不一样**，这里必须按路径选：
     *   · `/api/agent/search`（契约）→ `{ query, sessionId }`
     *   · `/api/ask`（旧链路调试口）→ `{ question }`
     * 发错了会被 `.strict()` 直接拒掉 —— 这是刻意的，也正是它该有的行为。
     */
    const payload =
      pathname === '/api/ask' ? { question } : { query: question, sessionId: 'e2e-session' };

    const res = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const contentType = res.headers.get('content-type') ?? '';
    const raw = await res.text();

    if (contentType.includes('ndjson')) {
      const events = raw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const completed = events.find((e) => e.type === 'run.completed');
      const failed = events.find((e) => e.type === 'run.failed');
      return {
        status: res.status,
        body: completed?.result ?? null,
        events,
        isStream: true,
        errorCode: failed?.error?.code ?? null,
        errorMessage: failed?.error?.message ?? null,
        contentType,
        raw,
      };
    }

    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      /* 非 JSON */
    }
    return {
      status: res.status,
      body,
      events: [],
      isStream: false,
      errorCode: body?.code ?? null,
      errorMessage: body?.message ?? body?.error ?? null,
      contentType,
      raw,
    };
  } catch (error) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      status: isTimeout ? 0 : -1,
      body: null,
      events: [],
      isStream: false,
      errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      errorMessage: isTimeout
        ? `请求超过 ${timeoutMs / 1000}s 未返回 —— 检查是否有出站调用没设超时（LLM_TIMEOUT_MS / ZHIHU_TIMEOUT_MS）`
        : String(error?.message ?? error),
      contentType: '',
      raw: '',
    };
  }
}

/** 启动被测服务，返回停止函数 */
async function startServer() {
  // ⚠️ 端口预检（不要删）：`next dev` 发现端口被占会**静默改用下一个端口**，
  // 而下面的就绪检测轮询的是固定 PORT —— 于是会连上**那个占着端口的陌生服务**，
  // 用别的代码跑完整套用例。真发生过（评测脚本上一次因此跑了 24 分钟）。
  const occupied = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
    signal: AbortSignal.timeout(1500),
  })
    .then(() => true)
    .catch(() => false);
  if (occupied) {
    throw new Error(
      `端口 ${PORT} 已被占用。先停掉占用进程，或换端口：E2E_PORT=3240 npm run e2e`,
    );
  }

  const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const env = { ...process.env, PORT: String(PORT) };
  // e2e 断言的是 fixture 语料的确定性行为（例如「语料已加载 174 条」），
  // 所以无论如何都要钉死语料范围，不受 .env.local 影响。
  // 174 = sample 6 + gold 168，即 synthetic。
  env.FIXTURE_CORPUS = 'synthetic';
  if (!LIVE_LLM) {
    // Next 不会用 .env 覆盖已存在的 process.env，所以这里的值会生效
    env.USE_FIXTURES = '1';
    env.LLM_PROVIDER = 'none';
    env.ASK_RATE_LIMIT = WITH_THROTTLE ? '20' : '0';
  }

  const child = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  const stop = () => {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  };

  // 等服务就绪
  for (let i = 0; i < 90; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { stop, logs };
    } catch {
      /* 还没起来 */
    }
    await sleep(1000);
  }
  stop();
  console.error('服务启动超时（90s）。最后的日志：\n' + logs.join('').slice(-2000));
  process.exit(1);
}

async function main() {
  const mode = LIVE_LLM ? '真实模型' : 'fixture + 无 LLM';
  console.log(`=== 端到端集成测试（${mode}）===\n`);

  if (FRESH) {
    await rm(path.join(process.cwd(), '.cache'), { recursive: true, force: true });
    console.log('已清空 .cache/（确保真实调用而不是命中缓存）');
  }

  console.log(`启动被测服务 :${PORT} …`);
  const server = await startServer();
  console.log('服务就绪，开始跑用例。');

  try {
    section('基础可用性');
    const health = await getJson('/api/health');
    check('/api/health 返回 200', health.status === 200, `实际 ${health.status}`);
    // ⚠️ 响应形状由**前端契约**决定：成功时**响应体就是载荷本身**，没有 {status,data} 外壳。
    // （曾经套过一层信封，前端 zod 的 .strict() 直接判整条响应非法 —— 已改回扁平。）
    const healthData = health.body;
    check('health.ok 为 true', healthData?.ok === true);
    check(
      '数据目录可写（serverless 环境会回退到 /tmp）',
      healthData?.runtime?.dataDirWritable === true,
      `dataDir=${healthData?.runtime?.dataDir}`,
    );

    if (!LIVE_LLM) {
      check(
        '运行模式为 fixtures（否则测试会打真实接口、结果不确定）',
        healthData?.mode === 'fixtures',
        `mode=${healthData?.mode}，llmProvider=${healthData?.configured?.llmProvider}`,
      );
      check(
        'LLM 已关闭（保证测试快速确定）',
        healthData?.configured?.llmProvider === 'none',
        `llmProvider=${healthData?.configured?.llmProvider}`,
      );
    }

    section('登录状态（对齐前端契约）');
    const status = await getJson('/api/auth/session');
    check('/api/auth/session 返回 200', status.status === 200);
    const s = status.body;
    check(
      'configured / authenticated 都是布尔',
      typeof s?.configured === 'boolean' && typeof s?.authenticated === 'boolean',
      `configured=${s?.configured} authenticated=${s?.authenticated}`,
    );
    // 前端 schema 是 .strict() —— **多一个键整条响应就作废**。
    // 这条断言就是那个守门人：曾经这里多出 missing/redirectIsLocalOnly/expiresInSeconds 三个键，
    // 前端会全部判为 INVALID_RESPONSE，而后端日志里一点异常都看不到。
    check(
      '恰好只有 3 个键（configured / authenticated / user）',
      JSON.stringify(Object.keys(s ?? {}).sort()) ===
        JSON.stringify(['authenticated', 'configured', 'user']),
      `实际键：${Object.keys(s ?? {}).join(', ') || '(空)'}`,
    );
    check(
      'user 是对象或 null',
      s?.user === null || typeof s?.user === 'object',
      `user=${JSON.stringify(s?.user)}`,
    );
    check('未授权时 authenticated 为 false', s?.authenticated === false);

    section('授权入口的防御');
    // 凭证没配齐 / 回调地址是占位符时，不该 500 裸奔，而应 302 回 /app 带错误码
    const authz = await getJson('/api/auth/zhihu/login', { redirect: 'manual' });
    const isRedirect = authz.status >= 300 && authz.status < 400;
    const location = authz.headers?.get?.('location') ?? '';
    check(
      'login 要么跳知乎、要么带错误码回 /app，不会静默失败',
      isRedirect,
      `HTTP ${authz.status} → ${location}`,
    );
    // 这个环境回调地址是占位符，所以应当回 unconfigured 而不是跳到知乎
    check(
      '回调地址不可用时回到 /app?auth=unconfigured',
      location.includes('auth=unconfigured') || location.includes('openapi.zhihu.com'),
      location || '(无 Location)',
    );

    section('输入校验（4~300 字，与前端规格一致）');
    // ⚠️ 流式端点的失败也走**流内事件**，HTTP 状态恒为 200（流一旦开始写就改不了状态码）。
    // 所以这里断言的是**错误码**，不是状态码。
    const tooShort = await postAsk('太短');
    check(
      '过短问题 → INVALID_SEARCH_REQUEST',
      tooShort.errorCode === 'INVALID_SEARCH_REQUEST',
      `${tooShort.errorCode} · ${tooShort.errorMessage ?? ''}`,
    );
    const tooLong = await postAsk('测'.repeat(1200));
    check(
      '超长问题 → INVALID_SEARCH_REQUEST',
      tooLong.errorCode === 'INVALID_SEARCH_REQUEST',
      `${tooLong.errorCode} · ${tooLong.errorMessage ?? ''}`,
    );

    /** 把一段 NDJSON 文本解析成事件数组（这里刻意不用 postAsk，因为要发非法请求体） */
    const parseNdjson = (text) =>
      text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return { type: '__unparsable__', line: l };
          }
        });

    // 契约是 .strict()：多一个字段前端就拒整条请求，所以后端也应主动拒绝
    const extraField = await fetch(`${BASE}/api/agent/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '这是一个长度足够的问题描述文本',
        sessionId: 'e2e',
        bogus: 1,
      }),
    });
    const extraEvents = parseNdjson(await extraField.text());
    check(
      '请求体多余字段被拒（契约是 .strict()）',
      extraEvents.some(
        (e) => e.type === 'run.failed' && e.error?.code === 'INVALID_SEARCH_REQUEST',
      ),
      extraEvents.find((e) => e.type === 'run.failed')?.error?.message ?? '(未收到 run.failed)',
    );

    const badJson = await fetch(`${BASE}/api/agent/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const badJsonEvents = parseNdjson(await badJson.text());
    check(
      '非法 JSON → 流内 run.failed（而不是 400 裸响应）',
      badJsonEvents.some(
        (e) => e.type === 'run.failed' && e.error?.code === 'INVALID_SEARCH_REQUEST',
      ),
      badJsonEvents.find((e) => e.type === 'run.failed')?.error?.message ?? '(未收到 run.failed)',
    );

    section('端点迁移：旧路径仍兼容');
    const legacy = await postAsk('我在大厂做产品 7 年，该不该去创业公司？', '/api/ask');
    check(
      '废弃路径 /api/ask 仍返回 200（兼容旧脚本）',
      legacy.status === 200,
      `HTTP ${legacy.status}`,
    );

    section('领域域（对齐前端 zod .strict() 契约）');

    // 前端的 schema 全部 .strict()：多一个键、少一个键、值域越界，整条响应都会被判非法。
    // 所以这里不止断言语义，还要断言**键集合精确匹配** —— 那才是真正会拦住人的那一层。
    const keysOf = (o) => JSON.stringify(Object.keys(o ?? {}).sort());

    const featured = await getJson('/api/fields/featured');
    const featuredFields = featured.body?.items ?? [];
    check('响应形状是 { items }（恰好一个键）', keysOf(featured.body) === '["items"]', keysOf(featured.body));
    check(
      '推荐领域非空且首尾顺序是定义顺序',
      featuredFields.length > 0 && featuredFields[0]?.id === 'agent-dev',
      featuredFields.map((f) => f.name).join(' / '),
    );
    check(
      'FieldSummary 恰好 8 个键',
      featuredFields.every(
        (f) =>
          keysOf(f) ===
          '["color","description","icon","id","memberCount","name","tags","topicCount"]',
      ),
      keysOf(featuredFields[0]),
    );
    const FIELD_COLORS = ['blue','cyan','violet','amber','emerald','rose','indigo','teal'];
    check(
      'color 是白名单 token（不是十六进制或任意字符串）',
      featuredFields.every((f) => FIELD_COLORS.includes(f.color)),
      featuredFields.map((f) => `${f.name}=${f.color}`).join(' ｜ '),
    );
    check(
      '每个领域都挂到了真实人物（不是空壳）',
      featuredFields.every((f) => f.memberCount > 0 && f.topicCount > 0),
      featuredFields.map((f) => `${f.name}:${f.memberCount}人`).join(' ｜ '),
    );

    const fieldSearch = await getJson(`/api/fields?query=${encodeURIComponent('训练大模型')}`);
    check(
      '领域搜索命中相关领域，形状也是 { items }',
      (fieldSearch.body?.items ?? []).length > 0 && keysOf(fieldSearch.body) === '["items"]',
      (fieldSearch.body?.items ?? []).map((f) => f.name).join(' / '),
    );
    check(
      '领域搜索只返回领域、不返回人物（两个功能的边界）',
      !JSON.stringify(fieldSearch.body ?? {}).includes('"people"'),
    );
    // 回归断言：曾因给每个领域无条件叠加「人数加权」，任何查询都返回全部领域 —— 连不存在的词也一样。
    check(
      '无意义查询返回空 items（不是错误，也不是全部领域）',
      ((await getJson(`/api/fields?query=${encodeURIComponent('不存在的领域xyz')}`)).body?.items ?? [])
        .length === 0,
    );
    check('领域搜索缺 query 返回 400', (await getJson('/api/fields')).status === 400);
    const badReq = await getJson('/api/fields');
    check(
      '错误体是 { code, message, retryable } 形状',
      typeof badReq.body?.code === 'string' &&
        typeof badReq.body?.message === 'string' &&
        typeof badReq.body?.retryable === 'boolean',
      JSON.stringify(badReq.body),
    );

    const graph = await getJson('/api/fields/agent-dev/graph');
    const g = graph.body;
    const topics = g?.topics ?? [];
    const people = g?.people ?? [];
    check(
      '星图返回 field + topics + people（恰好三个键）',
      keysOf(g) === '["field","people","topics"]',
      keysOf(g),
    );
    check('议题与人物都非空（前端契约要求各至少 1 个）', topics.length > 0 && people.length > 0, `${topics.length} 议题 / ${people.length} 人`);
    check(
      'TopicNode 恰好 4 个键（不该有 memberCount 之类的多余字段）',
      topics.every((t) => keysOf(t) === '["description","id","name","position"]'),
      keysOf(topics[0]),
    );
    check(
      '议题坐标是 **0~1 归一化**（不是 0~1000）',
      topics.every((t) => t.position.x >= 0 && t.position.x <= 1 && t.position.y >= 0 && t.position.y <= 1),
      topics.map((t) => `(${t.position.x},${t.position.y})`).join(' '),
    );
    check(
      'PersonNode 恰好 9 个键，且**不含 position**（人物位置由前端决定）',
      people.every(
        (p) =>
          keysOf(p) ===
          '["avatarTone","avatarUrl","headline","id","initial","name","profileUrl","relevance","topicIds"]',
      ),
      keysOf(people[0]),
    );
    check(
      'relevance 是 0~100（不是 0~1）',
      people.every((p) => p.relevance >= 0 && p.relevance <= 100),
      people.slice(0, 4).map((p) => p.relevance).join(' / '),
    );
    check(
      'profileUrl 字段存在且为 null（知乎搜索接口不返回作者主页标识）',
      people.every((p) => p.profileUrl === null || typeof p.profileUrl === 'string'),
    );
    check(
      '人物的 topicIds 都指向本领域真实存在的议题',
      people.every((p) => p.topicIds.every((id) => topics.some((t) => t.id === id))),
    );
    const notFound = await getJson('/api/fields/no-such-field/graph');
    check(
      '未知领域返回 404 + FIELD_NOT_FOUND + retryable:false（前端据此不给重试按钮）',
      notFound.status === 404 &&
        notFound.body?.code === 'FIELD_NOT_FOUND' &&
        notFound.body?.retryable === false,
      JSON.stringify(notFound.body),
    );

    section('人物公开资料（星图与找人共用出口）');
    const samplePersonId = people[0]?.id;
    check('已从星图取到一个 personId 用于验证', Boolean(samplePersonId), samplePersonId ?? '(空)');

    const creator = await getJson(`/api/creators/${encodeURIComponent(samplePersonId ?? 'x')}`);
    const card = creator.body;
    check('/api/creators/:id 返回 200', creator.status === 200, JSON.stringify(card).slice(0, 200));
    // 前端 schema 是 .strict()：**恰好这 16 个字段**
    check(
      'CreatorCard 恰好 16 个键',
      keysOf(card) ===
        '["avatarTone","avatarUrl","evidence","headline","id","identityConfidence","initial","limitations","matchedDimensions","name","profileUrl","reason","relevanceLevel","role","score","suitableQuestions"]',
      keysOf(card),
    );
    check(
      '领域来源的人物 role 是「领域相关」（不能说「经历最接近」）',
      card?.role === '领域相关',
      `role=${card?.role}`,
    );
    check(
      '领域来源**没有内容证据**，如实给空数组（不许为凑满而虚构）',
      Array.isArray(card?.evidence) && card.evidence.length === 0,
      `evidence=${card?.evidence?.length ?? '(非数组)'} 条`,
    );
    check(
      'score 是 0~100，与星图里的 relevance 一致',
      typeof card?.score === 'number' &&
        card.score >= 0 &&
        card.score <= 100 &&
        card.score === people[0]?.relevance,
      `名片 ${card?.score} vs 星图 ${people[0]?.relevance}`,
    );
    check(
      'matchedDimensions 来自关联议题（最多 4 条）',
      Array.isArray(card?.matchedDimensions) && card.matchedDimensions.length <= 4,
      (card?.matchedDimensions ?? []).join(' / '),
    );
    check(
      'avatarUrl / profileUrl 是 https 或 null（前端直接塞进 img/a）',
      [card?.avatarUrl, card?.profileUrl].every(
        (u) => u === null || (typeof u === 'string' && u.startsWith('https://')),
      ),
      `avatar=${card?.avatarUrl} profile=${card?.profileUrl}`,
    );
    const ghost = await getJson('/api/creators/p_does_not_exist');
    check(
      '不存在的创作者返回 404 + NOT_FOUND（前端保留页面上下文，不弹回首页）',
      ghost.status === 404 && ghost.body?.code === 'NOT_FOUND',
      JSON.stringify(ghost.body),
    );

    section('热榜选题');
    const hot = await getJson('/api/topics/hot');
    check('/api/topics/hot 返回 200', hot.status === 200);
    check(
      '响应恰好 { topics, unavailable } 两个键',
      keysOf(hot.body) === '["topics","unavailable"]',
      keysOf(hot.body),
    );
    check(
      'unavailable 是布尔（拿不到时前端隐藏热榜区，而不是弹红条）',
      typeof hot.body?.unavailable === 'boolean',
      `unavailable=${hot.body?.unavailable} · ${hot.body?.topics?.length ?? 0} 条`,
    );
    check(
      '每条热榜都带 https 地址（坏链接会被丢弃而不是发出去）',
      (hot.body?.topics ?? []).every((t) => typeof t.url === 'string' && t.url.startsWith('https://')),
    );

    // ── 流式协议 ──────────────────────────────────────────────────────────
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const STEP_ORDER = [
      'loading_context',
      'understanding',
      'retrieving',
      'verifying',
      'ranking',
      'saving',
    ];

    section('★ 流式协议（NDJSON）');
    const streamed = await postAsk(
      '我在大厂做产品 7 年，收到一家 50 人 AI 创业公司的 offer，固定薪资降 20% 但有期权，该不该去？',
    );
    const events = streamed.events;

    check('Content-Type 是 application/x-ndjson', streamed.contentType.includes('ndjson'), streamed.contentType);
    check(
      '响应是逐行 JSON（每一行都能独立解析）',
      events.length > 0 && !events.some((e) => e.type === '__unparsable__'),
      `${events.length} 个事件`,
    );
    check(
      '每行以 \\n 结尾（NDJSON 的硬要求，前端按行切分）',
      streamed.raw.endsWith('\n'),
    );
    check(
      '第一个事件是 run.started 且带 uuid 的 requestId',
      events[0]?.type === 'run.started' && UUID_RE.test(events[0]?.requestId ?? ''),
      events[0] ? JSON.stringify(events[0]) : '(空)',
    );
    check(
      '最后一个事件是 run.completed',
      events.at(-1)?.type === 'run.completed',
      events.at(-1)?.type ?? '(空)',
    );

    const startedSteps = events.filter((e) => e.type === 'step.started').map((e) => e.step);
    const completedSteps = events.filter((e) => e.type === 'step.completed').map((e) => e.step);
    check(
      '六阶段都发出了 step.started，顺序与契约完全一致',
      JSON.stringify(startedSteps) === JSON.stringify(STEP_ORDER),
      startedSteps.join(' → '),
    );
    check(
      '六阶段都发出了 step.completed，顺序与契约完全一致',
      JSON.stringify(completedSteps) === JSON.stringify(STEP_ORDER),
      completedSteps.join(' → '),
    );
    // ★ 回归断言：我们的链路顺序是 ranked → verified（先重排、后校验），
    // 而契约要求 verifying → ranking（先校验、后重排）—— 两者是**交错**的。
    // 不在流式层重排事件，前端进度条就会**倒退**，看起来像出 bug。
    const startedAt = (phase) =>
      events.findIndex((e) => e.type === 'step.started' && e.step === phase);
    check(
      '进度严格单调不倒退（verifying 必须先于 ranking 开始）',
      startedAt('verifying') !== -1 &&
        startedAt('ranking') !== -1 &&
        startedAt('verifying') < startedAt('ranking'),
      `verifying@${startedAt('verifying')} ｜ ranking@${startedAt('ranking')}`,
    );

    const done = events.at(-1);
    check(
      'run.completed 带 result / runId / persistence',
      Boolean(done?.result) && typeof done?.persistence === 'string',
      `persistence=${done?.persistence}`,
    );
    check(
      '顶部 runId 是 uuid（契约是 z.string().uuid()）',
      UUID_RE.test(done?.runId ?? ''),
      `${done?.runId}`,
    );
    check(
      'PersonSearchResult 恰好 12 个键',
      keysOf(done?.result) ===
        '["analyzedContentCount","background","cards","contextSourceCounts","contextStatus","fallbackReason","modeUsed","modelFallback","persistence","rejectedContentCount","runId","searchedQueries"]',
      keysOf(done?.result),
    );
    check(
      'cards 是 CreatorCard（最多 3 张，每张恰好 16 键）',
      (done?.result?.cards ?? []).length <= 3 &&
        (done?.result?.cards ?? []).every(
          (c) =>
            keysOf(c) ===
            '["avatarTone","avatarUrl","evidence","headline","id","identityConfidence","initial","limitations","matchedDimensions","name","profileUrl","reason","relevanceLevel","role","score","suitableQuestions"]',
        ),
      `${done?.result?.cards?.length ?? 0} 张`,
    );
    check(
      'searchedQueries 是数组（前端「背景资料」区要用）',
      Array.isArray(done?.result?.searchedQueries),
      (done?.result?.searchedQueries ?? []).join(' / '),
    );

    section('刷新恢复');
    const restored = await getJson(`/api/agent/runs/${encodeURIComponent(done?.runId ?? 'x')}`);
    check('能用刚拿到的 runId 取回结果', restored.status === 200, JSON.stringify(restored.body).slice(0, 160));
    check(
      'RunRestoreResponse 恰好 14 个键',
      keysOf(restored.body) ===
        '["analyzedCount","background","cards","contextSourceCounts","contextStatus","createdAt","expiresAt","fallbackReason","mode","modelFallback","persistence","rejectedCount","runId","searchedQueries"]',
      keysOf(restored.body),
    );
    check(
      'persistence 固定为 saved（能取回就说明当初存下来了）',
      restored.body?.persistence === 'saved',
      `persistence=${restored.body?.persistence}`,
    );
    check(
      '恢复出来的卡片与首次搜索一致',
      JSON.stringify(restored.body?.cards) === JSON.stringify(done?.result?.cards),
      `${restored.body?.cards?.length ?? 0} 张 vs ${done?.result?.cards?.length ?? 0} 张`,
    );
    const ghostRun = await getJson('/api/agent/runs/00000000-0000-4000-8000-000000000000');
    check(
      '不存在的 run → 404 + RUN_NOT_FOUND（前端静默回 idle，不弹红条）',
      ghostRun.status === 404 && ghostRun.body?.code === 'RUN_NOT_FOUND',
      JSON.stringify(ghostRun.body),
    );

    section('三栏对比（原文侧 vs Agent 侧）');
    const compareRes = await fetch(`${BASE}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '我在大厂做产品 7 年，收到一家 50 人 AI 创业公司的 offer，该不该去？',
        sessionId: 'e2e',
      }),
      signal: AbortSignal.timeout(180000),
    });
    const compare = await compareRes.json();
    check('/api/compare 返回 200', compareRes.status === 200, JSON.stringify(compare).slice(0, 160));
    check(
      'CompareResponse 恰好 5 个键',
      keysOf(compare) === '["agent","contextStatus","modeUsed","modelFallback","raw"]',
      keysOf(compare),
    );
    check(
      '原文侧只有 1 个查询词（**不扩词**，这正是对比的意义）',
      compare?.raw?.queries?.length === 1,
      (compare?.raw?.queries ?? []).join(' / '),
    );
    check(
      '原文侧有命中，且每条都收敛成窄形状',
      (compare?.raw?.hits ?? []).length > 0,
      `${compare?.raw?.hits?.length ?? 0} 条`,
    );
    const rawHit = compare?.raw?.hits?.[0];
    check(
      'SearchHitCard 恰好 12 个键',
      keysOf(rawHit) ===
        '["author","commentCount","contentId","contentType","editTime","excerpt","provider","rankingScore","sourceQuery","title","url","voteUpCount"]',
      keysOf(rawHit),
    );
    check(
      '内部的召回归因 / 精选评论 / 全文**没有**过线（映射是一道收窄边界）',
      !('matchedBy' in (rawHit ?? {})) && !('comments' in (rawHit ?? {})) && !('contentText' in (rawHit ?? {})),
    );
    check(
      'author 恰好 5 个键，且 id 是 p_ 前缀的稳定标识（与星图/人物卡一致）',
      keysOf(rawHit?.author) === '["authorityLevel","avatarUrl","badgeText","name","syntheticId"]' &&
        (rawHit?.author?.syntheticId ?? '').startsWith('p_'),
      `${keysOf(rawHit?.author)} · ${rawHit?.author?.syntheticId}`,
    );
    check(
      'Agent 侧带卡片与上下文状态',
      (compare?.agent?.cards ?? []).length > 0 &&
        ['applied', 'partial', 'unavailable'].includes(compare?.agent?.contextStatus),
      `${compare?.agent?.cards?.length ?? 0} 张 · contextStatus=${compare?.agent?.contextStatus}`,
    );


    section('核心链路：情境化问题应走「真人」');
    // ⚠️ 链路断言打**旧路径** `/api/ask`：它仍然返回链路原始产物 `AskResult`
    // （8 步 trace / route / metrics），而新路径返回的是映射后的 `PersonSearchResult`。
    // 8 步链路是 e2e 与对照实验的共同基准，用原始产物验证它才准。
    // 新路径的契约形状另有专门的断言（见「流式协议」一节）。
    const askStart = Date.now();
    const human = await postAsk(
      '我在大厂做产品 7 年，收到一家 50 人 AI 创业公司产品负责人的 offer，固定薪资降 20% 但有期权和管理机会，同时我在这里晋升已经放缓，该不该去？',
      '/api/ask',
    );
    const askMs = Date.now() - askStart;
    check('返回 200', human.status === 200, human.body?.error ?? '');
    // maxDuration 默认 60s（Vercel Hobby 上限）。超了就会在生产环境 504。
    check(
      `整条链路耗时 ${(askMs / 1000).toFixed(1)}s，在 maxDuration=60s 之内`,
      askMs < 60000 || human.status !== 200,
      askMs >= 60000
        ? '⚠️ 已超过 60s：生产环境会 504。缓解手段：部署环境 maxDuration=300，或降低 LLM_CONCURRENCY 之外的调用次数'
        : `LLM 并发 ${process.env.LLM_CONCURRENCY || 4}`,
    );
    const result = human.body;

    if (result) {
      check('分诊路由为 human', result.route === 'human', `route=${result.route}`);
      check(
        '8 步链路全部执行成功',
        Array.isArray(result.trace) &&
          result.trace.length === 8 &&
          result.trace.every((t) => t.status === 'ok' || t.status === 'cached'),
        result.trace?.map((t) => `${t.step}:${t.status}`).join(' → '),
      );
      check(
        '每一步都带产物摘要（链路可见）',
        result.trace?.every((t) => typeof t.summary === 'string'),
        result.trace?.map((t) => `${t.step}=${t.summary}`).join(' ｜ '),
      );

      // 六阶段是前端规格要的展示口径，由 handler 从 8 步 trace 映射而来。
      // 它必须**始终**是 6 条且带 label —— 前端直接用，不自己聚合。
      check(
        'phases 是 6 阶段（前端展示口径）',
        Array.isArray(result.phases) &&
          result.phases.length === 6 &&
          result.phases.every((p) => typeof p.label === 'string' && p.label.length > 0),
        result.phases?.map((p) => `${p.label}:${p.status}`).join(' → '),
      );
      check(
        '六阶段覆盖到 8 步的产出（不是空壳）',
        result.phases?.some((p) => p.summary && p.summary.length > 0),
        result.phases?.map((p) => p.summary || '—').join(' ｜ '),
      );
      // 各步耗时：maxDuration 超限时，一眼能看出是谁慢
      const slowest = [...(result.trace ?? [])].sort((a, b) => b.ms - a.ms)[0];
      check(
        '链路各步耗时已记录',
        typeof slowest?.ms === 'number',
        (result.trace ?? []).map((t) => `${t.step}:${t.ms}ms`).join(' ') +
          (slowest ? `  ← 最慢：${slowest.step} ${(slowest.ms / 1000).toFixed(1)}s` : ''),
      );
      // 真实模型模式下必须确认模型真的被调用了 —— 否则测试是假的
      if (LIVE_LLM) {
        check(
          '确实调用了模型（不是全部命中缓存）',
          result.trace?.some((t) => t.status === 'ok'),
          result.trace?.every((t) => t.status === 'cached')
            ? '全部命中缓存 ⇒ 本次没有真正验证模型链路。加 --fresh 重跑'
            : '有步骤真实执行',
        );
      }

      check(
        '召回与抽取都有产出',
        result.metrics?.hitCount > 0 && result.metrics?.eventCount > 0,
        `召回 ${result.metrics?.hitCount} 条 · 经历 ${result.metrics?.eventCount} 条 · 候选 ${result.metrics?.candidateCount} 位`,
      );
      check(
        '产出推荐卡片',
        result.recommendations?.length > 0,
        result.recommendations?.map((r) => `${r.role}｜${r.candidate.authorName}`).join(' / '),
      );
      check(
        '每张卡片都带「不适合回答」（诚实性字段）',
        result.recommendations?.every((r) => Array.isArray(r.notGoodAt) && r.notGoodAt.length > 0),
      );
      check(
        '卡片都通过了证据校验',
        result.recommendations?.every((r) => r.verified === true),
      );
      check(
        '证据覆盖率是有效数字',
        typeof result.metrics?.evidenceCoverage === 'number',
        `evidenceCoverage=${result.metrics?.evidenceCoverage} · noEvidenceRate=${result.metrics?.noEvidenceRate}`,
      );

      // ★ 核心不变式：所有外显证据必须能在源文里逐字查到
      section('★ 核心不变式：证据必须可回溯到原文');
      try {
        // 语料现在有多个来源（gold / sample / harvested），必须全部纳入校验 ——
        // 只查 sample-hits 会在换成 gold 语料后「因为找不到而误报失败」，
        // 更糟的是可能「因为恰好包含而假通过」。
        const normalize = (s) =>
          String(s)
            .replace(/[\s\u3000]/g, '')
            .replace(/[「」『』“”"'`（）()【】[\]{}，。；：、,.!?！？—\-~·]/g, '');

        const corpusFiles = ['gold-hits.json', 'sample-hits.json', 'harvested-hits.json'];
        const hits = [];
        for (const file of corpusFiles) {
          try {
            const raw = await readFile(
              path.join(process.cwd(), 'src', 'back', 'fixtures', file),
              'utf8',
            );
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.hits)) hits.push(...parsed.hits);
          } catch {
            // 该语料文件不存在（比如没跑过 harvest）：跳过
          }
        }
        // ⚠️ 语料为空时必须让校验失败 —— 空的 haystack 会让 includes 永远 false，
        // 但如果我们写的是 `traceable === total`，total 也可能是 0 而假通过。
        check('语料已加载（证据校验的前提）', hits.length > 0, `${hits.length} 条`);
        const haystack = normalize(hits.map((h) => `${h.title}${h.contentText}`).join(''));

        let total = 0;
        let traceable = 0;
        const bad = [];
        for (const rec of result.recommendations ?? []) {
          for (const ev of rec.evidence ?? []) {
            total += 1;
            if (haystack.includes(normalize(ev.quote))) traceable += 1;
            else bad.push(`${rec.candidate.authorName}：${String(ev.quote).slice(0, 40)}…`);
          }
        }
        check(
          `全部 ${total} 条证据都能在源文中逐字定位`,
          total > 0 && traceable === total,
          traceable === total ? '' : `不可回溯：${bad.join(' ｜ ')}`,
        );
      } catch (error) {
        check('证据可回溯校验', false, `读取 fixture 失败：${error.message}`);
      }
    }

    section('「别问人」路径：通用知识问题不该导向真人');
    const generic = await postAsk('什么是大模型上下文窗口，它的原理是什么？', '/api/ask');
    check('返回 200', generic.status === 200, generic.body?.error ?? `HTTP ${generic.status}`);
    check(
      '路由不是 human',
      generic.body?.route === 'content' || generic.body?.route === 'ai',
      `route=${generic.body?.route} · ${generic.body?.triageReason ?? ''}`,
    );
    check(
      '不给真人卡片',
      generic.body?.recommendations?.length === 0,
    );
    check(
      '改为直接给公开内容',
      generic.body?.contentOnly?.length > 0,
      `${generic.body?.contentOnly?.length ?? 0} 条内容`,
    );

    if (WITH_THROTTLE) {
      section('额度防护（限流）');
      let hit429 = false;
      for (let i = 0; i < 30; i += 1) {
        const res = await postAsk('限流测试用的问题，长度足够六字以上。');
        if (res.status === 429) {
          hit429 = true;
          check('连续请求会触发 429', true, `第 ${i + 1} 次被拦，提示：${res.body?.error ?? ''}`);
          break;
        }
      }
      if (!hit429) check('连续请求会触发 429', false, '打了 30 次都没被限流');
    }
  } finally {
    server.stop();
  }

  const failed = cases.filter((c) => !c.ok);
  console.log('\n=== 结果 ===');
  console.log(`  通过 ${cases.length - failed.length}/${cases.length}`);
  if (failed.length) {
    console.log('  失败用例：');
    for (const f of failed) console.log(`   · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
