#!/usr/bin/env node
/**
 * 构建 SPA 并把产物放到 Next 的 `public/spa/` 下（同源部署用）。
 *
 * 为什么要这个脚本：
 *   Next 侧通过 `next.config.mjs` 的 fallback rewrite 把非 API 请求回落到
 *   `public/spa/index.html`，于是一个端口同时提供页面与接口 —— 这是**同源**部署的前提
 *   （跨站时浏览器不带 Cookie，登录与会话会直接失效）。
 *
 * ⚠️ 构建时**必须**传 `SPA_BASE=/spa/`：
 *   不传的话产物里的 `<script src="/assets/...">` 会去请求 `/assets/...`，
 *   而真实文件在 `/spa/assets/...` ⇒ 线上白屏。这个坑不会在本地双进程模式暴露，
 *   因为那时 Vite dev server 自己就是根。
 *
 * 用法：
 *   node scripts/build-spa.mjs
 *
 * 环境要求：**Node ≥ 22.13 + pnpm**（Vite 8 的要求，npm 装不上 ——
 * `@tailwindcss/vite` 的 peer 还不支持 Vite 8）。
 */

import { spawnSync } from 'node:child_process';
import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPA_DIR = path.join(ROOT, 'src', 'fronted');
const DIST = path.join(SPA_DIR, 'dist');
const OUT = path.join(ROOT, 'public', 'spa');

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(
    `✗ 当前 Node ${process.versions.node}，但 Vite 8 要求 ≥ 22.13。\n` +
      '  请切到 Node 22 再跑（例如 nvm use 22）。\n' +
      '  注：后端 Next 只要 18.18+，这个限制只针对前端构建。',
  );
  process.exit(1);
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const build = spawnSync(pnpm, ['run', 'build'], {
  cwd: SPA_DIR,
  /**
   * 两个变量缺一不可，漏一个都是灾难性的：
   *
   * `SPA_BASE=/spa/`：不设的话产物里是 `<script src="/assets/...">`，
   *   而真实文件在 `/spa/assets/...` ⇒ 线上白屏。
   *
   * `VITE_API_MODE=live`：不设的话 `create-api-client` 会回退到 **mock**
   *   （`import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock'`），
   *   线上跑的就是内置假数据 —— 页面照样能开、能点、能出结果，
   *   但**一次后端请求都不会发**。登录、LLM、真实语料全都是摆设。
   *   这个失败模式极阴险：看起来一切正常，只有对比后端日志才会发现请求数为 0。
   *   2026-09-15 部署时就漏了它，用户一眼看出「没接 OAuth、LLM 没跑」。
   */
  env: { ...process.env, SPA_BASE: '/spa/', VITE_API_MODE: 'live' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (build.status !== 0) {
  console.error('\n✗ SPA 构建失败，产物未更新（旧的 public/spa/ 保持原样）。');
  process.exit(build.status ?? 1);
}

const indexHtml = path.join(DIST, 'index.html');
try {
  await stat(indexHtml);
} catch {
  console.error(`✗ 没找到构建产物 ${indexHtml}`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await cp(DIST, OUT, { recursive: true });

console.log(`\n✓ SPA 产物已更新：public/spa/`);
console.log('  现在起后端（npm run dev -- --port 8787）访问 / 就是真实界面，不再是旧的 Next 页面。');
</content>
