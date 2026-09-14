#!/usr/bin/env node
/**
 * 对照实验（A/B/C 三组）—— 路演最重要的一页数据
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 这个脚本回答一个问题：**它比直接用关键词搜索强吗？**
 * 评审权重 40% 在「AI 场景价值」，而「场景成立」必须用对照数据支撑。
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 三组配置（同一套代码，只是配置不同 —— 见 src/domain/experiment.ts）：
 *   A  纯关键词检索          → 搜到相关内容的作者
 *   B  纯语义检索（向量）    → 跨措辞召回的作者
 *   C  完整链路              → 两路 RRF 融合 + 经历抽取 + 证据校验
 *
 * 核心指标：**Top-3 有效人选率**
 *   推荐的前 3 个人里，有多少是「真的第一人称经历过这个话题」的人。
 *   ground truth 来自 scripts/gold/labels.json（按 topic 维度标注）。
 *
 * 辅助指标：
 *   - 覆盖率：这一组能为多少个问题产出推荐（产不出推荐 = 无价值）
 *   - 证据覆盖率：外显理由能逐字回溯的比例（C 组才有意义）
 *   - 平均延迟 / P95 延迟
 *   - 大 V 集中度（健康指标，越低越好）
 *
 * 用法：
 *   # 先起服务（脚本会自己起，但调试时可复用已有的）
 *   node scripts/eval.mjs
 *   node scripts/eval.mjs --port 3100 --groups A,B,C --questions q01,q02
 *   node scripts/eval.mjs --live-llm     # 用真实 LLM（慢，但抽取质量真实）
 *
 * 产出：
 *   eval/report.md       ← 可直接贴进计划书的 Markdown 表格
 *   eval/raw.json        ← 逐条原始结果，便于复核
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GOLD_QUESTIONS, GENERIC_PROBE_QUESTIONS } from './gold/questions.mjs';

const ROOT = process.cwd();
const EVAL_DIR = path.join(ROOT, 'eval');

// ── 参数解析 ────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg('port', 3210));
const GROUPS = arg('groups', 'A,B,C').split(',').map((s) => s.trim()).filter(Boolean);
const QUESTION_FILTER = arg('questions', '').split(',').map((s) => s.trim()).filter(Boolean);
const LIVE_LLM = has('live-llm');
const BASE = `http://127.0.0.1:${PORT}`;

/** 每个请求的超时。per-hit 抽取 + LLM 时可能到 60s，给足余量 */
const REQUEST_TIMEOUT_MS = Number(arg('timeout', 180000));

/**
 * 兜底看门狗。**默认 5 分钟**（可以用 --watchdog 调大）。
 *
 * 为什么需要它：收尾逻辑一旦卡住（关服务、写文件、句柄没释放），脚本会「假装还在跑」——
 * 实测有任务因此挂了 **2 小时 12 分**，而报告其实早在第 1 分钟就写好了。
 * 定时器用 unref：它**不会**延长进程寿命，但只要进程还活着就一定会到点强制退出。
 *
 * 正常一轮（fixture + 无 LLM）约 40~70 秒，5 分钟是很宽的余量。
 * 跑 --live-llm 时请显式调大：npm run eval -- --live-llm --watchdog 1800
 */
const WATCHDOG_MS = Number(arg('watchdog', 300)) * 1000;
setTimeout(() => {
  console.error(`\n⚠️ 已超过 ${WATCHDOG_MS / 1000}s 仍未结束，强制退出以免进程挂死。`);
  console.error('   若这是 --live-llm 的正常耗时，请调大：npm run eval -- --watchdog 1800');
  process.exit(2);
}, WATCHDOG_MS).unref();

// ── 标注加载 ────────────────────────────────────────────────────────────

async function loadLabels() {
  const raw = await readFile(path.join(ROOT, 'scripts/gold/labels.json'), 'utf8');
  return JSON.parse(raw);
}

/**
 * 判定一个推荐是不是「有效人选」。
 *
 * 判定规则（客观、可复现）：
 *   该作者的 firstPersonTopics 包含这个问题所属的 topic
 *   → 他确实第一人称写过这个话题的经历 → 有效
 *
 * 这是一个**宽松**的判定：只要写过就算，不判断写的内容是否真的能回答问题。
 * 所以它是「上界估计」。报告里会注明这个局限。
 */
