# Cloudflare Pages 反代（登录回调域名适配）

**目的**：知乎登录的回调地址登记的是 `https://zhihu-wenren.pages.dev/auth/callback`
（黑客松报名表「知乎登录回调地址」字段），OAuth 校验**逐字符一致**。
真实后端在别的域名上，所以用这层 Pages Functions 把 `zhihu-wenren.pages.dev` 的
请求全部转发过去 —— 域名对上登记值，登录即通。

## 目录结构

```
cloudflare-pages/
└── functions/
    └── [[path]].js     ← 全站反代 + 回调路径映射
```

## 部署（Cloudflare 控制台，不需要 wrangler）

1. 登录 [Cloudflare Dash](https://dash.cloudflare.com/) → Workers & Pages
2. 找到 `zhihu-wenren` 这个 Pages 项目（域名 `zhihu-wenren.pages.dev` 就是它）
3. 把本目录的 `functions/[[path]].js` 放进该项目的 `functions/[[path]].js`，
   重新部署（控制台「Create deployment」拖拽上传，或 git 集成直接 push）
4. 部署后自测：
   ```bash
   curl -sI "https://zhihu-wenren.pages.dev/api/health" | head -1     # 期待 200
   curl -sI "https://zhihu-wenren.pages.dev/auth/callback" | head -1  # 任意状态都行，只要不是 404
   ```

部署完成后，后端的 `ZHIHU_REDIRECT_URI` 必须是登记值本身：

```
ZHIHU_REDIRECT_URI=https://zhihu-wenren.pages.dev/auth/callback
```

（后端 `.env` 已按此配置并重新发布。）

## 验证登录

打开 `https://zhihu-wenren.pages.dev` → 点「知乎账号登录」→ 知乎授权页点「确认授权」
→ 应回到站点且顶栏显示知乎昵称。
