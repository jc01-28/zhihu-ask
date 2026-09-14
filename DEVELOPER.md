# DEVELOPER.md · 开发者手册

> 面向本项目开发者（我 + 队友）。目标：**看完这一份就能安全地改代码，不踩已经踩过的坑。**
> 产品向的介绍看 [README.md](README.md)，当前进度与排期看 `internal/STATUS.md`，纯大白话的交接说明看 `internal/HANDOFF.md`（`internal/` 已被 gitignore，**不随仓库发布**）。
> 如果你是用 AI 编码助手（Codex / Claude Code）改这个仓库，让助手先读 **[AGENT.md](AGENT.md)** —— 那里是给机器看的硬约束。

---

## 目录

- [0. 五分钟上手](#0-五分钟上手)
- [1. 架构与分层边界](#1-架构与分层边界)
- [2. 契约层：数据流与类型](#2-契约层数据流与类型)
- [3. 框架层 API](#3-框架层-api)
- [4. 工程边界清单（重点）](#4-工程边界清单重点)
- [5. 开发约定](#5-开发约定)
- [6. 怎么扩展](#6-怎么扩展)
- [7. 调试与排错](#7-调试与排错)
- [8. 对照实验流程](#8-对照实验流程)
- [9. OAuth 协议偏差](#9-oauth-协议偏差)
- [10. 部署清单](#10-部署清单)
- [11. 提交前自检](#11-提交前自检)

---

## 0. 五分钟上手

```bash
npm install

# 零凭证模式：先跑通链路，再补业务
cp .env.example .env.local
sed -i 's/^USE_FIXTURES=0/USE_FIXTURES=1/' .env.local
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env.local
npm run dev        # → http://localhost:3000
```

**先打 `/api/health`**，它会告诉你缺什么凭证、数据目录是否可写：

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
```

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务 |
| `npm run typecheck` | 类型检查（提交前必跑） |
| `npm run build` | 生产构建（提交前必跑） |
| `npm run e2e` | 集成测试 28 项（fixture + 无 LLM，约 3 秒） |
| `npm run e2e:llm -- --fresh` | 真实模型链路测试（约 45 秒，`--fresh` 会清缓存保证真的调用模型） |
| `npm run llm:probe` | 模型探针：连通性 + 结构化输出稳定性 |
| `npm run zhihu:doctor` | 知乎凭证体检（三类凭证 + 回调地址） |
| `npm run harvest` | 离线预热：抓真实内容落成 fixture |
| `npm audit` | 应为 `found 0 vulnerabilities` |

---

## 1. 目录结构与分层边界

### 顶层：一眼看出谁是谁的地盘

```
src/
├── app/       Next.js 路由壳 —— 只转发，不放业务
├── back/      ★ 后端（主战场）
├── front/     ★ 前端
└── shared/    ★ 前后端唯一交接点
```

`src/app/` 是 Next.js 强制的路由目录，必须存在；但里面**只有壳** ——
`api/**/route.ts` 把 HTTP 上下文拍平成参数转交 `back/handlers/`，`page.tsx` 转交 `front/pages/`。

### 展开

```
src/
├── app/                           Next.js 路由壳（不放业务逻辑）
│   ├── api/agent/search/          问题找人（NDJSON 流式）→ back/handlers/agent
│   ├── api/agent/runs/[runId]/    刷新恢复           → back/handlers/agent
│   ├── api/compare/               三栏对比           → back/handlers/agent
│   ├── api/creators/[creatorId]/  人物公开资料       → back/handlers/creators
│   ├── api/topics/hot/            热榜               → back/handlers/agent
│   ├── api/fields/                领域检索           → back/handlers/fields
│   ├── api/fields/featured/       推荐领域           → back/handlers/fields
│   ├── api/fields/[fieldId]/graph/ 领域星图          → back/handlers/fields
│   ├── api/conversations/         会话（创建/读取/重置/消息/Agent/咨询）
│   ├── api/consultation/packages/ 咨询套餐
│   ├── api/auth/session/          登录状态           → back/handlers/auth
│   ├── api/auth/zhihu/{login,callback,logout}/
│   ├── api/health/                能力自检           → back/handlers/health
│   ├── api/image-proxy/           纯代理，无业务
│   ├── api/ask/                   @deprecated 兼容旧脚本
│   ├── api/oauth/*/               @deprecated 兼容旧脚本
│   ├── layout.tsx                 html 骨架 + 引入 front/styles
│   └── page.tsx                   → front/pages/HomePage
│
├── back/                          ★ 后端
│   ├── steps/                     8 步业务链路 + 入口 runAsk   ← 业务核心
│   ├── domain/                    后端内部类型 + 实验配置
│   ├── framework/                 引擎与基础设施（不知道业务是什么）
│   ├── adapters/                  数据源 / LLM / 会话  ← index.ts 是唯一装配根
│   ├── handlers/                  路由处理（脱离 Next 也能测）
│   └── fixtures/                  语料（sample / gold / harvested）
│
├── front/                         ★ 前端
│   ├── pages/HomePage.tsx         页面
│   ├── components/                组件
│   ├── api-client.ts              ★ 前端唯一的 fetch 出口
│   └── styles/globals.css         全局样式
│
└── shared/                        ★ 前后端交接点
    └── contract.ts                端点常量 + 信封 + 所有「过线」的类型
```

### back 内部的分层

```
┌──────────────────────────────────────────────────────────────┐
│ L1 routing  app/api/**              薄壳：HTTP ↔ 参数          │
├──────────────────────────────────────────────────────────────┤
│ L2 handler  back/handlers/**        校验 / 会话 / 限流         │
├──────────────────────────────────────────────────────────────┤
│ L3 业务编排 back/steps/**   ← 你的业务核心                     │
├──────────────────────────────────────────────────────────────┤
│ L4 契约     shared/contract.ts      过线的类型（前后端共用）    │
│             back/domain/types.ts    不过线的类型               │
├──────────────────────────────────────────────────────────────┤
│ L5 框架     back/framework/**       不知道业务是什么            │
├──────────────────────────────────────────────────────────────┤
│ L6 适配     back/adapters/**        知道怎么对接，不知道业务规则 │
└──────────────────────────────────────────────────────────────┘
```

### 四条不可破的边界（代码评审就用这四条）

1. **`back/framework/` 里不允许出现任何业务名词。**
   对外 API 只有 `Step` / `Pipeline` / `runPipeline` / `ContextDeps`，输入输出都是 `unknown`。
   → 好处：想换成 LangGraph，只需替换 `runPipeline` 这个 driver，`steps/` 一行不用改。

2. **`back/steps/` 里不允许 `import` 任何具体实现类。**
   只能通过 `ctx.source` / `ctx.llm` / `ctx.cache` / `ctx.quota` 这几个端口访问外部世界。
   → 好处：换数据源、加缓存、换模型，都不需要动业务流程。

3. **`back/adapters/index.ts` 是唯一的装配根。**
   换数据源、换模型、调额度策略，只改这一个文件。
   → 反例：不要在某个 step 里 `new ZhihuHttpSource()`。

4. **`front/` 不允许 `import @/back/*`，也不允许直接 `fetch`。**（前后端分工靠这条）
   只能 `from '@/front/api-client'` 取数据、`from '@/shared/contract'` 取类型。
   → 好处：后端重构实现时前端零改动；前端只靠契约就能独立开发。
   → 自查命令（只匹配真正的 import/require，不匹配注释）：
   ```bash
   grep -rnE "(from|require\()\s*['\"]@/back" src/front   # 必须无输出
   ```

### 依赖方向（单向，不允许反向）

```
back  ──┐
        ├──→  shared        shared 不 import back，也不 import front
front ──┘
```

`back` 内部：`handlers → steps → domain / framework`；`adapters` 由装配根注入。
**没有反向依赖，也没有循环依赖。**

### 路由地图（2026-09-14 按前端规格对齐）

页面（规格的 7 页 + 1 个公共模块，已落地 3 页）：

| 路由 | 页面 | 依赖的后端 | 状态 |
|---|---|---|---|
| `/` | 项目推荐页 | **零后端** | ✅ `ProjectIntroPage` |
| `/app` | 授权门 + 功能首页 | `GET /api/auth/session` | ✅ `AppHomePage` |
| `/app/find` | 问题找人 | `POST /api/agent/search` | ✅ `FindPage` |
| `/app/fields` | 领域目录 | `GET /api/fields/featured`、`GET /api/fields?query=` | 后端 ✅ ｜ 前端待队友 |
| `/app/fields/:fieldId` | 领域星图 | `GET /api/fields/:id/graph` | 后端 ✅ ｜ 前端待队友 |
| `/app/chat/:conversationId` | 虚拟私聊 | `/api/conversations/*` | ⬜ 待建（P5） |
| — | 人物名片抽屉（公共） | `GET /api/people/:id` | ⬜ 待建（P6） |

接口：

后端 **20 个接口已全部就绪**（2026-09-14）。`agent/search` 与 `agent-runs` 是
**NDJSON 流式**，其余一次性返回。

| 端点 | 状态 | 说明 |
|---|---|---|
| `GET /api/auth/session` | ✅ | `configured` / `authenticated` / `user`，前端三分支全靠它 |
| `GET /api/auth/zhihu/login` | ✅ | 302 到知乎授权页（整页跳转，不是 fetch） |
| `GET /api/auth/zhihu/callback` | ✅ | 302 回 `/app?auth=成功或错误码` |
| `GET\|POST /api/auth/zhihu/logout` | ✅ | 清会话后 302 回 `/app?auth=required` |
| `POST /api/agent/search` | ✅ | 问题找人，**NDJSON 流式**（六阶段：loading_context → … → saving） |
| `GET /api/agent/runs/:runId` | ✅ | 刷新恢复。`runId` 必须是标准 uuid |
| `POST /api/compare` | ✅ | 三栏对比。请求**复用 `SearchRequest`**，不是 `{runId}` |
| `GET /api/creators/:creatorId` | ✅ | 人物公开资料。星图与找人**共用这一个出口** |
| `GET /api/topics/hot` | ✅ | 热榜。不可用时返回空列表 + `unavailable: true`，**不是错误** |
| `GET /api/fields/featured` | ✅ | 推荐领域（7 个，顺序即定义顺序） |
| `GET /api/fields?query=&limit=` | ✅ | 领域搜索。**只返回领域，不返回人物** |
| `GET /api/fields/:fieldId/graph` | ✅ | 星图。坐标 **0~1 归一化**，人物 `relevance` 是 0~100 |
| `POST /api/conversations` | ✅ | 创建或幂等恢复（200 命中 / 201 新建）。**不要求登录** |
| `GET /api/conversations/:id` | ✅ | 读取会话 |
| `GET /api/conversations/:id/messages` | ✅ | 游标分页。游标是**上一条消息的 id**，不是下标 |
| `POST /api/conversations/:id/messages` | ✅ | 发消息，**按 `clientMessageId` 幂等** |
| `POST /api/conversations/:id/agent-runs` | ✅ | 会话内 Agent，**NDJSON 流式**（`agent.*` 事件） |
| `POST /api/conversations/:id/reset` | ✅ | 重置。会话 id 不变，前端整体替换 |
| `POST /api/conversations/:id/consultation/actions` | ✅ | 咨询状态机。非法流转 409 + `details` 回正 |
| `GET /api/consultation/packages` | ✅ | 套餐。金额单位是人民币**分** |
| `GET /api/health` | ✅ | 含 `corpus` 构成，演示前先看它 |
| `GET /api/image-proxy` | ✅ | 头像同源代理 |
| `/api/ask`、`/api/oauth/*` | 🟡 废弃别名 | 仅为兼容旧脚本，新代码不要用 |

**会话为什么不要登录**：前端 `/app/chat/:conversationId` 是唯一没有 `RequireAuth`
的路由（其余 `/app/*` 都有）。后端若返回 401，那个页面一进去就是死的。
未授权时用 `zh_guest` cookie 维持稳定访客身份 —— 「稳定」很关键，否则刷新一次就换一个人。

**咨询是模拟支付**：不接受银行卡 / 手机号 / 身份证字段，不创建真实订单，不产生扣款。

**领域域的坐标系**：`0~1` 归一化，中心 `(0.5, 0.5)` 是领域中心节点。
议题在半径 0.3 的圆上均匀分布。前端按容器尺寸缩放即可，**不需要自己算布局**；
刷新页面位置不变，演示时这点很重要。人物**没有**坐标，只有 `topicIds` ——
由前端决定怎么环绕排布（`relevance` 0~100 可用来决定头像大小）。

⚠️ **领域域只认真实语料**（`enumerateRealCorpus`，无视 `FIXTURE_CORPUS`）。
它展示的是「谁**真的**写过这个话题」—— 一旦混进合成语料里的虚构作者
（「林一舟」那种），产品内核就废了，而且演示时没人能当场分辨哪个名字是编的。

授权错误码共 8 个（含 `success`），定义在 `shared/contract.ts` 的 `AuthErrorCode`。
前端的文案映射表写成 `Record<AuthErrorCode | 'success', ...>` —— **漏一个 tsc 就会报错**，
这是刻意的：错误码加了却没人处理，比编译失败更糟。

⚠️ **`configured` 的语义包含回调地址可用性**：即使三个凭证都在，只要
`ZHIHU_REDIRECT_URI` 是占位符或本地地址，`configured` 就是 `false`。
否则会出现「按钮能点、点下去必然失败」这种最招人烦的体验。

### 文件分级管理（四层，别混）

| 层级 | 位置 | 发布？ | 放什么 |
|---|---|---|---|
| **发布层** | `src/`、`scripts/`、`README/DEVELOPER/AGENT.md`、`.env.example`、`eval/` | ✅ 进仓库 | 产品代码、可复现的评测脚本与报告 |
| **内部层** | `internal/` | ❌ gitignore | 进度排期、交接说明、缺口盘点、前端规格等团队内部资料 |
| **运行时层** | `.cache/`、`.artifacts/`、`.next/`、`node_modules/` | ❌ gitignore | 可再生的缓存与产物 |
| **机密层** | `.env`、`.env.local` | ❌ gitignore | 凭证。永远不要提交，也不要在日志里打印 |

新增资料时按这个顺序判断：**给评委/公众看 → 发布层；给队友看 → `internal/`；可再生成 → 运行时层。**

⚠️ 两个反直觉的点：
1. `src/back/fixtures/*.json` 是**输入语料**，不是运行时产物 —— 必须提交，
   否则别人 clone 下来跑不出 `eval/report.md` 里的数字。所以**不要**加 `*.json` 之类的通配忽略。
2. `internal/` 是目录级忽略，所以在里面**新建任何文件都不需要改 `.gitignore`**。
   这比文件级忽略安全：不会因为漏加一条规则把内部资料推到公开仓库。

---

## 2. 契约层：数据流与类型

`src/domain/types.ts` 是**接口冻结层**：所有步骤之间只通过这里的类型交换数据。
改动这里的类型会影响全链路，**改之前先同步**。

```
question: string
  │
  ├─01 triage ────────→ TriageResult      { route: content|ai|human }
  ├─02 profile ───────→ ProblemProfile    { constraints, needExperiences, searchQueries }
  ├─03 recall ────────→ SearchHit[]
  ├─04 events ────────→ ExperienceEvent[] ← 产品的核心数据对象
  ├─05 candidates ────→ Candidate[]
  ├─06 ranked ────────→ Candidate[]       （加 score / scoreBreakdown）
  ├─07 verified ──────→ VerifyReport      { candidates, stats }
  └─08 result ────────→ AskResult         （最终对外结构）
```

### 四个最需要理解的类型

**`ExperienceEvent`** —— 「这个人真的经历过什么」。硬约束：

```ts
firstPerson: boolean   // 第一人称经历，不是旁观者观点
quote: string          // 必须能从来源 contentText 逐字定位到（证据护栏的基础）
timeHint: string       // 时间线索（时间护栏用）
```

**`Candidate`** —— 从经历事件按作者聚合出来的「人」。注意 `rejectedReasons` 是**内部诊断字段，禁止外显**。

**`Recommendation`** —— 对外的推荐卡片。`notGoodAt`（不适合回答）是**必显项**，不是彩蛋。

**`AskResult.metrics`** —— 指标直接对应计划书 §6.2：`evidenceCoverage` / `noEvidenceRate` / `bigVShare` / `candidateCount`。

---

## 3. 框架层 API

### 声明一个步骤

```ts
export const myStep: Step = {
  name: 'myStage',                                  // 产物在 artifacts 里的键
  from: ['recall', 'profile'],                      // 依赖哪些上游产物
  describe: '一句话说明',                            // 出现在 trace 与控制台
  optional: true,                                   // 失败不炸链路
  shouldRun: (input, ctx) => true,                  // false 则跳过
  cacheKey: (input) => `myStage:${...}`,            // 返回 null 则不缓存
  summarize: (output) => `${(output as X[]).length} 条`,  // trace 上显示什么
  async run(input, ctx) { /* ... */ },
};
```

### 四个关键约定

| 约定 | 说明 |
|---|---|
| **`from: null`** | 直接用流水线的初始输入（`runAsk` 的 `question`） |
| **`from: 'x'`** | 用 x 步骤的产物 |
| **`from: ['x','y']`** | 多输入，`input` 变成 `{ x: ..., y: ... }` |
| **`SYS_INPUT`** | 保留键。任何步骤都能声明 `from: [SYS_INPUT, ...]` 拿到**最原始的输入**，不必让上游一层层抄下来 |

> ⚠️ **`from` 里必须写「步骤名 `step.name`」，不是业务概念名。**
> 写错会被 `validatePipeline()` 在启动前拦住并列出可用产物名。
> 这个校验是必须的：否则引擎会静默给 `undefined`，trace 上每步都 `ok`、最终却什么都搜不到，极难排查。

### 引擎做什么、不做什么

**做**：顺序执行 · 产物落盘（`.artifacts/<runId>/NN-<step>.json`）· 步骤缓存 · `shouldRun` 守卫 · `optional` 降级 · 启动前声明校验 · 每步耗时与摘要。
**不做**：并行、重试、条件跳转、循环、人工中断。
需要**有界循环**（比如召回不足时改写 query 重试）时，在步骤**内部**实现，不要试图改引擎。

### 上下文能拿到什么

```ts
ctx.source     // ContentSource 端口
ctx.llm        // LlmClient 端口
ctx.cache      // Cache 端口
ctx.quota      // QuotaGuard 端口
ctx.logger     // info / warn / error
ctx.runId
ctx.now()
ctx.saveArtifact(name, index, value)   // 一般不用手调，引擎会自动存
```

### LLM 调用的统一姿势

```ts
const result = await llmOrFallback<ProblemProfile>(
  ctx,
  { system, input, schemaHint: SCHEMA, cacheKey: `profile:${question}`, validate: coerce },
  () => heuristic(question),     // ← 必须提供确定性降级
  'profile',                     // 日志标签
);
```

**每个用到 LLM 的地方都必须有降级路径**，理由：直答只有 100 次/天；现场可能断网；计划书的「信心护栏」本来就要求低证据时宁缺毋滥。

---

## 4. 工程边界清单（重点）

这一节是这份文档的核心。**下面每一条都是会真的出问题的地方，不是理论。**

### 4.1 数据边界 —— 它决定了架构

| 事实 | 架构后果 |
|---|---|
| 搜索接口返回 **`ContentText`（实测是完整长文）** | ✅ 经历事件的抽取源就是搜索接口，**不需要 Golden Dataset 兜底** |
| 「本人创作」接口**只给 Title + Summary，没有正文** | 不能靠它做抽取 |
| 搜索接口**不返回作者主页 URL / UrlToken** | 「看 TA 主页」对未关注的人是降级的（现在降级为「在知乎搜索 TA」） |
| 关注列表接口**给** `Url` / `UrlToken` / `Headline` / `FollowerCount` | ✅ 用 **OAuth 关注数据补主页**，用**搜索数据补经历** |
| 没有「按用户 ID 拉他人全部创作」的接口 | 数据流必须**反过来**：先搜内容 → 抽经历 → 按作者聚合成人 |
| **没有用户资料接口**（`/user` 无正式 schema） | OAuth 成功后**拿不到用户昵称和头像**，界面上不要假装知道用户是谁 |
| 没有任意两人的社交关系、没有评论列表接口 | 不能做「二度关系」和「评论分析」 |

> 结论：**「先内容、后人」不是设计选择，是 API 约束逼出来的。** 任何试图「先按人再拉内容」的实现都会撞墙。

### 4.2 运行时边界

| 边界 | 后果与对策 |
|---|---|
| **serverless 文件系统只读**（Vercel 的 `process.cwd()` 是 `/var/task`） | ⚠️ **这是最容易炸部署的一条。** 所有落盘必须走 `dataDir()`（探测 `DATA_DIR` → `cwd` → `os.tmpdir()`），且**所有写操作必须容错** —— 写不进去只是「失去缓存这个优化」，绝不能变成「请求失败」。已实现于 `framework/datadir.ts` + `DiskCache` / `DiskQuotaGuard` / `saveArtifact` |
| **serverless 无共享内存** | 会话状态**不能**放进程内 Map（每个 lambda 各一份）。所以 OAuth token 用 **AES-256-GCM 加密的 HttpOnly Cookie**，服务端无状态 |
| 同上 | 缓存与额度护栏必须是**模块级单例**。每次请求 new 一个的话，磁盘只读时进程内计数永远从 0 开始，护栏等于失效 |
| 同上 | 额度护栏在磁盘只读时退化为**进程内**，多实例各算各的 → **它是本地保险丝，不是全局配额**。要全局限流得接 Redis / Vercel KV |
| **Next 15 起 `cookies()` / `headers()` 是异步 API** | 必须 `await cookies()`。升级 Next 时优先 grep 这里 |
| Route Handler 默认 Node runtime | `node:crypto` / `node:fs` 可用；若要迁 Edge runtime，这几处都得换实现 |

### 4.3 额度边界

| 接口 | 每日上限 | 单次上限 | 备注 |
|---|---|---|---|
| `zhihu_search` | 1000 | 10 条 | 我们最主要的成本项，一次提问消耗 4 次（4 路 query） |
| `global_search` | 1000 | 20 条 | 当前未用 |
| `hot_list` | 100 | 30 条 | 当前未用 |
| 直答 `/v1/chat/completions` | 100 | — | 一次提问消耗 1~8 次（按召回内容数） |

**三层防护，缺一不可：**

1. **磁盘缓存**（`framework/cache.ts`）：同样输入第二次直接命中，TTL 24h。
2. **额度护栏**（`framework/quota.ts`）：按日计数 + 上限拦截，超了直接抛 `QuotaExceededError`，宁可早报错也不打光额度。
3. **请求限流**（`framework/throttle.ts` + `api/ask`）：默认 10 分钟 20 次/客户端，防止有人连点把额度烧穿。演示链接公开放到作品广场时这条是必需的。

**已知取舍**：额度是「发起请求前就 +1」，所以失败的调用也会计数。这是保守方向（宁可多算），线上排查时注意别被这个数字误导。

### 4.4 安全边界

| 边界 | 规则 |
|---|---|
| **三个凭证不能串位** | `app_id`（短数字，进配置）/ OAuth `app_key`（换 token 用）/ 开放平台 `Access Secret`（内容接口鉴权用）。**`app_key` 不是 `X-OAuth-Token`** |
| OAuth token | 只能存服务端加密 cookie，**不进浏览器 JS、不进前端日志、不进 URL** |
| **回调没有 `state`** | 知乎实测不回传 state ⇒ **无法完成标准 CSRF 校验**。现在的做法是「照常下发、能校验就校验」，并在重定向参数里标注 `stateChecked=0`。**不得声称生产级安全** |
| 图片代理 | 必须限制域名白名单（现在只放行 `*.zhimg.com` / `*.zhihu.com`），否则会变成开放代理 |
| `/api/ask` **没有鉴权** | 这是公开演示接口。防护只有限流 + 输入长度上限（1000 字）。**不要在里面做任何有破坏性的操作** |
| 密钥泄露 | `.env*.local` 已在 `.gitignore`；`/api/health` 只回布尔值，不回任何密钥内容 |

### 4.5 合规边界

- **禁止批量爬取、滥用站内用户数据**（赛事红线，会被取消资格）。
- 只读取**公开范围**内容；不要试图绕过权限。
- **`Candidate.rejectedReasons` 等内部诊断字段禁止外显** —— 它们包含"哪条证据没通过校验"，对外展示会显得像在指责作者。
- 展示他人内容时保留原文链接与作者名（现在的卡片就是这么做的）。
- 使用知乎 IP / 素材需遵守赛事期间的授权范围。

### 4.6 契约边界（重复强调，因为最容易违反）

- `framework/` 里不出现「分诊」「经历」「创作者」这类业务词。
- `steps/` 里不出现 `ZhihuHttpSource` / `ZhidaLlmClient` 这类实现类名。
- 只有 `adapters/index.ts` 知道所有实现。

### 4.7 性能边界

| 指标 | 实测值 |
|---|---|
| 全链路（fixture + 无 LLM） | ~110ms |
| 全链路（缓存全命中） | ~100ms |
| **全链路（真实模型冷启动）** | **42.8s**（triage 4.2s + profile 14.0s + events 24.5s，其余 <20ms） |
| `maxDuration` | 60s（`/api/ask`）—— 余量很薄，见第 10 节警告 |

**没有异步任务队列，也不需要。** 但 42.8s 说明「一次请求内跑完」已经接近上限，
所以两个杠杆要记住：`EXTRACT_MAX_HITS`（控制 LLM 调用条数）和演示前预热缓存。
**没有超时的出站调用等于没有降级** —— 所有 fetch 都必须走 `fetchWithTimeout`，
否则 provider 挂住时 `optional` / `llmOrFallback` 永远不会被触发（实测踩过 300 秒挂死）。

### 4.8 明确不做（scope 边界）

写下来是为了**防止有人好心加上去**：

- ❌ 多 Agent 自主协作 —— 增加不稳定性，也无法证明假设
- ❌ Async Job / 任务轮询 —— 见 4.7
- ❌ Push 触达 / 推送订阅页 —— 那是「问题订阅」产品，解决的是「何时主动找你」，与本产品「何时把问题还给人」是两个问题
- ❌ Topic Link API / 输出话题链接 —— 输出应该是**人**，给话题链接等于绕回内容侧
- ❌ 好友关系 / 长期维系、AI 自动私信 / 破冰
- ❌ 复杂支付系统 —— 知乎已有现成咨询能力
- ❌ 复杂图谱可视化 —— 好看但不直接提升「找对人」

---

## 5. 开发约定

| 项目 | 约定 |
|---|---|
| 语言 | 全部 TypeScript，`strict: true`。**不允许 `any` 逃逸**（`unknown` + 收窄） |
| 注释 | 中文。注释写**「为什么」**，不写「是什么」—— 代码本身说明是什么 |
| 模块头注释 | 每个文件顶部写清楚：这个文件负责什么、**有什么坑** |
| 常量 | 领域词典、阈值、权重都提到文件顶部具名常量，不要内联魔法值 |
| 依赖 | **保持 3 个生产依赖**（next / react / react-dom）。加任何新依赖前先问：能不能 60 行自己写 |
| 缓存 | 新增带 LLM/网络调用的步骤时必须提供 `cacheKey` |
| 降级 | 新增 LLM 调用时必须提供 fallback |
| 幂等 | 步骤应该是纯函数式的：只读 `input` 和端口，不写全局状态 |

### 改完代码一定要做的事

⚠️ **改了任何步骤的逻辑，就把 `src/steps/index.ts` 里的 `pipeline.version` 加一。**

缓存 key 里拼了 `pipeline.version`，不加版本号你会拿到**用旧代码算出来的缓存结果**，而且因为每步都命中缓存，trace 上看起来完全正常 —— 极难排查。这个坑我们已经踩过一次。

（只改注释、`summarize`、日志这类不影响产物的改动**不用**加版本。）

### Git 约定

- 分支：`main` 保持可运行；功能开 `feat/xxx`，修复开 `fix/xxx`
- commit：`feat(recall): 加向量召回 + RRF 融合` 这种 `type(scope): 描述` 格式
- **不要把 `.env.local`、`.cache/`、`.artifacts/` 提交上去**（已在 `.gitignore`）
- 提交前跑：`npm run typecheck && npm run build`

---

## 6. 怎么扩展

### 加一个步骤

1. 在 `src/domain/types.ts` 的 `Stages` 里加一个键（键名必须等于 `step.name`）
2. 新建 `src/steps/09-xxx.ts`，导出 `Step`
3. 在 `src/steps/index.ts` 的 `steps` 数组里插到正确位置（顺序 = 执行顺序）
4. `pipeline.version` +1
5. `npm run typecheck` —— 如果 `from` 写错了，启动时会报错并列出可用产物名

### 换/加数据源

1. 在 `src/adapters/` 新建实现，`implements ContentSource`
2. 在 `src/adapters/index.ts` 的 `pickSource()` 里按环境变量分发
3. **不要**在步骤里直接引用它

### 换模型

- 用环境变量切：`LLM_PROVIDER=zhida | openai | none`
- 新增 provider：实现 `LlmClient`，在 `adapters/index.ts` 的 `llm()` 里分发
- **注意**：知乎直答是 OpenAI 兼容但**不支持 `response_format: json_object`**，所以结构化输出走「提示词约束 + 宽松解析 + 校验」三件套（`framework/llm-utils.ts`）

### 调重排权重

改 `src/steps/06-rank.ts` 的 `DEFAULT_WEIGHTS`。**但不要拍脑袋调** —— 用 Golden Set 跑对照，看指标变化再定。现在的权重是初始值。

---

## 7. 调试与排错

| 现象 | 先看哪 |
|---|---|
| 链路每一步都 `ok` 但结果为 0 | 99% 是某个 `from` 写错了。现在启动会被 `validatePipeline()` 拦住；如果漏过，对比 `.artifacts/<runId>/` 里各步产物 |
| 改了逻辑但行为没变 | 缓存。看 trace 是不是全是 `cached`，是就 bump `pipeline.version` |
| 部署后接口 500 | 打 `/api/health` 看 `runtime.dataDirWritable`。false 说明回退到了 `/tmp`（正常），但若报 EROFS 说明有地方绕过了 `dataDir()` |
| 知乎接口报 `Code=20001` | 鉴权失败。检查 `Authorization: Bearer` 用的是 **Access Secret**，不是 OAuth app_key |
| 知乎接口报 `Code=30001/30002` | 频率/配额限制。停手，看 `/api/health` 的 `quotaUsedToday` |
| 直答一直失败 | 看 `LLM_PROVIDER`；`zhida` 需要 `ZHIHU_ACCESS_SECRET`。失败会自动降级到启发式，所以不会中断链路 |
| OAuth 回调报缺 code | 知乎回调用的是 `authorization_code` 参数；`pickAuthorizationCode()` 已兼容两种 |
| OAuth 报连接超时 | 平台出口 IP 可能被知乎屏蔽（zhihu-circle 踩过，它做了代理兜底） |
| LLM 输出解析失败 | `extractJson()` 能容忍围栏和前后文字；仍失败说明模型没吐 JSON，看 system prompt 里的 `schemaHint` |

**`src/framework/llm-utils.ts` 的 `extractJson` 是宽松解析器**，能处理：```json 围栏、前后解释文字、字符串里的花括号。不要换成 `JSON.parse`。

### 最有用的调试手段

看 `.artifacts/<runId>/` —— 8 个 JSON 文件就是这条链路每一步的真实输入输出。**不用重跑全链路，直接看是哪一步歪了。**

---

## 8. 对照实验流程（✅ 已实现）

**路演最重要的一页**：用数据回答「它比直接用关键词搜索强吗」。

一条命令：

```bash
npm run gold:build   # 生成 Golden Dataset（168 条语料 + ground truth）
npm run eval         # 跑 A/B/C 三组，产出 eval/report.md
npm run eval:llm     # 同上，但用真实 LLM（慢、耗额度，抽取质量真实）
```

### 配置是数据，不是代码

```ts
runAsk(question, { experiment: 'A' | 'B' | 'C' })
```

三组**共用同一个 `runAsk`**，差异全部来自 `src/domain/experiment.ts` 里的 `ExperimentConfig`。
配置经 `runPipeline(..., { config })` 注入 `StepContext.config`，步骤自行 cast 后取用。

**这是对照实验可信的前提** —— 三组之间不能有任何实现差异，否则你比的不是召回策略，
而是「两次不同的实现」。

| 版本 | recall | extract | verify | 权重 |
|---|---|---|---|---|
| **A** Basline | `keyword` | ✗ | ✗ | 只看 relevance |
| **B** Basline | `semantic` | ✗ | ✗ | 只看 relevance |
| **C** Version C | `hybrid`（RRF） | ✓ | ✓ | 7 项完整权重 |

### 关键实现点

**① A/B 关掉抽取后，靠「伪事件」仍能推荐人**（`05-aggregate.ts`）

如果只是把 `events` 置空，A/B 会产出 0 位候选，对照就没法比了。
所以 A/B 走降级路径：**把召回内容本身当作一条经历**（quote 取正文首句，`firstPerson: false`）。
这恰好暴露了要打的靶子：**「能找到证据」不等于「这条证据说明他经历过」**。

**② 权重/召回模式必须进 cache key**（`03-recall.ts` / `06-rank.ts`）

否则 A 组跑完，B 组直接读到 A 组的缓存 —— 而 trace 上一切正常（全 `cached`），
你会得出「调参没区别」的错误结论。

**③ ground truth 与检索语料物理隔离**

`src/fixtures/gold-hits.json`（检索用，**不含** `_gold`）↔ `scripts/gold/labels.json`（仅评测读）。
一旦搜索引擎能看到「谁是亲历者」，实验就变成作弊。文件级隔离是唯一可靠做法。

**④ 作者级标注必须是 topic 维度**

一位作者写了 5 篇，其中 1 篇关于「期权」是亲历 —— 他对「期权怎么估值」是有效人选，
对「IC 转管理」不是。只标「有没有亲历过任何事」的话，几乎所有作者都会被标成有效，
指标就失去区分度了（第一版踩过这个坑）。

### 指标定义

| 指标 | 定义 | 备注 |
|---|---|---|
| **Top-3 有效人选率** | 前 3 人里「确实第一人称写过该主题」的比例 | **主指标** |
| 至少命中 1 位 | Top-3 里有亲历者的比例 | 更抗噪声的二值指标 |
| 产出覆盖率 | 能为多少问题产出推荐 | Triage 判 `ai`/`content` 会走「别问人」路径，不算失败，故单列 |
| 证据覆盖率 | 外显理由能逐字回溯的比例 | 只有 C 组做校验，A/B 恒为 0 |
| 大 V 集中度 | 结果被高赞用户占据的程度 | 健康指标，越低越好 |
| P95 响应时间 | 95 分位延迟 | 受 `maxDuration=60` 约束 |

### 实测结果（2026-09-12，168 条合成语料 / 20 问题 / `LLM_PROVIDER=none`）

```
A 纯关键词    Top-3 有效人选率 68.5%  至少命中1位 88.9%  覆盖率 90.0%
B 纯语义      Top-3 有效人选率 66.7%  至少命中1位 94.4%  覆盖率 90.0%
C 完整链路    Top-3 有效人选率 85.2%  至少命中1位 100.0% 覆盖率 90.0%
```

逐问题明细里最有说服力的一条：`q07`/`q09`（都是「IC 转管理」类情境），
**A 组是 0/3 —— 三个人一个都不对**，因为「管理岗」这个词在职场讨论里太泛，
纯关键词搜出来的全是方法论文章；C 组拿到 2/3 和 3/3。

### ⚠️ 必须如实声明的局限

1. **语料是合成的**（`scripts/gold/corpus.mjs`）：ground truth 在生成时写入。
   验证的是「方法在受控条件下有效」，**不能替代真实数据结论**。
2. **「有效」判定是上界**：只判断「有没有写过该主题」，不判断内容是否真能回答该问题。
3. **B 组是弱基线**：默认 embedder 是 hash 投影（词元重合度），不是真语义模型。
   要可信的 B 组数字需配 `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL`。
   C 组的增益主要来自「经历抽取 + 证据校验」，不依赖 embedding 质量。
4. 真实数据部分（`npm run harvest`）**没有 ground truth**，只能人工抽查，与合成语料分开陈述。

### 踩过的坑

- **`eval.mjs` 默认不复用已有服务**：端口上是「改代码之前起的」旧进程时，
  你会在完全不知情的情况下用旧代码跑完评测，然后对着假数据调参。
  复用必须显式 `--reuse`。（第一版就是这样，指标全错。）
- **语料模板必须是通顺中文**：无 LLM 时抽取走 `heuristic()`（按「我当时」锚点切句 +
  逐字摘录）。病句语料会让拼出的 quote 前后不接，被 e2e 的证据不变式逮到。
- **不要把 `/embeddings` 端点想当然**：「OpenAI 兼容的 chat 端点」≠「有 embeddings 端点」。
  SenseNova 的 `LLM_BASE_URL` 就没有，自动复用凭证会让 B/C 组 404 崩掉整条请求。
  现在默认降级到 hash，要用真 embeddings 必须显式配 `EMBEDDING_*`。

---

## 9. OAuth 协议偏差


以下是官方文档 + 线上实测的结论，`adapters/zhihu-oauth.ts` 已全部处理。**照抄，不要重新发明。**

| # | 偏差 | 我们的处理 |
|---|---|---|
| 1 | 回调参数是 **`authorization_code`**，不是文档里的 `code` | `pickAuthorizationCode()` 两个都接 |
| 2 | 换 token 的表单字段**仍然叫 `code`**，且 `grant_type` 固定 `authorization_code` | 已按此提交 |
| 3 | **回调不回传 `state`** | 照常下发并尝试校验，缺失时在重定向参数标注 `stateChecked=0` |
| 4 | token 响应业务字段 **`code: 20000` 是成功** | 以 `access_token` 是否存在为准，不看 code |
| 5 | **没有** PKCE / scope / refresh token / 撤销接口 | token 过期只能重新授权 |
| 6 | `/user` 没有正式响应 schema | 不解析、不伪造用户字段 |
| 7 | 调用用户数据接口要**同时**带 Bearer + `X-OAuth-Token` | `ZhihuHttpSource.get(withOAuth=true)` 已实现 |
| 8 | `localhost` 不能做真实登录 | 必须公网 HTTPS 部署 + 开放平台登记回调 |

---

## 10. 部署与联调 Runbook

真实 OAuth 登录**必须**走这条路 —— `localhost` 无法完成登录，这是平台限制。

### 第 0 步：本地能验证到哪一步（先做，能省很多时间）

```bash
npm run zhihu:doctor    # 三类凭证齐不齐、回调地址是否合法
npm run llm:probe       # 模型能不能稳定吐 JSON（结构化输出是本项目的硬依赖）
npm run e2e             # 28 个用例：链路、防御、证据可回溯（fixture，3 秒）
npm run e2e:llm -- --fresh   # 真实模型链路（约 45 秒）
```

`zhihu:doctor` 的诚实结论要记住：**App ID / App Key 在本地无法验证**。
实测依据（已写进脚本注释）：用伪造 code 打 `/access_token` 时，真实与错误的 App ID
返回**完全相同**的 `Access denied: not exists`；`/authorize` 也只是 302 跳登录页并原样回显 app_id。
所以脚本在无法判定时会报「无法判定」，**不会给你一个假通过**。

### 第 1 步：部署拿到公网 HTTPS 域名

Vercel / Cloudflare / Sealos 均可。Vercel 导入 GitHub 仓库即可，无需改构建配置。

Environment Variables 填：

| 变量 | 值 |
|---|---|
| `ZHIHU_APP_ID` | 开放平台申请到的 App ID（短数字） |
| `ZHIHU_OAUTH_APP_KEY` | 与 App ID 一起发放的 OAuth App Key |
| `ZHIHU_ACCESS_SECRET` | **另一个凭证**，在 developer.zhihu.com/profile 生成 |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ZHIHU_REDIRECT_URI` | `https://<域名>/api/oauth/callback` |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_BASE_URL` / `LLM_API_KEY` | 模型配置 |

**不要**填 `DATA_DIR` —— serverless 上 `cwd` 只读，代码会自动回退到 `/tmp`。

> ⚠️ `ZHIHU_REDIRECT_URI` 必须与开放平台登记的地址**逐字符一致**，包括结尾有没有斜杠。

### 第 2 步：登记回调地址

到知乎开放平台把 `https://<域名>/api/oauth/callback` 加进回调白名单。
**这一步没做，点「授权知乎账号」一定会失败。**

### 第 3 步：按顺序验证

```bash
curl -s https://<域名>/api/health | python3 -m json.tool
```

- [ ] `configured.oauth` / `accessSecret` / `sessionSecret` 全为 `true`
- [ ] `runtime.dataDirWritable` 为 `true`（会在 `/tmp` 下）
- [ ] `GET /api/oauth/status` 里 `credentials.missing` 为空数组
- [ ] 浏览器点「授权知乎账号」→ **授权页由本人点击确认** → 回到首页看到「已授权 · 昵称」
- [ ] 回到首页后凭证提示条消失
- [ ] `quotaUsedToday` 随使用增长

### ⚠️ 部署环境的两个关键差异

1. **`maxDuration` 是硬约束。** 实测真实模型链路冷启动 **42.8s**（triage 4.2s + profile 14.0s + events 24.5s）。
   Vercel Hobby 上限 60s，**余量很薄**：模型一慢就会 504。
   缓解优先级：① 部署环境设 `maxDuration = 300`（Pro 才有）→
   ② 降低 `EXTRACT_MAX_HITS`（当前 4）→ ③ 换更快的模型。
2. **缓存基本不生效。** serverless 的 `/tmp` 每实例独立且随时可能被回收，
   所以线上额度消耗远高于本地。**演示前务必在本地把要演示的问题跑一遍预热**，
   或在演示环境用 `USE_FIXTURES=1`。

### 本地调试 OAuth 的替代方案

如果暂时不想部署，可以起一条隧道拿公网域名（`cloudflared` / `ngrok`）。
但**回调地址必须登记在开放平台**，而快速隧道的域名每次重启都会变，
所以更实际的做法还是部署到一个稳定域名。

---

## 11. 提交前自检

```bash
npm run typecheck        # 必须无输出
npm run build            # 必须 ✓ Compiled successfully
npm audit                # 必须是 found 0 vulnerabilities
```

然后人工确认：

- [ ] 改了步骤逻辑 → `pipeline.version` 已 +1
- [ ] 新增的 LLM 调用有 fallback 和 `cacheKey`
- [ ] 新增的文件顶部有「负责什么 + 有什么坑」的注释
- [ ] 没有在 `framework/` 里引入业务名词
- [ ] 没有在 `steps/` 里 import 具体实现类
- [ ] 没有把 `rejectedReasons` 这类内部字段渲染到界面
- [ ] 没有新增生产依赖（除非有充分理由）
- [ ] **`npm run publish:check` 通过**（提交公开仓库前必跑，见第 12 节）

---

## 12. 仓库发布范围

这个仓库会作为「代码仓库链接」提交给赛事评审（选交项，但计加分）。所以**发布范围要自觉约束**。

### 会发布

| 内容 | 为什么公开 |
|---|---|
| `README.md` | 产品是什么、怎么跑 —— 评审第一眼看的就是它 |
| `DEVELOPER.md` | 架构与工程边界 —— 工程规范的直接证据 |
| `AGENT.md` | AI 协作约定 —— 现代工程实践的体现 |
| `src/` `scripts/` 配置文件 | 代码本身 |
| `.env.example` | 变量模板（**绝不含真实值**） |

### 不发布（`internal/`，已被 gitignore）

| 内容 | 为什么不公开 |
|---|---|
| `internal/HANDOFF.md` | 交接说明，写给团队自己看的 |
| `internal/STATUS.md` | 进度排期、内部取舍判断 |

**为什么用目录级忽略而不是逐个文件加规则**：`.gitignore` 是只增不减的规则表，
靠人记住"哪些不能传"一定会漏。把内部资料统一放进 `internal/`，以后新增文档
不需要改 `.gitignore`，也就不会因为漏一条规则而出事故。

**为什么这两份不公开**：它们是**第二人称、带日期、含内部取舍**的团队自用材料
（例如「你这块完全没做」「建议不做 X」）。公开仓库应该展示**产品与工程本身**，
而不是团队的草稿本。对外的路线图摘要已经在 README 里了。

### 强制自检

```bash
npm run publish:check
```

它做三件事：

1. **按 `.gitignore` 反推**出真正会被发布的文件清单（规则表是唯一事实源，不会走样）
2. **读取 `.env.local` 里的真实密钥值，逐个在可发布文件里反查** ——
   这是主防线。模式匹配只能抓「长得像密钥的东西」，而反查直接回答
   「我的密钥有没有漏进要公开的文件」，零假设。
3. 兜一层通用模式扫描（`sk-` 字面量、引号包裹的密钥），防住还没写进 `.env.local` 的凭证。

> ⚠️ 这类检查**必须做投毒验证**才能信。
> 我们第一版把占位符判定写成 `/^(|your[-_]|...)/`，开头那个**空分支**让正则恒真，
> 于是每个真实密钥都被当成占位符跳过、反查形同虚设 —— 而脚本照样打印「自检通过」。
> **给的是假安全感，比没有检查更危险。** 现在「未加载到密钥」会显式报错而不是静默跳过。

### 关于 git 历史

删掉文件**不会**把它从历史里移除。判断方法：

```bash
git log --all --oneline -- <被删文件>     # 有输出说明历史里还在
```

如果这个仓库**从未推送过**，最干净的做法是重新开始（能拿到一个完全干净的首次提交）：

```bash
rm -rf .git && git init && git add -A && git commit -m "feat: 知乎问人 —— 让 AI 知道什么时候该把问题还给人"
git status --short        # 确认 .env.local / internal/ 都不在待提交列表里
```

**如果已经推送过**，删文件不够，需要重写历史（`git filter-repo`）**并且轮换所有泄露过的凭证** ——
后者更重要：一旦密钥进过公开仓库，就要当作已泄露处理。

---

*知乎黑客松 2026 · 校园新锐季 ｜ 有问题先看第 4 节工程边界，八成答案在那里*
