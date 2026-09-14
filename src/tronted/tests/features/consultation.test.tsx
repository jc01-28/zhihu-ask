import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/front/api/ApiError";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import { formatMoney } from "@/front/shared/format-money";
import { createTestClient, renderApp, seedConversation } from "../test-utils";

async function setupChat(createClient = createTestClient) {
  const client = createClient();
  const conversation = await seedConversation(client);
  renderApp({ client, route: `/chat/${conversation.id}` });
  await screen.findByText(/与 林知行 的虚拟对话/);
  return { client, conversation };
}

describe("金额格式化", () => {
  it("分转元的展示规则", () => {
    expect(formatMoney(4900)).toBe("¥49");
    expect(formatMoney(9900)).toBe("¥99");
    expect(formatMoney(19900)).toBe("¥199");
    expect(formatMoney(4950)).toBe("¥49.50");
    expect(formatMoney(Number.NaN)).toBe("--");
  });
});

describe("咨询状态与模拟支付", () => {
  it("为单位的金额直接来自套餐契约", async () => {
    await setupChat();

    expect(screen.getByText("¥49")).toBeInTheDocument();
    expect(screen.getByText("¥99")).toBeInTheDocument();
    expect(screen.getByText("¥199")).toBeInTheDocument();
  });

  it("用户申请 → 答主创建方案 → 模拟支付 → 开始咨询，全程由服务端状态驱动", async () => {
    const { conversation, client } = await setupChat();

    expect(screen.getByText("免费交流")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /申请付费咨询/ }));
    expect(await screen.findByText("已申请咨询")).toBeInTheDocument();
    expect(
      screen.getByText("用户发起了付费咨询意向（模拟）。"),
    ).toBeInTheDocument();

    // 切到答主视角创建方案
    await userEvent.click(screen.getByRole("tab", { name: /答主视角/ }));
    await userEvent.click(screen.getByRole("button", { name: /创建咨询方案/ }));
    expect(await screen.findByText("咨询方案待确认")).toBeInTheDocument();

    // 回到用户视角完成模拟支付
    await userEvent.click(screen.getByRole("tab", { name: /用户视角/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: /确认方案并模拟支付/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "确认模拟支付" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/不会创建真实订单，也不会产生扣款/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /确认模拟支付/ }));
    expect(await screen.findByText("模拟支付完成")).toBeInTheDocument();

    // 答主开始咨询
    await userEvent.click(screen.getByRole("tab", { name: /答主视角/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^开始咨询/ }));
    // 状态标签与只读按钮都会显示「咨询进行中」，这里只要求它出现；
    // 状态的唯一真相在下一行的服务端查询里。
    expect((await screen.findAllByText("咨询进行中")).length).toBeGreaterThan(0);

    const stored = await client.getConversation(conversation.id);
    expect(stored.consultation.status).toBe("consulting");
  });

  it("模拟支付弹窗可以用 Escape 关闭，且关掉不会推进状态", async () => {
    const { conversation, client } = await setupChat();

    await userEvent.click(screen.getByRole("button", { name: /申请付费咨询/ }));
    await screen.findByText("已申请咨询");
    await userEvent.click(screen.getByRole("tab", { name: /答主视角/ }));
    await userEvent.click(screen.getByRole("button", { name: /创建咨询方案/ }));
    await screen.findByText("咨询方案待确认");
    await userEvent.click(screen.getByRole("tab", { name: /用户视角/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: /确认方案并模拟支付/ }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // 键盘用户必须能退出，不需要去够鼠标点「取消」。
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // 关掉弹窗只是关掉弹窗：没有扣款，也没有把状态推到 mock_paid。
    expect(screen.getByText("咨询方案待确认")).toBeInTheDocument();
    const stored = await client.getConversation(conversation.id);
    expect(stored.consultation.status).toBe("offer_created");
  });

  it("非法状态转移使用服务端状态回正并提示", async () => {
    const { client } = await setupChat();

    client.applyConsultationAction = async () => {
      throw new ApiError({
        code: API_ERROR_CODES.invalidConsultationTransition,
        message: "当前咨询状态不允许这个操作，已按服务端状态回正。",
        status: 409,
        retryable: false,
        details: {
          id: "consultation-server",
          status: "free_chat",
          packageId: "voice-30",
          amount: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
    };

    await userEvent.click(screen.getByRole("button", { name: /申请付费咨询/ }));

    expect(
      await screen.findByText(/已按服务端状态回正/),
    ).toBeInTheDocument();
    // UI 回到服务端状态
    expect(screen.getByText("免费交流")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /申请付费咨询/ })).toBeInTheDocument();
  });

  it("套餐加载失败时给出提示且不阻塞聊天", async () => {
    const client = createTestClient();
    client.getConsultationPackages = async () => {
      throw new Error("演示：套餐不可用");
    };
    const conversation = await seedConversation(client);
    renderApp({ client, route: `/chat/${conversation.id}` });

    await screen.findByText(/与 林知行 的虚拟对话/);
    expect(await screen.findByText(/套餐暂时不可用/)).toBeInTheDocument();
    expect(screen.getByLabelText("消息输入框")).toBeEnabled();
  });

  it("咨询状态变化会插入一条系统消息", async () => {
    const { conversation, client } = await setupChat();

    await userEvent.click(screen.getByRole("button", { name: /申请付费咨询/ }));
    await waitFor(async () => {
      const page = await client.listMessages(conversation.id);
      expect(
        page.items.some(
          (item) =>
            item.sender === "system" &&
            item.content === "用户发起了付费咨询意向（模拟）。",
        ),
      ).toBe(true);
    });
  });
});
