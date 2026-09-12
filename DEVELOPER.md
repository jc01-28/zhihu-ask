# DEVELOPER.md · 开发者手册

> 面向本项目开发者（我 + 队友）。目标：**看完这一份就能安全地改代码，不踩已经踩过的坑。**
> 产品向的介绍看 [README.md](README.md)，当前进度与排期看 [docs/STATUS.md](docs/STATUS.md)。

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
| `npm run harvest` | 离线预热：抓真实内容落成 fixture |
| `npm audit` | 应为 `found 0 vulnerabilities` |

---

## 1. 架构与分层边界

```
┌─────────────────────────────────────────────────────────────┐
│ L1 表现层   app/page.tsx · components/*                     │  只消费 AskResult
├─────────────────────────────────────────────────────────────┤
│ L2 接口层   app/api/**                                       │  薄 IO：校验 + 取会话 + 限流
├─────────────────────────────────────────────────────────────┤
│ L3 业务编排 steps/**           ← 你的业务核心                │  8 个 Step 的顺序 + 入口 runAsk
├─────────────────────────────────────────────────────────────┤
│ L4 契约层   domain/types.ts                                  │  只有类型，没有逻辑
├─────────────────────────────────────────────────────────────┤
│ L5 框架层   framework/**                                     │  不知道业务是什么
│     ports · pipeline · cache · quota · datadir · throttle    │
├─────────────────────────────────────────────────────────────┤
│ L6 适配层   adapters/**                                      │  知道怎么对接，不知道业务规则
│     zhihu-http-source · source-fixture · llm · session       │
│     index.ts  ← 唯一装配根                                    │
└─────────────────────────────────────────────────────────────┘
```

### 三条不可破的边界（代码评审就用这三条）

1. **`framework/` 里不允许出现任何业务名词。**
   现在它对外的 API 只有 `Step` / `Pipeline` / `runPipeline` / `ContextDeps`，输入输出都是 `unknown`。
   → 好处：想换成 LangGraph，只需替换 `runPipeline` 这个 driver，`steps/` 一行不用改。

2. **`steps/` 里不允许 `import` 任何具体实现类。**
   只能通过 `ctx.source` / `ctx.llm` / `ctx.cache` / `ctx.quota` 这几个端口访问外部世界。
   → 好处：换数据源、加缓存、换模型，都不需要动业务流程。

3. **`adapters/index.ts` 是唯一的装配根。**
   换数据源、换模型、调额度策略，只改这一个文件。
   → 反例：不要在某个 step 里 `new ZhihuHttpSource()`。

### 依赖方向

```
app → steps → domain / framework
app → adapters ─┐
steps ─────────┴→ framework/ports（只有接口）
```

`framework` 不依赖任何人，`domain` 只依赖 `framework/ports` 的类型。**没有反向依赖，也没有循环依赖。**

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
| 全链路（真调 8 次 LLM） | 数秒~十几秒 |
| `maxDuration` | 60s（`/api/ask`） |

**没有异步任务队列，也不需要。** 引入 Async Job 会带来状态机、进度轮询、失败重试一大堆非核心复杂度，而当前链路一次请求内能跑完。

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

## 8. 对照实验流程

这是路演最重要的一页，目前**还没做**。前置是一个小重构：

```
现在：  runAsk(question: string, opts)
目标：  runAsk({ question, experiment: 'A' | 'B' | 'C' })
```

配置需要经 `StepContext`（或 `boot`）透传到 `03-recall` 和 `06-rank`。**A/B/C 必须是「同一套代码 + 不同配置」**，否则对照不干净。

| 版本 | 配置 |
|---|---|
| **A** Baseline | 只用关键词检索，取前 3 位作者，不做经历抽取 / 校验 |
| **B** Baseline | 只用向量检索，同样取前 3 位作者 |
| **C** Version C | 关键词 + 向量 + RRF → 经历抽取 → 重排 → 证据校验（完整链路） |

**输出指标**（读 `.artifacts/` 或直接读 `AskResult.metrics`）：

- Top 3 有效人选率（北极星，需要人工标注 Ground Truth）
- 意外发现率（用户认为「自己搜不到」的比例）
- 证据覆盖率 / 无证据陈述率
- 大 V 集中度
- P95 响应时间

**Golden Set 建议规模**：20 个真实职场问题 · 30~50 位创作者 · ~250 篇内容 · 人工标注 Ground Truth。
先用 `npm run harvest` 抓真实内容，再人工标注成 JSON/CSV。

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

## 10. 部署清单

以 Vercel 为例：

- [ ] 代码推到 GitHub（确认 `.env.local` / `.cache/` / `.artifacts/` 没进仓库）
- [ ] Vercel 导入仓库
- [ ] Environment Variables 填：`ZHIHU_APP_ID`、`ZHIHU_APP_KEY`、`ZHIHU_ACCESS_SECRET`、`SESSION_SECRET`、`ZHIHU_REDIRECT_URI`、`LLM_PROVIDER`、`LLM_MODEL`
      **不要**填 `DATA_DIR`（让它自动回退到 `/tmp`）
- [ ] `ZHIHU_REDIRECT_URI` = `https://<域名>/api/oauth/callback`，并**逐字符**登记到开放平台白名单
- [ ] 部署后打 `/api/health`：
  - `configured.accessSecret` / `oauth` / `sessionSecret` 都应为 `true`
  - `runtime.dataDirWritable` 应为 `true`（会在 `/tmp` 下）
- [ ] 走一遍完整 OAuth：点「授权知乎账号」→ 授权页**由本人点击确认** → 回到首页看到「已授权」
- [ ] 检查 `quotaUsedToday` 增长正常
- [ ] 演示前本地跑一遍要用的示例问题，让缓存预热（**注意：Vercel 上用 /tmp，实例重启就没了 —— 缓存预热只在自建长驻服务上有效**）

**⚠️ 部署环境与本地环境的关键差异**：serverless 的 `/tmp` 是**每实例、可能随时被回收**的，所以**部署环境下缓存基本不生效**，额度消耗会比本地高。演示时优先用 fixture 模式，或把要演示的问题在本地跑熟。

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

---

*知乎黑客松 2026 · 校园新锐季 ｜ 有问题先看第 4 节工程边界，八成答案在那里*
