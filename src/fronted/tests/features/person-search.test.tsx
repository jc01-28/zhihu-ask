import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/front/api/ApiError";
import { API_ERROR_CODES } from "@/shared/contracts/errors";
import {
  createCompletedSteps,
  createInitialSearchState,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  personSearchReducer,
  validateQuery,
} from "@/front/features/search/search-state";
import { MAIN_QUERY, SAMPLE_QUESTIONS } from "@/front/mocks/demo-data";
import {
  readSessionText,
  removeSessionText,
  writeSessionText,
  STORAGE_KEYS,
} from "@/front/shared/storage";
import { createTestClient, renderApp } from "../test-utils";

describe("personSearchReducer", () => {
  it("开始新搜索会清空上一次结果并重置阶段", () => {
    const first = personSearchReducer(createInitialSearchState("旧问题"), {
      type: "run.started",
      query: "旧问题",
    });
    const withStep = personSearchReducer(first, {
      type: "step",
      event: { type: "step.started", step: "retrieving", message: "检索中" },
    });
    expect(withStep.steps.retrieving.status).toBe("running");

    const second = personSearchReducer(withStep, {
      type: "run.started",
      query: "新问题",
    });
    expect(second.query).toBe("新问题");
    expect(second.result).toBeNull();
    expect(second.steps.retrieving.status).toBe("waiting");
  });

  it("未知阶段或缺失 message 不会伪造状态", () => {
    const initial = createInitialSearchState("问题");
    const unchanged = personSearchReducer(initial, {
      type: "step",
      event: { type: "run.started", requestId: "00000000-0000-4000-8000-000000000011" },
    });
    expect(unchanged.steps).toEqual(initial.steps);
  });

  it("取消不是失败：回到 idle 且保留输入", () => {
    const running = personSearchReducer(createInitialSearchState("问题"), {
      type: "run.started",
      query: "问题",
    });
    const aborted = personSearchReducer(running, { type: "run.aborted" });
    expect(aborted.status).toBe("idle");
    expect(aborted.error).toBeNull();
    expect(aborted.query).toBe("问题");
  });

  it("run.failed 记录可重试错误", () => {
    const failed = personSearchReducer(createInitialSearchState("问题"), {
      type: "run.failed",
      error: { code: "RATE_LIMITED", message: "稍后重试", retryable: true },
    });
    expect(failed.status).toBe("error");
    expect(failed.error).toMatchObject({ retryable: true });
  });

  it("刷新恢复：直接进入 done，六个阶段都按已完成呈现", () => {
    const result = {
      cards: [],
      modeUsed: "fixture" as const,
      fallbackReason: null,
      modelFallback: false,
      contextStatus: "applied" as const,
      contextSourceCounts: { creation: 0, followee: 0, collection: 0, favlist: 0 },
      searchedQueries: [],
      background: [],
      analyzedContentCount: 0,
      rejectedContentCount: 0,
      runId: "00000000-0000-4000-8000-000000000051",
      persistence: "saved" as const,
    };

    const restored = personSearchReducer(createInitialSearchState("新问题"), {
      type: "run.restored",
      result,
      query: "上次的问题",
    });

    expect(restored.status).toBe("done");
    expect(restored.query).toBe("上次的问题");
    expect(restored.completedQuery).toBe("上次的问题");
    expect(restored.result).toEqual(result);
    expect(restored.error).toBeNull();
    expect(Object.values(restored.steps).every((step) => step.status === "done")).toBe(true);
    expect(restored.steps).toEqual(createCompletedSteps());
  });
});

describe("validateQuery", () => {
  it("长度边界是 4～300 字，两端都是闭区间", () => {
    expect(MIN_QUERY_LENGTH).toBe(4);
    expect(MAX_QUERY_LENGTH).toBe(300);

    expect(validateQuery("三个字")).toMatch(/至少输入 4 个字/);
    expect(validateQuery("刚好四个")).toBeNull();
    expect(validateQuery("字".repeat(MAX_QUERY_LENGTH))).toBeNull();
    expect(validateQuery("字".repeat(MAX_QUERY_LENGTH + 1))).toMatch(/控制在 300 字以内/);
  });

  it("前后空白不计入长度", () => {
    expect(validateQuery("  找四个人  ")).toBeNull();
    expect(validateQuery("  找三人  ")).toMatch(/至少输入 4 个字/);
  });
});

