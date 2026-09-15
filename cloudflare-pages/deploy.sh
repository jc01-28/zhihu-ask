#!/usr/bin/env bash
# 部署 zhihu-wenren.pages.dev 反代（Cloudflare Pages）
#
# 为什么必须用 _worker.js：wrangler CLI 在 Windows 上**不扫描 functions/ 目录**，
# 部署日志会显示 `Uploaded 0 files`，所有路径退化成静态首页。
# _worker.js 放在静态目录根部会被正确识别（日志出现 `Compiled Worker successfully`）。
#
# 前置：npx wrangler login（一次即可，凭据存在 ~/AppData/Roaming/xdg.config/.wrangler）
set -euo pipefail
cd "$(dirname "$0")/.."
D=".pages-deploy"
rm -rf "$D"; mkdir -p "$D"
cp "cloudflare-pages/functions/_worker.js" "$D/_worker.js"
npx wrangler pages deploy "$D" --project-name=zhihu-wenren --branch=main --commit-dirty=true