function isValidPick(authorName, topic, labels) {
  const author = labels.authors[authorName];
  if (!author) return false;
  return (author.firstPersonTopics ?? []).includes(topic);
}

// ── 单次请求 ────────────────────────────────────────────────────────────

async function ask(question, experiment) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${BASE}/api/agent/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, experiment }),
      signal: controller.signal,
    });
    const ms = Date.now() - startedAt;
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, ms, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    const body = JSON.parse(text);
    return { ok: true, ms, data: body.data };
  } catch (error) {
    return { ok: false, ms: Date.now() - startedAt, error: String(error.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

// ── 单组 × 单问题 ───────────────────────────────────────────────────────

function evaluateOne(result, question, labels) {
  const recs = result.recommendations ?? [];
  const names = recs.map((r) => r.candidate?.authorName).filter(Boolean);
  const validFlags = names.map((n) => isValidPick(n, question.topic, labels));

  const top3 = names.slice(0, 3);
  const top3Valid = validFlags.slice(0, 3).filter(Boolean).length;

  return {
    produced: recs.length > 0,
    recommendedNames: names,
    validFlags,
    top3Count: top3.length,
    top3Valid,
    // 「Top-3 有效人选率」：前 3 里有效的比例。没产出推荐时记 0
    top3Rate: top3.length ? top3Valid / top3.length : 0,
    // 「至少命中一个」：Top-3 里有没有真亲历者（二值，更抗噪声）
    anyValid: validFlags.slice(0, 3).some(Boolean),
    evidenceCoverage: result.metrics?.evidenceCoverage ?? 0,
    bigVShare: result.metrics?.bigVShare ?? 0,
    route: result.route,
    candidateCount: result.metrics?.candidateCount ?? 0,
    hitCount: result.metrics?.hitCount ?? 0,
    eventCount: result.metrics?.eventCount ?? 0,
    experimentId: result.experiment?.id ?? '',
  };
}

// ── 服务生命周期 ────────────────────────────────────────────────────────

function startServer() {
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'dev', '-p', String(PORT)],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // 评测必须关掉限流（否则 60 个请求会撞 20 次的窗口）
        ASK_RATE_LIMIT: '0',
        // 评测跑 fixture，保证可复现
        USE_FIXTURES: '1',
        // ⚠️ 必须显式钉死语料范围。Next 不会用 .env.local 覆盖已存在的 process.env，
        // 但这里没写这一项时，.env.local 里的 FIXTURE_CORPUS=real 就会生效 ——
        // 于是评测拿真实语料去对 gold 标签，指标全错却看起来一切正常。
        // 对照实验的标签只对合成语料有效，所以评测永远只看 synthetic。
        FIXTURE_CORPUS: 'synthetic',
        // 不传 LLM 时走确定性降级 —— 这样指标可复现，且不烧额度
        LLM_PROVIDER: LIVE_LLM ? process.env.LLM_PROVIDER || 'openai' : 'none',
      },
      shell: process.platform === 'win32',
    },
  );
  child.stdout.on('data', (d) => {
    const s = String(d);
    if (s.includes('Ready') || s.includes('error')) process.stdout.write(`[dev] ${s}`);
  });
  child.stderr.on('data', (d) => process.stderr.write(`[dev:err] ${d}`));
  return child;
}

