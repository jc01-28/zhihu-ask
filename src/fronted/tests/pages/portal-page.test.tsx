import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AUTH_LOGOUT_PATH } from "@/shared/contracts/auth";
import { createTestClient, renderApp } from "../test-utils";

async function renderPortal() {
  const utils = renderApp({ client: createTestClient(), route: "/app" });
  await screen.findByRole("heading", { name: "你想怎么开始？" });
  return utils;
}

describe("功能首页", () => {
  it("只分流到专业领域社交与问题找人两个入口", async () => {
    await renderPortal();

    expect(screen.getByRole("heading", { name: "专业领域社交" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "问题找人" })).toBeInTheDocument();
    // 功能首页不展示完整搜索结果，也不提供搜索输入。
    expect(screen.queryByLabelText("你现在想找什么样的人？")).toBeNull();
    expect(screen.queryByText("Agent 工作轨迹")).toBeNull();
  });

  it("提供用户状态与退出入口", async () => {
    await renderPortal();

    expect(screen.getByText("演示用户")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /退出/ })).toHaveAttribute(
      "href",
      AUTH_LOGOUT_PATH,
    );
  });

  it("点击入口跳转到对应页面", async () => {
    const fields = await renderPortal();
    await userEvent.click(screen.getByRole("link", { name: /浏览专业领域/ }));
    expect(fields.router.state.location.pathname).toBe("/app/fields");

    const find = await renderPortal();
    await userEvent.click(screen.getByRole("link", { name: /描述问题找人/ }));
    expect(find.router.state.location.pathname).toBe("/app/find");
  });

  it("主导航可以切回功能首页", async () => {
    const { router } = await renderPortal();

    await userEvent.click(screen.getByRole("link", { name: "问题找人" }));
    expect(router.state.location.pathname).toBe("/app/find");

    await userEvent.click(screen.getByRole("link", { name: "功能首页" }));
    expect(router.state.location.pathname).toBe("/app");
  });
});
