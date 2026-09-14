# 前端工作流

七条路由，每条都写成「用户看到什么 → 前端做什么 → 数据从哪来」，方便交接时逐段对照代码。

以上所有流程都可以在两种模式下走完，页面代码完全不变：

| 模式 | 启动 | 数据来自 | 用途 |
|---|---|---|---|
| `mock`（默认） | `pnpm dev` | `MockApiClient`，不发任何网络请求 | 演示、日常开发、`pnpm run test:e2e` |
| `live` | `pnpm dev:live`（+ 可选 `pnpm stub`） | `HttpApiClient` → `/api/**` | 后端联调、`pnpm run test:e2e:live` |

两者实现同一个 `ApiClient` 接口、共用同一份 Zod 契约，所以页面与 feature 不判断当前是哪种模式。

| 路由 | 页面 | 数据来源 |
|---|---|---|
| `/` | 项目推荐页 | **不访问任何业务 API** |
| `/app` | 授权门禁 + 功能首页（两个入口） | `GET /api/auth/session` |
| `/app/fields` | 专业领域目录 | `getFeaturedFields` / `searchFields` |
| `/app/fields/:fieldId` | 领域星图 | `getFieldGraph` / `getCreator` |
| `/app/find` | 问题找人 | `streamSearch` / `restoreRun` |
| `/app/chat/:conversationId` | 虚拟私聊 + 咨询 + 私有 Agent | `getConversation` / `listMessages` / … |
| `/chat/:conversationId` | 旧路径，仅作兼容重定向 | — |

---

## 1. Auth（授权门禁）

```text
打开任意 /app 页面
   └─ GET /api/auth/session
        ├─ 200 authenticated=true  ─▶ 正常页面
        ├─ 200 authenticated=false ─▶ AuthGate（未授权）
        ├─ 200 configured=false    ─▶ AuthGate（未配置，按钮禁用）
        └─ 请求失败                ─▶ 「无法读取登录状态」+ 重新加载

点「使用知乎账号授权」 → 浏览器导航 GET /api/auth/zhihu/login
   └─ 知乎官方页授权 → GET /auth/callback（后端）→ 302 回 /?auth=<status>
        └─ 首页根据 status 显示一次性提示，再以 session 结果决定是否放行
```

要点：

- **没有绕过入口。** 未授权时任何业务界面都不渲染——推荐页不出现搜索框、不出现登录用户、不出现人物数据（E2E 断言这些选择器数量为 0）。
- 401 是**全局**行为：任何受保护请求返回 401 → `useRefreshSession()` → `authEpoch++` → 受保护页面回到 AuthGate。单个 feature 不自己写一套判断。
- 登录与退出用 `<a href>` 导航，不用 `fetch` 跟 302。
- 前端只认得 `configured / authenticated / user` 三个字段；Token、授权码、内部 UID 都不进入前端。

对应文件：`features/auth/*`、`pages/LandingPage.tsx`、`components/layout/AppHeader.tsx`、`app/ApiProvider.tsx`。

---

## 2. 专业领域目录（`/app/fields`）

```text
进入页面
   └─ GET /api/fields/featured         ─▶ 推荐领域（页面主体内容）
        └─ 失败 → 可重试的错误面板

在检索框输入并提交 / 点「检索领域」
   └─ GET /api/fields?query=&limit=
        ├─ 有结果 → 领域列表
        ├─ 空数组 → 「没有匹配的领域」+ 回到推荐
        └─ 503 FIELD_SEARCH_FAILED → 检索区错误态 + 重试（推荐领域仍在）
```

两条状态线彼此独立（`useFields`）：

| 状态 | 界面 |
|---|---|
| `featuredState: loading` | 骨架屏（带 `role="status"` 的「正在加载推荐领域」） |
| `featuredState: ready` | 推荐领域网格 |
| `featuredState: error` | 错误面板 + 重新加载 |
| `listState: idle` | 只显示推荐领域 |
| `listState: loading` | 检索区骨架 |
| `listState: ready` | 检索结果网格 |
| `listState: empty` | 空结果说明 + 清除条件 |
| `listState: error` | 错误条 + 重试（**不清空推荐领域**） |

关键约束：

- **领域检索只返回领域。** 返回值一定是 `FieldSummary[]`，这条链路上不渲染「查看证据」等人物级操作；
- 每次新检索先取消上一次请求，快速连续提交不会出现「后发先至」的错位结果；
- 输入非法（过短等）在提交前拦下，不发请求；
- 点领域卡片 → `/app/fields/:fieldId`。

对应文件：`features/fields/*`、`pages/FieldsPage.tsx`。

