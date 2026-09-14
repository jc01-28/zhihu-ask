# 代码结构

纯前端工程，唯一职责是「把服务端状态讲清楚，把用户动作翻译成契约请求」。

本文件描述**代码放在哪里、依赖朝哪个方向流动、为什么这么切**。
功能行为（用户看到什么、点了会发生什么）见 `FRONTEND_WORKFLOW.md`，接口细节见 `API_CONTRACT.md`。

---

## 1. 四层边界

```text
src/
├─ app/main.tsx          Vite 唯一启动入口：导入样式 → 导入 App → createRoot
├─ back/                 后端实现（本仓库与后端同学共用，前端不往里写任何东西）
├─ front/                全部浏览器前端实现
└─ shared/contracts/     前后端共同遵守的公开契约（只有 Zod Schema 与常量）
```

### 检查范围：只守前端自己拥有的文件

本仓库是前后端共用的：`src/back/` 是后端的地盘，`src/app/` 与 `src/shared/` 里也可能有后端放的东西。
所以边界守卫**不去枚举这些目录下的每一个文件**，只检查前端拥有的三处：

- `src/front/**`（全部）；
- `src/app/main.tsx`（前端唯一的启动入口）；
- `src/shared/contracts/**`（前后端共享、会随前端进浏览器的公开契约）。

`src/front` 之外的内容归后端，我们不替别人定目录规矩。**这不是放松要求**：`src/front` 的规则一条没少，
而 `src/shared/contracts/` 的纯度检查对谁写的文件都成立——它是安全性，不是归属权。

> 这条范围是踩过坑之后改的。原先的规则里有「`src/back` 下只能有 `.md`」这类**按目录归属**的判定，
> 在单人前端仓库里成立；一旦后端在 `src/back/` 写了实现，`pnpm run check` 就会当场变红——
> 等于我们用检查脚本替后端定了目录规矩。

六条规则由 `scripts/check-boundaries.mjs` 静态检查，并作为 `pnpm run check` 的第一道门：

| 规则 | 检查内容 | 违反后果 |
|---|---|---|
| `server-leak` | 前端拥有的代码不得出现 `next/`、`drizzle`、`cloudflare:workers`、密钥名、`localStorage.clear` | 服务端实现细节渗进浏览器包 |
| `direct-fetch` | `src/front/{pages,features,components}` 不得出现 `fetch(` | 绕过契约校验与 401 收敛点 |
| `contract-purity` | `src/shared/contracts/` 下只能是 kebab-case `.ts`，且不得依赖 React、不得读环境变量 | 契约被污染成前端工具，或读到浏览器里不存在的值 |
| `app-entry` | `src/app/main.tsx` 必须存在（不限制该目录下的其他文件） | 启动入口丢失 |
| `boundary-doc` | `docs/BACKEND_BOUNDARY.md` 必须存在，且声明不下发 `ZHIHU_ACCESS_SECRET`、`APP_SESSION_SECRET` | 后端边界失守且无人察觉 |
| `creator-routing` | `src/front/{pages,app}` 不得把 `creatorId` 当作聊天路由参数 | 会话必须用 `conversationId` 标识 |

`src/front` 内部的分层：

```text
src/front/
├─ app/            ApiProvider（只有组件）+ api-context（Context 与 hook）+ router + App 外壳
├─ pages/          只做装配：取 session、组合 feature、决定页面级状态呈现
├─ features/       按业务切分的实现（auth / portal / fields / field-graph /
│                  search / creator / compare / chat / consultation / private-agent）
├─ components/     layout（PageStates、AppHeader）与 ui（无业务语义的基础件）
├─ api/            ApiClient 接口 + HTTP/Mock 实现 + ApiError + NDJSON 解析
├─ mocks/          确定性演示数据（无 Math.random）
├─ shared/         纯前端工具：cn、format-money、storage、motion、entry-links
├─ styles/         globals.css（Tailwind 主题变量与 keyframes）
└─ types/          浏览器侧的全局类型补充（如 WebMCP 的 document.modelContext）
```

依赖方向严格单向：

```text
pages → features → (api | components | front/shared | shared/contracts)
api   → shared/contracts + mocks        （api 不依赖 features）
shared/contracts → 只依赖 zod           （不依赖任何运行时、不依赖 React）
components/ui → 只依赖 front/shared/cn  （不含业务语义）
```

### 为什么 `pages` 不直接 `fetch`

网络访问只有 `src/front/api` 一个出口。好处是：

1. 换后端只改一个目录；
2. 契约校验无法被绕过；
3. 401 收敛到一处（`useRefreshSession`），不会出现十个组件各自判断；
4. 组件测试可以直接注入 `MockApiClient`，不需要网络拦截。

