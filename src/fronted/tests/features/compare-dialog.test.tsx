import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createTestClient, renderApp } from "../test-utils";

async function openCompare() {
  renderApp({ client: createTestClient() });
  await userEvent.click(await screen.findByRole("button", { name: /对比测试/ }));
  return screen.findByText("同一句话，三种检索方式");
}

describe("三栏对比弹窗", () => {
  it("输入不足 4 个字时给出校验提示", async () => {
    await openCompare();

    const input = screen.getByLabelText("对比用的检索问题");
    await userEvent.clear(input);
    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByRole("button", { name: /开始对比/ }));

    expect(await screen.findByText(/请至少输入 4 个字/)).toBeInTheDocument();
  });

  it("对比后同时展示知乎外链、原始命中和 Agent 人物卡", async () => {
    const dialog = await openCompare();

    await userEvent.click(screen.getByRole("button", { name: /开始对比/ }));

    expect(await screen.findByText(/原始检索 · 3 条/)).toBeInTheDocument();
    expect(
      screen.getByText("从大厂到创业公司，我踩过的三个坑（演示数据）"),
    ).toBeInTheDocument();
    expect(screen.getByText(/@匿名演示作者 · 1830 赞 · 42 评论/)).toBeInTheDocument();
    expect(screen.getAllByText("林知行").length).toBeGreaterThan(0);

    const contentLink = screen.getByRole("link", { name: /在知乎搜内容/ });
    expect(contentLink).toHaveAttribute(
      "href",
      expect.stringContaining("zhihu.com/search?type=content"),
    );

    // 对比卡片内的按钮必须明确禁用，不留无反馈的死按钮
    const compareDialog = (await dialog).closest("[data-slot='dialog-content']");
    const panel = within(compareDialog as HTMLElement);
    for (const button of panel.getAllByRole("button", { name: "查看证据" })) {
      expect(button).toBeDisabled();
    }
    for (const button of panel.getAllByRole("button", { name: /与 TA 聊聊/ })) {
      expect(button).toBeDisabled();
    }
  });

  it("对比失败展示错误提示", async () => {
    const client = createTestClient();
    client.compare = async () => {
      throw new Error("演示：对比不可用");
    };
    renderApp({ client });

    await userEvent.click(await screen.findByRole("button", { name: /对比测试/ }));
    await userEvent.click(await screen.findByRole("button", { name: /开始对比/ }));

    expect(await screen.findByText("演示：对比不可用")).toBeInTheDocument();
  });

  it("知乎外链是单个链接，不在链接里再嵌一个按钮", async () => {
    await openCompare();

    for (const name of [/在知乎搜内容/, /在知乎搜用户/]) {
      const links = screen.getAllByRole("link", { name });
      expect(links).toHaveLength(1);
      const link = links[0];

      // <a> 里嵌 <button> 是非法嵌套：读屏会报「链接里还有一个按钮」，
      // 键盘会拿到两个都要 Tab 的可交互节点，而它们其实是同一个动作。
      expect(within(link).queryByRole("button")).toBeNull();
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("对比弹窗可以用 Escape 关闭，不需要鼠标", async () => {
    await openCompare();
    expect(screen.getByText("同一句话，三种检索方式")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByText("同一句话，三种检索方式")).not.toBeInTheDocument(),
    );
  });
});