---

## 3. 领域星图（`/app/fields/:fieldId`）

```text
进入页面
   └─ GET /api/fields/:fieldId/graph
        ├─ 200 → 中心领域 + 议题节点 + 人物聚类
        ├─ 404 FIELD_NOT_FOUND → 「领域不存在」+ 返回领域目录（**不给重试**）
        └─ 其他错误 → 「领域星图加载失败」+ 重试 + 返回领域目录

点议题 → 只做前端筛选：不相关节点淡化（不隐藏、仍可点），再点同一议题取消
点人物头像/卡片
   └─ GET /api/creators/:id
        ├─ 200 → 统一人物名片（source="field"）
        └─ 失败 → 页内错误条 + 「重新加载公开资料」（保留当前选区）

名片里点「开始私聊」
   └─ POST /api/conversations { creatorId, sourceRunId: null }
        └─ 200/201 → navigate(`/app/chat/${id}`)
```

布局与降级：

- 布局由 `layoutGraph()` 这个**纯函数**算好（无随机数），同一份数据永远得到同一张图；
- 坐标裁剪进 `[0.06, 0.94]`，服务端给 0 或 1 也不会贴边出框；
- `topicIds` 为空或指向不存在的议题 → 归入「其他（尚未归入具体议题）」分组，**不丢弃**；
- 桌面（≥ 768px）用 SVG 星图，窄屏降级为按议题分组的头像卡片——用 CSS 断点切换而不是 JS 媒体查询；
- 筛选器里各议题人数之和**不等于**总人数（一个人可归入多个议题），「全部」用的是去重后的 `people.length`。

交互细节（真实浏览器里踩过的坑）：

- `onPointerDown` 里**不**调用 `setPointerCapture`。一旦在按下时就捕获指针，浏览器会把随后合成的 `click` 重定向到被捕获的 `<svg>`，`<g>` 上的 `onClick` 永不触发——表现就是「鼠标点头像毫无反应」。只有在位移超过 `DRAG_THRESHOLD = 4` 时才认为这是一次拖拽，此时才捕获。
- 人物节点与议题节点都可聚焦（`tabIndex` + `role`），Enter / Space 与鼠标走同一个回调。
- 窄屏卡片的按钮用与桌面 SVG 节点**相同的可访问名**（`查看人物 X，headline`）：同一个动作不该因为断点而改名。

对应文件：`features/field-graph/*`、`pages/FieldGraphPage.tsx`。

---

## 4. 问题找人（`/app/find`）

```text
输入问题（trim 后 4～300 字，Ctrl/Cmd+Enter 提交）
   └─ POST /api/agent/search  → NDJSON
        run.started
        step.started/completed × 6（loading_context → … → saving）
        run.completed { result, runId, persistence }
        或 run.failed { error }
```

状态机（`search-state.ts`）：

```text
idle ──开始找人──▶ running ──run.completed──▶ done
                      │
                      ├─停止/取消──▶ idle（不显示红条）
                      └─run.failed─▶ error ──重试──▶ running

页面加载时：读本地指针 ──restoreRun──▶ done（run.restored）
                        └─失败──▶ idle（静默清指针，不显示红条）
```

界面对应：

| 状态 | 界面 |
|---|---|
| `idle` | 六阶段全部 waiting + 「输入问题后，结果会来自本次搜索」 |
| `running` | 骨架屏 + 六阶段逐个 running → done + 「停止搜索」 |
| `done` | 结果摘要 + 最多三张人物卡（或空结果）+ 背景资料 |
| `error` | `role="alert"` 错误条 + 重试按钮 |

六阶段文案只来自契约（`AGENT_STEP_ORDER` + `STEP_LABELS`）。服务端没上报的阶段永远停在 waiting —— 界面不会出现「看起来跑过、其实没有」的步骤。`run.restored` 恢复时也不会伪造逐阶段上报内容，只用各阶段的待机说明。

结果区必须区分：

- **人物证据**（`cards[].evidence`）与**背景资料**（`background[]`）分区展示，背景资料不参与推荐；
- Live 与 Fixture 用不同底色说明；Fixture 时明确写「当前显示虚构演示数据」；
- `modelFallback=true` 说明问题理解阶段降级；
- `persistence="unavailable"` 说明结果只在当前会话有效。

**刷新恢复：存指针，不存结果。**

```text
run.completed 且 persistence="saved"
   └─ sessionStorage 写 { runId, query }
        └─ 刷新页面 → GET /api/agent/runs/:runId → dispatch run.restored
             ├─ 成功 → 摘要信息量与首次搜索完全一致（契约 1:1 映射）
             └─ 失败 → 静默清指针，回 idle（用户没做错事，不弹红条）
```

