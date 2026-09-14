import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/front/api/ApiError";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import {
  clearOwnKeys,
  readText,
  STORAGE_KEYS,
  STORAGE_PREFIX,
  writeText,
} from "@/front/shared/storage";
import { createTestClient, renderApp, seedConversation } from "../test-utils";

describe("浏览器存储边界", () => {
  it("只允许写入本工程前缀下的 key", () => {
    writeText(STORAGE_KEYS.searchDraft, "草稿");
    writeText("other-app:key", "不该写入");

    expect(readText(STORAGE_KEYS.searchDraft)).toBe("草稿");
    expect(window.localStorage.getItem("other-app:key")).toBeNull();
    expect(STORAGE_KEYS.searchDraft.startsWith(STORAGE_PREFIX)).toBe(true);
  });

  it("clearOwnKeys 不会清空其它应用的存储", () => {
    window.localStorage.setItem("other-app:key", "保留");
    writeText(STORAGE_KEYS.searchDraft, "草稿");

    clearOwnKeys();

    expect(window.localStorage.getItem("other-app:key")).toBe("保留");
    expect(readText(STORAGE_KEYS.searchDraft)).toBeNull();
  });
});

describe("恢复与错误状态", () => {
  it("登录状态读取失败时展示错误页并可重试", async () => {
    const client = createTestClient();
    const real = client.getSession.bind(client);
    let failing = true;
    client.getSession = async (signal?: AbortSignal) => {
      if (failing) {
        throw new ApiError({
          code: API_ERROR_CODES.networkError,
          message: "网络不可用，请检查连接后重试。",
          retryable: true,
        });
      }
      return real(signal);
    };

    renderApp({ client });

    expect(await screen.findByText("无法读取登录状态")).toBeInTheDocument();
    failing = false;
    await userEvent.click(screen.getByRole("button", { name: /重试/ }));

    expect(await screen.findByRole("button", { name: /开始找人/ })).toBeInTheDocument();
  });

  it("会话 503 展示可重试错误页，重试后恢复", async () => {
    const client = createTestClient();
    const conversation = await seedConversation(client);
    const real = client.getConversation.bind(client);
    let failing = true;
    client.getConversation = async (id: string, signal?: AbortSignal) => {
      if (failing) {
        throw new ApiError({
          code: API_ERROR_CODES.persistenceUnavailable,
          message: "服务暂时不可用，请稍后重试。",
          status: 503,
          retryable: true,
        });
      }
      return real(id, signal);
    };

    renderApp({ client, route: `/chat/${conversation.id}` });

    expect(await screen.findByText("会话加载失败")).toBeInTheDocument();
    failing = false;
    await userEvent.click(screen.getByRole("button", { name: /重试/ }));

    expect(await screen.findByText(/与 林知行 的虚拟对话/)).toBeInTheDocument();
  });

  it("会话不存在时展示 404 页并提供返回找人", async () => {
    renderApp({ client: createTestClient(), route: "/chat/does-not-exist" });

    expect(await screen.findByText("会话不存在")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /返回找人/ })).toHaveAttribute(
      "href",
      "/app/find",
    );
  });

  it("reset 成功后整体替换会话与消息", async () => {
    const client = createTestClient();
    const conversation = await seedConversation(client);
    renderApp({ client, route: `/chat/${conversation.id}` });
    await screen.findByText(/与 林知行 的虚拟对话/);

    await userEvent.click(screen.getByRole("button", { name: /申请付费咨询/ }));
    expect(await screen.findByText("已申请咨询")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /重置/ }));

    expect(await screen.findByText("免费交流")).toBeInTheDocument();
    await waitFor(() => {
      const page = screen.getByLabelText("会话消息");
      expect(page.textContent).toContain("这是虚拟聊天演示");
    });
  });

  it("reset 失败时保持旧页面并提示", async () => {
    const client = createTestClient();
    const conversation = await seedConversation(client);
    client.resetConversation = async () => {
      throw new ApiError({
        code: API_ERROR_CODES.persistenceUnavailable,
        message: "重置失败，请稍后重试。",
        status: 503,
        retryable: true,
      });
    };

    renderApp({ client, route: `/chat/${conversation.id}` });
    await screen.findByText(/与 林知行 的虚拟对话/);

    await userEvent.type(screen.getByLabelText("消息输入框"), "还没发出去的草稿");
    await userEvent.click(screen.getByRole("button", { name: /重置/ }));

    expect(await screen.findByText("重置失败，请稍后重试。")).toBeInTheDocument();
    // 旧消息仍在
    expect(screen.getByText(/我是通过「知乎问人」看到你的/)).toBeInTheDocument();
  });

  it("未发送草稿会被保存，reset 后清空", async () => {
    const client = createTestClient();
    const conversation = await seedConversation(client);
    renderApp({ client, route: `/chat/${conversation.id}` });
    await screen.findByText(/与 林知行 的虚拟对话/);

    await userEvent.type(screen.getByLabelText("消息输入框"), "未发送的草稿");

    await waitFor(() =>
      expect(readText(STORAGE_KEYS.messageDraft(conversation.id))).toBe("未发送的草稿"),
    );

    await userEvent.click(screen.getByRole("button", { name: /重置/ }));

    await waitFor(() =>
      expect(readText(STORAGE_KEYS.messageDraft(conversation.id))).toBeNull(),
    );
  });
});
