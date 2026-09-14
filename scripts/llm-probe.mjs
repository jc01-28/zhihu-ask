#!/usr/bin/env node
/**
 * LLM 连通性与「结构化输出能力」探针
 *
 * 为什么单独做这个脚本：
 *   整条链路有 3 处依赖模型吐出**可解析的 JSON**（问题结构化 / 经历抽取 / 解释生成）。
 *   免费或轻量模型经常在这一点上翻车 —— 输出里带解释文字、带 Markdown 围栏、
 *   或者干脆漏字段。等到跑整条链路时才发现，排查成本会高很多。
 *   所以先单独把「模型能不能稳定吐 JSON」这件事测掉。
 *
 * 用法：
 *   node scripts/llm-probe.mjs
 *   node scripts/llm-probe.mjs --rounds 3
 */

import './load-env.mjs';

const BASE = (process.env.LLM_BASE_URL || '').replace(/\/$/, '');
const KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || '';
const ROUNDS = Number(argValue('--rounds') ?? 3);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function mask(value) {
  if (!value) return '(空)';
  return value.length <= 8 ? value : `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
}

/** 与 src/framework/llm-utils.ts 的 extractJson 同源实现，保持行为一致 */
function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error('输出中找不到 JSON');
  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error('输出中的 JSON 不闭合');
}

async function chat(messages, { temperature = 0, maxTokens } = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature,
      stream: false,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
  });
  const text = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`响应里没有 content：${text.slice(0, 300)}`);
  return { content, ms, usage: data.usage ?? null };
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('=== LLM 探针 ===');
  console.log(`  base_url : ${BASE || '(空)'}`);
  console.log(`  model    : ${MODEL || '(空)'}`);
  console.log(`  api_key  : ${mask(KEY)}`);
  console.log('');

  if (!BASE || !KEY || !MODEL) {
    console.error('缺少 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，无法检测。');
    process.exit(1);
  }

  console.log('【1】基础连通性（纯文本）');
  try {
    const { content, ms, usage } = await chat([{ role: 'user', content: '用一句中文回答：1+1 等于几？' }]);
    record('连通性', content.includes('2'), `${ms}ms · "${content.trim().slice(0, 40)}"`);
    if (usage) console.log(`     usage: ${JSON.stringify(usage)}`);
  } catch (error) {
    record('连通性', false, error.message);
    console.log('\n连通性都过不了，后面的检查没有意义，先解决上面的报错。');
    process.exit(1);
  }

  console.log('\n【2】结构化输出（与项目里「经历抽取」同形状的任务，共 %d 轮）', ROUNDS);
  const system =
    '你是经历抽取器。从一段知乎内容中，抽取作者「亲身经历过」的职业/人生决策事件。\n' +
    '严格规则：\n' +
    '1. 只抽第一人称的真实经历，旁观者评论、纯观点、方法论综述一律不要。\n' +
    '2. quote 必须从原文逐字摘录，不得改写、不得拼接、不得概括。\n' +
    '3. 原文没有明确经历时，返回 {"events": []}，不要为了凑数编造。\n' +
    '4. relevance 表示这段经历与用户问题的相关程度，0 到 1。\n' +
    '\n【输出格式】\n' +
    '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释性文字。\n' +
    '严格遵循以下结构（字段名不得改动）：\n' +
    `{\n  "events": [\n    {\n      "firstPerson": true,\n      "from": "转变前状态",\n      "to": "转变后状态",\n      "decision": "当时做的关键判断",\n      "constraints": ["当时受什么约束"],\n      "timeHint": "时间线索，如 2023 年",\n      "quote": "从原文逐字摘录的片段",\n      "relevance": 0.0\n    }\n  ]\n}`;

  const sampleText =
    '三年前我在一家头部大厂做到 Senior 产品经理。一家 50 人左右的 AI 创业公司找我做产品负责人，' +
    '固定薪资降了 20%，给期权。我最后接了。当时判断对的地方是我先问自己：降薪 20% 之后现金流能不能扛住 18 个月，' +
    '我算过房贷，答案是能。踩的坑是我以为管理经验可以平移，实际上前三个月我几乎没写出过一份完整的产品方案。';

  let structuredPass = 0;
  for (let round = 1; round <= ROUNDS; round += 1) {
    try {
      const { content, ms } = await chat([
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ userProblem: { currentState: '大厂产品经理面临降薪跳槽' }, content: { title: '从大厂到 AI 创业公司', author: '林一舟', text: sampleText } }) },
      ]);
      const parsed = extractJson(content);
      const events = Array.isArray(parsed?.events) ? parsed.events : null;
      if (!events) throw new Error('缺少 events 数组');

      if (events.length === 0) {
        record(`第 ${round} 轮`, false, `${ms}ms · 抽取结果为空（该样例应能抽出经历）`);
        continue;
      }
      const first = events[0];
      const missing = ['firstPerson', 'from', 'to', 'decision', 'timeHint', 'quote', 'relevance'].filter(
        (k) => first[k] === undefined,
      );
      const quoteOk = typeof first.quote === 'string' && sampleText.includes(first.quote);
      const fenced = /```/.test(content);

      const problems = [];
      if (missing.length) problems.push(`缺字段 ${missing.join(',')}`);
      if (!quoteOk) problems.push('quote 不是原文逐字摘录');
      if (fenced) problems.push('输出带 Markdown 围栏（能解析但说明没遵守指令）');

      if (problems.length) {
        record(`第 ${round} 轮`, false, `${ms}ms · ${problems.join('；')}`);
      } else {
        structuredPass += 1;
        record(`第 ${round} 轮`, true, `${ms}ms · ${events.length} 条经历 · quote 可回溯 ✓`);
      }
    } catch (error) {
      record(`第 ${round} 轮`, false, error.message);
    }
  }

  console.log('\n=== 结论 ===');
  const ok = structuredPass === ROUNDS;
  if (ok) {
    console.log(`  ✅ 结构化输出 ${structuredPass}/${ROUNDS} 轮全部通过，可以直接跑整条链路。`);
  } else {
    console.log(`  ⚠️  结构化输出仅 ${structuredPass}/${ROUNDS} 轮通过。`);
    console.log('     对策（按性价比排序）：');
    console.log('     1) 换更强的模型档位（如 sensenova 的非 lite 版本）');
    console.log('     2) 降低单次抽取的内容长度（MAX_TEXT 现在 1500 字）');
    console.log('     3) 收紧 system prompt 里的字段约束，并给一个输出示例');
    console.log('     4) 依赖项目自带的降级路径：解析失败会自动退回启发式抽取，链路不会断');
  }
  console.log(`\n  提示：项目内 LLM_PROVIDER 需要设为 openai 才会用这个端点（当前进程读到的是 ${process.env.LLM_PROVIDER || '(未设置)'}）。`);

  process.exit(ok ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