async function waitForServer(maxSec = 60) {
  for (let i = 0; i < maxSec; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ── 聚合与报告 ──────────────────────────────────────────────────────────

function aggregate(rows) {
  const n = rows.length || 1;
  const produced = rows.filter((r) => r.produced);
  const withTop3 = rows.filter((r) => r.top3Count > 0);

  const avg = (arr, pick) =>
    arr.length ? arr.reduce((s, r) => s + (pick(r) ?? 0), 0) / arr.length : 0;

  const latencies = rows.filter((r) => r.ms).map((r) => r.ms).sort((a, b) => a - b);
  const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));

  return {
    questions: rows.length,
    produced: produced.length,
    coverage: produced.length / n,
    // 主指标：只在「产出了推荐」的问题上算有效率 ——
    // 否则产不出推荐会拉低平均值，但我们其实想单独看「产出率」这个指标
    top3Rate: withTop3.length ? avg(withTop3, (r) => r.top3Rate) : 0,
    anyValidRate: withTop3.length ? withTop3.filter((r) => r.anyValid).length / withTop3.length : 0,
    avgTop3Valid: withTop3.length ? avg(withTop3, (r) => r.top3Valid) : 0,
    evidenceCoverage: avg(produced, (r) => r.evidenceCoverage),
    bigVShare: avg(produced, (r) => r.bigVShare),
    avgCandidates: avg(produced, (r) => r.candidateCount),
    avgHits: avg(produced, (r) => r.hitCount),
    avgEvents: avg(produced, (r) => r.eventCount),
    avgMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    p95Ms: latencies.length ? latencies[p95Index] : 0,
  };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}
