/**
 * Cloudflare Pages · 全站反代（_worker.js 高级模式）
 *
 * 为什么用 `_worker.js` 而不是 `functions/[[path]].js`：
 * wrangler CLI 在 Windows 上部署时**不扫描 `functions/` 目录**（实测日志一直是
 * `Uploaded 0 files` 或只传静态资源），函数完全不生效 —— 所有路径都退化成静态首页。
 * `_worker.js` 放在静态目录根部即被识别（日志会出现 `Compiled Worker successfully`），
 * 是 CLI 部署下最可靠的接管方式。
 *
 * 目的：让 `zhihu-wenren.pages.dev` 的所有请求转发到真实后端，
 * 使 OAuth 回调地址与黑客松报名表登记值（`/auth/callback`）逐字符一致。
 *
 * ── 两个必须处理的细节 ────────────────────────────────────────────────
 * 1. **必须传回原始 Host**（`X-Forwarded-Host` + 保留 `Host`）。
 *    后端用 `request.url` 作为相对 Location 的 base 来拼跳转地址。
 *    如果把 Host 删掉，后端拿到的是自己的监听地址，于是回调成功后
 *    会把用户 302 到 `https://0.0.0.0:3000/app?auth=success` —— 一个打不开的地址。
 *    实测症状：`/auth/callback` → `LOC=https://0.0.0.0:3000/app?auth=code_missing`。
 * 2. **重写回包的 Location**：把指向上游内部地址的跳转改回本域，
 *    否则用户会被带出 pages.dev，Cookie 也随之丢失（同源会话直接断掉）。
 */

const UPSTREAM = "https://zhihu-wenren.app.workbuddy.host";

/** 上游内部地址的特征：这些出现在 Location 里说明后端没认对 Host */
const INTERNAL_HOST_RE = /^https?:\/\/(0\.0\.0\.0|127\.0\.0\.1|localhost)(:\d+)?/i;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 健康探针：确认反代本身活着，不打扰上游
    if (url.pathname === "/__proxy_ok") {
      return new Response("proxy alive", { status: 200 });
    }

    const target = new URL(url.pathname + url.search, UPSTREAM);
    // 报名表登记的是 /auth/callback，后端真实路由是 /api/auth/zhihu/callback
    if (url.pathname === "/auth/callback") {
      target.pathname = "/api/auth/zhihu/callback";
    }

    const headers = new Headers(request.headers);
    // 保留 Host（而不是删掉），让后端知道用户实际访问的是哪个域名；
    // 再补一个 X-Forwarded-Host 兜底，覆盖后端优先读它的情形。
    headers.set("Host", url.host);
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const upstream = await fetch(target, init);

    const out = new Headers(upstream.headers);

    // 1) 把指向上游内部地址的 Location 拉回本域（同源，Cookie 才留得住）
    const location = upstream.headers.get("location");
    if (location) {
      if (INTERNAL_HOST_RE.test(location)) {
        // 例如 https://0.0.0.0:3000/app?auth=success → https://zhihu-wenren.pages.dev/app?auth=success
        out.set("location", new URL(new URL(location).pathname + new URL(location).search, url.origin).toString());
      }
    }

    // 2) Workers 会把多个 Set-Cookie 合并成一个头，逐条拆出来重放，避免丢 Cookie
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    if (cookies.length) {
      out.delete("set-cookie");
      for (const c of cookies) out.append("set-cookie", c);
    }

    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
