# 知乎问人 · 前端工程

「知乎问人」的前端。两条进入路径：

- **专业领域社交**：从领域目录进入领域星图，看这个方向的议题分布与相关的人，点开头像读公开资料，再决定要不要聊；
- **问题找人**：用户描述自己的真实处境，搜索 Agent 检索知乎公开内容、核验证据，给出最多三张可解释的人物卡。

两条路径最终都汇到同一个虚拟对话：Agent 以 **AI Agent** 身份回复，并可继续走付费咨询的演示状态机。

本工程是**纯前端**：不做 OAuth 加解密、不碰数据库、不实现 Agent Runtime、不含任何服务端 Route。所有业务真相来自 `ApiClient`（开发期是确定性 Mock，联调期是真实 HTTP API）。

> **旧工程 `../zhihu-wenren-app` 只读。** 它是本工程的行为与视觉参考，任何情况下都不修改、不移动、不删除、不格式化。本工程的所有产物只写在 `demo/zhihu-wenren` 内。

---

## 快速开始

### 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | 22 LTS 及以上 |
| pnpm | 12.x（`packageManager` 已锁定 `pnpm@12.4.1`，用 corepack 会自动对齐） |

### 安装

```bash
pnpm install
```

**Windows 说明**：本工程在 `pnpm-workspace.yaml` 里固定 `nodeLinker: hoisted`。pnpm 默认的符号链接布局在部分 Windows 环境会报 `Failed to create symlink ... os error 2`，hoisted 布局不依赖创建符号链接，安装更稳。这不会改变任何依赖版本。

### 启动（Mock 模式，默认）

```bash
pnpm dev
```

打开 `http://127.0.0.1:5173`。Mock 模式默认「已授权」，不需要任何后端就能走完整个主流程。

### 构建与预览

```bash
pnpm build      # tsc -b + vite build，产物在 dist/
pnpm preview    # 本地预览构建产物
```

---

## 环境变量

复制 `.env.example` 为 `.env.development`（或 `.env.local`，已被 `.gitignore` 忽略）：

```dotenv
VITE_API_MODE=mock
VITE_API_BASE_URL=
VITE_MOCK_AUTH_STATE=authenticated
VITE_ENABLE_DEMO_ROLE_SWITCHER=true
```

| 变量 | 取值 | 用途 |
|---|---|---|
| `VITE_API_MODE` | `mock` \| `live` | `mock` 使用内置确定性后端，不发出任何网络请求；`live` 使用真实 HTTP API |
| `VITE_API_BASE_URL` | 空 或 同源前缀 | 默认空字符串，即使用相对路径。**不要**配置成跨站域名：Cookie 需要同源 |
| `VITE_MOCK_AUTH_STATE` | `authenticated` \| `anonymous` \| `unconfigured` | Mock 初始授权状态，用于演示未授权与未配置两种门禁 |
| `VITE_ENABLE_DEMO_ROLE_SWITCHER` | `true` \| `false` | 是否显示「用户视角 / 答主视角」切换；真实后端可能禁止答主演示消息，届时设为 `false` |

### Mock 演示开关（URL query）

只在 `VITE_API_MODE=mock` 时生效，用来在不重启 dev server 的情况下切换分支；真实模式完全忽略这两个参数。E2E 也依赖它们构造错误场景。

| 参数 | 取值 | 效果 |
|---|---|---|
| `mock_auth` | `anonymous` / `unconfigured` | 覆盖初始授权状态 |
| `mock_scenario` | `default` | 正常主流程 |
| | `empty-results` | 搜索成功但没有任何人选 |
| | `search-failed` | 搜索流在开始后失败 |
| | `agent-stream-failed` | Agent 回复在保存阶段失败 |
| | `agent-stream-truncated` | Agent 流没有终态事件（模拟中断） |
| | `consultation-conflict` | 咨询动作被服务端拒绝（409，模拟状态已被别处改过） |
| | `field-search-failed` | 领域检索不可用（503，推荐领域仍然可用） |
| | `field-graph-missing` | 领域星图 404（给的 fieldId 不存在或已下线） |

例：`http://127.0.0.1:5173/?mock_scenario=search-failed`

### 联调真实后端（Live）

