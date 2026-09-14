/**
 * 极简 .env 加载器 —— 让 scripts/*.mjs 不再依赖 `node --env-file`
 *
 * 为什么需要它：`--env-file` 是 **Node 20+** 才有的特性，而本项目的运行环境可能是
 * Node 18（Next 15 只要求 18.18+）。结果是 `npm run zhihu:doctor` / `harvest` /
 * `llm-probe` 会直接以 `node: bad option: --env-file` 失败 —— 看起来像凭证没配，
 * 实际是脚本根本没启动。排查很容易跑偏，所以自己加载。
 *
 * 用法：在脚本顶部 `import './load-env.mjs';`（副作用导入，早于任何 process.env 读取）
 *
 * 约定：
 *   - 按 .env.local → .env 顺序读，先出现的优先（.env.local 覆盖 .env）
 *   - **不覆盖**已存在的真实环境变量（命令行传入的优先级最高）
 *   - 文件不存在静默跳过（不联网、不报错）
 *   - ⚠️ 不展开 `$(...)`：shell 才做这件事，dotenv 系一律不做。
 *     检测到 `$(` 会告警 —— 那通常意味着有人把 README 里的示例命令整行复制进来了，
 *     结果密钥变成了字面量 `$(openssl rand -hex 32)`。这个坑真实发生过。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FILES = ['.env.local', '.env'];

/** 解析一行 `KEY=VALUE`，失败返回 null */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();

  const quoted = /^(['"]).*\1$/s.test(value);
  if (quoted) {
    value = value.slice(1, -1);
  } else {
    // 去掉行内注释。只在"空白 + #"处切，避免误伤值里本身就有的 #
    const hash = value.search(/\s#/);
    if (hash >= 0) value = value.slice(0, hash).trim();
  }

  return key ? [key, value] : null;
}

let loaded = false;
const suspicious = [];

for (const file of FILES) {
  const full = path.resolve(process.cwd(), file);
  if (!existsSync(full)) continue;

  for (const line of readFileSync(full, 'utf8').split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    const [key, value] = parsed;
    if (value.includes('$(')) suspicious.push(key);

    // 真实环境变量优先：命令行传的 > 文件里的
    if (process.env[key] === undefined) process.env[key] = value;
  }
  loaded = true;
}

if (suspicious.length > 0) {
  console.warn(
    `⚠️  ${suspicious.join(', ')} 的值里含有 "$(…)"，看起来是把 README 的示例命令复制进来了。\n` +
      '   .env 不会执行 shell —— 这个值会被当成普通字符串。请换成真实值，例如：\n' +
      '   SESSION_SECRET=$(openssl rand -hex 32)   ← 在 shell 里执行这行，再写结果进去',
  );
}

export const envLoaded = loaded;
export const suspiciousKeys = suspicious;
