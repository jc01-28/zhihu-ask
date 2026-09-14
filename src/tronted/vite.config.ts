import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * 联调用的后端地址。`VITE_API_MODE=live` 时前端只发相对路径请求，
 * 由开发服务器把 /api 与 /auth 代理到真实后端，浏览器侧不出现跨站 Cookie。
 */
const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
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
