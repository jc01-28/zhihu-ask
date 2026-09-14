#!/usr/bin/env node
/**
 * 提交前自检（publish-check）
 *
 * 解决的问题：要往公开仓库推代码时，最容易出的事故是「把不该传的文件传上去」——
 * 尤其是凭证。而 .gitignore 是**只增不减**的规则表，靠人记住"哪些不能传"一定会漏。
 *
 * 这个脚本做三件事：
 *   1. 按 .gitignore **推导**出真正会被发布的文件清单（规则表本身是唯一事实源，不会走样）
 *   2. 读取 .env.local 里的真实密钥值，逐个在可发布文件里反查
 *      —— 直接回答「我的密钥有没有漏进要公开的文件」，比模式匹配可靠得多
 *   3. 兜一层通用模式扫描（sk- 开头的 key、赋值型密钥），防住尚未写入 .env.local 的凭证
 *
 * 用法：node scripts/publish-check.mjs
 *       node scripts/publish-check.mjs --list   # 额外列出全部将发布文件
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const LIST = process.argv.includes('--list');

/** 即使 .gitignore 没写，这些目录也绝不该被扫描/发布 */
const ALWAYS_SKIP = new Set(['.git', 'node_modules', '.next']);

/** 文件大于这个尺寸就跳过内容扫描（正常源码不会这么大） */
const MAX_SCAN_BYTES = 512 * 1024;

// ── 解析 .gitignore ────────────────────────────────────────────────────

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

async function loadIgnoreRules() {
  let raw = '';
  try {
    raw = await readFile(path.join(ROOT, '.gitignore'), 'utf8');
  } catch {
    console.warn('⚠️  找不到 .gitignore —— 这本身就是个风险信号');
  }

  const rules = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const negated = trimmed.startsWith('!');
    const body = negated ? trimmed.slice(1) : trimmed;
    rules.push({
      negated,
      dirOnly: body.endsWith('/'),
      value: body.replace(/\/$/, ''),
    });
  }
  return rules;
}

function isIgnored(relativePath, rules) {
  let ignored = false;
  const segments = relativePath.split('/');
  const base = segments[segments.length - 1];

  for (const rule of rules) {
    let hit = false;
    if (rule.dirOnly) {
      // 目录规则：任意一段路径等于该名字即命中
      hit = segments.slice(0, -1).includes(rule.value) || base === rule.value;
    } else if (rule.value.includes('*') || rule.value.includes('?')) {
      const re = globToRegExp(rule.value);
      hit = re.test(relativePath) || re.test(base);
    } else {
      hit = base === rule.value || relativePath === rule.value;
    }
    if (hit) ignored = !rule.negated;
  }
  return ignored;
}

// ── 遍历可发布文件 ─────────────────────────────────────────────────────

