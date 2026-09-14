import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveGithubUrl, resolveLiveSiteUrl } from "@/front/shared/entry-links";
import { createTestClient, renderApp } from "../test-utils";

afterEach(() => vi.unstubAllEnvs());

describe("项目推荐页", () => {
  it("只介绍项目：不展示登录用户、搜索框或人物数据", async () => {
    renderApp({ client: createTestClient(), route: "/" });

    expect(await screen.findByText("知乎黑客松 Demo")).toBeInTheDocument();
    expect(screen.getByText("知域")).toBeInTheDocument();
    expect(screen.getByText(/找到值得问的人/)).toBeInTheDocument();
    expect(screen.queryByLabelText("你现在想找什么样的人？")).toBeNull();
    expect(screen.queryByText("演示用户")).toBeNull();
    expect(screen.queryByRole("button", { name: /开始找人/ })).toBeNull();
  });

  it("渲染两个出口且不请求任何业务 API", async () => {
    const client = createTestClient();
    const session = vi.spyOn(client, "getSession");
    const fields = vi.spyOn(client, "getFeaturedFields");
    const search = vi.spyOn(client, "streamSearch");
    const topics = vi.spyOn(client, "getHotTopics");

    renderApp({ client, route: "/" });
    await screen.findByText("知乎黑客松 Demo");

    expect(session).not.toHaveBeenCalled();
    expect(fields).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(topics).not.toHaveBeenCalled();
  });

  it("未配置环境变量时仍使用线上 Demo 的 GitHub 项目地址", async () => {
    vi.stubEnv("VITE_GITHUB_URL", "");

    renderApp({ client: createTestClient(), route: "/" });

    const link = await screen.findByRole("link", {
      name: /查看 GitHub 项目/,
    });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/jc01-28/zhihu-ask/tree/main",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("配置 GitHub 地址后使用该地址并在新标签打开", async () => {
    vi.stubEnv("VITE_GITHUB_URL", "https://github.com/acme/zhihu-wenren");

    renderApp({ client: createTestClient(), route: "/" });

    const link = await screen.findByRole("link", { name: /查看 GitHub 项目/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/zhihu-wenren");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("在线网站按钮默认指向本站 /app", async () => {
    renderApp({ client: createTestClient(), route: "/" });

    const link = await screen.findByRole("link", { name: /进入在线网站/ });
    expect(link).toHaveAttribute("href", "/app");
    expect(link).not.toHaveAttribute("target");
  });

  it("配置外部在线地址时按外链打开", async () => {
    vi.stubEnv("VITE_LIVE_SITE_URL", "https://zhihu-wenren.example.org/app");

    renderApp({ client: createTestClient(), route: "/" });

    const link = await screen.findByRole("link", { name: /进入在线网站/ });
    expect(link).toHaveAttribute("href", "https://zhihu-wenren.example.org/app");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("入口地址解析", () => {
  it("GitHub 地址只接受非占位的 https 绝对地址", () => {
    expect(resolveGithubUrl("https://github.com/acme/repo")).toBe(
      "https://github.com/acme/repo",
    );
    expect(resolveGithubUrl("  https://github.com/acme/repo  ")).toBe(
      "https://github.com/acme/repo",
    );

    for (const bad of [
      undefined,
      "",
      "   ",
      "github.com/acme/repo",
      "http://github.com/acme/repo",
      "javascript:alert(1)",
      "https://github.com/example/zhihu-wenren",
      "https://example.com/repo",
    ]) {
      expect(resolveGithubUrl(bad)).toBeNull();
    }
  });

  it("在线地址解析：站内路径走路由，外部 https 走外链，其余回退 /app", () => {
    expect(resolveLiveSiteUrl("/app")).toEqual({ kind: "internal", to: "/app" });
    expect(resolveLiveSiteUrl("/app/fields")).toEqual({
      kind: "internal",
      to: "/app/fields",
    });
    expect(resolveLiveSiteUrl(undefined)).toEqual({ kind: "internal", to: "/app" });
    expect(resolveLiveSiteUrl("https://demo.example.org")).toEqual({
      kind: "external",
      href: "https://demo.example.org/",
    });

    // 危险或非法的输入一律回退到站内入口，绝不生成可点击的外部链接。
    for (const bad of ["//evil.example/x", "javascript:alert(1)", "http://x.example", "???"]) {
      expect(resolveLiveSiteUrl(bad)).toEqual({ kind: "internal", to: "/app" });
    }
  });
});