1. 后端在本机 `8787` 端口提供 `/api/**` 与 `/auth/**`（可用 `VITE_DEV_PROXY_TARGET` 覆盖代理目标）。
2. 用 `pnpm dev:live` 启动（等价于 `pnpm dev --mode live`，读 `.env.live` 里的 `VITE_API_MODE=live`）。Vite 会把 `/api` 与 `/auth` 代理到后端，登录与退出走浏览器导航，不做 `fetch` 跟随 302。

真实模式不需要改任何组件代码——Mock 与 HTTP 实现的是同一个 `ApiClient` 接口。接口清单见 [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)。

**还没有后端也能跑通这条链路**：仓库里带了一个最小后端桩 `scripts/live-stub-server.mjs`，覆盖会话探测、领域目录/星图、人物资料、六阶段检索流与刷新恢复。

```bash
pnpm stub        # 终端 A：监听 127.0.0.1:8787
pnpm dev:live    # 终端 B：live 模式前端
```

桩上用 `/api/__stub/mode?value=<分支>` 切换分支（`anonymous` / `unconfigured` / `expired` / `fields-degraded` / `fields-failed` / `graph-missing` / `search-failed` / `search-truncated` / `slow-steps`），`/api/__stub/requests` 能读到此刻为止收到的请求——用来证明「页面上的数据确实来自服务端」，而不是前端自己编的。

桩**只**覆盖读路径与检索流。会话与咨询（写路径、带真实状态机）统一返回 `501 NOT_IMPLEMENTED`：在桩里再实现一遍状态机，验证的就会是桩而不是前端。

---

## 目录职责

工程分四层，边界由 `scripts/check-boundaries.mjs` 静态守卫，是 `pnpm run check` 的第一道门（不过它就不进入 lint）。

| 目录 | 唯一职责 | 不得放入 |
|---|---|---|
| `src/app` | 前端启动入口 `main.tsx` | 页面、feature、样式、业务逻辑 |
| `src/back` | 后端实现（与后端同学共用本仓库，前端**不往这里写东西**） | 前端代码 |
| `src/front` | **全部**前端实现 | — |
| `src/shared/contracts` | 前后端共同遵守的公开 Zod 契约 | OAuth Secret、数据库类型、模型内部类型 |
| `scripts` | 可执行的边界守卫与联调桩 | 业务逻辑 |
| `tests` | 单元、组件、页面与 E2E 测试 | 生产代码 |
| `docs` | API、结构、工作流、后端边界说明 | 临时笔记 |

`src/front` 内部再分层，依赖方向单向向下：

| 目录 | 唯一职责 | 不得放入 |
|---|---|---|
| `src/front/app` | 路由、全局依赖注入、应用壳 | 页面业务细节、HTTP 实现 |
| `src/front/pages` | 组合 feature 成页面 | Zod 契约、`fetch`、后端业务规则 |
| `src/front/features` | 按用户能力组织 UI 与交互状态 | 通用按钮、原始后端响应 |
| `src/front/components/ui` | 无业务含义的基础组件 | 搜索、聊天、咨询规则 |
| `src/front/api` | `ApiClient` 接口、HTTP/Mock 实现、NDJSON 解析 | JSX 页面结构 |
| `src/front/mocks` | 稳定、确定性的开发数据与 Mock 后端 | 生产凭据、随机不可复现数据 |
| `src/front/shared` | 小型纯函数、动效工具与浏览器存储边界 | 聚合式「万能 utils」 |

工程边界（由守卫脚本强制，共 6 条规则，规则名就是报错里会出现的标识）：

守卫**只检查前端自己拥有的文件**——`src/front/**`、`src/app/main.tsx`、`src/shared/contracts/**`。
它不去枚举 `src/back`、`src/app`、`src/shared` 下的每一个文件，因为那些目录里有后端的东西，
我们不替别人定目录规矩。（早期版本有「`src/back` 下只能有 `.md`」这类按目录归属的判定，
后端一写实现 `check` 就会红，已经改掉。）

