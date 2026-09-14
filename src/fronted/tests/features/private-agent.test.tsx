import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PrivateAgentPanel } from "@/front/features/private-agent/PrivateAgentPanel";
import {
  buildPrivateAgentView,
  PRIVATE_AGENT_DEMO_NOTICE,
  PRIVATE_AGENT_STATUS_LABELS,
  UNCONFIGURED_SAMPLE_QUESTIONS,
} from "@/front/features/private-agent/private-agent-state";
import { findPrivateAgentFixture } from "@/front/features/private-agent/private-agent-fixture";
import { createTestClient, renderApp, seedConversation } from "../test-utils";

describe("私有知识库 Agent 状态推导", () => {
  it("没有夹具就是「尚未配置」，并给出示意用的示例问题", () => {
    const view = buildPrivateAgentView("someone-unknown", "张三");

    expect(view.status).toBe("unconfigured");
    expect(view.statusLabel).toBe(PRIVATE_AGENT_STATUS_LABELS.unconfigured);
    expect(view.name).toBe("张三的私有知识库");
    expect(view.topics).toEqual([]);
    expect(view.scope).toEqual([]);
    expect(view.sampleQuestions).toEqual(UNCONFIGURED_SAMPLE_QUESTIONS);
  });

  it("主题或范围不完整时判为「部分配置」而不是「已配置」", () => {
    const partial = buildPrivateAgentView("zhou-yu", "周屿");
    expect(findPrivateAgentFixture("zhou-yu")!.topics.length).toBeLessThan(3);
    expect(partial.status).toBe("partial");

    const full = buildPrivateAgentView("lin-zhixing", "林知行");
    expect(full.status).toBe("configured");
    expect(full.topics.length).toBeGreaterThanOrEqual(3);
    expect(full.scope.length).toBeGreaterThanOrEqual(2);
  });

  it("示例问题不与答主公开建议问题重名，避免出现两个同名入口", () => {
    const view = buildPrivateAgentView("lin-zhixing", "林知行");
    const suggested = ["你加入创业公司前重点验证了哪些风险？", "第一次带团队时，前三个月应该优先建立什么？"];
    for (const question of view.sampleQuestions) {
      expect(suggested).not.toContain(question);
    }
    // 未配置时的示意问题同样不能撞名。
    const fallback = buildPrivateAgentView("nobody", "李四");
    for (const question of fallback.sampleQuestions) {
      expect(suggested).not.toContain(question);
    }
  });
});

describe("私有知识库展示区", () => {
  it("展示 Agent 名称、状态、主题、范围与统一演示声明", () => {
    const view = buildPrivateAgentView("lin-zhixing", "林知行");
    render(<PrivateAgentPanel view={view} onPickQuestion={() => undefined} />);

    expect(screen.getByText("私有知识库 Agent")).toBeInTheDocument();
    expect(screen.getByText(view.name)).toBeInTheDocument();
    expect(screen.getByLabelText("私有知识库状态：已配置")).toBeInTheDocument();
    expect(screen.getByText("知识库主题")).toBeInTheDocument();
    expect(screen.getByText("大厂转创业")).toBeInTheDocument();
    expect(screen.getByText("可回答范围")).toBeInTheDocument();
    expect(screen.getByText("仅答主授权后可见")).toBeInTheDocument();
    expect(screen.getByText(PRIVATE_AGENT_DEMO_NOTICE)).toBeInTheDocument();
    // 出范围提示必须在场：否则用户会以为知识库什么都答。
    expect(screen.getByText(view.outOfScopeHint)).toBeInTheDocument();
  });

  it("未配置时如实说明「没有主题/没有范围」，不放任何虚构条目", () => {
    const view = buildPrivateAgentView("nobody", "李四");
    render(<PrivateAgentPanel view={view} onPickQuestion={() => undefined} />);

    expect(screen.getByLabelText("私有知识库状态：尚未配置")).toBeInTheDocument();
    expect(screen.getByText("还没有任何主题被录入。")).toBeInTheDocument();
    expect(screen.getByText("暂未划定范围。")).toBeInTheDocument();
    expect(screen.getByText(view.boundary)).toBeInTheDocument();
  });

  it("点击示例问题只回调文本，不发起任何请求", async () => {
    const view = buildPrivateAgentView("lin-zhixing", "林知行");
    const onPick = vi.fn();
    render(<PrivateAgentPanel view={view} onPickQuestion={onPick} />);

    await userEvent.click(
      screen.getByRole("button", { name: view.sampleQuestions[0] }),
    );

    expect(onPick).toHaveBeenCalledWith(view.sampleQuestions[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe("聊天页里的私有 Agent 展示", () => {
  async function setupChat() {
    const client = createTestClient();
    const conversation = await seedConversation(client);
    renderApp({ client, route: `/app/chat/${conversation.id}` });
    await screen.findByText(/与 林知行 的虚拟对话/);
    return { client };
  }

  it("示例问题点进输入框后不自动发送", async () => {
    const { client } = await setupChat();
    const sendSpy = vi.spyOn(client, "sendMessage");
    const agentSpy = vi.spyOn(client, "streamConversationAgent");

    const view = buildPrivateAgentView("lin-zhixing", "林知行");
    const question = view.sampleQuestions[0];

    await userEvent.click(screen.getByRole("button", { name: question }));

    expect(screen.getByLabelText("消息输入框")).toHaveValue(question);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(agentSpy).not.toHaveBeenCalled();
  });

  it("面板在会话页可见并标注为演示功能", async () => {
    await setupChat();

    const heading = screen.getByText("私有知识库 Agent");
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(PRIVATE_AGENT_DEMO_NOTICE)).toBeInTheDocument();
    // 咨询与私有 Agent 并存在右栏，两者都不能互相遮挡。
    const consultation = screen.getByText("付费咨询").closest("[data-slot='card']");
    expect(consultation).not.toBeNull();
    expect(within(consultation as HTMLElement).getByText("演示边界")).toBeInTheDocument();
  });
});
