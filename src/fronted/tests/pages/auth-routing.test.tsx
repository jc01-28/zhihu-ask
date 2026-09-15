import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";

import { ApiError } from "@/front/api/ApiError";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import { createTestClient, renderApp } from "../test-utils";

describe("授权路由", () => {
  it("读取会话期间展示 loading 骨架", async () => {
    const client = createTestClient();
    client.getSession = () => new Promise(() => undefined);

    renderApp({ client });

    expect(screen.getByRole("status")).toHaveTextContent("正在读取登录状态");
  });

  it("未配置授权时也放行访客（演示模式），不显示门禁", async () => {
    // 显式走 /app：这里验证的是「功能首页」这一入口，不是默认的 /app/find
    renderApp({ client: createTestClient({ authState: "unconfigured" }), route: "/app" });

    // 演示模式下无需登录即可进入功能首页
    expect(
      await screen.findByRole("heading", { name: "你想怎么开始？" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("当前部署缺少知乎授权配置，无法进入。请联系管理员补齐服务端配置后再试。")).toBeNull();
    expect(screen.getByText("访客模式 · 全部功能可直接体验")).toBeInTheDocument();
  });

  it("未授权时不再拦在授权页，直接进入功能首页", async () => {
    renderApp({ client: createTestClient({ authState: "anonymous" }), route: "/app" });

    expect(
      await screen.findByRole("heading", { name: "你想怎么开始？" }),
    ).toBeInTheDocument();
    // 顶栏如实显示「访客」，不假装已授权
    expect(screen.getAllByText("访客").length).toBeGreaterThan(0);
    expect(screen.queryByText("知乎账号已授权")).toBeNull();
  });

  it("授权回调状态不再阻断进入（演示模式无门禁页）", async () => {
    renderApp({
      client: createTestClient({ authState: "anonymous" }),
      route: "/app?auth=state_mismatch",
    });

    expect(
      await screen.findByRole("heading", { name: "你想怎么开始？" }),
    ).toBeInTheDocument();
  });

  it("已授权时 /app 进入功能首页并展示两个入口", async () => {
    renderApp({ client: createTestClient(), route: "/app" });

    expect(
      await screen.findByRole("heading", { name: "你想怎么开始？" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /浏览专业领域/ })).toHaveAttribute(
      "href",
      "/app/fields",
    );
    expect(screen.getByRole("link", { name: /描述问题找人/ })).toHaveAttribute(
      "href",
      "/app/find",
    );
    expect(screen.getByText("演示用户")).toBeInTheDocument();
  });

  it("已授权时 /app/find 进入问题找人页", async () => {
    renderApp({ client: createTestClient() });

    expect(await screen.findByRole("button", { name: /开始找人/ })).toBeInTheDocument();
    expect(screen.getByText("演示用户")).toBeInTheDocument();
  });

  it("聊天页 401 不再挡回授权门禁（演示模式），而是给出可返回的错误", async () => {
    const client = createTestClient();
    const unauthorized = async () => {
      throw new ApiError({
        code: API_ERROR_CODES.authExpired,
        message: "授权已过期",
        status: 401,
        retryable: false,
      });
    };
    client.getConversation = unauthorized;
    client.listMessages = unauthorized;

    renderApp({ client, route: "/chat/conversation-1" });

    // 演示模式下访客可直接用，401 只当作一次失败提示，不再渲染登录墙
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("登录状态已失效，请重新使用知乎账号授权。");
    expect(alert).toHaveTextContent("重试");
    expect(alert).toHaveTextContent("返回上一页");
    // 不再出现门禁页的授权入口
    expect(screen.queryByRole("link", { name: /用知乎账号登录|去授权/ })).toBeNull();
  });

  it("未知路径展示 404 页面并可以返回首页", async () => {
    renderApp({ client: createTestClient(), route: "/not-exist" });

    expect(await screen.findByText("页面不存在")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /返回首页/ })).toHaveAttribute("href", "/");
  });
});
