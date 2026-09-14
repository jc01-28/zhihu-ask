#!/usr/bin/env node
/**
 * 前端边界检查。
 *
 * 这个脚本只做静态边界校验，不放任何业务代码。它把实施计划里「靠人工记住」的
 * 几条硬约束变成可执行的检查，避免它们在后续提交里被悄悄破坏。
 *
 * ## 检查范围（重要）
 *
 * 这是一个**多人在同一个仓库里协作**的工程：`src/back` 归后端、`src/app` 与
 * `src/shared` 也可能有后端放的东西。因此本脚本**只检查前端自己拥有的文件**：
 *
 *   - `src/front/**`                 —— 全部属于前端
 *   - `src/app/main.tsx`             —— 前端唯一的启动入口
 *   - `src/shared/contracts/**`      —— 前后端共享的公开契约（会进浏览器）
 *
 * 明确**不检查** `src/back/**`，也不去枚举 `src/app` 与 `src/shared` 下
 * 除了上述文件之外的任何内容。那些目录归后端，我们不替别人定目录规矩。
 *
 * ## 六条规则
 *
 *  1. `server-leak`      前端拥有的代码里不得出现服务端实现或密钥；
 *  2. `direct-fetch`     page / feature / component 不得直接 fetch；
 *  3. `contract-purity`  公开契约不得依赖 React，也不得读环境变量；
 *  4. `app-entry`        前端启动入口 `src/app/main.tsx` 必须存在；
 *  5. `boundary-doc`     后端边界说明必须存在，且声明了绝不下发的敏感字段；
 *  6. `creator-routing`  聊天路由不得再把 creatorId 当作会话 ID。
 *
 * 用 `node scripts/check-boundaries.mjs` 运行，退出码非 0 表示越界。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

const violations = [];

function toPosix(path) {
  return path.split(sep).join("/");
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function filesUnder(rel) {
  const abs = join(SRC, rel);
  try {
    statSync(abs);
  } catch {
    return [];
  }
  return walk(abs);
}

function read(file) {
  return readFileSync(file, "utf8");
}

/** 前端拥有的、会进浏览器的源码文件。边界检查只针对这些文件。 */
function frontendOwnedSourceFiles() {
  const entry = join(SRC, "app", "main.tsx");
  return [
    ...filesUnder("front"),
    ...(existsSync(entry) ? [entry] : []),
    ...filesUnder("shared/contracts"),
  ];
}

/** 注释行只描述规则，不构成实现，扫描时必须排除，否则规则文档本身会被误判。 */
function isCommentLine(line) {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("*/")
  );
}

function report(rule, file, line, detail) {
  violations.push({ rule, file: toPosix(relative(ROOT, file)), line, detail });
}

/* ------------------------------------------------------------------ */
/* 1. 前端拥有的代码里不允许出现服务端实现或密钥                        */
/* ------------------------------------------------------------------ */

