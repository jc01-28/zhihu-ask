import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/front/api/ApiError";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import { createTestClient, renderApp, seedConversation } from "../test-utils";

async function setupChat(client = createTestClient()) {
  const conversation = await seedConversation(client);
  renderApp({ client, route: `/chat/${conversation.id}` });
  await screen.findByText(/与 林知行 的虚拟对话/);
  return { client, conversation };
}

describe("聊天页消息流", () => {
  it("加载服务端快照：系统说明、用户开场与答主（演示）回应", async () => {
    await setupChat();

    expect(
      screen.getByText(/这是虚拟聊天演示。所有消息都由 Mock API 生成/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/我是通过「知域」看到你的/),
    ).toBeInTheDocument();
    expect(screen.getByText(/我是林知行（演示人物）/)).toBeInTheDocument();
  });

  it("未输入时发送按钮禁用，空消息不会被提交", async () => {
    await setupChat();

    const sendButton = screen.getByRole("button", { name: "发送消息" });
    expect(sendButton).toBeDisabled();

    const textarea = screen.getByLabelText("消息输入框");
    await userEvent.type(textarea, "   ");
    expect(sendButton).toBeDisabled();
  });

  it("输入框限制 2000 字", async () => {
    await setupChat();

    expect(screen.getByLabelText("消息输入框")).toHaveAttribute("maxlength", "2000");
  });

  it("建议问题可以填入输入框并发送", async () => {
    await setupChat();

    const suggestion = screen.getByRole("button", {
      name: "你加入创业公司前重点验证了哪些风险？",
    });
    await userEvent.click(suggestion);
    expect(screen.getByLabelText("消息输入框")).toHaveValue(
      "你加入创业公司前重点验证了哪些风险？",
    );

    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
    const list = screen.getByLabelText("会话消息");
    await waitFor(() =>
      expect(within(list).getAllByText(/重点验证了哪些风险/).length).toBeGreaterThan(0),
    );
  });

  it("答主视角消息使用 sendMessage 的 creator 角色", async () => {
    const { client, conversation } = await setupChat();

    await userEvent.click(screen.getByRole("tab", { name: /答主视角/ }));

    const textarea = screen.getByLabelText("消息输入框");
    await userEvent.type(textarea, "这是一条演示答主回复");
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByText("这是一条演示答主回复")).toBeInTheDocument();
    const page = await client.listMessages(conversation.id);
    const last = page.items.at(-1);
    expect(last?.sender).toBe("creator");
    expect(last?.content).toBe("这是一条演示答主回复");
  });

  it("发送失败时保留输入提示重试，422/400 等错误可读", async () => {
    const { client } = await setupChat();
    client.streamConversationAgent = async () => {
      throw new ApiError({
        code: API_ERROR_CODES.invalidMessage,
        message: "消息不能为空，且不超过 2000 字。",
        status: 400,
        retryable: false,
      });
    };

    const textarea = screen.getByLabelText("消息输入框");
    await userEvent.type(textarea, "这条会失败");
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByText(/消息不能为空/)).toBeInTheDocument();
    // 已确认的用户消息不会被丢弃
    expect(screen.getByText("这条会失败")).toBeInTheDocument();
  });

  it("加载更多可以取回更早的消息", async () => {
    const client = createTestClient({ messagePageSize: 2 });
    const conversation = await seedConversation(client);
    renderApp({ client, route: `/chat/${conversation.id}` });

    await screen.findByText(/与 林知行 的虚拟对话/);
    expect(screen.getByText(/我是通过「知域」看到你的/)).toBeInTheDocument();
    expect(screen.queryByText(/这是虚拟聊天演示/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "加载更早的消息" }));

    expect(await screen.findByText(/这是虚拟聊天演示/)).toBeInTheDocument();
  });

  it("消息按时间顺序稳定渲染，不出现重复", async () => {
    const { conversation, client } = await setupChat();

    const textarea = screen.getByLabelText("消息输入框");
    await userEvent.type(textarea, "同一句话");
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await screen.findByText(/关于「同一句话」/);

    const page = await client.listMessages(conversation.id);
    const ids = page.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    const list = screen.getByLabelText("会话消息");
    const rendered = within(list).getAllByText(/^同一句话$/);
    await waitFor(() => expect(rendered).toHaveLength(1));
  });
});
