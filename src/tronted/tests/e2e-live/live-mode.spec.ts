import { createTest, expect, test, type Page } from "../e2e/fixtures";

/**
 * live 模式的 E2E：浏览器请求的是一台真的 HTTP 服务器
 * （`scripts/live-stub-server.mjs`，经 vite 的 /api 代理）。
 *
 * 这里只放 **mock 模式证明不了的事**，其余继续由 `tests/e2e/` 覆盖：
 *
 *  - 真实响应体必须过 Zod 契约（领域检索退化成人物时要在前端被拒绝）；
 *  - NDJSON 在真实 socket 上分块到达，进度是逐条推进的；
 *  - 会话探测拿到 401 时的实际行为（`onUnauthorized` 会不会把会话探测
 *    和它自己打成死循环）；
 *  - 刷新恢复真的走了一次 `GET /api/agent/runs/:runId`。
 *
 * 「数据来自后端」不靠界面文案判断，一律去查桩服务器的请求记录：
 * 页面上的名字（陆知远 / 大模型应用）只在桩里存在，mock 夹具里没有。
 */

/**
 * 验证失败分支的用例要放行对应的 HTTP 失败状态。
 *
 * 这些用例的**目的**就是让服务端失败，浏览器因此必然把 401/404/503
 * 记成 console.error。默认的 `test` 不放行任何状态码，
 * 免得静态资源 404 这类真问题被一起放过。
 */
const testWithServerFailure = createTest({ allowedHttpStatuses: [401, 404, 503] });

const QUERY = "大模型应用的效果评测该怎么做？";

const RUN_ID = "11111111-2222-4333-8444-555555555555";

type StubRequest = { method: string; path: string; search: string; mode: string };

/** 切分支。桩服务器用一个 `stub_mode` Cookie 记住它，页面与请求共享同一个 Cookie 罐。 */
async function setStubMode(page: Page, mode: string): Promise<void> {
  const response = await page.request.get(`/api/__stub/mode?value=${mode}`);
  expect(response.ok(), `切换桩分支 ${mode} 失败`).toBe(true);
  await page.request.get("/api/__stub/requests/reset");
}

async function stubRequests(page: Page): Promise<StubRequest[]> {
  const response = await page.request.get("/api/__stub/requests");
  const payload = (await response.json()) as { items: StubRequest[] };
  // 读记录这个动作本身也会被记录，过滤掉免得干扰计数。
  return payload.items.filter((item) => !item.path.startsWith("/api/__stub/"));
}

function countPath(items: StubRequest[], path: string): number {
  return items.filter((item) => item.path === path).length;
}

testWithServerFailure(
  "后端持续返回 401 时，会话探测不会被打成请求风暴",
  async ({ page }) => {
    await setStubMode(page, "expired");

    await page.goto("/app/find");
    await expect(
      page.getByRole("link", { name: /使用知乎账号授权/ }),
    ).toBeVisible();

    // 断言「一段时间内请求数不再增长」，而不是断言一个固定次数：
    // 次数会被 StrictMode 的 effect 双跑、渲染次数等无关因素影响，
    // 而「不再增长」才是「没有循环」这件事本身。
    const before = countPath(await stubRequests(page), "/api/auth/session");
    await page.waitForTimeout(2_500);
    const after = countPath(await stubRequests(page), "/api/auth/session");

    expect(
      after,
      `会话探测在 2.5 秒内从 ${before} 次涨到 ${after} 次：` +
        "401 触发的全局会话刷新把会话探测本身也刷了，形成了循环",
    ).toBe(before);
    // 顺带确认它确实至少探测过一次，而不是压根没连上后端。
    expect(after).toBeGreaterThan(0);
  },
);

test("领域目录 → 星图 → 人物名片：数据与请求全部来自后端", async ({ page }) => {
  await setStubMode(page, "default");
  await page.goto("/app/fields");

  // 页面上的领域只存在于桩服务器，mock 夹具里没有这个名字。
  await expect(page.getByRole("link", { name: "查看领域 大模型应用" })).toBeVisible();

  await page.getByLabel("检索专业领域").fill("评测");
  await page.getByRole("button", { name: "检索领域" }).click();
  await expect(page.getByRole("heading", { name: /检索到 1 个领域/ })).toBeVisible();
  // 领域检索不得退化成人物搜索。
  await expect(page.getByRole("button", { name: "查看证据" })).toHaveCount(0);

  await page.getByRole("link", { name: "查看领域 大模型应用" }).click();
  await expect(page).toHaveURL(/\/app\/fields\/llm-apps$/);
  await expect(page.getByRole("heading", { name: "大模型应用" })).toBeVisible();
  await expect(page.getByText("2 位可交流的人")).toBeVisible();

  await page
    .getByTestId("field-graph-canvas")
    .getByRole("button", { name: /查看人物 陆知远/ })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("领域关联")).toBeVisible();
  // 领域来源没有逐条内容证据，如实说明。
  await expect(sheet.getByText("暂无内容证据")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  const paths = (await stubRequests(page)).map((item) => item.path);
  expect(paths).toContain("/api/fields/featured");
  expect(paths).toContain("/api/fields");
  expect(paths).toContain("/api/fields/llm-apps/graph");
  expect(paths).toContain("/api/creators/lu-zhiyuan");

  // 检索请求真的带上了参数，而不是前端本地过滤。
  const search = (await stubRequests(page)).find((item) => item.path === "/api/fields");
  expect(search?.search).toContain("query=");
});

