import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createTestClient, renderApp, seedConversation } from "../test-utils";

async function setupChat(client: ReturnType<typeof createTestClient>) {
  const conversation = await seedConversation(client);
  renderApp({ client, route: `/chat/${conversation.id}` });
  await screen.findByText(/与 林知行 的虚拟对话/);
  return conversation;
}

async function sendQuestion(text: string) {
  await userEvent.type(screen.getByLabelText("消息输入框"), text);
  await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
}

describe("Agent 对话流式展示", () => {
  it("delta 增量展示，完成后被服务端完整消息替换", async () => {
    const client = createTestClient({ stepDelayMs: 12 });
    const conversation = await setupChat(client);

    await sendQuestion("我该先确认哪些事情？");

    // 流式进行中：只有 AI Agent 气泡带「正在生成」标记
    expect(await screen.findByText(/正在生成/)).toBeInTheDocument();

    expect(
      await screen.findByText(/以上内容由 Mock Agent 生成/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/正在生成/)).not.toBeInTheDocument(),
    );

    const page = await client.listMessages(conversation.id);
    const agentMessages = page.items.filter((item) => item.sender === "agent");
    expect(agentMessages).toHaveLength(1);
    expect(agentMessages[0].content).toMatch(/以上内容由 Mock Agent 生成/);
  });

  it("Agent 气泡始终标注为 AI Agent，不伪装成真实答主", async () => {
    const client = createTestClient();
    await setupChat(client);

    await sendQuestion("这个决定怎么拆？");
    await screen.findByText(/以上内容由 Mock Agent 生成/);

    const list = screen.getByLabelText("会话消息");
    expect(within(list).getAllByText(/AI Agent/).length).toBeGreaterThan(0);
    expect(within(list).getAllByText(/答主（演示）/).length).toBeGreaterThan(0);
  });

  it("流失败后临时回复标记失败并可重试", async () => {
    const client = createTestClient({ scenario: "agent-stream-failed" });
    const conversation = await setupChat(client);
    const spy = vi.fn(client.streamConversationAgent.bind(client));
    client.streamConversationAgent = spy;

    await sendQuestion("这次会失败");

    expect(await screen.findByText(/这条回复没有完成/)).toBeInTheDocument();

    const retryButtons = screen.getAllByRole("button", { name: /重试/ });
    await userEvent.click(retryButtons[0]);
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));

    // 重试复用同一个 clientMessageId，不会产生重复的用户消息
    const page = await client.listMessages(conversation.id);
    expect(page.items.filter((item) => item.content === "这次会失败")).toHaveLength(1);
  });

  it("取消流：保留已确认的用户消息，且不保存半截回复", async () => {
    const client = createTestClient({ stepDelayMs: 25 });
    const conversation = await setupChat(client);

    await sendQuestion("取消测试");
    await screen.findByText(/正在生成/);

    await userEvent.click(screen.getByRole("button", { name: "停止生成" }));

    await waitFor(() =>
      expect(screen.queryByText(/正在生成/)).not.toBeInTheDocument(),
    );

    const page = await client.listMessages(conversation.id);
    expect(page.items.filter((item) => item.content === "取消测试")).toHaveLength(1);
    expect(page.items.filter((item) => item.sender === "agent")).toHaveLength(0);
  });

  it("流中断（无终态事件）同样标记失败", async () => {
    const client = createTestClient({ scenario: "agent-stream-truncated" });
    const conversation = await setupChat(client);

    await sendQuestion("半截流测试");

    expect(await screen.findByText(/这条回复没有完成/)).toBeInTheDocument();

    const page = await client.listMessages(conversation.id);
    expect(page.items.filter((item) => item.sender === "agent")).toHaveLength(0);
    expect(page.items.filter((item) => item.content === "半截流测试")).toHaveLength(1);
    void conversation;
  });
});
