import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/front/api/ApiError";
import type { Conversation } from "@/shared/contracts/conversation";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import { FIXTURE_CREATORS } from "@/front/mocks/demo-data";
import { createTestClient, renderApp } from "../test-utils";

async function runSearch() {
  await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));
  await screen.findByText("林知行");
}

describe("搜索结果 → 会话跳转", () => {
  it("点击「与 TA 聊聊」创建会话并跳转到聊天页", async () => {
    const client = createTestClient();
    const { router } = renderApp({ client });
    await runSearch();

    await userEvent.click(screen.getAllByRole("button", { name: /与 TA 聊聊/ })[0]);

    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(
        /^\/app\/chat\/conversation-lin-zhixing-/,
      ),
    );
    expect(await screen.findByText(/与 林知行 的虚拟对话/)).toBeInTheDocument();
  });

  it("创建中禁用按钮，重复点击只发一次请求", async () => {
    const client = createTestClient();
    let release: (conversation: Conversation) => void = () => undefined;
    const spy = vi.fn(
      () =>
        new Promise<Conversation>((resolve) => {
          release = resolve;
        }),
    );
    client.createConversation = spy;

    renderApp({ client });
    await runSearch();

    const buttons = screen.getAllByRole("button", { name: /与 TA 聊聊/ });
    await userEvent.click(buttons[0]);

    expect(
      await screen.findByRole("button", { name: /正在创建会话/ }),
    ).toBeDisabled();
    await userEvent.click(buttons[0]);
    expect(spy).toHaveBeenCalledTimes(1);

    const runId = null;
    expect(runId).toBeNull();
    release({
      id: "conversation-manual",
      user: { id: "u", displayName: "演示用户", avatarUrl: null },
      creator: FIXTURE_CREATORS[0],
      sourceRunId: null,
      consultation: {
        id: "consultation-manual",
        status: "free_chat",
        packageId: "voice-30",
        amount: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("创建失败时保留人物结果并显示可重试错误", async () => {
    const client = createTestClient();
    client.createConversation = async () => {
      throw new ApiError({
        code: API_ERROR_CODES.conversationSourceUnavailable,
        message: "这次搜索的运行记录已经过期。",
        status: 409,
        retryable: true,
      });
    };

    renderApp({ client });
    await runSearch();

    await userEvent.click(screen.getAllByRole("button", { name: /与 TA 聊聊/ })[0]);

    expect(await screen.findByText("没有创建成功对话")).toBeInTheDocument();
    expect(screen.getByText(/运行记录已经过期/)).toBeInTheDocument();
    // 人物结果仍然保留
    expect(screen.getByText("林知行")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("401 时提示授权失效", async () => {
    const client = createTestClient();
    client.createConversation = async () => {
      throw new ApiError({
        code: API_ERROR_CODES.authExpired,
        message: "授权已过期",
        status: 401,
        retryable: false,
      });
    };

    renderApp({ client });
    await runSearch();

    await userEvent.click(screen.getAllByRole("button", { name: /与 TA 聊聊/ })[0]);

    expect(await screen.findByText(/授权已失效/)).toBeInTheDocument();
  });
});