async function collectPublishable(rules, relativeDir = '') {
  const out = [];
  const absoluteDir = path.join(ROOT, relativeDir);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (ALWAYS_SKIP.has(entry.name)) continue;
    if (isIgnored(rel, rules)) continue;

    if (entry.isDirectory()) {
      out.push(...(await collectPublishable(rules, rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// ── 读取真实密钥值 ─────────────────────────────────────────────────────

/** 这些名字里带的值都算敏感 */
const SENSITIVE_KEY = /SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL/i;
/**
 * 占位符判定。
 *
 * ⚠️ 这里踩过一个非常隐蔽的坑：最初写成 `/^(|your[-_]|xxx|...)/i`，
 * 开头那个**空分支**让正则在任何字符串的位置 0 都能匹配成功 ——
 * 于是每一个真实密钥都被判成「占位符」跳过，反查形同虚设，
 * 而脚本照样打印「自检通过」。给的是**假安全感**，比没有检查更危险。
 * 教训：占位符这类「负向判定」必须写单测/投毒验证，否则无法发现它恒真。
 */
const PLACEHOLDER = /^(your[-_]|xxx|todo|changeme|placeholder|replace[-_]?me|示例|待填)/i;

async function loadRealSecrets() {
  const secrets = [];
  let raw = '';
  try {
    raw = await readFile(path.join(ROOT, '.env.local'), 'utf8');
  } catch {
    console.log('ℹ️  没有 .env.local，跳过「真实密钥反查」（只跑通用模式扫描）\n');
    return secrets;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const value = rest.join('=').trim().replace(/^["']|["']$/g, '');
    // 太短的值（如 App ID 451）既不是秘密、也容易误报，跳过
    if (!SENSITIVE_KEY.test(key)) continue;
    if (value.length < 8) continue;
    if (PLACEHOLDER.test(value)) continue;
    secrets.push({ key: key.trim(), value });
  }
  return secrets;
}

// ── 扫描 ───────────────────────────────────────────────────────────────

/**
 * 通用模式：即使凭证还没写进 .env.local，也应该被抓到。
 *
 * ⚠️ 这里的设计原则是**宁可漏一点，也不要误报**。
 * 第一版用了宽松的 `SECRET\s*=\s*[A-Za-z0-9_.]{16,}`，结果把
 * `secret = process.env.ZHIHU_ACCESS_SECRET` 这类**代码**全判成泄露，7 条命中全是误报。
 * 一个总是喊狼来了的检查，最后一定会被人忽略 —— 那比没有检查更糟。
 *
 * 所以现在要求「引号包裹的字面量」：真正的硬编码密钥几乎都长这样
 * （JSON 配置、`process.env.X || "sk-..."` 兜底值、文档里的示例）。
 * 而 .env 文件风格的泄露由「真实密钥反查」那一步精确覆盖，不需要靠模式匹配。
 */
const GENERIC_PATTERNS = [
  { name: 'OpenAI 风格 key 字面量', re: /sk-[A-Za-z0-9_-]{16,}/g },
  {
    name: '引号包裹的密钥字面量',
    re: /(?:SECRET|API_?KEY|APP_?KEY|ACCESS_?TOKEN|PASSWORD)\s*[=:]\s*["'][A-Za-z0-9_\-+/.=]{20,}["']/gi,
  },
];

function isProbablyText(buffer) {
  // 出现 NUL 字节基本可以判定是二进制
  return !buffer.subarray(0, 4096).includes(0);
}

async function main() {
  console.log('=== 发布自检 ===\n');

  const rules = await loadIgnoreRules();
  const files = (await collectPublishable(rules)).sort();
  const secrets = await loadRealSecrets();

  console.log(`将发布的文件：${files.length} 个`);
  const topLevel = [...new Set(files.map((f) => f.split('/')[0]))].sort();
  console.log(`顶层条目：${topLevel.join('  ')}\n`);

  const problems = [];

  // 1) 不该出现的路径
  const forbidden = ['.env.local', '.env', 'internal', '.cache', '.artifacts', 'node_modules'];
  for (const item of forbidden) {
    const hit = files.find((f) => f === item || f.startsWith(`${item}/`));
    if (hit) problems.push(`不该被发布的路径出现在清单里：${hit}`);
  }

  // 2) 真实密钥反查
  //    这一步是主要防线：模式匹配只能抓「长得像密钥的东西」，
  //    而反查直接回答「我的密钥有没有出现在要公开的文件里」，零假设。
  //    所以「没加载到任何密钥」必须显式说出来，不能静默跳过 —— 静默跳过 = 假通过。
  if (!secrets.length) {
    console.log('⚠️  未从 .env.local 读到任何密钥，真实密钥反查被跳过。');
    console.log('    如果 .env.local 确实有凭证，请检查变量名是否含 SECRET/KEY/TOKEN 字样。\n');
    problems.push('真实密钥反查未生效（没有加载到密钥），本自检结论不完整');
  } else {
    console.log(`真实密钥反查（${secrets.length} 个值，只显示变量名不显示值）…`);
    for (const { key, value } of secrets) {
      const leakedInto = [];
      for (const file of files) {
        const absolute = path.join(ROOT, file);
        try {
          const info = await stat(absolute);
          if (info.size > MAX_SCAN_BYTES) continue;
          const buffer = await readFile(absolute);
          if (!isProbablyText(buffer)) continue;
          if (buffer.toString('utf8').includes(value)) leakedInto.push(file);
        } catch {
          /* 读不了就跳过 */
        }
      }
      if (leakedInto.length) {
        problems.push(`${key} 的值出现在可发布文件中：${leakedInto.join('、')}`);
        console.log(`  ❌ ${key}`);
      } else {
        console.log(`  ✅ ${key}`);
      }
    }
    console.log('');
  }

  // 3) 通用模式扫描
  console.log('通用密钥模式扫描…');
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    let text;
    try {
      const info = await stat(absolute);
      if (info.size > MAX_SCAN_BYTES) continue;
      const buffer = await readFile(absolute);
      if (!isProbablyText(buffer)) continue;
      text = buffer.toString('utf8');
    } catch {
      continue;
    }
    for (const { name, re } of GENERIC_PATTERNS) {
      re.lastIndex = 0;
      const match = re.exec(text);
      if (match) {
        // .env.example 里的空赋值不会命中（要求 16 位以上）
        problems.push(`${file} 命中「${name}」：${match[0].slice(0, 24)}…`);
      }
    }
  }
  console.log(`  ${problems.length ? '有命中' : '无命中'}\n`);

  if (LIST) {
    console.log('=== 将发布的文件清单 ===');
    for (const file of files) console.log(`  ${file}`);
    console.log('');
  }

  console.log('=== 结论 ===');
  if (problems.length === 0) {
    console.log('  ✅ 自检通过：没有发现密钥泄露，也没有不该发布的路径。');
    console.log('     提示：git 历史里若有已提交过的文件，删掉文件本身不会从历史中消失。');
    console.log('     从未推送过的话，最干净的做法是重新 git init。');
    process.exit(0);
  }

  console.log(`  ❌ 发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log(`     · ${p}`);
  console.log('\n  处理方式：把对应文件移入已经忽略的目录（如 internal/），或加入 .gitignore。');
  console.log('  若已提交过，删文件不够 —— 需要处理 git 历史。');
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
