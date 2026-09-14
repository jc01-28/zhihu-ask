import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { findFieldGraph } from "@/front/mocks/field-data";
import {
  MOTION_MAX_DELAY_MS,
  MOTION_STAGGER_MS,
  motionDelay,
  prefersReducedMotion,
  useReducedMotionAttribute,
} from "@/front/shared/motion";
import { createTestClient, renderApp } from "../test-utils";

/** jsdom 没有 matchMedia；这里装一个可切换的最小实现。 */
function stubMatchMedia(reduce: boolean) {
  const listeners = new Set<() => void>();
  let matches = reduce;

  const stub = (query: string) => ({
    // 必须是 getter：`matches` 在真实 MediaQueryList 上是实时值，
    // 若在对象创建时快照下来，切换系统设置后读到的永远是旧值。
    get matches() {
      return query.includes("prefers-reduced-motion") ? matches : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, handler: () => void) => listeners.add(handler),
    removeEventListener: (_type: string, handler: () => void) => listeners.delete(handler),
    addListener: (handler: () => void) => listeners.add(handler),
    removeListener: (handler: () => void) => listeners.delete(handler),
    dispatchEvent: () => false,
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: stub,
  });

  return {
    set(next: boolean) {
      matches = next;
      for (const handler of listeners) handler();
    },
    listenerCount: () => listeners.size,
  };
}

function Probe() {
  const reduced = useReducedMotionAttribute();
  return <span data-testid="probe">{reduced ? "reduced" : "full"}</span>;
}

afterEach(() => {
  // 删掉桩，避免影响其它用例（jsdom 默认没有 matchMedia）。
  Reflect.deleteProperty(window, "matchMedia");
});

describe("动效偏好", () => {
  it("没有 matchMedia 时按「不减弱」处理，与 CSS 默认行为一致", () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it("系统开启减少动效时结果为 true", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(motionDelay(3, true)).toBe(0);
  });

  it("错峰延迟按序递增并有上限，不会无限拉长", () => {
    expect(motionDelay(0, false)).toBe(0);
    expect(motionDelay(1, false)).toBe(MOTION_STAGGER_MS);
    expect(motionDelay(3, false, { base: 100 })).toBe(100 + MOTION_STAGGER_MS * 3);
    // 封顶：第 100 个节点也不会等到天荒地老。
    expect(motionDelay(100, false)).toBe(MOTION_MAX_DELAY_MS);
    // 负数按 0 处理，避免出现负延迟。
    expect(motionDelay(-5, false)).toBe(0);
  });

  it("把偏好写成 html[data-reduced-motion]，并随系统设置变化", async () => {
    const media = stubMatchMedia(false);
    media.set(false);
    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("full");
    await waitFor(() =>
      expect(document.documentElement.dataset.reducedMotion).toBe("false"),
    );
    // 系统设置的变更发生在 React 事件之外，必须显式包在 act 里才会被刷进界面。
    act(() => media.set(true));

    expect(screen.getByTestId("probe")).toHaveTextContent("reduced");
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    // 组件在挂载时注册监听，卸载时清理，不留悬挂回调。
    expect(media.listenerCount()).toBeGreaterThan(0);
  });

  it("减少动效时星图节点的延迟被归零，不是「先隐形再闪现」", async () => {
    stubMatchMedia(true);
    const client = createTestClient();
    renderApp({ client, route: "/app/fields/agent-development" });

    const canvas = await screen.findByTestId("field-graph-canvas");
    await waitFor(() => {
      const nodes = canvas.querySelectorAll(".graph-node-enter");
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect((node as HTMLElement).style.animationDelay).toBe("0ms");
      }
    });
  });

  it("默认（不减弱）时星图保留由中心到人物的错峰入场", async () => {
    stubMatchMedia(false);
    const client = createTestClient();
    renderApp({ client, route: "/app/fields/agent-development" });

    const canvas = await screen.findByTestId("field-graph-canvas");
    await waitFor(() =>
      expect(canvas.querySelectorAll(".graph-node-enter").length).toBeGreaterThan(0),
    );
    const delays = new Set(
      Array.from(canvas.querySelectorAll(".graph-node-enter")).map(
        (node) => (node as HTMLElement).style.animationDelay,
      ),
    );
    // 至少存在两种不同延迟，说明错峰生效而不是全部同时出现。
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe("响应式与可访问性", () => {
  it("星图在窄屏降级为分组卡片，卡片里的头像仍可点击打开名片", async () => {
    const client = createTestClient();
    renderApp({ client, route: "/app/fields/agent-development" });

    const cards = await screen.findByTestId("field-graph-cards");
    expect(cards.className).toContain("md:hidden");

    const graph = findFieldGraph("agent-development")!;
    const firstPerson = graph.people[0];
    await userEvent.click(
      within(cards).getByRole("button", { name: new RegExp(`查看人物 ${firstPerson.name}`) }),
    );

    expect(await screen.findByText("领域关联")).toBeInTheDocument();
  });

  it("抽屉与弹层可以用 Escape 关闭，不需要鼠标", async () => {
    const client = createTestClient();
    renderApp({ client, route: "/app/fields/agent-development" });

    const cards = await screen.findByTestId("field-graph-cards");
    const graph = findFieldGraph("agent-development")!;
    await userEvent.click(
      within(cards).getByRole("button", {
        name: new RegExp(`查看人物 ${graph.people[0].name}`),
      }),
    );
    const sheet = (await screen.findByText("领域关联")).closest(
      "[data-slot='sheet-content']",
    ) as HTMLElement;
    expect(sheet).not.toBeNull();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("领域关联")).toBeNull());
  });

  it("加载中只用 role=status，错误才用 role=alert", async () => {
    const client = createTestClient();
    const real = client.getFeaturedFields.bind(client);
    let release: () => void = () => undefined;
    client.getFeaturedFields = async (signal?: AbortSignal) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return real(signal);
    };

    renderApp({ client, route: "/app/fields" });

    // 领域骨架屏自己带 role=status 播报，而不是靠 aria-hidden 的方块让读屏静音。
    const status = await screen.findByText("正在加载推荐领域");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => release());
  });

  it("错误态一定带恢复动作", async () => {
    const client = createTestClient({ scenario: "field-graph-missing" });
    renderApp({ client, route: "/app/fields/agent-development" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("领域不存在");
    // 404 不可重试，但必须给出返回目录的动作。
    expect(screen.getByRole("link", { name: /返回领域目录/ })).toHaveAttribute(
      "href",
      "/app/fields",
    );
  });

  it("主要导航在每个页面都在场，且当前页有 aria-current 标记", async () => {
    const client = createTestClient();
    renderApp({ client, route: "/app/fields" });

    const nav = await screen.findByRole("navigation", { name: "主导航" });
    expect(within(nav).getByRole("link", { name: /专业领域/ })).toBeInTheDocument();

    await userEvent.click(within(nav).getByRole("link", { name: /问题找人/ }));
    const activeNav = await screen.findByRole("navigation", { name: "主导航" });
    expect(within(activeNav).getByRole("link", { name: /问题找人/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