### 为什么 `src/shared` 只有契约

前后端双方都要理解的东西才配放在 `src/shared`。`cn.ts`、`storage.ts`、`motion.ts` 只有浏览器能用，放进 `src/shared` 会让后端误以为它们也是约定的一部分。

---

## 2. 路由

```text
/                             项目推荐页（不请求任何业务 API）
/app                          未授权 → 授权页；已授权 → 功能首页
/app/fields                   专业领域目录
/app/fields/:fieldId          领域星图
/app/find                     问题找人
/app/chat/:conversationId     虚拟私聊
/chat/:conversationId         旧地址，重定向到 /app/chat/:conversationId
*                             404
```

`/app` 以下由 `RequireAuth` 统一门禁：它把「加载中 → 骨架」「读不到 session → 带重试的错误面板」「未授权 → AuthGate」「已授权 → render prop 传 session」四件事收在一处，页面不再各自判断。

---

## 3. 依赖注入

```tsx
// src/front/app/App.tsx
<ApiProvider client={client}>
  <RouterProvider router={router} />
</ApiProvider>
```

`ApiProvider` 持有：

| 值 | 用途 |
|---|---|
| `client: ApiClient` | 由 `createApiClient()` 决定 Mock 还是 HTTP |
| `authEpoch: number` | 401 时自增，带动所有依赖它的 effect 重新取数 |
| `refreshSession()` | API 层统一调用的「授权失效」回调 |

`useApiClient()` / `useAuthEpoch()` / `useRefreshSession()` 是组件唯一的取用方式。组件**不读环境变量判断模式**，因此 Mock 与真实后端的行为差异被限制在 `createApiClient()` 一处。

`ApiProvider` 还接受一个可选的 `client` prop，测试直接注入 `MockApiClient` 实例。

**Context 与 hook 在 `app/api-context.ts`，`ApiProvider.tsx` 只导出组件。** 拆开有两个理由：

- 只取 hook 的模块（`useFields` / `usePersonSearch` / `useConversation` / …）不必把 Provider 组件拖进自己的依赖图；
- 组件与非组件混在一个文件里会让 Fast Refresh 退化成整页刷新（`react-refresh/only-export-components`）。拆开之后改 hook 不再连带刷新整个应用壳。

因此新写「取 ApiClient 的 hook」时，`import` 要从 `@/front/app/api-context` 取，不要从 `ApiProvider`。`App.tsx` 与 `tests/test-utils.tsx` 是仅有的两个从 `ApiProvider` 取**组件**的地方。

### 模式解析

```ts
resolveApiMode()          // VITE_API_MODE === "live" ? "live" : "mock"
createApiClient(options)  // 唯一的模式分支点
```

Mock 模式额外支持两个 URL 开关（仅演示与 E2E 使用，真实模式忽略）：`?mock_auth=` 与 `?mock_scenario=`。
**它们只在页面启动时读一次**：重新 `goto` 才能换场景，页内跳转不会改变已构造的客户端。

---

## 4. 状态归属

| 状态 | 归属 | 前端处理 |
|---|---|---|
| 输入、草稿、选中筛选、弹层开关 | 前端 | React state；只缓存草稿与视角偏好 |
| Loading / Error / sending / streaming | 前端 | 由请求生命周期驱动 |
| Agent 搜索六阶段 | 后端发事件 | 只显示服务端上报过的阶段，不伪造完成 |
| 当前用户与授权状态 | 后端 | `GET /api/auth/session` |
| 搜索运行与人物卡 | 后端 | `run.completed` 或 `restoreRun` 才写入 |
| 领域 / 议题 / 星图人物 | 后端 | 不做本地排序以外的加工 |
| Conversation / Message / Consultation | 后端 | 前端只缓存发送中的临时项 |
| Agent 对话回复 | 后端 | `delta` 只做增量展示，完成消息以服务端 `Message` 为准 |
| 私有知识库展示 | 前端夹具 | 纯展示，不调用任何接口 |

原则：**前端可以有临时项，但不能有第二份业务真相。**
星图节点的坐标是唯一例外——它由前端纯函数推导（后端只下发议题坐标），因此必须确定性，见 `graph-layout.ts`。

---

## 5. 三个状态机

### 5.1 搜索：`personSearchReducer`

`src/front/features/search/search-state.ts`

```text
idle ──run──▶ running ──run.completed──▶ done
                 │      └─run.restored──▶ done（刷新恢复，不重放动画）
                 ├──run.failed──▶ error ──retry──▶ running
                 └──cancel─────▶ idle
```

