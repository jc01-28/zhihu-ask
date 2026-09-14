/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * 同源部署：非 API 请求一律回落到 SPA 的 index.html。
   *
   * 为什么必须同源：浏览器**不会给跨站请求带 Cookie**，而我们的会话依赖
   * `zh_session` / `zh_guest` 两枚 Cookie。前后端一旦分成两个域名，
   * 登录态与会话在演示环境里直接失效（本地用 Vite 代理绕开了这个问题，
   * 上线后没有代理可用）。
   *
   * 匹配顺序由 Next 保证：真实静态文件 → 动态路由（含 /api/*）→ fallback。
   * 所以 `/api/health`、`/_next/*`、`/spa/assets/*` 都不会被这里拦掉。
   *
   * SPA 产物由 `scripts/build-spa.mjs` 生成到 `public/spa/`。
   * 该目录不存在时（纯 API 模式开发）这些 rewrite 自然落空，不影响本地双进程开发。
   */
  async rewrites() {
    return {
      fallback: [{ source: '/:path*', destination: '/spa/index.html' }],
    };
  },

  webpack: (config, { dev }) => {
    if (dev) {
      // ⚠️ 不要删这段 ignored —— 它决定了 dev 模式是「秒级」还是「分钟级」。
      //
      // 原因：业务写盘的两个目录就在项目内（dataDir() 回退到 cwd）：
      //   .cache/     步骤缓存 + 额度计数   —— 每次请求都会写
      //   .artifacts/ 每步中间产物          —— 每次请求写 8 个文件
      // Next dev 默认监听整个项目树，于是每次写盘都触发一个 watcher 事件，
      // 引发路由失效与重编译。表现是「结果全对、但慢得离谱」：
      // 实测一轮 npm run eval（62 个请求，单请求仅 20ms）要跑 11 分钟。
      //
      // 忽略这两个目录后，同一轮回到几十秒。
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.next/**',
          '**/.cache/**',
          '**/.artifacts/**',
          // src/frontend 是独立 Vite SPA，Next 不需要监听它（它的 node_modules / dist 尤其吵）
          '**/src/frontend/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
