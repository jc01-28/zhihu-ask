import { expect, test, type Page } from "./fixtures";

/**
 * 恢复流程 E2E。
 *
 * 每个用例只回答两个问题：**错误说清楚了没有**，以及**有没有可点击的恢复动作**。
 * 场景全部通过 Mock 的 URL 开关构造（只在 Mock 模式生效，且只在页面首次加载读取）：
 * - `?mock_auth=anonymous|unconfigured` 控制授权状态
 * - `?mock_scenario=...` 控制失败分支
 */

const QUERY = "大厂产品转 AI 创业公司，值得找谁聊？";

/** 走完搜索并进入聊天页。开关必须由调用方在**这一次** goto 时带上。 */
async function startChat(page: Page, route = "/app/find") {
  await page.goto(route);
  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();
  await expect(page.getByText(/本次找到 3 位有内容证据的人选/)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /与 TA 聊聊/ }).first().click();
  await expect(page).toHaveURL(/\/app\/chat\//);
  await expect(page.getByText(/与 林知行 的虚拟对话/)).toBeVisible();
}

test("项目推荐页在任何登录态下都能看到，但不泄露任何业务入口", async ({ page }) => {
  await page.goto("/?mock_auth=anonymous");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("找到值得问的人");
  // 推荐页不请求业务 API，也不展示搜索框与人物。
  await expect(page.getByLabel("你现在想找什么样的人？")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /开始找人/ })).toHaveCount(0);
  // Demo 始终提供固定的项目地址。
  const github = page.getByRole("link", { name: /查看 GitHub 项目/ });
  await expect(github).toBeVisible();
  await expect(github).toHaveAttribute(
    "href",
    "https://github.com/jc01-28/zhihu-ask/tree/main",
  );
});

test("未授权：功能首页只给唯一授权入口，不提供任何绕过方式", async ({ page }) => {
  await page.goto("/app?mock_auth=anonymous");

  await expect(page.getByText("使用知乎账号进入")).toBeVisible();
  const login = page.getByRole("link", { name: /使用知乎账号授权/ });
  await expect(login).toHaveAttribute("href", "/api/auth/zhihu/login");

  // 未授权时领域与找人两条路都不可达，也没有免登录预览。
  await expect(page.getByLabel("你现在想找什么样的人？")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /浏览专业领域/ })).toHaveCount(0);
  await expect(page.getByLabel("检索专业领域")).toHaveCount(0);

  // 唯一出口是返回项目介绍。
  await page.getByRole("link", { name: /返回项目介绍/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("未配置授权：明确说明原因，不给出无法完成的按钮", async ({ page }) => {
  await page.goto("/app?mock_auth=unconfigured");

  await expect(page.getByText("使用知乎账号进入")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /当前部署未配置知乎授权/ }),
  ).toBeDisabled();
  await expect(page.getByText(/联系管理员补齐服务端配置/)).toBeVisible();
});

test("授权回调带回错误状态时给出一次性提示与重新授权动作", async ({ page }) => {
  // 回调失败意味着这次授权没有成功，因此同时处于未授权状态。
  await page.goto("/app?auth=state_mismatch&mock_auth=anonymous");

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("授权校验未通过");
  await expect(page.getByRole("link", { name: /使用知乎账号授权/ })).toBeVisible();
});

test("问题找人搜索失败：错误条可读且可重试", async ({ page }) => {
  await page.goto("/app/find?mock_scenario=search-failed");

  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("这次没有搜成功");
  await expect(alert.getByRole("button", { name: /重试/ })).toBeEnabled();
  // 失败不写结果：不出现任何人物卡。
  await expect(page.getByRole("button", { name: "查看证据" })).toHaveCount(0);
});

test("问题找人无结果：明确说明是空结果而不是空页面", async ({ page }) => {
  await page.goto("/app/find?mock_scenario=empty-results");

  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();

  await expect(page.getByText(/本次找到 0 位有内容证据的人选/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/本次没有找到证据足够的人选/)).toBeVisible();
  await expect(page.getByLabel("你现在想找什么样的人？")).toBeEnabled();
});