- `status: idle | running | done | error`；
- 每个阶段 `waiting | running | done`，**只由** `step.started` / `step.completed` 驱动；
- 未知阶段或缺少 `message` 的事件被直接丢弃，保证界面不会显示服务端没报过的步骤；
- 每次搜索创建新的 `AbortController`；开始新搜索先取消旧的；
- 取消后不显示错误红条（取消 ≠ 失败）；
- `run.restored` 用于刷新恢复，六个阶段按「已完成」呈现，但不伪造逐阶段文案。

### 5.2 消息：`conversationItemsReducer`

`src/front/features/chat/conversation-state.ts`

`ChatItem` 与服务端 `Message` 的差别只有两点：**临时状态**（`sending` / `failed`）与**流式标记**。

```text
pending.user ──agent.run.started──▶ user.confirmed（服务端 Message 原子替换）
pending.agent ──agent.message.started──▶ id 换成服务端 messageId
              ──agent.message.delta────▶ 追加内容
              ──agent.message.completed▶ 服务端完整 Message 原子替换
              ──agent.run.failed───────▶ 全部 sending 项标记 failed
              ──取消───────────────────▶ 丢弃未成型的 Agent 气泡
```

去重规则（`withoutDuplicates`）：同 `id` 视为重复；同 `clientMessageId` **且同发送方**视为临时项被确认。

为什么要比较发送方：Agent 的临时气泡与它对应的用户消息**共用同一个 `clientMessageId`**。只按 `clientMessageId` 去重会在用户消息确认时把正在生成的 Agent 气泡一起删掉。

另外，临时用户气泡必须带着真实角色创建（`sender: "seeker" | "creator"`）。答主演示消息确认回来时 `sender=creator`，如果临时项固定写成 `seeker`，去重就匹配不上，界面会出现两条一样的消息。

`item.discarded` 只对 `local:` 前缀的临时项生效——**已经保存到服务端的消息永远不能从前端删除**。

### 5.3 领域查询：`useFields` 的双线状态

`src/front/features/fields/useFields.ts` 刻意维护两条**互不影响**的状态线：

- `featuredState`：推荐领域（页面打开时取一次）；
- `listState`：用户主动检索的结果。

检索失败不清空推荐领域——否则用户输入一个没见过的词，会得到一个比打开页面时更空的页面。

---

## 6. NDJSON

`src/front/api/ndjson.ts` 的 `parseNdjsonStream({ response, schema, onEvent, signal, isTerminal })`：

- 用 `TextDecoder` 逐块解码，跨 chunk 的残行留在 buffer 里；
- 空行跳过；单行解析失败或 Schema 不通过 → 丢弃该行（流里的脏行不能污染整个结果）；
- 遇到终态事件（`isTerminal`）立即结束读取，不等连接关闭；
- 流结束但没有终态 → 抛 `INCOMPLETE_STREAM`；
- 监听 `signal.abort`，取消时 `reader.cancel()`，并且在 `finally` 里移除监听。

`HttpApiClient` 与 `MockApiClient` 都只用这套语义：Mock 通过回调逐个 `emit`，真实实现由 `HttpApiClient` 解析。

---

## 7. 错误处理

| 层次 | 责任 |
|---|---|
| `HttpApiClient` | 解析错误信封 → `ApiError`；状态码兜底映射（400/401/403/404/409/429/503） |
| `ApiClient` 消费者（feature） | 转成页面的错误态，决定「重试 / 回退 / 提示」 |
| `ApiProvider` | 401 → `refreshSession()` → `authEpoch++` → 受保护页面回到 AuthGate |
| 页面 | 呈现错误，并保证**一定有一个可执行动作**（重试 / 返回目录 / 返回找人 / 重新授权） |

取消与失败严格区分：`isAbortError()` 为真时只清理本地临时状态，不写错误信息。

「不可重试」和「可重试」必须分开：

- 404（领域不存在、会话不存在）不给重试按钮——重试必然还是 404，给了反而是误导；
- 可重试错误（限流、503、流中断）必须给重试按钮。

---

## 8. 视觉与动效

- 视觉基线：知乎蓝白（`--primary: #056de8`）、白卡片、浅灰底、圆角与细边框，全部是 `globals.css` 里的 CSS 变量；
- **领域主题色只能来自白名单**：契约层 `FIELD_COLOR_TOKENS` 限定 8 个 token，`field-theme.ts` 把它们映射到字面量 Tailwind 类，`graph-theme.ts` 映射到固定色板。服务端无法下发任意 CSS 或任意类名；
- 图标同理：`field-theme.ts` 的 `ICONS` 是名称白名单，未知名称回退到 `Layers`；
- 不引入 Framer Motion 一类动画库，全部用 CSS keyframes（`card-enter` / `node-enter` / `edge-enter`）。

