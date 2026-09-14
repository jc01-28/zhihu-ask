/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