const SERVER_PATTERNS = [
  { re: /\bfrom\s+["']next\//, detail: "导入了 Next.js 模块" },
  { re: /\brequire\(["']next\//, detail: "require 了 Next.js 模块" },
  { re: /\bdrizzle-orm\b/, detail: "引用了 Drizzle ORM" },
  { re: /cloudflare:workers/, detail: "引用了 Cloudflare Workers 运行时" },
  { re: /ZHIHU_ACCESS_SECRET/, detail: "出现了知乎 Access Secret 名称" },
  { re: /APP_SESSION_SECRET/, detail: "出现了会话签名密钥名称" },
  { re: /localStorage\.clear\s*\(/, detail: "整表清空 localStorage" },
];

for (const file of frontendOwnedSourceFiles()) {
  if (/\.(ts|tsx|js|jsx|mjs)$/.test(file) === false) continue;
  const lines = read(file).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    for (const { re, detail } of SERVER_PATTERNS) {
      if (re.test(line)) report("server-leak", file, index + 1, detail);
    }
  });
}

/* ------------------------------------------------------------------ */
/* 2. 页面 / feature / 组件不得直接 fetch                               */
/* ------------------------------------------------------------------ */

for (const rel of ["front/pages", "front/features", "front/components"]) {
  for (const file of filesUnder(rel)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    read(file)
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (/\bfetch\s*\(/.test(line) || /\bnew\s+Response\s*\(/.test(line)) {
          report("direct-fetch", file, index + 1, "绕过 ApiClient 直接访问网络");
        }
      });
  }
}

/* ------------------------------------------------------------------ */
/* 3. 公开契约的纯度                                                    */
/* ------------------------------------------------------------------ */
/*                                                                    */
/* 只检查 `src/shared/contracts/` 里的文件：它们是前后端共享、会随前端 */
/* 一起进浏览器的。这条规则对谁写的文件都成立，因为它是安全性而非归属权。 */
/* 注意：**不再**要求「src/shared 下只允许 contracts/」——那是替后端定  */
/* 目录规矩，共享仓库里后端有权在 src/shared 放自己的东西。             */

const CONTRACT_FILE_RE = /^[a-z0-9-]+\.ts$/;
for (const file of filesUnder("shared/contracts")) {
  const name = toPosix(relative(join(SRC, "shared", "contracts"), file));
  if (name.includes("/") || !CONTRACT_FILE_RE.test(name)) {
    report(
      "contract-purity",
      file,
      0,
      "契约文件必须是 src/shared/contracts/ 下的 kebab-case .ts",
    );
    continue;
  }
  const content = read(file);
  if (/\bfrom\s+["']react["']/.test(content)) {
    report("contract-purity", file, 0, "公开契约不得依赖 React");
  }
  if (/process\.env|import\.meta\.env/.test(content)) {
    report("contract-purity", file, 0, "公开契约不得读取环境变量");
  }
}

/* ------------------------------------------------------------------ */
/* 4. 前端启动入口必须存在                                              */
/* ------------------------------------------------------------------ */
/*                                                                    */
/* 只断言入口在，**不禁止** src/app 下有别的文件：共享仓库里后端也可能  */
/* 在 src/app 放自己的东西。                                          */

const APP_ENTRY = join(SRC, "app", "main.tsx");
if (!existsSync(APP_ENTRY)) {
  report("app-entry", APP_ENTRY, 0, "缺少前端启动入口 src/app/main.tsx");
}

/* ------------------------------------------------------------------ */
/* 5. 后端边界说明必须存在且完整                                        */
/* ------------------------------------------------------------------ */
/*                                                                    */
/* 边界说明原本放在 src/back/README.md。共享仓库里 src/back 归后端，把   */
/* 它挤在别人的实现文件旁边不合适，因此移到 docs/ 下；这条规则跟着走。   */

const BOUNDARY_DOC = join(ROOT, "docs", "BACKEND_BOUNDARY.md");
if (!existsSync(BOUNDARY_DOC)) {
  report("boundary-doc", BOUNDARY_DOC, 0, "缺少后端边界说明 docs/BACKEND_BOUNDARY.md");
} else {
  const content = read(BOUNDARY_DOC);
  if (/ZHIHU_ACCESS_SECRET|APP_SESSION_SECRET/.test(content) === false) {
    // 边界文档必须显式声明不得下发的敏感字段，缺失说明文档被裁剪过。
    report("boundary-doc", BOUNDARY_DOC, 0, "边界说明缺少绝不下发的敏感字段声明");
  }
}

/* ------------------------------------------------------------------ */
/* 6. 聊天路由不得把 creatorId 当会话 ID                                */
/* ------------------------------------------------------------------ */

for (const file of [...filesUnder("front/pages"), ...filesUnder("front/app")]) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const content = read(file);
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    // 允许：createConversation({ creatorId, ... })、跳转使用 conversation.id
    // 禁止：路由参数用 creatorId，或拼出 /chat/${creator.id}
    if (/useParams<\{[^}]*creatorId/.test(line)) {
      report("creator-routing", file, index + 1, "路由参数使用了 creatorId");
    }
    if (/\/chat\/\$\{[^}]*creator\.(id|creatorId)/.test(line)) {
      report("creator-routing", file, index + 1, "跳转链接使用了 creatorId");
    }
  });
}

/* ------------------------------------------------------------------ */

if (violations.length === 0) {
  console.log(
    "边界检查通过：前端拥有的文件（src/front、src/app/main.tsx、src/shared/contracts）符合规范。",
  );
  process.exit(0);
}

console.error(`边界检查发现 ${violations.length} 处越界：\n`);
for (const item of violations) {
  const where = item.line > 0 ? `${item.file}:${item.line}` : item.file;
  console.error(`  [${item.rule}] ${where} — ${item.detail}`);
}
console.error("\n请把越界代码移回允许的目录，不要放宽这里的规则。");
process.exit(1);