清指针的时机：`runSearch` 开新搜索、`selectSample`、`reset`。`persistence="unavailable"` 的运行从不写指针。

从人物卡创建会话：

```text
点「与 TA 聊聊」
   └─ POST /api/conversations { creatorId, sourceRunId }
        ├─ 200/201 → navigate(`/app/chat/${id}`)
        ├─ 409 CONVERSATION_SOURCE_UNAVAILABLE → 保留人物结果 + 可重试错误条
        └─ 401 → 刷新 session → AuthGate
```

同一个请求进行中时按钮禁用（`inFlightRef`），避免重复建会话。

其他：热榜失败静默隐藏；对比弹窗（`POST /api/compare`）只读预览，`raw.hits` 不得当人物卡；WebMCP `start_person_search` 在没有 `document.modelContext` 时静默不可用。

对应文件：`features/search/*`、`features/creator/*`、`features/compare/CompareDialog.tsx`、`pages/FindPeoplePage.tsx`。

---

## 5. 会话与消息（`/app/chat/:conversationId`）

```text
进入页面
   ├─ GET /api/conversations/:id                    → 人物栏 + 咨询状态
   ├─ GET /api/conversations/:id/messages?limit=50  → 第一页消息
   └─ GET /api/consultation/packages                → 套餐（失败只提示，不阻塞）

加载更多：GET .../messages?cursor=<nextCursor>  → 更早的消息插到列表头部
```

加载结果分四种，各自有明确的恢复动作：

| 情况 | 界面 | 恢复动作 |
|---|---|---|
| 加载中 | 三段式骨架屏（`role="status"`） | — |
| 401 | AuthGate | 重新授权 |
| 404 | 「会话不存在」 | 返回找人 |
| 其他错误 / 503 | 「会话加载失败」 | 重试（`retryable` 时） |

页面顶部横幅按来源切换，两条都不含糊：

- 来自检索（`sourceRunId` 非空）：「本页人物卡来自你本次的搜索结果；本页仍是虚拟聊天演示，消息不会发送给该知乎用户，答主回复由 Agent 生成并标注为 AI。」
- 来自领域星图（`sourceRunId` 为 null）：「模拟聊天：消息不会发送给真实知乎用户；付费咨询不会产生订单或扣款。」

发送消息：

```text
用户视角：pending.user ─▶ POST .../agent-runs（NDJSON，见下一条流程）
答主视角：pending.user ─▶ POST .../messages { actorRole: "creator" }
                └─ 成功 → 服务端 Message 替换临时气泡
                └─ 失败 → 临时气泡标记 failed，输入内容保留以便重试
```

幂等：`clientMessageId` 由前端生成并在重试时复用，服务端不得因此产生第二条消息。

reset：

```text
POST /api/conversations/:id/reset
   ├─ 成功 → 整体替换 Conversation 与 Messages，清空草稿
   └─ 失败 → 保持旧页面，只提示错误（不会先清 UI 再失败）
```

对应文件：`features/chat/useConversation.ts`、`conversation-state.ts`、`MessageList.tsx`、`MessageComposer.tsx`、`pages/ChatPage.tsx`。

---

## 6. Agent Chat（流式回复）

```text
POST /api/conversations/:id/agent-runs { clientMessageId, content } → NDJSON
   agent.run.started      { requestId, userMessage }   → 临时用户气泡换成服务端 Message
   agent.message.started  { messageId }                → 临时 Agent 气泡换成服务端 id
   agent.message.delta    { messageId, delta }         → 追加内容，显示「· 正在生成」
   agent.message.completed{ message }                  → 服务端完整 Message 原子替换
   agent.run.failed       { error }                    → 标记失败
```

四种收尾：

| 收尾 | 前端行为 |
|---|---|
| `agent.message.completed` | 用服务端消息替换流式气泡，清掉「正在生成」 |
| `agent.run.failed` / 网络失败 | 临时 Agent 气泡标 failed（显示「这条回复没有完成」+ 重试/删除），已确认的用户消息保留 |
| 无终态的流中断 | 同失败：`INCOMPLETE_STREAM`，不保存半截回复 |
| 用户点「停止生成」 | `AbortController.abort()` → 丢弃未成型的 Agent 气泡，不写错误红条 |

去重（决定界面会不会出现两条一样的消息）：

- 同 `id` → 重复，丢弃旧的；
- 同 `clientMessageId` **且同发送方** → 临时项被服务端确认，用服务端消息替换。