function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildMarkdown({ byGroup, rows, labels, meta }) {
  const lines = [];
  lines.push('# 对照实验结果（A/B/C）');
  lines.push('');
  lines.push(`> 生成时间：${new Date().toISOString()}`);
  lines.push(`> 问题数：${meta.questions} ｜ 语料：${labels.docCount} 条 / ${Object.keys(labels.authors).length} 位作者`);
  lines.push(`> LLM：${meta.liveLlm ? '真实模型' : '确定性降级（LLM_PROVIDER=none）'} ｜ Embedding：${meta.embedder}`);
  lines.push('');
  lines.push('## 主指标');
  lines.push('');
  lines.push('| 组 | 配置 | Top-3 有效人选率 ↑ | 至少命中1位 ↑ | 产出覆盖率 ↑ | 证据覆盖率 ↑ | 平均候选数 | 平均延迟 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const [id, a] of Object.entries(byGroup)) {
    const label = meta.labels[id]?.label ?? id;
    lines.push(
      `| **${id}** | ${label} | **${pct(a.top3Rate)}** | ${pct(a.anyValidRate)} | ${pct(a.coverage)} | ${pct(
        a.evidenceCoverage,
      )} | ${a.avgCandidates.toFixed(1)} | ${fmtMs(a.avgMs)} |`,
    );
  }
  lines.push('');
  lines.push('## 逐问题明细');
  lines.push('');
  const header = ['问题', 'topic', ...Object.keys(byGroup).map((g) => `${g} 组命中`)];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);
  for (const r of rows) {
    const cells = [
      `\`${r.qid}\``,
      r.topic,
      ...Object.keys(byGroup).map((g) => {
        const cell = r.groups[g];
        if (!cell || !cell.produced) return '—';
        const marks = cell.validFlags.map((v) => (v ? '✓' : '✗')).join('');
        return `${cell.top3Valid}/${cell.top3Count} ${marks}`;
      }),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('> ✓ = 该推荐人确实第一人称写过这个主题（ground truth） ｜ ✗ = 只是写过相关内容，没亲历');
  lines.push('');
  lines.push('## 方法学与局限（如实声明）');
  lines.push('');
  lines.push('1. **语料是合成的**：`scripts/gold/corpus.mjs` 生成 168 条内容，');
  lines.push('   每条在生成时就写下 ground truth（是否第一人称亲历）。');
  lines.push('   这验证了「方法在受控条件下有效」，**不能替代真实数据结论**。');
  lines.push('2. **「有效」的判定是上界**：只要作者在对应主题上写过第一人称内容就算有效，');
  lines.push('   不判断那段内容是否真的能回答这个具体问题。所以数字偏乐观。');
  lines.push('3. **噪声占多数（53%）**是对现实的刻意模拟：真实搜索结果里，');
  lines.push('   评论型与方法论型内容占比远高于亲历型。Baseline 的失败正是从这来的。');
  if (meta.embedderDegraded) {
    lines.push('4. ⚠️ **Embedding 后端是降级实现（hash 投影），不是真语义模型**。');
    lines.push('   它只捕捉词元重合度，因此 **B 组应被理解为「弱关键词基线」，');
    lines.push('   它对 A 组的提升不代表语义召回的真实能力**。');
    lines.push('   要得到可信的 B 组数字，需配置 `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` /');
    lines.push('   `EMBEDDING_MODEL` 后重跑。C 组的增益主要来自「经历抽取 + 证据校验」，');
    lines.push('   这部分不依赖 embedding 质量，结论成立。');
  }
  lines.push('5. **「产出覆盖率」单列**：Triage 判定为 `ai`/`content` 的问题会走「别问人」路径、');
  lines.push('   不产出推荐 —— 这是产品的克制设计，不是失败。故主指标只在「产出推荐」的');
  lines.push('   问题上计算，覆盖率单独报告。');
  return lines.join('\n');
}

// ── 主流程 ──────────────────────────────────────────────────────────────

async function main() {
  await mkdir(EVAL_DIR, { recursive: true });
  const labels = await loadLabels();

  const questions = QUESTION_FILTER.length
    ? GOLD_QUESTIONS.filter((q) => QUESTION_FILTER.includes(q.id))
    : GOLD_QUESTIONS;

  const { resolveExperiment, EXPERIMENTS } = await import('./gold/experiments.mjs');
  const meta = {
    questions: questions.length,
    liveLlm: LIVE_LLM,
    embedder: process.env.EMBEDDING_MODEL
      ? `${process.env.EMBEDDING_MODEL}（远程）`
      : 'hash-fallback（降级，未配置 EMBEDDING_*）',
    embedderDegraded: !process.env.EMBEDDING_MODEL,
    labels: EXPERIMENTS,
  };

  console.log(`对照实验：${GROUPS.join(' / ')} 组 × ${questions.length} 个问题`);
  console.log(`语料 ${labels.docCount} 条 / ${Object.keys(labels.authors).length} 位作者`);
  console.log('');

  let server = null;
  // ⚠️ 默认**不复用**已有服务：复用会带来一个极隐蔽的坑 ——
  // 端口上如果是「改了代码之前起的」旧进程，你会在完全不知情的情况下
  // 用旧代码跑完整个评测，然后对着假数据调参。
  // 想复用必须显式 --reuse（调试时才用）。
  const reuse = has('reuse');
  const booted =
    reuse &&
    (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
      .then(() => true)
      .catch(() => false));

  // ⚠️ 端口预检（不要删）：不打算复用、端口却被别的东西占着时必须立刻失败。
  // 原因：`next dev` 发现端口被占会**静默改用下一个端口**，而下面的 waitForServer
  // 轮询的是 ${BASE}/api/health —— 于是它连上的是**那个占着端口的陌生服务**。
  // 后果有两个，都真发生过：
  //   1) 用旧代码跑完一整轮评测，数字看起来还特别可信；
  //   2) 陌生服务处于半死状态时，每个请求卡到 REQUEST_TIMEOUT_MS（180s），
  //      整轮 60 个请求要跑二十多分钟。
  if (!booted) {
    const occupied = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
      .then(() => true)
      .catch(() => false);
    if (occupied) {
      console.error(`❌ 端口 ${PORT} 已被占用（且未指定 --reuse）。`);
      console.error('   先停掉占用进程，或换端口：npm run eval -- --port 3240');
      process.exit(1);
    }
  }

  if (booted) {
    console.log(`⚠️ 复用已有服务 ${BASE}（--reuse 显式指定，确认它跑的是当前代码）\n`);
  } else {
    console.log('启动 dev server…');
    server = startServer();
    const ok = await waitForServer();
    if (!ok) {
      console.error('服务未能在 60 秒内就绪');
      server.kill();
      process.exit(1);
    }
    console.log('服务就绪\n');
  }

  const rows = [];
  const errors = [];

  try {
    for (const q of questions) {
      const row = { qid: q.id, question: q.question, topic: q.topic, groups: {} };
      process.stdout.write(`${q.id} `);

      for (const g of GROUPS) {
        const res = await ask(q.question, g);
        if (!res.ok) {
          errors.push({ qid: q.id, group: g, error: res.error });
          row.groups[g] = { produced: false, error: res.error, ms: res.ms };
          process.stdout.write(`${g}:ERR `);
          continue;
        }
        const ev = evaluateOne(res.data, q, labels);
        row.groups[g] = { ...ev, ms: res.ms, runId: res.data.runId };
        process.stdout.write(`${g}:${ev.top3Valid}/${ev.top3Count} `);
      }
      console.log('');
      rows.push(row);
    }

    // Triage 克制性检验：通用知识问题不该路由到 human
    const triageRows = [];
    for (const q of GENERIC_PROBE_QUESTIONS) {
      const res = await ask(q.question, GROUPS[GROUPS.length - 1]);
      if (res.ok) {
        triageRows.push({ qid: q.id, question: q.question, route: res.data.route, ok: res.data.route !== 'human' });
      }
    }

    // Aggregation
    const byGroup = {};
    for (const g of GROUPS) {
      const groupRows = rows.map((r) => ({ ...r.groups[g], qid: r.qid })).filter((x) => x && x.ms !== undefined);
      byGroup[g] = aggregate(groupRows);
    }

    const markdown = buildMarkdown({ byGroup, rows, labels, meta });
    // 附上 Triage 结果
    const triageSection = [
      '',
      '## Triage 克制性（通用知识问题不该打扰真人）',
      '',
      '| 问题 | 路由结果 | 是否克制 ✓ |',
      '|---|---|---|',
      ...triageRows.map((t) => `| ${t.question} | \`${t.route}\` | ${t.ok ? '✓' : '✗'} |`),
      '',
      triageRows.length
        ? `路由克制率：**${pct(triageRows.filter((t) => t.ok).length / triageRows.length)}**（${triageRows.filter((t) => t.ok).length}/${triageRows.length}）`
        : '',
    ].join('\n');

    await writeFile(path.join(EVAL_DIR, 'report.md'), markdown + triageSection + '\n', 'utf8');
    await writeFile(
      path.join(EVAL_DIR, 'raw.json'),
      JSON.stringify({ meta, byGroup, rows, triageRows, errors }, null, 2),
      'utf8',
    );

    console.log('');
    console.log('═══ 结果 ═══');
    for (const [id, a] of Object.entries(byGroup)) {
      console.log(
        `${id} 组：Top-3 有效人选率 ${pct(a.top3Rate)} ｜ 至少命中1位 ${pct(a.anyValidRate)} ｜ ` +
          `覆盖率 ${pct(a.coverage)} ｜ 延迟 ${fmtMs(a.avgMs)}`,
      );
    }
    if (errors.length) console.log(`\n⚠️ ${errors.length} 次请求失败（见 eval/raw.json 的 errors）`);
    console.log('');
    console.log('报告：eval/report.md');
    console.log('原始：eval/raw.json');
  } finally {
    await stopServer(server);
  }
}

/**
 * 关掉被测服务。**必须杀整棵进程树**，不能只 `child.kill()`。
 *
 * 踩过的坑（代价：一个后台任务挂了 2 小时 12 分）：
 * `startServer()` 用 `spawn(..., { shell: true })` 起的是 cmd/npx 包装进程，
 * 真正的 `next dev` 是它的孙进程。只杀包装进程会留下 next 继续占端口，
 * 而且它的 stdout/stderr 管道一直开着 —— 父进程的事件循环因此永不空转结束。
 * 结果极具误导性：报告文件早写好了、控制台也打了「已停止 dev server」，
 * 但任务一直显示「运行中」。
 *
 * ⚠️ 这里刻意用**异步 spawn 而不是 spawnSync**：收尾阶段任何阻塞都可能让进程挂死。
 * 而且 spawnSync 找不到命令时只是返回 error、不会抛，静默失败反而更难查。
 */
async function stopServer(child) {
  if (!child) return;

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      const done = () => resolve();
      killer.on('close', done);
      killer.on('error', done);
      // 保险：taskkill 自己卡住也不能拖死我们
      setTimeout(done, 3000).unref?.();
    });
  } else {
    child.kill('SIGTERM');
  }

  // 显式断开管道，确保没有任何句柄继续挂住父进程
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref?.();
  console.log('\n已停止 dev server');
}

main()
  // 兜底：即使还有句柄没释放，也一定让进程退出
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