### 减少动效

只压 `animation-duration` 是不够的：星图的分层入场靠 `animation-delay`，延迟还在的话节点会先隐形再逐个闪现，反而比不做动画更糟。因此两处同时归零：

1. `@media (prefers-reduced-motion: reduce)` 里压时长**并**把 delay 归零；
2. `src/front/shared/motion.ts` 的 `motionDelay()` 在偏好为真时直接返回 0，`useReducedMotionAttribute()` 把 `data-reduced-motion` 写到 `<html>`，CSS 里另有一组 `[data-reduced-motion="true"]` 规则兜底（部分嵌入式 WebView 的媒体查询不可靠）。

`matchMedia` 缺失时按「不减弱」处理，与 CSS 默认行为一致。

---

## 9. 存储边界

`src/front/shared/storage.ts` 只允许 `zhihu-wenren:frontend:v1:` 前缀下的 key：

| key | 存储 | 内容 |
|---|---|---|
| `searchDraft` | localStorage | 搜索输入草稿 |
| `messageDraft:<conversationId>` | localStorage | 未发送的聊天草稿 |
| `viewerRole` | localStorage | 用户/答主视角偏好 |
| `lastSearchRun` | sessionStorage | 「最近一次搜索运行」的**指针**（runId + 查询词） |

- 前缀之外的 key 读不到也写不进；
- 从不调用 `localStorage.clear()`；`clearOwnKeys()` 也只删自己前缀下的 key；
- 空草稿等于没有草稿：写空串会被翻译成删除 key，避免刷新后出现「存了一个空串」的中间态；
- **不保存** Conversation、Message、Consultation、Token 或完整人物结果作为业务真相。

`lastSearchRun` 存的是指针而不是结果：人物卡、证据与相关度的真相永远在服务端，刷新时再用 `restoreRun` 换一次。
用 sessionStorage 而不是 localStorage，是因为运行记录本身按会话过期，跨浏览器会话留着一个必然 404 的 runId 只会白费一次请求。三处会主动清掉这个指针：开始新搜索、选中示例问题、恢复失败。

Mock 后端自己另有一份镜像：`zhihu-wenren:mock-backend:v1`（sessionStorage）。它模拟的是「服务端」，不是前端缓存——正因为有它，刷新页面才能演示恢复流程。

---

## 10. 可访问性与响应式

- 所有 Dialog / Sheet 继承 Radix 行为：`Escape` 关闭、焦点陷阱、`aria-labelledby`；
- 错误使用 `role="alert"`，加载使用 `role="status"`（骨架屏本身 `aria-hidden`，但旁边一定有一个 sr-only 的状态文本）；
- 图标按钮都有 `aria-label`（如「发送消息」「停止生成」「放大星图」「关闭」）；
- 星图人物节点在桌面 SVG 与窄屏卡片里使用**同一个可访问名**（`查看人物 X，headline`）——同一个动作不该因为断点而改名；
- 筛选 chip 用 `aria-pressed` 表达选中，用完整的 `aria-label` 承载人数（`筛选 任务规划与分解（3 人）`）；
- 布局在 1440×900 / 1024×768 / 390×844 都不出现横向溢出；
- 窄屏（< 768px）星图降级为按议题分组的头像卡片，不强行显示完整星图；
- **任何非交互元素（`div` / `span` / `li` …）都不承载 `onClick`**：要做成可点的东西，就用 `<button>` / `<a>` / `Link`。全库扫描这个模式是空的，新增组件时要保持。

### 样式化的链接必须用 `Button asChild`，不要在 `<a>` 里嵌 `<button>`

写「看起来像按钮的外链」时，唯一正确的形态是：

```tsx
<Button asChild variant="outline">
  <a href={url} target="_blank" rel="noopener noreferrer">
    <ExternalLink /> 在知乎搜内容
  </a>
</Button>
```

反过来写（`<a><Button>…</Button></a>`）在视觉上完全一样，但语义是错的：可交互内容不能嵌套可交互内容。读屏会把它报成「链接里还有一个按钮」，键盘用户会遇到两个都要 Tab 的节点，而它们其实是同一个动作。`CompareDialog` 曾经两处这么写，因为「看起来正常」而一直没有被发现——所以新增外链按钮时请直接抄上面的形态。

### 一个只有真实浏览器能发现的坑

星图的缩放/拖拽用 `setPointerCapture` 实现。曾经在 `pointerdown` 里就捕获指针，结果是：**浏览器会把随后合成的 `click` 重定向到被捕获的 `<svg>`，`<g>` 上的 onClick 永远不触发**——鼠标点人物头像毫无反应。

