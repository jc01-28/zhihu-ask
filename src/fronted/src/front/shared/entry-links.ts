/**
 * 项目推荐页两个按钮的地址解析。
 *
 * 放在这里而不是组件里，是为了让「未配置时不得生成无效链接」这条规则可以被单元测试
 * 直接覆盖：页面只需要消费解析结果，不需要自己判断 URL 合法性。
 */

/** 线上 Demo 默认展示的项目地址；环境变量未配置时也必须有可用出口。 */
export const PROJECT_GITHUB_URL = "https://github.com/jc01-28/zhihu-ask/tree/main";

/** 明确标注为占位的示例地址：即使被填进环境变量，也视为「未配置」。 */
function isPlaceholder(url: URL): boolean {
  if (url.hostname === "example.com" || url.hostname.endsWith(".example.com")) {
    return true;
  }
  // .env.example 里给出的示例仓库地址；避免示例值被当成真实地址发布出去。
  if (url.hostname === "github.com" && url.pathname.startsWith("/example/")) {
    return true;
  }
  return false;
}

/**
 * 解析 GitHub 地址：只接受 https 的、非占位的绝对地址，否则返回 null。
 * 返回 null 时页面必须展示「暂未配置」的禁用按钮，而不是指向别处的死链接。
 */
export function resolveGithubUrl(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (isPlaceholder(url)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type LiveSiteLink =
  | { kind: "internal"; to: string }
  | { kind: "external"; href: string };

/**
 * 解析「进入在线网站」地址。
 *
 * 默认指向本站的功能首页 `/app`；配置了外部的 https 地址时按外链处理；
 * 其他任何形态（http、javascript:、相对片段）都回退到 `/app`。
 */
export function resolveLiveSiteUrl(raw: string | undefined): LiveSiteLink {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "internal", to: "/app" };
  if (value.startsWith("/") && !value.startsWith("//")) {
    return { kind: "internal", to: value };
  }
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !isPlaceholder(url)) {
      return { kind: "external", href: url.toString() };
    }
  } catch {
    // 非法地址：回退到站内入口。
  }
  return { kind: "internal", to: "/app" };
}
