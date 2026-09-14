import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";

import { ApiError } from "@/front/api/ApiError";
import { AUTH_MESSAGES, AUTH_LOGIN_PATH } from "@/front/features/auth/auth-messages";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import { createTestClient, renderApp } from "../test-utils";

describe("授权路由", () => {
  it("读取会话期间展示 loading 骨架", async () => {
    const client = createTestClient();
    client.getSession = () => new Promise(() => undefined);

    renderApp({ client });

    expect(screen.getByRole("status")).toHaveTextContent("正在读取登录状态");
  });

  it("未配置时给出未配置门禁且不提供绕过入口", async () => {
    renderApp({ client: createTestClient({ authState: "unconfigured" }) });

    expect(
      await screen.findByText("当前部署缺少知乎授权配置，无法进入。请联系管理员补齐服务端配置后再试。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /当前部署未配置知乎授权/ }),
    ).toBeDisabled();
    expect(screen.queryByRole("link", { name: /使用知乎账号授权/ })).toBeNull();
  });

  it("未授权时展示知乎授权入口", async () => {
    renderApp({ client: createTestClient({ authState: "anonymous" }) });

    const loginLink = await screen.findByRole("link", {
      name: /使用知乎账号授权/,
    });
    expect(loginLink).toHaveAttribute("href", AUTH_LOGIN_PATH);
    expect(screen.getByText("授权完成后才会进入功能首页。")).toBeInTheDocument();
  });

  it("授权回调状态只作为一次性提示", async () => {
    renderApp({
      client: createTestClient({ authState: "anonymous" }),
      route: "/app?auth=state_mismatch",
    });

    expect(
      await screen.findByText(AUTH_MESSAGES.state_mismatch),
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

  it("聊天页 401 回到授权门禁", async () => {
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

    expect(
      await screen.findByText("登录状态已失效，请重新使用知乎账号授权。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /使用知乎账号授权/ }),
    ).toBeInTheDocument();
  });

  it("未知路径展示 404 页面并可以返回首页", async () => {
    renderApp({ client: createTestClient(), route: "/not-exist" });

    expect(await screen.findByText("页面不存在")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /返回首页/ })).toHaveAttribute("href", "/");
  });
});