| 规则 | 约束 |
|---|---|
| `server-leak` | 服务端类型与凭据名不得进入前端拥有的代码 |
| `direct-fetch` | 页面 / feature / 组件不得绕过 `ApiClient` 直接访问网络 |
| `contract-purity` | `src/shared/contracts/` 下只能是 kebab-case `.ts`；契约不得依赖 React、不得读取环境变量 |
| `app-entry` | 前端启动入口 `src/app/main.tsx` 必须存在 |
| `boundary-doc` | `docs/BACKEND_BOUNDARY.md` 必须存在，且声明敏感字段不下发 |
| `creator-routing` | 路由参数与跳转链接不得使用 `creatorId`（会话用会话 ID，不是人物 ID） |

另有一条靠契约而不是靠自觉的约束：真实 API 与 Mock 实现同一个 `ApiClient`，共用同一份 Zod 契约。浏览器存储只写 `zhihu-wenren:frontend:v1:*` 前缀下的未发送草稿、UI 偏好与「最近一次搜索运行的指针」；不保存 Conversation / Message / Consultation / 人物结果 / Token 作为业务真相，也从不调用 `localStorage.clear()`。

---

## 测试

```bash
pnpm test           # Vitest：契约、NDJSON、HTTP 客户端、Mock 后端、页面与交互（28 文件 / 261 用例）
pnpm test:watch
pnpm test:e2e       # Playwright：Mock 模式下的主流程与错误流程（桌面 + 移动共 38 条）
pnpm test:e2e:live  # Playwright：live 模式，前面挂桩服务器（10 条）
pnpm lint           # ESLint：0 error / 0 warning
pnpm typecheck
pnpm check          # 边界守卫 + lint + typecheck + test + build
```

测试分三层，各自证明不同的事：

| 层 | 位置 | 证明什么 |
|---|---|---|
| 单元 / 组件 | `tests/**/*.test.ts(x)` | 状态机、契约、可交互行为。`fetch` 是注入的假的 |
| HTTP 集成 | `tests/api/http-api-client.integration.test.ts` | **真实 socket**：NDJSON 跨 chunk（含跨汉字字节）重组、收到终态立刻返回、取消中断连接、错误信封 |
| live E2E | `tests/e2e-live/live-mode.spec.ts` | **真实浏览器 + 真实服务器**：契约在真实响应上生效、进度逐条到达、刷新恢复真的打了 `restoreRun` |

中间那层值得单独说一句：`tests/api/http-api-client.test.ts` 注入的是假的 `fetchImpl` 与假的 `Response`，所以它证明不了任何和「真的走网络」有关的事。集成测试自己起一个 `node:http` 服务器（随机端口），把逐字节切开的 NDJSON 打进去——**切点包含一个汉字的 3 字节中间**，用来验证 `TextDecoder({ stream: true })` 的跨 chunk 拼接。

### live 模式真的查出过三个 bug

这三条都是 mock 模式**永远**碰不到的，`pnpm test` 也全绿：

- **会话探测死循环**：`GET /api/auth/session` 返回 401 时，`onUnauthorized` 也会被调用，于是 `authEpoch` 自增 → 会话探测重跑 → 又是 401。实测 3 秒内打了 **652 次**请求。修法是会话探测跳过全局刷新——它自己的 401 就是答案，不是「会话过期了」这个事件。
- **底层传输错误漏给界面**：流推到一半被掐断时，`reader.read()` 抛的是 `TypeError: terminated`（浏览器里是 `Failed to fetch`）。它没有被收敛成 `ApiError`，`usePersonSearch` 直接把 `error.message` 显示出来，界面上就是一句英文技术错误。
- **错误信封的 `details` 整条丢光**：错误信封契约是 `.strict()`，而 `details` 没有被声明进去，`HttpApiClient.send()` 也从未把它转进 `ApiError`。于是服务端带 `details` 的咨询 409 会让**整个信封**解析失败，`code` 退化按状态码推断成 `CONFLICT`，`useConversation` 里那句「拿 `details` 回正到服务端真实状态」在真实后端下永不生效。这一条尤其隐蔽：`MockApiClient` 是直接 `new ApiError(...)`，从不经过信封解析，因此 mock 模式与当时全部 258 个单测都看不见它，而且**它不报错、只是安静地不生效**。

