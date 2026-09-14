/**
 * Cloudflare Pages Functions · 全站反代
 *
 * 为什么需要它：知乎登录的回调地址登记的是 `https://zhihu-wenren.pages.dev/auth/callback`
 * （见黑客松报名表的「知乎登录回调地址」字段）。OAuth 校验回调时要求**逐字符一致**，
 * 而我们的真实后端跑在另一个域名上 —— 域名对不上，知乎直接报「出错啦！请稍后再试」。
 *
 * 解法：让 Pages 把所有请求原样转发给真实后端。这样：
 *   · 用户访问 https://zhihu-wenren.pages.dev 就是完整应用（同源，Cookie 正常）
 *   · 回调地址与登记值一致，OAuth 打通
 *
 * 特殊映射：登记的是 `/auth/callback`，后端真实路由是 `/api/auth/zhihu/callback`，
 *   转发时改写路径。其余路径（含 /api/**、/spa/**）原样透传。
 */

const UPSTREAM = "https://zhihu-wenren.app.workbuddy.host";

export const onRequest = async ({ request }) => {
  const url = new URL(request.url);

  const target = new URL(url.pathname + url.search, UPSTREAM);
  if (url.pathname === "/auth/callback") {
    target.pathname = "/api/auth/zhihu/callback";
  }

  const headers = new Headers(request.headers);
  headers.delete("host");

  // redirect:"manual" —— 登录接口会 302 到知乎授权页，必须原样交还给浏览器，
  // 让它自己去跳，而不是由反代替它跟过去（那会把 Set-Cookie 弄丢）。
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });

  const out = new Headers(upstream.headers);
  // Workers 会把多个 Set-Cookie 合并成一个头，逐条拆出来重放，避免丢 Cookie
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  if (cookies.length) {
    out.delete("set-cookie");
    for (const c of cookies) out.append("set-cookie", c);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
};
