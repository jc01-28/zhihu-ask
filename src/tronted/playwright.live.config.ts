import { defineConfig, devices } from "@playwright/test";

/**
 * live 模式的 E2E：浏览器真的去请求一台 HTTP 服务器。
 *
 * 与默认的 `playwright.config.ts` 的区别就是「有没有后端」：
 *  - 默认配置跑 `VITE_API_MODE=mock`，验证 UI 与状态机，快速且零依赖；
 *  - 本配置跑 `--mode live`，前面挂 `scripts/live-stub-server.mjs`，
 *    验证的是 mock 模式永远碰不到的几件事：真实响应必须过契约、
 *    NDJSON 要在真实 socket 上分块到达、会话探测与错误信封的实际行为。
 *
 * 单独占一个端口与一份配置，因为这两类用例的启动前提不同，
 * 混在一起会让默认的 `pnpm run test:e2e` 也依赖这个桩服务器。
 *
 *   pnpm run test:e2e:live
 *
 * 注意：Playwright 会自己发一次 HTTP 请求去判断「服务起来了吗」。
 * 如果运行环境把本地端口也接管了，这次探测可能拿到 404/502：dev server
 * 明明已经在监听、也已经打印 `ready in ...`，探测却一直 404，于是报出
 * `Timed out waiting 120000ms from config.webServer`——一个与真实原因
 * 完全无关的错。实测过：同一个环境里 8787 的探测正常（502 → 200），
 * 4320 的探测无论服务在不在都返回 404；而用 `node -e` 直接
 * `http.get` 同一个地址却是 200。**这是环境行为，不是项目问题。**
 *
 * 真的遇到时有两个办法：
 *   1. 换一个不受限的终端跑（首选，什么都不用改）；
 *   2. 自己把两个服务起好，然后设 `PW_NO_WEBSERVER=1` 跳过托管：
 *        node scripts/live-stub-server.mjs --port 8787 --latency 120 &
 *        node ./node_modules/vite/bin/vite.js --mode live --port 4320 --strictPort &
 *        PW_NO_WEBSERVER=1 pnpm exec playwright test --config playwright.live.config.ts
 */

const PORT = 4320;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const STUB_PORT = 8787;
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

/** 见上方注释：环境把本地端口接管时，跳过 webServer 托管、直接连已起好的服务。 */
const skipWebServer = process.env.PW_NO_WEBSERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e-live",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "live-desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : [
        {
          // 逐事件延迟调大：用例要断言「进度是逐条到达的」，
          // 默认 40ms 在真实浏览器里太短，快到看不出中间态。
          command: `node scripts/live-stub-server.mjs --port ${STUB_PORT} --latency 120`,
          url: `${STUB_URL}/api/__stub/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
        {
          // `--mode live` 让 vite 读 `.env.live`（`VITE_API_MODE=live`），
          // 而不是默认的 `.env.development`（mock）。不依赖进程环境变量的
          // 优先级，因为 `.env.local` 的存在会改变那套规则的落点。
          command: `node ./node_modules/vite/bin/vite.js --mode live --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