这三条现在各有回归：会话探测那条在 live E2E 里断言「2.5 秒内请求数不再增长」（不锁死次数，因为 StrictMode 会把 effect 跑两遍），传输错误那条在集成测试里断言「抛出的必须是 `ApiError`，且 message 不含 `terminated` / `fetch`」，`details` 那两条在单测里断言「`code` 是精确码而不是退化的 `CONFLICT`」与「信封里的未声明字段不被静默吸收」，另有一条真实 socket 集成用例让 `details` 穿过真实错误信封。补测试时还反向验证过：临时把契约里的 `details` 删掉，两条新用例如期变红。

lint 是干净的，没有任何 warning。这曾经不是这样：`react-refresh/only-export-components` 会为「组件文件里同时导出 hook 或 CVA 变体」报警，shadcn 风格的 `badge/button/tabs` 天然中招。现在是**真的修掉**而不是压掉：

- `ApiProvider.tsx` 只导出组件，Context 与 `useApiClient` / `useAuthEpoch` / `useRefreshSession` 移到 `src/front/app/api-context.ts`。副作用是「只要 hook 的模块」不再把 Provider 组件拖进自己的依赖图，改 hook 也不会让应用壳整页刷新。
- `badge` / `button` / `tabs` 的 `xxxVariants` 不再导出。它们全库无人使用（只在各自文件内部用于 `cn(...)`），所以去掉无用导出即可。真需要在别处组合样式时，请另建 `xxx-variants.ts`，不要从组件文件里导出。

E2E 的 `page` fixture 会在每条用例结束时断言浏览器控制台零错误（`pageerror` / `console.error` / 非取消类请求失败），所以「页面能跑」和「页面跑得干净」是同一道门槛。

浏览器的 4xx/5xx 也会被记成 `console.error`，所以**刻意**验证失败分支的用例要显式放行对应状态码（`createTest({ allowedHttpStatuses: [...] })`）。默认不放行任何状态码：让整个文件统一放行，连静态资源 404 都会被一起放过。

E2E 第一次运行前需要安装浏览器：

```bash
pnpm exec playwright install chromium
# 若当前环境的 node_modules/.bin 不可用，可用等价的直接调用：
node ./node_modules/playwright/cli.js install chromium
```

Playwright 会自己拉起 dev server：默认配置跑 `4319`（mock），live 配置再额外拉起桩服务器的 `8787` 与自己的 `4320`。都不复用你本机正在跑的 `5173`，避免误连真实后端。mock 配置两个 project（`desktop-chromium` 1440×900 与 `mobile-chromium` 390×844）各跑一遍。

> 若运行环境把本地端口也接管了（例如沙箱拦了出站连接），Playwright 自己发的那次「服务起来了吗」探测会拿到 404/502，于是 dev server 明明已经在监听，却一直报 `Timed out waiting 120000ms from config.webServer`——一个和真实原因完全无关的错。遇到就换一个不受限的终端重跑。

---

## 已实现的可见能力

**入口与门禁**

- 项目推荐页（不访问任何业务 API）+ 授权门禁 + 功能首页两个入口；
- 未配置状态、授权回调错误文案、退出入口；未授权时不渲染任何业务界面。

**路线 A · 专业领域社交**

- 专业领域目录：推荐领域 + 领域检索（**检索只返回领域，不退化成人物搜索**）；
- 领域星图：中心领域 / 议题节点 / 人物聚类，纯函数布局（无随机数）、缩放与拖拽、议题筛选（淡化不隐藏、仍可点）；
- 窄屏降级为按议题分组的头像卡片，不做「缩小版的星图」；
- 统一人物名片：按来源区分——检索来源给相关度、匹配维度、逐条内容证据与「适合问 TA」；领域来源给领域相关度、关联议题，并如实写「暂无内容证据」而不是虚构；
- 公开主页外链（https 白名单，无主页时禁用并说明原因）。

**路线 B · 问题找人**

