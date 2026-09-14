interface ImportMetaEnv {
  readonly VITE_API_MODE?: "mock" | "live";
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MOCK_AUTH_STATE?: "authenticated" | "anonymous" | "unconfigured";
  readonly VITE_ENABLE_DEMO_ROLE_SWITCHER?: string;
  readonly VITE_DEV_PROXY_TARGET?: string;
  /** 项目推荐页的 GitHub 地址。留空或占位地址时按钮显示「暂未配置」。 */
  readonly VITE_GITHUB_URL?: string;
  /** 项目推荐页「进入在线网站」的地址。留空时回退到本站 `/app`。 */
  readonly VITE_LIVE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