test("后端把领域检索退化成人物列表时，前端拒绝而不是把人物当领域渲染", async ({ page }) => {
  await setStubMode(page, "fields-degraded");
  await page.goto("/app/fields");

  await page.getByLabel("检索专业领域").fill("评测");
  await page.getByRole("button", { name: "检索领域" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("领域检索失败");
  await expect(alert).toContainText("不符合约定契约");

  // 人物一个都不许出现：既不能被当成领域卡片，也不能有「查看证据」这类人物动作。
  await expect(page.getByText("陆知远")).toHaveCount(0);
  await expect(page.getByText("周亦然")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看证据" })).toHaveCount(0);
});

testWithServerFailure(
  "领域检索失败时给出可执行的重试入口",
  async ({ page }) => {
    await setStubMode(page, "fields-failed");
    await page.goto("/app/fields");

    // 推荐领域与检索是两条独立的状态线：检索失败不该把推荐区一起清空。
    const featuredAlert = page.getByRole("alert");
    await expect(featuredAlert).toContainText("推荐领域加载失败");
    await expect(
      page.getByRole("button", { name: /重新加载推荐/ }),
    ).toBeVisible();

    await page.getByLabel("检索专业领域").fill("评测");
    await page.getByRole("button", { name: "检索领域" }).click();
    await expect(page.getByText(/的领域检索失败/)).toBeVisible();
    await expect(page.getByRole("button", { name: "重新检索" })).toBeVisible();
  },
);

testWithServerFailure(
  "领域星图 404 时给「领域不存在」与返回入口，而不是给一个永远失败的重试",
  async ({ page }) => {
    await setStubMode(page, "graph-missing");
    await page.goto("/app/fields/llm-apps");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("领域不存在");
    await expect(alert.getByRole("link", { name: "返回领域目录" })).toHaveAttribute(
      "href",
      "/app/fields",
    );
    // 领域不存在是终态：不给重试。
    await expect(alert.getByRole("button", { name: /重试/ })).toHaveCount(0);
  },
);

test("六阶段检索流走真实 socket，刷新后由 restoreRun 取回同样的结果", async ({ page }) => {
  await setStubMode(page, "default");
  await page.goto("/app/find");

  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();

  await expect(page.locator("[data-step]")).toHaveCount(6);
  await expect(page.locator('[data-step][data-status="done"]')).toHaveCount(6, {
    timeout: 30_000,
  });

  await expect(page.getByText(/本次找到 2 位有内容证据的人选/)).toBeVisible();
  await expect(page.getByText("陆知远", { exact: true })).toBeVisible();

  const afterSearch = await stubRequests(page);
  expect(countPath(afterSearch, "/api/agent/search")).toBe(1);

  // ---- 刷新：业务真相来自服务端，浏览器只留了一个运行指针 ----
  await page.request.get("/api/__stub/requests/reset");
  await page.reload();

  await expect(page.getByText(/本次找到 2 位有内容证据的人选/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("陆知远", { exact: true })).toBeVisible();
  // 摘要里的数字必须与首次搜索完全一致，不能因为恢复响应少字段就归零。
  await expect(page.getByText(/分析 34 条内容/)).toBeVisible();
  await expect(page.getByLabel("你现在想找什么样的人？")).toHaveValue(QUERY);

  const afterReload = await stubRequests(page);
  // 恢复请求确实发生过；次数不锁死——StrictMode 在开发模式下会把 effect 跑两遍，
  // 那是有意的重复执行，不是缺陷。
  expect(countPath(afterReload, `/api/agent/runs/${RUN_ID}`)).toBeGreaterThanOrEqual(1);
  // 恢复不能顺带再跑一次检索流：结果来自服务端的运行记录，不是重新搜出来的。
  expect(countPath(afterReload, "/api/agent/search")).toBe(0);
});

test("进度是逐条到达的：阶段没跑完就不会先出现结果", async ({ page }) => {
  // 桩在这个分支里把逐事件间隔拉到 120ms，并在终态前多停 600ms。
  await setStubMode(page, "slow-steps");
  await page.goto("/app/find");

  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();

  // 六个阶段已经出现，但都还没完成。
  await expect(page.locator("[data-step]")).toHaveCount(6);
  await expect(page.locator('[data-step][data-status="done"]')).not.toHaveCount(6);
  // 结果区此刻必须是空的：这一条才说明数据是边算边到的。
  await expect(page.getByText("陆知远", { exact: true })).toHaveCount(0);

  await expect(page.locator('[data-step][data-status="done"]')).toHaveCount(6, {
    timeout: 30_000,
  });
  await expect(page.getByText("陆知远", { exact: true })).toBeVisible();
});

test("流干净结束但缺终态事件时，如实报「连接中断」并允许重试", async ({ page }) => {
  await setStubMode(page, "search-truncated");
  await page.goto("/app/find");

  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("这次没有搜成功");
  await expect(alert).toContainText("连接中断，没有收到完整结果，请重试。");
  await expect(alert.getByRole("button", { name: /重试/ })).toBeEnabled();
  // 半截结果不许留在页面上。
  await expect(page.getByText("陆知远", { exact: true })).toHaveCount(0);
});

test("检索流返回 run.failed 时展示服务端错误码对应的文案", async ({ page }) => {
  await setStubMode(page, "search-failed");
  await page.goto("/app/find");

  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("这次没有搜成功");
  await expect(alert).toContainText("检索被限流，请稍后重试。");
  await expect(alert.getByRole("button", { name: /重试/ })).toBeEnabled();
});

test("未实现的后端接口明确返回 501，不会被当成空数据静默通过", async ({ page }) => {
  // 桩只覆盖读路径与检索流；会话/咨询是写路径，应当明确报「未实现」。
  const response = await page.request.post("/api/conversations", {
    data: { creatorId: "lu-zhiyuan", sourceRunId: null },
  });
  expect(response.status()).toBe(501);
  expect(await response.json()).toMatchObject({ code: "NOT_IMPLEMENTED" });
});
