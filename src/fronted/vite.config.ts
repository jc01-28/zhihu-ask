import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * 联调用的后端地址。`VITE_API_MODE=live` 时前端只发相对路径请求，
 * 由开发服务器把 /api 与 /auth 代理到真实后端，浏览器侧不出现跨站 Cookie。
 */
const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET ?? "http://127.0.0.1:8787";

/**
 * 产物里的资源前缀。
 *
 * 默认是 `/`（独立运行时 SPA 自己占一个域名）。
 * **同源部署时必须改成 `/spa/`**：那种模式下 SPA 产物被放到 Next 的 `public/spa/` 下，
 * 由 Next 对外同时提供 API 与页面。若这里仍是 `/`，构建出的 `<script src="/assets/...">`
 * 会去请求 `/assets/...`，而真实文件在 `/spa/assets/...` ⇒ 页面白屏。
 *
 * 由 `scripts/build-spa.mjs` 在构建时注入 `SPA_BASE=/spa/`，开发模式不受影响。
 */
const base = process.env.SPA_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: devProxyTarget, changeOrigin: true },
      "/auth": { target: devProxyTarget, changeOrigin: true },
    },
  },
});
