import { expect, test, type Page } from "./fixtures";

/**
 * 主流程 E2E：只用 Mock 模式跑通两条完整链路。
 *
 * 路线 A（领域）：项目推荐页 → 功能首页 → 专业领域目录 → 领域星图
 *                → 统一人物名片 → 创建会话 → 虚拟私聊
 * 路线 B（找人）：功能首页 → 问题找人 → 六阶段 Agent → 人物卡
 *                → 私聊 → Agent 回复 → 模拟咨询 → 刷新恢复
 *
 * Mock 后端把业务状态镜像在浏览器 sessionStorage 里，因此 `page.reload()`
 * 之后会话、消息与咨询状态都必须还在——这正是「刷新恢复」的验证点。
 * URL 上的 `?mock_scenario=` 只在页面**首次加载**时读取，所以构造失败分支
 * 必须直接 goto 目标地址，不能从首页点进去。
 */

const QUERY = "大厂产品转 AI 创业公司，值得找谁聊？";

/** Tailwind 的 `md` 断点：星图在这个宽度以上用 SVG，以下用分组卡片。 */
const DESKTOP_MIN_WIDTH = 768;

/**
 * 星图有两个互斥视图（桌面 SVG / 窄屏卡片），用 CSS 断点切换。
 *
 * 这里按断点选作用域，而不是用 `locator.isVisible()` 去探测：
 * `isVisible()` 不会自动等待，页面还在加载骨架时它会立刻返回 false，
 * 于是用例会去查一个本来就不会有内容的容器，报出与真实原因无关的错。
 */
function graphScope(page: Page) {
  const canvas = page.getByTestId("field-graph-canvas");
  const cards = page.getByTestId("field-graph-cards");
  const desktop = (page.viewportSize()?.width ?? 0) >= DESKTOP_MIN_WIDTH;
  return {
    desktop,
    visible: desktop ? canvas : cards,
    hidden: desktop ? cards : canvas,
  };
}

/** 从项目推荐页点进功能首页。这是产品定义的第一屏，两条链路都要先经过它。 */
async function enterFromLanding(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("找到值得问的人");
  // 推荐页只介绍项目：不出现登录用户、搜索框或任何人物数据。
  await expect(page.getByLabel("你现在想找什么样的人？")).toHaveCount(0);

  await page.getByRole("link", { name: /进入在线网站/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "你想怎么开始？" })).toBeVisible();
}