`jsdom` 里的 `userEvent.click` 直接派发 click 事件，不经过指针捕获，所以单元测试全绿也发现不了。
现在的做法是：位移超过 `DRAG_THRESHOLD`（4px）才捕获，并在 `tests/features/field-graph.test.tsx` 里断言「按下即抬起不会捕获指针」。

---

## 11. 测试策略

| 层 | 文件 | 断言什么 |
|---|---|---|
| 契约 | `tests/contracts/contracts.test.ts`、`field-contracts.test.ts` | strict 拒绝多余字段、范围校验、非法 URL、非法枚举、非法领域色 token |
| 流解析 | `tests/api/ndjson.test.ts` | 跨 chunk 拆行、脏行丢弃、终态提前结束、中断报错、取消 |
| HTTP（假 fetch） | `tests/api/http-api-client.test.ts` | `credentials`、错误信封、状态兜底、Schema 校验、会话探测的 401 不触发全局刷新 |
| HTTP（真实 socket） | `tests/api/http-api-client.integration.test.ts` | 自起 `node:http` 服务器：跨 chunk 与跨汉字字节重组、终态即返回、取消中断 socket、掐断收敛为 `ApiError`、契约在真实响应上生效 |
| Mock 后端 | `tests/api/mock-api-client.test.ts`、`field-api-client.test.ts` | 幂等、状态机、场景开关、确定性、人物找不到时抛 404 而不是兜底 |
| UI 基础件 | `tests/features/ui-components.test.tsx` | 变体、可访问名称、键盘关闭 |
| 领域目录 | `tests/features/field-directory.test.tsx`、`field-search.test.ts` | 推荐/检索双线、空结果、检索失败保留推荐 |
| 星图布局 | `tests/features/graph-layout.test.ts` | 纯函数确定性、坐标裁剪、缺失议题归入「其他」 |
| 星图交互 | `tests/features/field-graph.test.tsx` | 筛选、名片、外链、键盘、指针捕获时机、404 与失败重试 |
| 人物名片 | `tests/features/creator-card.test.tsx`、`creator-detail.test.tsx` | 两个来源的展示差异、不虚构证据、外链与空主页 |
| 搜索 | `tests/features/person-search.test.tsx` | 六阶段、长度边界、停止、重试、断流、刷新恢复、指针失效 |
| 结果与对比 | `tests/features/creator-results.test.tsx`、`compare-dialog.test.tsx` | 卡片、证据、空结果、Fixture 标注、只读按钮、外链不嵌套按钮、Escape 关闭 |
| 导航 | `tests/features/conversation-navigation.test.tsx` | 建会话跳转、重复点击、错误重试 |
| 聊天 | `tests/features/chat-messages.test.tsx` | 快照、分页、角色、失败保留、去重 |
| Agent 流 | `tests/features/agent-conversation-stream.test.tsx` | 增量→完成替换、中断、取消、重试幂等 |
| 私有 Agent | `tests/features/private-agent.test.tsx` | 三态推导、示例问题不重名、只填输入框不发请求 |
| 咨询 | `tests/features/consultation.test.tsx` | 五阶段、409 回正、套餐失败、金额格式化、弹窗 Escape 关闭且关掉不推进状态 |
| 路由与鉴权 | `tests/pages/auth-routing.test.tsx`、`landing-page.test.tsx`、`portal-page.test.tsx`、`app-smoke.test.tsx` | 门禁、404、401、推荐页不请求业务 API、五条主路由都能挂载 |
| 恢复 | `tests/pages/recovery-states.test.tsx` | loading、503 重试、reset 成功/失败、草稿落盘 |
| 动效与可访问性 | `tests/pages/responsive-accessibility.test.tsx` | 减少动效开关、延迟归零、窄屏可用、Escape 关闭、恢复动作在场 |
| E2E（mock） | `tests/e2e/main-flow.spec.ts`、`error-recovery.spec.ts`、`fixtures.ts` | 两条主链路贯通 + 每条错误路径都有恢复动作 + 零控制台错误 |
| E2E（live） | `tests/e2e-live/live-mode.spec.ts` | 真实浏览器 + 真实服务器：契约在真实响应上拒绝退化数据、进度逐条到达、刷新走 `restoreRun`、会话探测不成风暴 |

### 为什么要有「真实 socket」这一层

