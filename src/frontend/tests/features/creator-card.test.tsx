import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreatorAvatar, ResultCard } from "@/front/features/creator/CreatorCard";
import { FIXTURE_CREATORS, findCreatorCard } from "@/front/mocks/demo-data";
import { fieldPersonToCreatorCard, findFieldPerson } from "@/front/mocks/field-data";
import type { CreatorCardData } from "@/shared/contracts/creator";

const searchCreator = FIXTURE_CREATORS[0];

/** 领域来源的人物：有公开关联但没有可核验的内容证据。 */
const fieldCreator = fieldPersonToCreatorCard(findFieldPerson("p-shen-yiran")!);

function renderCard(creator: CreatorCardData, props: Partial<Parameters<typeof ResultCard>[0]> = {}) {
  return render(<ResultCard creator={creator} featured={false} {...props} />);
}

describe("统一人物卡", () => {
  it("有 avatarUrl 时使用后端地址，加载失败回退到首字占位", () => {
    const withAvatar: CreatorCardData = {
      ...searchCreator,
      avatarUrl: "https://pic1.zhimg.com/v2-demo-avatar.jpg",
    };
    renderCard(withAvatar);

    const image = screen.getByRole("img", { name: `${withAvatar.name}的头像` }) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe(withAvatar.avatarUrl);

    fireEvent.error(image);
    // 加载失败后不能再留着一个破图，必须换成首字占位。
    expect(screen.queryByRole("img", { name: `${withAvatar.name}的头像` })).toBeNull();
    expect(screen.getAllByText(withAvatar.initial).length).toBeGreaterThan(0);
  });

  it("没有 avatarUrl 时直接使用首字占位，不发起图片请求", () => {
    renderCard(searchCreator);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getAllByText(searchCreator.initial).length).toBeGreaterThan(0);
  });

  it("有内容证据时展示条数与首条证据标题", () => {
    renderCard(searchCreator);

    expect(
      screen.getByText(`${searchCreator.evidence.length} 条内容证据`),
    ).toBeInTheDocument();
    expect(screen.getByText(searchCreator.evidence[0].title)).toBeInTheDocument();
  });

  it("领域来源没有证据时如实说明，不用占位文案冒充证据", () => {
    renderCard(fieldCreator);

    expect(fieldCreator.evidence).toHaveLength(0);
    expect(screen.getByText("0 条内容证据")).toBeInTheDocument();
    expect(
      screen.getByText("暂无内容证据，资料来自领域公开关联。"),
    ).toBeInTheDocument();
  });

  it("对比预览（无回调）时两个操作按钮都禁用并说明原因", () => {
    renderCard(searchCreator);

    const details = screen.getByRole("button", { name: "查看证据" });
    const chat = screen.getByRole("button", { name: /与 TA 聊聊/ });

    expect(details).toBeDisabled();
    expect(chat).toBeDisabled();
    expect(details).toHaveAttribute("title", "对比预览中不可操作");
    expect(chat.getAttribute("title")).toContain("请回到搜索结果页操作");
  });

  it("创建会话进行中时按钮禁用并提示进度", () => {
    const onChat = vi.fn();
    renderCard(searchCreator, { onChat, chatPending: true });

    const chat = screen.getByRole("button", { name: /正在创建会话/ });
    expect(chat).toBeDisabled();
    expect(chat).toHaveAttribute("aria-busy", "true");
  });

  it("头像组件在两种尺寸下都保持圆形占位", () => {
    render(<CreatorAvatar creator={findCreatorCard("cheng-che")!} size="lg" />);
    const placeholder = screen.getByText("程");
    expect(placeholder.className).toContain("rounded-full");
  });
});