test("领域检索失败：保留已有推荐领域，重试重新执行当前查询", async ({ page }) => {
  await page.goto("/app/fields?mock_scenario=field-search-failed");

  // 推荐领域先到，不能被一次检索失败清空。
  await expect(page.getByRole("link", { name: "查看领域 Agent 开发" })).toBeVisible();

  await page.getByLabel("检索专业领域").fill("Agent");
  await page.getByRole("button", { name: "检索领域" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("领域检索失败");
  await expect(alert.getByRole("button", { name: /重新检索/ })).toBeEnabled();
  // 推荐领域仍在，用户不会面对一个空白页。
  await expect(page.getByRole("link", { name: "查看领域 Agent 开发" })).toBeVisible();

  // 恢复动作：清空检索词就能回到推荐领域。
  await page.getByRole("button", { name: /清空/ }).click();
  await expect(page.getByRole("link", { name: "查看领域 Agent 开发" })).toBeVisible();
});

test("领域不存在：给出 404 而不给无法成功的重试", async ({ page }) => {
  await page.goto("/app/fields/agent-development?mock_scenario=field-graph-missing");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("领域不存在");
  await expect(page.getByRole("button", { name: /^重试$/ })).toHaveCount(0);

  await page.getByRole("link", { name: /返回领域目录/ }).click();
  await expect(page).toHaveURL(/\/app\/fields$/);
  await expect(page.getByLabel("检索专业领域")).toBeVisible();
});

test("会话不存在：404 页面提供返回找人的动作", async ({ page }) => {
  await page.goto("/app/chat/does-not-exist");

  await expect(page.getByRole("heading", { name: "会话不存在" })).toBeVisible();
  await page.getByRole("link", { name: /返回找人/ }).click();
  await expect(page).toHaveURL(/\/app\/find$/);
  await expect(page.getByRole("button", { name: /开始找人/ })).toBeVisible();
});

test("旧聊天地址 /chat/:id 重定向到 /app/chat/:id", async ({ page }) => {
  await page.goto("/chat/does-not-exist");

  await expect(page).toHaveURL(/\/app\/chat\/does-not-exist$/);
  await expect(page.getByRole("heading", { name: "会话不存在" })).toBeVisible();
});

test("Agent 流中断：半截回复不落库，用户消息保留且可重试", async ({ page }) => {
  await startChat(page, "/app/find?mock_scenario=agent-stream-truncated");

  await page.getByLabel("消息输入框").fill("这次流会中断");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByText("这条回复没有完成")).toBeVisible({ timeout: 20_000 });
  const messageList = page.getByLabel("会话消息");
  await expect(messageList.getByText("这次流会中断", { exact: true })).toBeVisible();
  // 断流不会把尾句也送过来，因此失败气泡里不该出现完成态文案。
  await expect(page.getByText(/以上内容由 Mock Agent 生成/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /重试/ }).first()).toBeEnabled();

  // 半截回复不落库：刷新后只剩服务端保存过的用户消息，没有 Agent 回复。
  await page.reload();
  await expect(page.getByText(/与 林知行 的虚拟对话/)).toBeVisible();
  await expect(messageList.getByText("这次流会中断", { exact: true })).toBeVisible();
  await expect(messageList.getByText("AI Agent", { exact: true })).toHaveCount(0);
  await expect(page.getByText("这条回复没有完成")).toHaveCount(0);
});

test("咨询状态冲突：用服务端状态回正并提示", async ({ page }) => {
  await startChat(page, "/app/find?mock_scenario=consultation-conflict");

  await page.getByRole("button", { name: /申请付费咨询/ }).click();

  await expect(page.getByText(/已按服务端状态回正/)).toBeVisible();
  // UI 回到服务端状态，并且恢复动作仍然可用。
  await expect(page.getByText("免费交流")).toBeVisible();
  await expect(page.getByRole("button", { name: /申请付费咨询/ })).toBeEnabled();
});

test("减少动效偏好被写入 html 属性，星图不再错峰等待", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/fields/agent-development");

  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");

  // 星图有两个互斥视图：桌面 SVG（`hidden md:block`）与窄屏卡片（`md:hidden`）。
  // 卡片视图本来就不做入场错峰，所以「延迟归零」只能在 SVG 上验证；
  // 而 SVG 在窄屏下只是被 `display:none` 隐藏、仍在 DOM 里，内联的
  // `animationDelay` 依旧可读，因此这个用例在两个 project 下都能跑同一段断言，
  // 只需要按断点选「哪个视图可见」来确认星图真的画出来了。
  const canvas = page.getByTestId("field-graph-canvas");
  const cards = page.getByTestId("field-graph-cards");
  const desktop = (page.viewportSize()?.width ?? 0) >= 768;

  await expect(desktop ? canvas : cards).toBeVisible();

  // 必须等星图真的渲染完再读节点样式：html 属性在挂载时就写好了，
  // 那时数据请求可能还没回来，直接 evaluateAll 会读到空数组。
  await expect(canvas.locator(".graph-node-enter").first()).toBeAttached();

  const delays = await canvas
    .locator(".graph-node-enter")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).style.animationDelay),
    );
  expect(delays.length).toBeGreaterThan(0);
  for (const delay of delays) {
    expect(delay === "" || delay === "0ms").toBe(true);
  }
});