`tests/api/http-api-client.test.ts` 注入的是假的 `fetchImpl` 与假的 `Response`。它能验证「拿到这个响应之后怎么处理」，但**验证不了任何与真的走网络有关的事**：chunk 边界、多字节字符被切开、连接被掐断、终态之后连接还挂着。所以另有 `http-api-client.integration.test.ts`：它自己起一个 `node:http` 服务器（随机端口，避免和本机服务打架），把逐字节切开的 NDJSON 打进去 —— 切点包含**一个汉字的 3 字节中间**。

### live 模式查出的三个 bug

这三条 mock 模式永远碰不到，`pnpm test` 与 `pnpm run test:e2e` 都全绿：

1. **会话探测死循环**。`GET /api/auth/session` 返回 401 时，`HttpApiClient.send()` 也会调 `onUnauthorized`；而 `useAuthSession` 的 effect 依赖 `authEpoch`，于是 401 → `authEpoch++` → 会话探测重跑 → 又是 401。实测 3 秒内 **652 次**请求。修法：`requestJson` 增加 `refreshOnUnauthorized`，会话探测传 `false` —— 它自己的 401 就是答案本身，不是「会话过期了」这个事件。
2. **底层传输错误漏给界面**。流推到一半被掐断时 `reader.read()` 抛 `TypeError: terminated`（浏览器是 `Failed to fetch`），它没被收敛成 `ApiError`，`usePersonSearch` 把 `error.message` 原样显示，界面上出现一句英文技术错误。修法：`parseNdjsonStream` 里把读失败包装成 `ApiError(NETWORK_ERROR, retryable)`，同时保留取消语义（`signal.aborted` 时仍抛 `AbortError`）。
3. **错误信封的 `details` 整条丢光**。`apiErrorEnvelopeSchema` 是 `.strict()`，`details` 没有被声明；`HttpApiClient.send()` 也从未把它转进 `ApiError`。于是服务端带 `details` 的咨询 409 会让**整个信封**解析失败，`code` 退化按状态码推断成 `CONFLICT`；`useConversation` 里 `consultationSchema.safeParse(caught.details)` 那句回正逻辑因此永不成功。修法：契约补 `details: z.unknown().optional()`，`send()` 补透传。

第 3 条和第 1、2 条是同一类但更隐蔽：前两条会**报错**（请求风暴、英文错误文案冒到界面上），第 3 条不报错、只是**安静地不生效**；而且 `MockApiClient` 是直接 `new ApiError(...)`，从不经过信封解析，所以 mock 模式与当时全部 258 个单测都照不到它。补 3 条回归后还做了反向验证：临时删掉契约里的 `details` 声明，两条新用例如期变红。

回归写法也刻意挑了不怕抖的形式：会话探测那条断言「2.5 秒内请求数不再增长」而不是锁死次数（StrictMode 会把 effect 跑两遍）；NDJSON 那条断言「必须是 `ApiError` 且 message 不含 `terminated` / `fetch`」；`details` 那两条断言「`code` 是精确码而不是退化的 `CONFLICT`」与「信封里的未声明字段不被静默吸收」。

E2E 的 `page` fixture（`tests/e2e/fixtures.ts`）会在用例结束时断言三件事为零：`pageerror`、`console.error`、非主动取消的 `requestfailed`。「浏览器控制台没有运行错误」这条要求靠人工看是看不住的，交给 fixture 才可复现。

浏览器会把自己收到的 4xx/5xx 也记成 `console.error`，所以**刻意**验证失败分支的用例必须显式放行对应状态码：`createTest({ allowedHttpStatuses: [401, 404, 503] })`。默认的 `test` 不放行任何状态码 —— 若让整个文件统一放行，连静态资源 404 都会被一起放过。

测试注入方式是 `ApiProvider` 的 `client` prop，配合 `tests/test-utils.tsx` 的 `createTestClient` / `renderApp` / `seedConversation`。
`renderApp` 默认路由是 `/app/find`（授权之后的主界面）；项目推荐页与功能首页的用例显式传入 route。
Mock 客户端在测试里传 `persist: false`，避免用例之间通过 sessionStorage 互相污染。

---

## 12. 落地时与计划不一致的地方

以下内容在实施时新增或调整，均已在本工程内自洽：

