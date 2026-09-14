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
 * 带超时的 POST。默认打**新路径** `/api/agent/search`（前端规格的命名）。
 * 显式设超时是必须的：一旦被测服务因为外部依赖挂住，我们要得到一个**命名的失败用例**，
 * 而不是让整个测试脚本崩掉、把后面的用例也一起吞掉。
 */
async function postAsk(question, pathname = '/api/agent/search', timeoutMs = 180000) {
  try {
    const res = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* 非 JSON */
    }
    return { status: res.status, body };
  } catch (error) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      status: isTimeout ? 0 : -1,
      body: {
        error: isTimeout
          ? `请求超过 ${timeoutMs / 1000}s 未返回 —— 检查是否有出站调用没设超时（LLM_TIMEOUT_MS / ZHIHU_TIMEOUT_MS）`
          : String(error?.message ?? error),
      },
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
    // ⚠️ 所有端点统一走信封 { status:'success', data }（见 src/shared/contract.ts）。
    // 这里刻意按契约显式拆包：如果哪天有人漏了信封，用例要红，而不是悄悄读 undefined。
    const healthData = health.body?.data;
    check(
      '响应符合统一信封（status=success 且带 data）',
      health.body?.status === 'success' && Boolean(healthData),
      `body.status=${health.body?.status}`,
    );
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

    section('登录状态（授权域新口径）');
    const status = await getJson('/api/auth/session');
    check('/api/auth/session 返回 200', status.status === 200);
    const statusData = status.body?.data;
    // 前端三分支全靠这两个平级布尔，所以它们必须存在且是 boolean
    check(
      'configured 是布尔（凭证是否配齐）',
      typeof statusData?.configured === 'boolean',
      `configured=${statusData?.configured}`,
    );
    check(
      'authenticated 是布尔（是否已授权）',
      typeof statusData?.authenticated === 'boolean',
      `authenticated=${statusData?.authenticated}`,
    );
    check(
      'missing 是数组（缺哪些凭证直接可读）',
      Array.isArray(statusData?.missing),
      `missing=${JSON.stringify(statusData?.missing)}`,
    );
    check('未授权时 authenticated 为 false', statusData?.authenticated === false);

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
    const tooShort = await postAsk('太短');
    check('过短问题被拒（400）', tooShort.status === 400, tooShort.body?.error ?? '');
    const tooLong = await postAsk('测'.repeat(1200));
    check('超长问题被拒（400）', tooLong.status === 400, tooLong.body?.error ?? '');
    const badJson = await fetch(`${BASE}/api/agent/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    check('非法 JSON 被拒（400）', badJson.status === 400);

    section('端点迁移：新路径可用，旧路径仍兼容');
    const legacy = await postAsk('我在大厂做产品 7 年，该不该去创业公司？', '/api/ask');
    check(
      '废弃路径 /api/ask 仍返回 200（兼容旧脚本）',
      legacy.status === 200,
      `HTTP ${legacy.status}`,
    );

    section('领域域（专业领域社交）');
    const featured = await getJson('/api/fields/featured');
    const featuredFields = featured.body?.data ?? [];
    check(
      '推荐领域返回 7 个，且顺序是定义顺序',
      featuredFields.length === 7 && featuredFields[0]?.id === 'agent-dev',
      featuredFields.map((f) => f.name).join(' / '),
    );
    check(
      '每个领域都挂到了真实人物（不是空壳）',
      featuredFields.every((f) => f.memberCount > 0 && f.topicCount > 0),
      featuredFields.map((f) => `${f.name}:${f.memberCount}人`).join(' ｜ '),
    );

    const fieldSearch = await getJson(`/api/fields?query=${encodeURIComponent('训练大模型')}`);
    check(
      '领域搜索命中相关领域',
      (fieldSearch.body?.data?.total ?? 0) > 0,
      (fieldSearch.body?.data?.fields ?? []).map((f) => f.name).join(' / '),
    );
    check(
      '领域搜索只返回领域、不返回人物（两个功能的边界）',
      !JSON.stringify(fieldSearch.body?.data ?? {}).includes('"people"'),
    );
    // 回归断言：曾经因为给每个领域无条件叠加「人数加权」，
    // 任何查询都返回全部 7 个领域 —— 连不存在的词也一样。
    check(
      '无意义查询返回 0 个领域',
      (await getJson(`/api/fields?query=${encodeURIComponent('不存在的领域xyz')}`)).body?.data
        ?.total === 0,
    );
    check('领域搜索缺 query 返回 400', (await getJson('/api/fields')).status === 400);

    const graph = await getJson('/api/fields/agent-dev/graph');
    const graphData = graph.body?.data;
    const nodes = [...(graphData?.topics ?? []), ...(graphData?.people ?? [])];
    check(
      '星图同时返回议题与人物，且坐标都在 0~1000 画布内',
      (graphData?.topics?.length ?? 0) > 0 &&
        (graphData?.people?.length ?? 0) > 0 &&
        nodes.every(
          (n) =>
            n.position?.x >= 0 &&
            n.position?.x <= 1000 &&
            n.position?.y >= 0 &&
            n.position?.y <= 1000,
        ),
      `${graphData?.topics?.length} 议题 / ${graphData?.people?.length} 人`,
    );
    check(
      '人物头像三要素齐全（initial / avatarTone / relevance）',
      (graphData?.people ?? []).every(
        (p) => p.initial && p.avatarTone && typeof p.relevance === 'number',
      ),
    );
    check('未知领域返回 404', (await getJson('/api/fields/no-such-field/graph')).status === 404);

    section('核心链路：情境化问题应走「真人」');
    const askStart = Date.now();
    const human = await postAsk(
      '我在大厂做产品 7 年，收到一家 50 人 AI 创业公司产品负责人的 offer，固定薪资降 20% 但有期权和管理机会，同时我在这里晋升已经放缓，该不该去？',
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
    const result = human.body?.data;

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
    const generic = await postAsk('什么是大模型上下文窗口，它的原理是什么？');
    check('返回 200', generic.status === 200, generic.body?.error ?? `HTTP ${generic.status}`);
    check(
      '路由不是 human',
      generic.body?.data?.route === 'content' || generic.body?.data?.route === 'ai',
      `route=${generic.body?.data?.route} · ${generic.body?.data?.triageReason ?? ''}`,
    );
    check(
      '不给真人卡片',
      generic.body?.data?.recommendations?.length === 0,
    );
    check(
      '改为直接给公开内容',
      generic.body?.data?.contentOnly?.length > 0,
      `${generic.body?.data?.contentOnly?.length ?? 0} 条内容`,
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
