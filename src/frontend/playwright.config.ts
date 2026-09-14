import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 只跑 Mock 模式。
 *
 * `tests/e2e` 里的用例全部依赖 `VITE_API_MODE=mock`，因此 webServer
 * 自己拉起一个独立的 dev server（默认端口 4319），不复用开发者本机的
 * 5173，避免误连到真实后端。
 */
const PORT = 4319;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Mock 后端状态镜像在浏览器 sessionStorage 里，串行执行更利于定位问题。
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    // 直接调用本地 vite，避免依赖 node_modules/.bin。
    command: `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_API_MODE: "mock",
      VITE_MOCK_AUTH_STATE: "authenticated",
    },
  },
});