| 项 | 说明 |
|---|---|
| `src/shared/contracts/url.ts` | 新增。计划里 URL 字段写的是 `z.string().url()`，但它会放行 `javascript:` / `data:`，这些值会进 `<img src>`、`<a href>`。统一换成 https 白名单校验 |
| `FIELD_COLOR_TOKENS` / `ICONS` 白名单 | 新增。计划只要求「领域主题色」，直接透传服务端字符串等于开放任意 CSS / 任意路径的注入面 |
| `src/front/shared/motion.ts` | 新增。计划说「用 CSS 或 `data-reduced-motion`」，落地时两者都做了：CSS 压不住 `animation-delay`，必须由 JS 归零 |
| `lastSearchRun` 指针 | 新增。计划要求「刷新恢复」但没规定结果放哪。存指针 + `restoreRun` 保证业务真相仍在服务端 |
| `restoreRun` 响应补全摘要字段 | 扩展。原本只返回 cards 与计数，缺 `modelFallback`、`contextSourceCounts`、`background` 等；前端要么伪造要么丢信息，因此让服务端一次给全 |
| `.npmrc` + `pnpm-workspace.yaml` | 新增。Windows 上 pnpm 默认符号链接布局会失败，固定 `nodeLinker: hoisted`。不影响依赖版本 |
| `agent.cancelled` | 新增的 reducer action。计划只写了「取消只影响当前请求，不删除已保存消息」；临时 Agent 气泡不属于已保存消息，取消时丢弃比标红更贴近用户意图 |
| Mock URL 开关 | 新增 `?mock_auth=` / `?mock_scenario=`。计划要求 E2E 覆盖未授权与各失败分支，而 env 变量在 dev server 启动时就固定了 |
| `consultation-conflict` / `field-search-failed` / `field-graph-missing` 场景 | 新增 Mock 场景。正常点击路径不可能产生 409 / 领域检索失败 / 星图 404，E2E 需要能真实穿过 `ApiClient` 的错误来源 |
| 中断场景只在最后一个分片之前断 | `agent-stream-truncated` 不再把尾句送完就抛错。真实的连接断开不会把最后一个分片也送达，这样「半截回复不落库」才是可验证的 |
| Playwright 两个 project | 桌面 1440×900 与移动 390×844 各跑一遍；1024×768 在用例内用 `setViewportSize` 覆盖，避免为第三种尺寸重跑全部用例 |
| `playwright.config.ts` 直连 `node ./node_modules/vite/bin/vite.js` | 避免依赖 `node_modules/.bin`，在本机的 hoisted 布局下更稳 |
| `FieldsPage` / `ResultSummary` 未按 Task 6 改动 | 计划把这两个文件列进了「统一人物名片」的范围，但它们都不承载人物数据：领域卡片按设计不展示人物头像（Task 4 Step 3），结果摘要只讲一次运行的元信息。改它们只会引入无意义的改动 |
| 星图交互修正 | `setPointerCapture` 从 `pointerdown` 移到「位移超过阈值」时才调用。原写法让真实浏览器里的鼠标点击完全失效，详见第 10 节 |
| 文档改名 | 计划 Task 10 要求 Create `docs/CODE_STRUCTURE.md` 与 `docs/FRONTEND_WORKFLOW.md`，而这两份内容此前已在 `docs/FRONTEND_ARCHITECTURE.md` / `docs/WORKFLOWS.md` 里。直接改名而不是复制一份，避免同一个主题出现两份会各自过期的说明 |
| `docs/PRIVATE_AGENT_SCOPE.md` | 新增。计划把这个文件名列进了 Task 10 的 Files，但没写内容要求。私有 Agent 最容易被误解成「已经接了 RAG」，因此单开一份把「它没有真实能力」讲清楚，并写明将来接后端要补什么 |
| 边界守卫 6 条规则 | 计划只给了三条人工 `grep` 命令。落地时把同样的判断写成 `scripts/check-boundaries.mjs` 并挂在 `pnpm run check` 首位——人工命令会忘，脚本不会 |
| E2E 断言改用精确匹配 | `getByText("内容证据")` 会被领域分支说明句里的「没有经过逐条核验的内容证据」子串命中，导致「区块不存在」被误判成存在。断言的意图是「没有那条标题级区块」，所以用 `{ exact: true }` 锁定标题本身 |
| 减少动效 E2E 按断点选作用域 | 移动端星图走卡片视图（`md:hidden`），SVG 容器是 `display:none`，在其中等可见性永远等不到。改为按断点断言可见的那个视图，节点延迟仍从 SVG 读——它在 DOM 里，内联 `animation-delay` 照样可读，两个 project 因此能共用同一段断言 |
| E2E 跑动期间不要改 `src/` | 实测过：在 Playwright 执行过程中修改 `src` 下的文件会触发 Vite 整页热重载，把当时正在跑的用例打断成 `Execution context was destroyed, most likely because of a navigation`。这不是产品问题，重跑即可；跑验收时应冻结 `src/` |
| live 模式与桩服务器 | 新增。计划里 `VITE_API_MODE=live` 一直存在，但没有任何东西验证它——mock 模式不经过网络，`test:e2e` 也只跑 mock。新增 `scripts/live-stub-server.mjs`（读路径 + 检索流）、`.env.live`、`playwright.live.config.ts` 与 `tests/e2e-live/live-mode.spec.ts`，把这条链路真正跑起来。桩刻意不实现会话与咨询：那两处带真实状态机，桩里再写一遍就变成「第三套后端」，验证的是桩而不是前端 |
| 桩的分支开关放在 `/api/__stub/` 下 | 走既有 `/api` 代理，不需要为测试改 `vite.config.ts` 的代理表；命名上也能一眼看出「真实后端不会有这些路由」 |
| `playwright.live.config.ts` 用 `--mode live` 而不是注入进程环境变量 | 让 Vite 读 `.env.live`。`.env.local` 的存在会改变进程环境变量与 `.env` 文件的优先级落点，靠 env 注入是隐式依赖；`.env.live` 同时也是一个直接可用的开发者入口（`pnpm dev:live`） |
| live E2E 的「数据来自后端」靠请求记录断言 | 不靠界面文案，也不靠「名字看起来不像 mock 数据」。桩暴露 `GET /api/__stub/requests`，用例直接查「页面渲染出这个名字时，服务端是否真的收到了对应请求」 |
| E2E 的 console 守卫增加状态码放行 | 浏览器会把 4xx/5xx 也记成 `console.error`，mock 模式从不返回真实失败状态所以以前不需要。新增 `createTest({ allowedHttpStatuses })`，只给**刻意**验证失败分支的用例放行，默认仍不放行任何状态码 |
| 边界守卫改为「只守前端拥有的文件」 | 本工程要与后端同学共用同一个仓库（`src/back` 归后端），原先 `back-scope` / `app-scope` / `shared-scope` 三条规则是按**目录归属**判定的——后端只要在 `src/back` 里写实现文件，`pnpm run check` 立刻变红。现改为只检查 `src/front/**`、`src/app/main.tsx`、`src/shared/contracts/**`，规则相应改名为 `server-leak` / `direct-fetch` / `contract-purity` / `app-entry` / `boundary-doc` / `creator-routing`。已用临时探针文件双向验证：后端地盘放文件 exit 0，前端四条违规全部命中 exit 1 |
| `src/back/README.md` → `docs/BACKEND_BOUNDARY.md` | 移动。共享仓库里 `src/back/` 是后端的地盘，把「后端职责清单 + 禁发字段」这类前后端约定塞在别人的实现目录旁边不合适；`boundary-doc` 规则改查新路径，全部引用已同步 |
| `docs/BACKEND_INTEGRATION.md` | 新增。`API_CONTRACT.md` 是**前端消费视角**（讲「前端拿到什么」），后端同学照着看得自己反推要发什么。新文档是后端视角：全局约定、20 条接口总表、逐接口的完整 JSON 示例与字段约束、NDJSON 协议、幂等与限流、16 项实现清单、绝不下发的字段。开头就把 `.strict()` 的硬约束摆在最前 |
| 错误信封补 `details` 通道 | 真实缺陷修复。`apiErrorEnvelopeSchema` 是 `.strict()` 且未声明 `details`，`HttpApiClient.send()` 也从不把它转进 `ApiError`——于是带 `details` 的咨询 409 会**整个信封解析失败**，`code` 退化按状态码推断成 `CONFLICT`，`useConversation.ts` 里那句「拿 `details` 回正到服务端真实状态」在真实后端下永不生效。这是第四个「mock 全绿、live 才暴露」的缺陷：mock 直接构造 `ApiError`，从不经过信封解析，全部单测都看不见。补 2 条单测 + 1 条真实 socket 集成用例，并用「临时移除 `details` 声明 → 两条如期变红 → 恢复」验证测试确实拦得住 |
| `playwright.live.config.ts` 增加 `PW_NO_WEBSERVER=1` | 逃生开关。本机环境下 Vite 的 webServer 探测**无论服务起没起都返回 404**（日志已打印 `ready in 954 ms`），而 `node -e` 直接 `http.get` 同一地址是 200；桩服务器的探测则正常（502→200）。判定为环境对特定端口的行为，不是项目问题。手动起好两个服务后置 `PW_NO_WEBSERVER=1` 跳过托管，live E2E 10 条全绿 |
| `.gitignore` 排除内部工作文档 | `FRONTEND_IMPLEMENTATION_PLAN.md` 与 `docs/MIGRATION_CHECKLIST.md` 是施工期的工作稿（逐任务复选框、临时进度），推给同学看没有价值。`.env.development` / `.env.live` 则**保留**：它们不含密钥，只是 mock/live 模式开关，别人 clone 下来能直接跑 |
