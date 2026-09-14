import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createTestClient, renderApp } from "../test-utils";

async function runSearch() {
  await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));
  await screen.findByText("林知行");
}

describe("人物卡与结果摘要", () => {
  it("展示头像占位字、角色、相关度、维度与推荐理由", async () => {
    renderApp({ client: createTestClient() });
    await runSearch();

    expect(screen.getByText("前大厂产品负责人 · AI 创业团队联合创始人")).toBeInTheDocument();
    expect(screen.getByText("经历最接近")).toBeInTheDocument();
    expect(screen.getByText("92")).toBeInTheDocument();
    expect(screen.getByText("大厂转创业")).toBeInTheDocument();
    expect(
      screen.getByText(/公开内容覆盖从成熟平台加入早期 AI 团队/),
    ).toBeInTheDocument();
    // 没有 avatarUrl 时回退到首字占位
    expect(screen.getAllByText("林").length).toBeGreaterThan(0);
  });

  it("结果摘要摊开模式、上下文与降级情况", async () => {
    renderApp({ client: createTestClient() });
    await runSearch();

    expect(screen.getByText("演示数据兜底")).toBeInTheDocument();
    expect(screen.getByText("已应用授权上下文")).toBeInTheDocument();
    expect(screen.getByText("分析 18 条内容")).toBeInTheDocument();
    expect(screen.getByText("排除 11 条弱证据")).toBeInTheDocument();
    expect(screen.getByText(/真实知乎 API 暂不可用/)).toBeInTheDocument();
    expect(screen.getByText(/问题理解阶段降级为确定性规则模型/)).toBeInTheDocument();
  });

  it("证据抽屉展示证据详情、无外链提示、建议问题与边界说明", async () => {
    renderApp({ client: createTestClient() });
    await runSearch();

    await userEvent.click(screen.getAllByRole("button", { name: "查看证据" })[0]);

    const sheetTitle = await screen.findByText("内容证据");
    const sheet = sheetTitle.closest("[data-slot='sheet-content']");
    expect(sheet).not.toBeNull();
    const panel = within(sheet as HTMLElement);

    expect(
      panel.getByText("离开万人大厂后，我如何适应五十人的创业团队"),
    ).toBeInTheDocument();
    expect(panel.getAllByText("Fixture 演示证据，无真实外链")).toHaveLength(2);
    expect(panel.getByText("适合问 TA")).toBeInTheDocument();
    expect(
      panel.getByText("你加入创业公司前重点验证了哪些风险？"),
    ).toBeInTheDocument();
    expect(
      panel.getByText("人物与内容为 Fixture 演示数据，不对应真实知乎用户。"),
    ).toBeInTheDocument();
  });

  it("背景资料与人物证据分区展示", async () => {
    renderApp({ client: createTestClient() });
    await runSearch();

    expect(screen.getByText("行业背景（不参与人物推荐）")).toBeInTheDocument();
    expect(screen.getByText(/来源：全网搜索 · 仅作为背景信息/)).toBeInTheDocument();
    expect(screen.getByText(/来源：热榜 · 仅作为背景信息/)).toBeInTheDocument();
  });
});
