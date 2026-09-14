import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { API_ERROR_CODES } from "@/shared/contracts/errors";
import { FIELD_SUMMARIES } from "@/front/mocks/field-data";
import { createTestClient, renderApp } from "../test-utils";

async function renderFields(client = createTestClient({ stepDelayMs: 0 })) {
  const utils = renderApp({ client, route: "/app/fields" });
  await screen.findByRole("heading", { name: "专业领域" });
  return { ...utils, client };
}

async function typeQuery(query: string) {
  const input = screen.getByLabelText("检索专业领域");
  await userEvent.clear(input);
  await userEvent.type(input, query);
  return input;
}

describe("专业领域目录", () => {
  it("先展示 Loading 骨架，再展示推荐领域", async () => {
    const client = createTestClient({ stepDelayMs: 12 });
    renderApp({ client, route: "/app/fields" });

    expect(await screen.findByText("推荐领域")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "查看领域 Agent 开发" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^查看领域/ })).toHaveLength(
      FIELD_SUMMARIES.length,
    );
  });

  it("卡片展示名称、简介、标签与计数，且不展示人物头像", async () => {
    await renderFields();

    const card = await screen.findByRole("link", { name: "查看领域 Agent 开发" });
    expect(within(card).getByText("Agent 开发")).toBeInTheDocument();
    expect(within(card).getByText(/把大模型接入真实业务系统/)).toBeInTheDocument();
    expect(within(card).getByText("多智能体")).toBeInTheDocument();
    expect(within(card).getByText("4 个议题 · 6 位可交流的人")).toBeInTheDocument();

    // 目录页不展示人物：只有星图页才做人物聚类。
    expect(within(card).queryByText("沈亦然")).toBeNull();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("提交检索后展示领域结果，且结果仍然是领域", async () => {
    const { client } = await renderFields();
    const searchFields = vi.spyOn(client, "searchFields");

    await typeQuery("风控");
    await userEvent.click(screen.getByRole("button", { name: /检索领域/ }));

    expect(await screen.findByText(/检索到 1 个领域/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看领域 金融科技" })).toBeInTheDocument();
    expect(searchFields).toHaveBeenCalledWith("风控", undefined, expect.anything());
    // 领域检索不会顺带调用人物检索。
    expect(vi.spyOn(client, "streamSearch")).not.toHaveBeenCalled();
  });

  it("回车同样触发检索", async () => {
    await renderFields();

    const input = await typeQuery("检索增强生成");
    await userEvent.type(input, "{Enter}");

    expect(await screen.findByText(/检索到 1 个领域/)).toBeInTheDocument();
  });

  it("空结果给出推荐领域与「去问题找人」，且不自动发起人物搜索", async () => {
    const { client } = await renderFields();
    const streamSearch = vi.spyOn(client, "streamSearch");

    await typeQuery("量子引力波投资");
    await userEvent.click(screen.getByRole("button", { name: /检索领域/ }));

    expect(
      await screen.findByRole("heading", { name: /没有匹配「量子引力波投资」的领域/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /去问题找人/ })).toHaveAttribute(
      "href",
      "/app/find",
    );
    expect(await screen.findByText("推荐领域")).toBeInTheDocument();
    expect(streamSearch).not.toHaveBeenCalled();
  });

  it("检索失败时保留推荐领域，重试按钮重新执行当前查询", async () => {
    const client = createTestClient({ stepDelayMs: 0 });
    let failing = true;
    const real = client.searchFields.bind(client);
    const spy = vi.fn(async (query: string, limit?: number, signal?: AbortSignal) => {
      if (failing) {
        throw Object.assign(new Error("演示：领域检索暂时不可用"), {
          name: "ApiError",
          code: API_ERROR_CODES.fieldSearchFailed,
          retryable: true,
        });
      }
      return real(query, limit, signal);
    });
    client.searchFields = spy as unknown as typeof client.searchFields;

    await renderFields(client);

    await typeQuery("风控");
    await userEvent.click(screen.getByRole("button", { name: /检索领域/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("领域检索失败");
    // 推荐领域没有被清空。
    expect(screen.getByRole("link", { name: "查看领域 Agent 开发" })).toBeInTheDocument();

    failing = false;
    await userEvent.click(screen.getByRole("button", { name: /重新检索/ }));

    expect(await screen.findByText(/检索到 1 个领域/)).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith("风控", undefined, expect.anything());
  });

  it("推荐领域加载失败时给出可重试错误", async () => {
    const client = createTestClient({ stepDelayMs: 0 });
    let failing = true;
    const real = client.getFeaturedFields.bind(client);
    client.getFeaturedFields = async (signal?: AbortSignal) => {
      if (failing) throw new Error("演示：推荐领域加载失败");
      return real(signal);
    };

    const { client: same } = await renderFields(client);

    expect(await screen.findByText(/推荐领域加载失败/)).toBeInTheDocument();
    failing = false;
    await userEvent.click(screen.getByRole("button", { name: /重新加载推荐/ }));

    expect(await screen.findByRole("link", { name: "查看领域 Agent 开发" })).toBeInTheDocument();
    expect(same).toBe(client);
  });

  it("点击卡片跳转到领域星图", async () => {
    const { router } = await renderFields();

    await userEvent.click(await screen.findByRole("link", { name: "查看领域 金融科技" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/app/fields/fintech"),
    );
  });

  it("清空后回到推荐领域", async () => {
    await renderFields();

    await typeQuery("风控");
    await userEvent.click(screen.getByRole("button", { name: /检索领域/ }));
    await screen.findByText(/检索到 1 个领域/);

    await userEvent.click(screen.getAllByRole("button", { name: /清空/ })[0]);

    await waitFor(() =>
      expect(screen.queryByText(/检索到 1 个领域/)).toBeNull(),
    );
    expect(screen.getByText("推荐领域")).toBeInTheDocument();
    expect(screen.getByLabelText("检索专业领域")).toHaveValue("");
  });

  it("移动端卡片使用单列、桌面使用多列栅格", async () => {
    await renderFields();

    const grid = (await screen.findByRole("link", { name: "查看领域 Agent 开发" }))
      .parentElement as HTMLElement;
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("xl:grid-cols-3");
    // 默认（窄屏）是单列：没有任何未加断点的 grid-cols-N。
    expect(grid.className).not.toMatch(/(^|\s)grid-cols-/);
  });
});
