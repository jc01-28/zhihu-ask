import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CreatorDetail } from "@/front/features/creator/CreatorDetail";
import { FIXTURE_CREATORS } from "@/front/mocks/demo-data";
import { fieldPersonToCreatorCard, findFieldPerson } from "@/front/mocks/field-data";
import { createTestClient, renderApp } from "../test-utils";

const searchCreator = FIXTURE_CREATORS[0];
const fieldCreator = fieldPersonToCreatorCard(findFieldPerson("p-shen-yiran")!);
const fieldCreatorWithoutProfile = fieldPersonToCreatorCard(findFieldPerson("p-he-zhiyuan")!);

/** 抽屉渲染在 portal 里，先定位到 sheet 内容再断言，避免与页面上同名文字冲突。 */
async function panelOf(anchor: string | RegExp) {
  const node = await screen.findByText(anchor);
  const sheet = node.closest("[data-slot='sheet-content']");
  expect(sheet).not.toBeNull();
  return within(sheet as HTMLElement);
}

function renderDetail(
  creator: typeof searchCreator,
  props: Partial<Parameters<typeof CreatorDetail>[0]> = {},
) {
  return render(
    <CreatorDetail
      creator={creator}
      open
      onOpenChange={() => undefined}
      {...props}
    />,
  );
}

describe("统一人物名片抽屉", () => {
  it("检索来源展示相关度、匹配维度、内容证据与建议问题", async () => {
    renderDetail(searchCreator);
    const panel = await panelOf("内容证据");

    expect(panel.getByText(`相关度 ${searchCreator.score}/100`)).toBeInTheDocument();
    expect(panel.getByText("匹配维度")).toBeInTheDocument();
    expect(panel.getByText("大厂转创业")).toBeInTheDocument();
    expect(panel.getByText(searchCreator.evidence[0].title)).toBeInTheDocument();
    expect(panel.getByText("适合问 TA")).toBeInTheDocument();
    expect(panel.getByText(searchCreator.suitableQuestions[0])).toBeInTheDocument();
    // 检索来源不出现领域专有区块，两个来源不能互相污染。
    expect(panel.queryByText("领域关联")).toBeNull();
  });

  it("领域来源改写为领域相关度与关联议题，且不虚构证据", async () => {
    renderDetail(fieldCreator, { source: "field" });
    const panel = await panelOf("领域关联");

    expect(panel.getByText(`领域相关度 ${fieldCreator.score}/100`)).toBeInTheDocument();
    expect(panel.getByText("关联议题")).toBeInTheDocument();
    expect(panel.getByText("暂无内容证据")).toBeInTheDocument();
    expect(panel.getByText(/没有经过逐条核验的内容证据/)).toBeInTheDocument();
    // 领域来源没有证据也没有建议问题，对应区块必须整块消失而不是留空壳。
    expect(panel.queryByText("内容证据")).toBeNull();
    expect(panel.queryByText("适合问 TA")).toBeNull();
  });

  it("有 profileUrl 时渲染新标签外链，并在缺少时给出禁用说明", async () => {
    renderDetail(searchCreator);
    const panel = await panelOf("内容证据");

    const link = panel.getByRole("link", { name: /查看知乎主页/ });
    expect(link).toHaveAttribute("href", searchCreator.profileUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(panel.queryByText(/后端没有为这个人提供公开主页地址/)).toBeNull();
  });

  it("后端没给主页地址时不生成死链", async () => {
    renderDetail(fieldCreatorWithoutProfile, { source: "field" });
    const panel = await panelOf("领域关联");

    expect(panel.getByRole("button", { name: /暂无公开主页/ })).toBeDisabled();
    expect(panel.queryByRole("link", { name: /查看知乎主页/ })).toBeNull();
    expect(panel.getByText(/后端没有为这个人提供公开主页地址/)).toBeInTheDocument();
  });

  it("「开始私聊」在创建中不可重复触发", async () => {
    const onChat = vi.fn();
    const { rerender } = renderDetail(searchCreator, { onChat });
    const panel = await panelOf("内容证据");

    await userEvent.click(panel.getByRole("button", { name: /开始私聊/ }));
    expect(onChat).toHaveBeenCalledTimes(1);

    rerender(
      <CreatorDetail
        creator={searchCreator}
        open
        onOpenChange={() => undefined}
        onChat={onChat}
        chatPending
      />,
    );
    const pending = await screen.findByRole("button", { name: /正在创建会话/ });
    expect(pending).toBeDisabled();
    await userEvent.click(pending);
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it("Escape 关闭抽屉时回传 false，由调用方收起", async () => {
    const onOpenChange = vi.fn();
    renderDetail(searchCreator, { onOpenChange });
    await panelOf("内容证据");

    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("从检索结果打开名片再私聊，成功后跳到 /app/chat/:conversationId", async () => {
    const client = createTestClient();
    const spy = vi.spyOn(client, "createConversation");
    const { router } = renderApp({ client });

    await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));
    await screen.findByText("林知行");

    await userEvent.click(screen.getAllByRole("button", { name: "查看证据" })[0]);
    const panel = await panelOf("内容证据");
    await userEvent.click(panel.getByRole("button", { name: /开始私聊/ }));

    // 检索来源必须带上本次运行的 runId，否则会话无法回溯证据。
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].creatorId).toBe(searchCreator.id);
    expect(spy.mock.calls[0][0].sourceRunId).toEqual(expect.any(String));

    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(
        /^\/app\/chat\/conversation-lin-zhixing-/,
      ),
    );
  });
});