- 默认问题、示例问题、4～300 字校验、Ctrl/Cmd+Enter 提交；
- 热榜选题（失败静默隐藏，不影响找人）；
- 开始 / 停止 / 重试搜索，六阶段 Agent 工作轨迹（只显示服务端真实上报的步骤）；
- Running 骨架屏、错误条、空结果、成功结果与摘要（Live/Fixture、模型降级、上下文、持久化提示）；
- 最多三张人物卡：相关度、匹配维度、理由、证据条数、局限；
- 证据抽屉：逐条证据、`kind` 标签、知乎原文链接或「Fixture 演示证据，无真实外链」；
- 背景资料与人物证据分区展示；
- 三栏对比弹窗（知乎外链 / 原始检索命中 / Agent 卡片）；
- **刷新恢复**：本地只存 `{runId, query}` 指针，刷新时用 `restoreRun` 向服务端换回结果，摘要信息量与首次搜索完全一致；恢复失败静默清指针，不弹红条。

**对话**

- 从人物卡或领域名片创建会话并跳转 `/app/chat/:conversationId`（会话 ID，不是人物 ID，同一个人可以有多个会话）；
- 聊天页：人物栏、消息流、建议问题、输入框、发送中 / 失败 / 重试 / 丢弃；
- Agent 回复的 NDJSON 流式增量，完成后用服务端完整消息替换；
- 取消流（只影响当前请求，不删除已保存消息）、流中断标记失败（半截回复不落库）；
- 演示角色切换、五阶段咨询状态机、套餐与模拟支付免责声明；
- **私有知识库 Agent 展示区**：三态（已配置 / 部分配置 / 尚未配置）、知识库主题、可回答范围与出范围提示；纯展示，不接后端、不上传文件，示例问题只填进输入框不自动发送。

**恢复与可访问性**

- 401 / 403 / 404 / 409 / 429 / 503、取消与回退体验，且区分「可重试」与「不可重试」（404 给的是换一条路，不是重试按钮）；
- 减少动效：`prefers-reduced-motion` 下 CSS 压时长 + 归零延迟，JS 侧节点入场延迟一律为 0，并写入 `<html data-reduced-motion>`；
- 键盘可达：星图节点可聚焦、Enter / Space 与鼠标同路径，抽屉可 Escape 关闭，导航有 `aria-current`；
- 响应式：1440×900 / 1024×768 / 390×844 三档均无横向溢出，加载态用 `role="status"` 播报；
- WebMCP `start_person_search`（浏览器不支持 `document.modelContext` 时静默不可用）。

## 不做的事

- 不实现 OAuth 加解密、知乎 Provider、Agent Runtime、数据库、限流或服务端 Route；
- 不实现真实的私有知识库：私有 Agent 展示区只读本地夹具，不上传文件、不保存私有资料、不调用任何接口；
- 不接收或记录 Token、Secret、完整授权码、内部用户 ID 或服务端堆栈；
- 不伪造后端成功：503 与流中断都会明确显示失败，不做本地「假成功」；
- 不伪造证据：领域来源没有逐条内容证据时如实写「暂无内容证据」，不用占位文字凑满版式；
- 不让领域检索退化成人物搜索：这条链路上只有领域卡片，没有「查看证据」之类的人物级操作；
- 不把 Agent 回复伪装成真实答主，不让 Fixture 数据看起来像真人；
- 不提供任何绕过授权门禁的入口，也不提供免登录预览。

## 文档

- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) — 逐接口的请求、响应、错误码与流事件
- [`docs/BACKEND_INTEGRATION.md`](docs/BACKEND_INTEGRATION.md) — **给后端的对接文档**：逐接口 JSON 示例、NDJSON 协议、实现清单、联调步骤
- [`docs/BACKEND_BOUNDARY.md`](docs/BACKEND_BOUNDARY.md) — 后端职责清单与「绝不向前端下发」的字段
- [`docs/CODE_STRUCTURE.md`](docs/CODE_STRUCTURE.md) — 四层边界、依赖注入、状态归属、状态机、动效与无障碍、测试策略
- [`docs/FRONTEND_WORKFLOW.md`](docs/FRONTEND_WORKFLOW.md) — 七条路由各自的工作流
- [`docs/PRIVATE_AGENT_SCOPE.md`](docs/PRIVATE_AGENT_SCOPE.md) — 私有知识库 Agent 展示区的范围边界（它没有真实能力）
- [`docs/MIGRATION_CHECKLIST.md`](docs/MIGRATION_CHECKLIST.md) — 逐项签收与工程级验收结果
