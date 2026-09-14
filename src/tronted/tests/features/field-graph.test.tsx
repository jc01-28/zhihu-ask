import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { findFieldGraph } from "@/front/mocks/field-data";
import { createTestClient, renderApp } from "../test-utils";

const FIELD_ID = "agent-development";
const graph = findFieldGraph(FIELD_ID)!;

async function renderGraph(
  options: Parameters<typeof createTestClient>[0] = { stepDelayMs: 0 },
) {
  const client = createTestClient(options);
  const utils = renderApp({ client, route: `/app/fields/${FIELD_ID}` });
  await screen.findByRole("heading", { name: graph.field.name });
  const canvas = await screen.findByTestId("field-graph-canvas");
  return { ...utils, client, canvas };
}

describe("领域星图", () => {
  it("展示领域中心、议题节点与人物节点", async () => {
    const { canvas } = await renderGraph();
    const scope = within(canvas);

    expect(scope.getByLabelText(`${graph.field.name} 领域星图`)).toBeInTheDocument();
    for (const topic of graph.topics) {
      expect(scope.getByRole("button", { name: `筛选议题 ${topic.name}` })).toBeInTheDocument();
    }
    for (const person of graph.people) {
      expect(
        scope.getByRole("button", { name: new RegExp(`查看人物 ${person.name}`) }),
      ).toBeInTheDocument();
    }
  });

  it("窄屏使用按议题分组的头像卡片，桌面才显示完整星图", async () => {
    await renderGraph();

    const canvas = screen.getByTestId("field-graph-canvas");
    const cards = screen.getByTestId("field-graph-cards");

    // 桌面画布在窄屏隐藏；卡片列表在桌面隐藏。二者由 CSS 断点切换。
    expect(canvas.className).toContain("hidden");
    expect(canvas.className).toContain("md:block");
    expect(cards.className).toContain("md:hidden");
    expect(within(cards).getByLabelText("任务规划与分解 分组")).toBeInTheDocument();
  });

  it("点击议题筛选：同一议题再次点击取消，筛选器状态同步", async () => {
    const { canvas } = await renderGraph();
    const topic = graph.topics[1];

    const node = within(canvas).getByRole("button", { name: `筛选议题 ${topic.name}` });
    await userEvent.click(node);

    expect(node).toHaveAttribute("aria-pressed", "true");
    const chip = screen.getByRole("button", {
      name: new RegExp(`^筛选 ${topic.name}（\\d+ 人）$`),
    });
    expect(chip).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(node);
    expect(node).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("筛选器里的「全部」与星图共用同一份筛选状态", async () => {
    await renderGraph();

    // 「全部」的人数必须是**去重后**的领域人数：一个人可以同时关联多个议题，
    // 把各议题人数相加会重复计数，界面上就会显示一个比星图节点数还大的数字。
    const all = screen.getByRole("button", {
      name: new RegExp(`^全部领域人物（${graph.people.length} 人）$`),
    });
    expect(all).toHaveAttribute("aria-pressed", "true");

    const topic = graph.topics[0];
    const chip = screen.getByRole("button", {
      name: new RegExp(`^筛选 ${topic.name}（\\d+ 人）$`),
    });
    await userEvent.click(chip);

    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    // 取消筛选后回到「全部」。
    await userEvent.click(all);
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveAttribute("aria-pressed", "false");

    // 该领域没有「其他」人物，因此不渲染「其他」筛选项。
    expect(screen.queryByRole("button", { name: /^筛选 其他/ })).toBeNull();
  });

  it("点击头像打开统一人物名片，且只展示领域关联、不虚构证据", async () => {
    const { canvas } = await renderGraph();

    await userEvent.click(
      within(canvas).getByRole("button", { name: /查看人物 沈亦然/ }),
    );

    const sheet = (await screen.findByText("领域关联")).closest(
      "[data-slot='sheet-content']",
    ) as HTMLElement;
    const panel = within(sheet);

    expect(panel.getByText("沈亦然")).toBeInTheDocument();
    expect(panel.getByText("暂无内容证据")).toBeInTheDocument();
    expect(panel.getByText("领域相关")).toBeInTheDocument();
    expect(panel.getByText(/领域相关度 94\/100/)).toBeInTheDocument();
    expect(panel.getByText("关联议题")).toBeInTheDocument();
    // 领域来源不展示建议问题，也不展示检索证据。
    expect(panel.queryByText("适合问 TA")).toBeNull();
    expect(panel.queryByText("内容证据")).toBeNull();
  });

  it("有公开主页的人物给出新标签外链，没有的给出禁用说明", async () => {
    const { canvas } = await renderGraph();

    await userEvent.click(
      within(canvas).getByRole("button", { name: /查看人物 沈亦然/ }),
    );
    const link = await screen.findByRole("link", { name: /查看知乎主页/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link.getAttribute("href")).toMatch(/^https:\/\/www\.zhihu\.com\/people\//);

    await userEvent.keyboard("{Escape}");
    await userEvent.click(
      within(canvas).getByRole("button", { name: /查看人物 何知远/ }),
    );

    expect(await screen.findByRole("button", { name: /暂无公开主页/ })).toBeDisabled();
    expect(screen.getByText(/后端没有为这个人提供公开主页地址/)).toBeInTheDocument();
  });

  it("键盘可以聚焦人物节点并用回车打开名片", async () => {
    const { canvas } = await renderGraph();

    const node = within(canvas).getByRole("button", { name: /查看人物 罗琪/ });
    node.focus();
    expect(node).toHaveFocus();

    fireEvent.keyDown(node, { key: "Enter" });

    const sheet = (await screen.findByText("领域关联")).closest(
      "[data-slot='sheet-content']",
    ) as HTMLElement;
    expect(within(sheet).getByText("罗琪")).toBeInTheDocument();
  });

  it("从星图创建会话时 sourceRunId 为 null，成功后跳转到会话页", async () => {
    const { client, canvas, router } = await renderGraph();
    const spy = vi.spyOn(client, "createConversation");

    await userEvent.click(
      within(canvas).getByRole("button", { name: /查看人物 沈亦然/ }),
    );
    await userEvent.click(await screen.findByRole("button", { name: /开始私聊/ }));

    expect(spy).toHaveBeenCalledWith({ creatorId: "p-shen-yiran", sourceRunId: null });
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(
        /^\/app\/chat\/conversation-p-shen-yiran-/,
      ),
    );
  });

  it("重复点击「开始私聊」只发一次请求", async () => {
    const { client, canvas } = await renderGraph();
    const spy = vi.spyOn(client, "createConversation");

    await userEvent.click(
      within(canvas).getByRole("button", { name: /查看人物 沈亦然/ }),
    );
    const button = await screen.findByRole("button", { name: /开始私聊/ });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("点一下节点不会被当成拖拽：不在 pointerdown 时捕获指针", async () => {
    const { canvas } = await renderGraph();
    const svg = canvas.querySelector("svg") as SVGSVGElement;
    const node = within(canvas).getByRole("button", { name: /查看人物 沈亦然/ });

    // 模拟真实指针序列：按下 → （没有位移）→ 抬起。
    // 如果在 pointerdown 就调用 setPointerCapture，浏览器会把随后合成的 click
    // 重定向到被捕获的 <svg> 上，<g> 的 onClick 就永远不会触发。
    const capture = vi.fn();
    Object.defineProperty(svg, "setPointerCapture", {
      configurable: true,
      writable: true,
      value: capture,
    });

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 200, clientY: 200 });

    expect(capture).not.toHaveBeenCalled();
    // 节点本身仍然是可点击的。
    await userEvent.click(node);
    expect(await screen.findByText("领域关联")).toBeInTheDocument();
  });

  it("真的拖动时才捕获指针，拖动距离进入位移计算", async () => {
    const { canvas } = await renderGraph();
    const svg = canvas.querySelector("svg") as SVGSVGElement;

    const capture = vi.fn();
    Object.defineProperty(svg, "setPointerCapture", {
      configurable: true,
      writable: true,
      value: capture,
    });

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 206, clientY: 200 });
    // 超过阈值（4px）后必须捕获，否则指针移出画布时拖拽会断掉。
    expect(capture).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 206, clientY: 200 });
  });

  it("领域不存在时展示 404 与返回领域目录，而不是重试", async () => {
    const client = createTestClient({ scenario: "field-graph-missing", stepDelayMs: 0 });
    renderApp({ client, route: `/app/fields/${FIELD_ID}` });

    expect(await screen.findByText("领域不存在")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /返回领域目录/ })).toHaveAttribute(
      "href",
      "/app/fields",
    );
    expect(screen.queryByRole("button", { name: /^重试$/ })).toBeNull();
  });

  it("星图加载失败时展示可重试错误", async () => {
    const client = createTestClient({ stepDelayMs: 0 });
    const real = client.getFieldGraph.bind(client);
    let failing = true;
    client.getFieldGraph = async (id: string, signal?: AbortSignal) => {
      if (failing) throw new Error("演示：星图服务暂不可用");
      return real(id, signal);
    };

    renderApp({ client, route: `/app/fields/${FIELD_ID}` });

    expect(await screen.findByText("领域星图加载失败")).toBeInTheDocument();
    failing = false;
    await userEvent.click(screen.getByRole("button", { name: /重试/ }));

    expect(
      await screen.findByRole("heading", { name: graph.field.name }),
    ).toBeInTheDocument();
  });

  it("公开资料加载失败时给出可重试提示，且不打开名片", async () => {
    const { client, canvas } = await renderGraph();
    let failing = true;
    const real = client.getCreator.bind(client);
    client.getCreator = async (id: string, signal?: AbortSignal) => {
      if (failing) throw new Error("演示：人物资料暂不可用");
      return real(id, signal);
    };

    await userEvent.click(
      within(canvas).getByRole("button", { name: /查看人物 沈亦然/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("人物资料暂不可用");
    expect(screen.queryByText("领域关联")).toBeNull();

    failing = false;
    await userEvent.click(screen.getByRole("button", { name: /重新加载公开资料/ }));

    expect(await screen.findByText("领域关联")).toBeInTheDocument();
  });
});