test("路线 A：领域目录 → 星图 → 人物名片 → 虚拟私聊", async ({ page }) => {
  await enterFromLanding(page);

  // ---- 功能首页只有两个入口，且不提供搜索框 ----
  await expect(page.getByRole("heading", { name: "专业领域社交" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "问题找人" })).toBeVisible();
  await expect(page.getByLabel("你现在想找什么样的人？")).toHaveCount(0);

  await page.getByRole("link", { name: /浏览专业领域/ }).click();
  await expect(page).toHaveURL(/\/app\/fields$/);

  // ---- 领域目录：推荐领域与检索都只返回领域 ----
  await expect(page.getByRole("link", { name: "查看领域 Agent 开发" })).toBeVisible();
  await page.getByLabel("检索专业领域").fill("Agent");
  await page.getByRole("button", { name: "检索领域" }).click();
  await expect(page.getByRole("link", { name: "查看领域 Agent 开发" })).toBeVisible();
  // 领域检索不得退化成人物搜索。
  await expect(page.getByRole("button", { name: "查看证据" })).toHaveCount(0);

  await page.getByRole("link", { name: "查看领域 Agent 开发" }).click();
  await expect(page).toHaveURL(/\/app\/fields\/agent-development$/);

  // ---- 星图：中心、议题与人物节点 ----
  await expect(page.getByRole("heading", { name: "Agent 开发" })).toBeVisible();

  // 桌面看 SVG，窄屏看分组卡片；两个容器始终只有一个可见。
  const graph = graphScope(page);
  await expect(graph.visible).toBeVisible();
  await expect(graph.hidden).toBeHidden();
  await expect(graph.visible.getByRole("button", { name: /查看人物 沈亦然/ })).toBeVisible();

  // 议题筛选：筛掉不相关节点，但被淡化的节点仍然可点。
  await expect(page.getByRole("button", { name: /^全部领域人物/ })).toBeVisible();

  // ---- 统一人物名片 ----
  await graph.visible.getByRole("button", { name: /查看人物 沈亦然/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("领域关联")).toBeVisible();
  // 领域来源没有逐条证据：如实说明，不虚构。
  //
  // 下面两条用 `exact` 精确匹配标题本身，而不是子串：
  // 领域分支的说明段落里写着「没有经过逐条核验的内容证据」，
  // 子串匹配会把这句话也算作命中，于是「区块不存在」被误判成存在。
  await expect(sheet.getByText("暂无内容证据")).toBeVisible();
  await expect(sheet.getByText("内容证据", { exact: true })).toHaveCount(0);
  await expect(sheet.getByText("适合问 TA", { exact: true })).toHaveCount(0);
  // 后端给了公开主页就外链打开，并且是 https。
  const profileLink = sheet.getByRole("link", { name: /查看知乎主页/ });
  await expect(profileLink).toHaveAttribute("href", /^https:\/\/www\.zhihu\.com\//);
  await expect(profileLink).toHaveAttribute("target", "_blank");

  // ---- 创建会话并进入私聊 ----
  await sheet.getByRole("button", { name: /开始私聊/ }).click();
  await expect(page).toHaveURL(/\/app\/chat\/conversation-p-shen-yiran-/);
  await expect(page.getByText(/与 沈亦然 的虚拟对话/)).toBeVisible();
  // 领域来源没有检索运行，因此页面走「模拟聊天」这条说明。
  await expect(
    page.getByText(/消息不会发送给真实知乎用户/),
  ).toBeVisible();

  // ---- 私有知识库展示区：演示边界必须写明 ----
  await expect(page.getByText("私有知识库 Agent")).toBeVisible();
  await expect(page.getByText(/不接入真实私有知识库/)).toBeVisible();

  const draft = page.getByLabel("消息输入框");
  await page
    .getByRole("button", { name: /工具调用连续失败三次/ })
    .click();
  // 示例问题只填输入框，不会自己发出去。
  await expect(draft).toHaveValue(/工具调用连续失败三次/);
  await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled();
});

test("路线 B：问题找人 → 人物卡 → 私聊 → 模拟咨询 → 刷新恢复", async ({ page }) => {
  await enterFromLanding(page);
  await page.getByRole("link", { name: /描述问题找人/ }).click();
  await expect(page).toHaveURL(/\/app\/find$/);

  // ---- 六阶段 Agent 检索 ----
  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();
  await expect(page.locator("[data-step]")).toHaveCount(6);
  await expect(page.locator('[data-step][data-status="done"]')).toHaveCount(6, {
    timeout: 20_000,
  });

  // ---- 结果摘要与三张人物卡 ----
  await expect(page.getByText(/本次找到 3 位有内容证据的人选/)).toBeVisible();
  for (const name of ["林知行", "周屿", "程澈"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "查看证据" })).toHaveCount(3);

  // ---- 证据抽屉：可以键盘关闭 ----
  await page.getByRole("button", { name: "查看证据" }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("内容证据")).toBeVisible();
  await expect(sheet.getByText("边界说明")).toBeVisible();
  await expect(sheet.getByText(/Fixture 演示证据，无真实外链/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // ---- 创建 Conversation 并跳转 ----
  await page.getByRole("button", { name: /与 TA 聊聊/ }).first().click();
  await expect(page).toHaveURL(/\/app\/chat\//);
  await expect(page.getByText(/与 林知行 的虚拟对话/)).toBeVisible();
  await expect(page.getByText(/本页人物卡来自你本次的搜索结果/)).toBeVisible();

  // ---- 用户消息 + Agent 流式回复 ----
  await page.getByLabel("消息输入框").fill("我该先确认哪些事情？");
  await page.getByRole("button", { name: "发送消息" }).click();

  const messageList = page.getByLabel("会话消息");
  await expect(messageList.getByText("我该先确认哪些事情？", { exact: true })).toBeVisible();
  // Agent 气泡必须标注为 AI Agent，并经历「正在生成」→ 服务端完整消息。
  await expect(messageList.getByText("AI Agent", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/以上内容由 Mock Agent 生成/).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/正在生成/)).toHaveCount(0);

  // ---- 咨询：用户申请 → 答主创建方案 → 模拟支付 → 开始咨询 ----
  await page.getByRole("button", { name: /申请付费咨询/ }).click();
  await expect(page.getByText("已申请咨询")).toBeVisible();

  await page.getByRole("tab", { name: /答主视角/ }).click();
  await page.getByRole("button", { name: /创建咨询方案/ }).click();
  await expect(page.getByText("咨询方案待确认")).toBeVisible();

  await page.getByRole("tab", { name: /用户视角/ }).click();
  await page.getByRole("button", { name: /确认方案并模拟支付/ }).click();

  const paymentDialog = page.getByRole("dialog");
  await expect(
    paymentDialog.getByRole("heading", { name: "确认模拟支付" }),
  ).toBeVisible();
  await expect(paymentDialog.getByText(/不会创建真实订单，也不会产生扣款/)).toBeVisible();
  // 模拟支付弹窗不得出现任何真实支付信息字段。
  await expect(paymentDialog.getByText(/银行卡|手机号|身份证/)).toHaveCount(0);
  await paymentDialog.getByRole("button", { name: /确认模拟支付/ }).click();
  await expect(page.getByText("模拟支付完成")).toBeVisible();

  await page.getByRole("tab", { name: /答主视角/ }).click();
  await page.getByRole("button", { name: /开始咨询/ }).click();
  await expect(page.getByText("咨询进行中").first()).toBeVisible();

  // ---- 刷新恢复：业务真相来自 API，刷新后必须还在 ----
  await page.reload();
  await expect(page.getByText(/与 林知行 的虚拟对话/)).toBeVisible();
  await expect(
    messageList.getByText("我该先确认哪些事情？", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/以上内容由 Mock Agent 生成/).first()).toBeVisible();
  await expect(page.getByText("咨询进行中").first()).toBeVisible();

  // ---- reset：整体替换会话与消息 ----
  await page.getByRole("button", { name: /重置/ }).click();
  await expect(page.getByText("免费交流")).toBeVisible();
  await expect(messageList.getByText(/这是虚拟聊天演示/)).toBeVisible();
  await expect(messageList.getByText("我该先确认哪些事情？", { exact: true })).toHaveCount(0);
});

test("问题找人刷新后自动恢复上次结果，摘要信息量不缩水", async ({ page }) => {
  await page.goto("/app/find");
  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();
  await expect(page.getByText(/本次找到 3 位有内容证据的人选/)).toBeVisible({
    timeout: 20_000,
  });

  await page.reload();

  // 结果由 restoreRun 从服务端取回，而不是把结果缓存在浏览器里。
  await expect(page.getByText(/本次找到 3 位有内容证据的人选/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("已应用授权上下文")).toBeVisible();
  await expect(page.getByText(/分析 \d+ 条内容/)).toBeVisible();
  await expect(page.getByText(/问题理解阶段降级为确定性规则模型/)).toBeVisible();
  // 输入框里还留着当时的问题，可以直接改一改再搜。
  await expect(page.getByLabel("你现在想找什么样的人？")).toHaveValue(QUERY);
});

test("布局在桌面、平板与移动视口都不出现横向溢出", async ({ page }) => {
  // 三种验收尺寸都在同一个用例里跑，比开三个 project 更省时间，也更容易定位是哪一档出问题。
  const viewports = [
    { name: "桌面 1440×900", width: 1440, height: 900 },
    { name: "平板 1024×768", width: 1024, height: 768 },
    { name: "移动 390×844", width: 390, height: 844 },
  ];
  const routes = ["/", "/app", "/app/fields", "/app/fields/agent-development", "/app/find"];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();

      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflow, `${viewport.name} 下的 ${route} 出现了横向溢出`).toBeLessThanOrEqual(1);

      // 主要操作在每个尺寸下都必须真的可点，而不是被别的元素盖住。
      if (route === "/app/find") {
        const start = page.getByRole("button", { name: /开始找人/ });
        await expect(start).toBeVisible();
        await expect(start).toBeEnabled();
      }
    }
  }
});

test("窄屏下领域星图降级为卡片，人物仍可点开名片", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/fields/agent-development");

  const cards = page.getByTestId("field-graph-cards");
  const canvas = page.getByTestId("field-graph-canvas");

  await expect(cards).toBeVisible();
  await expect(canvas).toBeHidden();

  await cards.getByRole("button", { name: /查看人物/ }).first().click();
  await expect(page.getByRole("dialog").getByText("领域关联")).toBeVisible();
  // 星图默认带缩放与拖拽，窄屏下不应该把页面撑出横向滚动条。
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("未发送的草稿在刷新后仍在，发送后清空", async ({ page }) => {
  await page.goto("/app/find");
  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();
  await expect(page.getByText(/本次找到 3 位有内容证据的人选/)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /与 TA 聊聊/ }).first().click();
  await expect(page.getByText(/与 林知行 的虚拟对话/)).toBeVisible();

  await page.getByLabel("消息输入框").fill("还没发出去的草稿");
  await page.reload();

  await expect(page.getByLabel("消息输入框")).toHaveValue("还没发出去的草稿");

  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(/以上内容由 Mock Agent 生成/).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.reload();
  await expect(page.getByLabel("消息输入框")).toHaveValue("");
});

test("桌面聊天栏固定在首屏高度内，消息区独立滚动", async ({ page }) => {
  await page.goto("/app/find");
  await page.getByLabel("你现在想找什么样的人？").fill(QUERY);
  await page.getByRole("button", { name: /开始找人/ }).click();
  await expect(page.getByText(/本次找到 3 位有内容证据的人选/)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /与 TA 聊聊/ }).first().click();
  await expect(page.getByText(/与 林知行 的虚拟对话/)).toBeVisible();

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector("[data-testid='chat-panel']");
    const messages = document.querySelector("[aria-label='会话消息']");
    if (!(panel instanceof HTMLElement) || !(messages instanceof HTMLElement)) {
      throw new Error("聊天面板或消息列表不存在");
    }
    const panelRect = panel.getBoundingClientRect();
    const grid = panel.parentElement;
    return {
      panelBottom: panelRect.bottom,
      panelHeight: panelRect.height,
      messageOverflowY: getComputedStyle(messages).overflowY,
      messageMinHeight: getComputedStyle(messages).minHeight,
      gridAlignItems: grid ? getComputedStyle(grid).alignItems : "",
    };
  });

  expect(metrics.panelBottom).toBeLessThanOrEqual(900);
  expect(metrics.panelHeight).toBeLessThanOrEqual(760);
  expect(metrics.messageOverflowY).toBe("auto");
  expect(metrics.messageMinHeight).toBe("0px");
  expect(metrics.gridAlignItems).toBe("flex-start");

  const consultationCard = page
    .locator("[data-slot='card']")
    .filter({ hasText: "付费咨询" })
    .first();
  const privateAgentCard = page
    .locator("[data-slot='card']")
    .filter({ hasText: "私有知识库 Agent" })
    .first();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const [consultationBox, privateAgentBox] = await Promise.all([
    consultationCard.boundingBox(),
    privateAgentCard.boundingBox(),
  ]);

  expect(consultationBox).not.toBeNull();
  expect(privateAgentBox).not.toBeNull();
  expect(consultationBox!.y + consultationBox!.height).toBeLessThanOrEqual(
    privateAgentBox!.y + 1,
  );
});

test("功能首页两个蓝色入口按钮在桌面端对齐", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "移动端入口卡片按列展示");
  await page.goto("/app");

  const fieldsLink = page.getByRole("link", { name: /浏览专业领域/ });
  const findLink = page.getByRole("link", { name: /描述问题找人/ });
  await expect(fieldsLink).toBeVisible();
  await expect(findLink).toBeVisible();

  const [fieldsBox, findBox] = await Promise.all([
    fieldsLink.boundingBox(),
    findLink.boundingBox(),
  ]);

  expect(fieldsBox).not.toBeNull();
  expect(findBox).not.toBeNull();
  expect(Math.abs(fieldsBox!.y - findBox!.y)).toBeLessThanOrEqual(1);
});