describe("首页搜索交互", () => {
  it("默认展示主问题，选中示例问题会替换输入但不自动搜索", async () => {
    renderApp({ client: createTestClient() });

    const textarea = await screen.findByLabelText("你现在想找什么样的人？");
    expect(textarea).toHaveValue(MAIN_QUERY);

    await userEvent.click(
      screen.getByRole("button", { name: SAMPLE_QUESTIONS[0] }),
    );
    expect(textarea).toHaveValue(SAMPLE_QUESTIONS[0]);
    expect(screen.getByText("输入问题后，结果会来自本次搜索")).toBeInTheDocument();
  });

  it("少于 4 个字时给出输入错误并保留内容", async () => {
    renderApp({ client: createTestClient() });

    const textarea = await screen.findByLabelText("你现在想找什么样的人？");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "abc");
    await userEvent.click(screen.getByRole("button", { name: /开始找人/ }));

    expect(await screen.findByText(/至少输入 4 个字/)).toBeInTheDocument();
    expect(textarea).toHaveValue("abc");
  });

  it("Ctrl+Enter 可以触发搜索并展示六阶段完成态与三张人物卡", async () => {
    renderApp({ client: createTestClient() });

    const textarea = await screen.findByLabelText("你现在想找什么样的人？");
    await userEvent.click(textarea);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    expect(await screen.findByText("林知行")).toBeInTheDocument();
    expect(screen.getByText("周屿")).toBeInTheDocument();
    expect(screen.getByText("程澈")).toBeInTheDocument();

    await waitFor(() => {
      const steps = document.querySelectorAll("[data-step]");
      expect(steps).toHaveLength(6);
      for (const step of steps) {
        expect(step.getAttribute("data-status")).toBe("done");
      }
    });
  });

  it("搜索失败展示错误条与重试按钮", async () => {
    renderApp({ client: createTestClient({ scenario: "search-failed" }) });

    await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));

    expect(await screen.findByText("这次没有搜成功")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("429 限流：保留输入、给出可读提示，并且可以重试成功", async () => {
    const client = createTestClient();
    const real = client.streamSearch.bind(client);
    let limited = true;
    client.streamSearch = async (...args) => {
      if (limited) {
        throw new ApiError({
          code: API_ERROR_CODES.rateLimited,
          message: "请求过于频繁，请稍后重试。",
          status: 429,
          retryable: true,
        });
      }
      return real(...args);
    };

    renderApp({ client });

    const textarea = await screen.findByLabelText("你现在想找什么样的人？");
    await userEvent.click(screen.getByRole("button", { name: /开始找人/ }));

    expect(await screen.findByText("请求过于频繁，请稍后重试。")).toBeInTheDocument();
    // 限流不丢输入：用户可以直接改一改再发。
    expect(textarea).toHaveValue(MAIN_QUERY);

    limited = false;
    await userEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(await screen.findByText("林知行")).toBeInTheDocument();
  });

  it("空结果不会被硬凑成三个人", async () => {
    renderApp({ client: createTestClient({ scenario: "empty-results" }) });

    await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));

    expect(
      await screen.findByText("本次没有找到证据足够的人选"),
    ).toBeInTheDocument();
    expect(screen.queryByText("林知行")).not.toBeInTheDocument();
  });

  it("停止搜索保留输入且不显示错误红条", async () => {
    renderApp({ client: createTestClient({ stepDelayMs: 8 }) });

    await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));
    await userEvent.click(await screen.findByRole("button", { name: /停止搜索/ }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /停止搜索/ })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("这次没有搜成功")).not.toBeInTheDocument();
    expect(screen.getByLabelText("你现在想找什么样的人？")).toHaveValue(MAIN_QUERY);
  });

  it("热榜可用时作为提问参考展示", async () => {
    renderApp({ client: createTestClient() });

    expect(await screen.findByText(/知乎热榜选题/)).toBeInTheDocument();
  });

  it("热榜不可用时静默隐藏，不影响主搜索", async () => {
    const client = createTestClient();
    client.getHotTopics = async () => {
      throw new Error("演示：热榜不可用");
    };

    renderApp({ client });

    const startButton = await screen.findByRole("button", { name: /开始找人/ });
    expect(startButton).toBeEnabled();
    await waitFor(() =>
      expect(screen.queryByText(/知乎热榜选题/)).not.toBeInTheDocument(),
    );
  });

  it("Cmd+Enter 与 Ctrl+Enter 都能触发搜索", async () => {
    renderApp({ client: createTestClient() });

    const textarea = await screen.findByLabelText("你现在想找什么样的人？");
    await userEvent.click(textarea);
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    expect(await screen.findByText("林知行")).toBeInTheDocument();
  });

  it("搜索流中断时给出可重试错误，重试后能拿到结果", async () => {
    const client = createTestClient();
    const real = client.streamSearch.bind(client);
    let truncated = true;
    client.streamSearch = async (...args) => {
      if (truncated) {
        throw new ApiError({
          code: API_ERROR_CODES.streamIncomplete,
          message: "搜索流没有返回完整结果。",
          status: 200,
          retryable: true,
        });
      }
      return real(...args);
    };

    renderApp({ client });
    await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));

    expect(await screen.findByText("这次没有搜成功")).toBeInTheDocument();
    expect(screen.getByText(/没有返回完整结果/)).toBeInTheDocument();

    truncated = false;
    await userEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(await screen.findByText("林知行")).toBeInTheDocument();
  });

  it("刷新后向服务端恢复上次结果，摘要信息量与首次搜索一致", async () => {
    const client = createTestClient();
    const first = renderApp({ client });

    await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));
    await screen.findByText("林知行");
    // 完成一次搜索后才会留下运行指针。
    expect(readSessionText(STORAGE_KEYS.lastSearchRun)).toContain("runId");
    first.unmount();

    const spy = vi.spyOn(client, "restoreRun");
    renderApp({ client });

    expect(await screen.findByText("林知行")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    // 恢复后的摘要不能缩水：降级、上下文与统计都要在。
    expect(screen.getByText("已应用授权上下文")).toBeInTheDocument();
    expect(screen.getByText("分析 18 条内容")).toBeInTheDocument();
    expect(screen.getByText("排除 11 条弱证据")).toBeInTheDocument();
    expect(screen.getByText(/问题理解阶段降级为确定性规则模型/)).toBeInTheDocument();
    // 输入框保留当时的问题，方便直接改一改再搜。
    expect(screen.getByLabelText("你现在想找什么样的人？")).toHaveValue(MAIN_QUERY);
  });

  it("运行已过期时静默清掉指针，不显示错误红条", async () => {
    const client = createTestClient();
    // 一个格式合法但服务端没有的运行：恢复必然 404。
    writeSessionText(
      STORAGE_KEYS.lastSearchRun,
      JSON.stringify({
        runId: "00000000-0000-4000-8000-0000000000ff",
        query: "上次的问题",
      }),
    );

    renderApp({ client });

    await waitFor(() =>
      expect(readSessionText(STORAGE_KEYS.lastSearchRun)).toBeNull(),
    );
    expect(screen.queryByText("这次没有搜成功")).toBeNull();
    expect(await screen.findByRole("button", { name: /开始找人/ })).toBeEnabled();
  });

  it("换一个问题或清空结果时，运行指针同步失效", async () => {
    const client = createTestClient();
    renderApp({ client });

    await userEvent.click(await screen.findByRole("button", { name: /开始找人/ }));
    await screen.findByText("林知行");
    expect(readSessionText(STORAGE_KEYS.lastSearchRun)).not.toBeNull();

    // 选示例问题会清空上一次结果，指针必须跟着失效，
    // 否则刷新后会把旧结果「复活」成新问题的答案。
    await userEvent.click(screen.getByRole("button", { name: SAMPLE_QUESTIONS[0] }));
    expect(readSessionText(STORAGE_KEYS.lastSearchRun)).toBeNull();
    removeSessionText(STORAGE_KEYS.lastSearchRun);
  });
});