Agent 气泡永远带 `AI Agent` 标签，不能画成真实答主；答主（演示）消息另标 `答主（演示）`。

对应文件：`features/chat/useConversation.ts`、`conversation-state.ts`、`MessageList.tsx`。

---

## 7. Consultation（咨询与模拟支付）

```text
free_chat ──seeker: propose────▶ proposed
free_chat/proposed ──creator: create_offer──▶ offer_created
proposed ──seeker: cancel──────▶ free_chat
offer_created ──creator: withdraw_offer─────▶ free_chat
offer_created ──seeker: confirm_mock_payment▶ mock_paid
mock_paid ──creator: start_consultation─────▶ consulting
```

前端**不推导下一状态**。

```text
点按钮 → POST /api/conversations/:id/consultation/actions { action, actorRole, packageId }
   ├─ 200 { consultation, systemMessage }
   │     → 更新咨询面板 + 往消息流插入一条 system 消息
   └─ 409 INVALID_CONSULTATION_TRANSITION
         → 用 details 里的服务端 Consultation 回正面板 + 提示
            （不猜测、不重试、不本地推断）
```

- 请求进行中所有咨询按钮禁用（`actionPending`）；
- 套餐加载失败只提示「套餐暂时不可用」，聊天照常可用；
- 视角决定可用动作：用户视角只有 propose/cancel/confirm_mock_payment，答主视角只有 create_offer/withdraw_offer/start_consultation；
- 模拟支付弹窗只展示套餐名、描述与格式化金额，写明「不会创建真实订单，也不会产生扣款」；不存在银行卡、手机号、身份证字段与任何真实支付 SDK；
- 金额以**分**传输，展示用 `formatMoney`（整数不带小数：`4900 → ¥49`，`4950 → ¥49.50`）。

状态标签：免费交流 / 已申请咨询 / 咨询方案待确认 / 模拟支付完成 / 咨询进行中。

对应文件：`features/consultation/ConsultationPanel.tsx`、`PaymentDialog.tsx`、`shared/format-money.ts`。

---

## 8. 私有知识库 Agent（纯展示）

聊天页右栏独立于咨询面板，展示「这个人如果配了私有知识库 Agent，大概能回答什么」。

```text
buildPrivateAgentView(creatorId, creatorName)
   └─ 三态：
        configured  主题 ≥ 3 且范围 ≥ 2
        partial     主题或范围不全
        unconfigured 没有这个人的配置
```

- 全部数据来自本地夹具（`private-agent-fixture.ts`），**不调用任何接口**，不上传文件，不保存私有资料；
- 示例问题点击后**只填进输入框**，不自动发送（单测断言 `sendMessage` / `streamConversationAgent` 未被调用）；
- 示例问题的措辞刻意与答主的「适合问 TA」不同：否则同一个问句会在页面上出现两个可点入口，键盘与读屏用户无法区分；
- 面板底部固定写明演示边界，未配置时也如实说明而不是留白。

对应文件：`features/private-agent/*`、`pages/ChatPage.tsx`。

---

## 附：刷新与恢复

| 数据 | 刷新后 | 依据 |
|---|---|---|
| 登录状态 | 重新请求 | `GET /api/auth/session` |
| 搜索运行结果 | 重新请求 | `sessionStorage` 只存 `{runId, query}` 指针 → `GET /api/agent/runs/:runId` |
| 领域星图 / 领域列表 | 重新请求 | 不进本地存储 |
| 会话 / 消息 / 咨询状态 | 重新请求后一致 | 业务真相在服务端；Mock 模式下镜像在 sessionStorage |
| 未发送的搜索词 | 保留 | `zhihu-wenren:frontend:v1:search-draft`（localStorage） |
| 未发送的聊天草稿 | 保留 | `zhihu-wenren:frontend:v1:message-draft:<conversationId>`（localStorage） |
| 视角偏好 | 保留 | `zhihu-wenren:frontend:v1:viewer-role`（localStorage） |
| 发送中 / 流式中 | 丢弃 | 临时状态不落盘 |
| 私有 Agent 展示态 | 重新计算 | 纯函数，无存储 |

存储只写「未发送草稿」「UI 偏好」「运行指针」三类。Conversation、Message、Consultation、人物结果与任何 Token 都不写入本机存储。写入前必须经过 `shared/storage.ts` 的前缀白名单，读取失败静默降级。

`lastSearchRun` 用 sessionStorage 而不是 localStorage：它天然按标签页会话失效，关掉标签页后指针对应的运行多半也已过期，留着只会换来一次必然 404 的请求。
