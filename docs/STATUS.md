# 实现现状盘点

> 本文档是**进度与排期的唯一事实源**。配套文档：
> [README.md](../README.md)（面向大众的产品介绍）· [DEVELOPER.md](../DEVELOPER.md)（面向开发者的架构与工程边界）
>
> 盘点时间：2026-09-12 16:40 ｜ 对应代码版本：`askPipeline` v0.1.5
> 图例：✅ 可运行 · 🟡 有基线实现待升级 · ⬜ 未做 ｜ 规模：S（半天内）/ M（半天~一天）/ L（一天以上）
>
> **结论先行**：核心链路（8 步）已经端到端跑通，本地可演示。剩下的工作可以分成两半 ——
> **「证明它有效」（评测）** 和 **「让它更准」（向量召回 + 抽取质量）**。
> 页面设计、推送、分享这些属于外壳，时间不够就砍。

---

## 一、技术栈总览（已完成部分用了什么）

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | **Next.js 15.5.25**（App Router）+ **React 19** + **TypeScript 5** + **Tailwind CSS 3** | 与 zhihu-circle 同源，页面壳与部署方式可复用 |
| 后端 | **Next.js Route Handlers**，`runtime = 'nodejs'` | 不需要独立后端服务，一个进程搞定 |
| 会话安全 | **AES-256-GCM 加密的 HttpOnly Cookie**（`node:crypto`） | OAuth token 不进浏览器、不进前端日志；服务端无状态，Vercel 也能用 |
| 大模型 | **知乎直答**（OpenAI 兼容 `POST /v1/chat/completions`，`zhida-fast-1p5`） | 也可切任意 OpenAI 兼容端点；未配置时自动走启发式降级 |
| 数据源 | **知乎开放平台 HTTP API**（`Bearer` + `X-Request-Timestamp`） | `zhihu_search` / `global_search` / `user/followees` 等；无凭证时切 fixture |
| 缓存 | **自研磁盘 KV**（sha256 key + TTL，`.cache/`） | 保护 API 额度 + 让演示不依赖实时网络 |
| 额度护栏 | **自研按日计数 + 上限拦截**（`.cache/quota-YYYY-MM-DD.json`） | 搜索 1000/天、直答 100/天，防烧穿 |
| 工作流引擎 | **自研**（`Step` / `Pipeline` / `runPipeline`） | 产物落盘 + 步骤缓存 + `shouldRun` 守卫 + `optional` 降级 + 声明校验 + 版本化缓存 key |
| 生产依赖 | **只有 3 个包**：`next` / `react` / `react-dom` | 零额外运行时依赖，`npm audit` = 0 vulnerabilities |

**已验证**：`tsc --noEmit` 零错误、`next build` 成功、本地 `npm run dev` 页面与 `POST /api/ask` 全通、fixture 模式下 8 步 ~110ms、证据覆盖率 100%。

---

## 二、按运行时层级梳理

### L1 · 表现层（前端）

| 事项 | 状态 | 已用 / 待用技术栈 | 位置 | 规模 |
|---|---|---|---|---|
| 提问页（输入 + 示例问题） | ✅ | React 19 `useState` + Tailwind | `app/page.tsx` | — |
| 结果页（推荐卡片） | ✅ | React 组件 | `components/RecommendationCard.tsx` | — |
| 证据片段展示（原文引用） | ✅ | — | 同上 | — |
| 匹配分 + 打分明细（可解释性） | ✅ | — | 同上 `<details>` | — |
| 链路看板（8 步产物数量） | ✅ | 框架 `trace.summary` | `app/page.tsx` `PipelineBoard` | — |
| 状态组件（加载 / 错误 / 无结果） | ✅ | — | `app/page.tsx` | — |
| 授权状态提示 | ✅ | `GET /api/oauth/status` | `app/page.tsx` | — |
| **提问历史** | ⬜ | `localStorage`（零依赖，MVP 够用）；要跨设备再上 SQLite/Postgres | 新增 | S |
| **分享海报** | ⬜ | `html-to-image` + `qrcode.react`（zhihu-circle 同款已验证） | 新增 | S |
| **指标看板（可视化健康指标）** | ⬜ | 直接渲染 `AskResult.metrics`，可加 `echarts`（zhihu-circle 已用） | 新增 | S |
| 推送订阅设置页 | ⬜ | **建议砍**（属于另一个产品） | — | — |
| 视觉打磨 / 动效 | ⬜ | Tailwind；**放在最后做** | — | M |

> 说明：`AskResult.metrics` 里已经算好了 4 个指标（证据覆盖率 / 无证据陈述率 / 大 V 集中度 / 候选数），前端只要接上就能变成看板 —— 这是性价比最高的一个展示项。

### L2 · 接口层（后端）

| 事项 | 状态 | 已用 / 待用技术栈 | 位置 | 规模 |
|---|---|---|---|---|
| Query API（提交问题） | ✅ | `POST /api/ask`，`maxDuration = 60` | `app/api/ask/route.ts` | — |
| 知乎 OAuth 授权跳转 | ✅ | 302 到 `openapi.zhihu.com/authorize`（含 state cookie） | `app/api/oauth/authorize` | — |
| OAuth 回调换 token | ✅ | 表单换 `/access_token`，兼容 `authorization_code` / `code` | `app/api/oauth/callback` | — |
| 授权状态查询 / 登出 | ✅ | 加密 cookie 会话 | `app/api/oauth/status`、`logout` | — |
| 健康自检 | ✅ | `GET /api/health`（只回布尔，不泄密钥） | `app/api/health` | — |
| 图片代理（绕过防盗链） | ✅ | `GET /api/image-proxy`（域名白名单） | `app/api/image-proxy` | — |
| **真实 OAuth 联调** | ⬜ | 需要公网 HTTPS 部署 + 开放平台登记回调；**本地 localhost 无法完成真实登录** | — | S |
| **请求限流（额度保险丝）** | ✅ | `MemoryThrottle` 进程内滑窗，默认 10 分钟 / 20 次；`ASK_RATE_LIMIT` 可调，0 关闭 | `framework/throttle.ts` + `api/ask` | — |
| 输入长度上限 | ✅ | 1000 字，防单次把 LLM 额度打光 | `api/ask` | — |
| **评测接口（可选）** | ⬜ | `POST /api/admin/eval`，跑 Baseline A/B/C；或直接用 npm 脚本 | 新增 | M |
| Async Job / 任务轮询 | ⬜ | **建议不做**：实测链路 100ms~几秒，`maxDuration=60` 足够 | — | — |
| Push 触达 API | ⬜ | **建议砍** | — | — |
| Topic Link API | ⬜ | **建议不做**（输出话题链接与"推荐人"定位冲突） | — | — |

### L3 · 编排层（框架，已全部完成）

这部分是让业务步骤能拼起来的地基，**已经做完且验证过**，不是待办项。

| 能力 | 状态 | 技术栈 | 位置 |
|---|---|---|---|
| 工作流引擎（顺序执行 + 多输入） | ✅ | 自研 `runPipeline`，`from` 支持 `null` / 单名 / 数组 | `framework/pipeline.ts` |
| 产物落盘（可回放、写评测报告用） | ✅ | `fs/promises` → `.artifacts/<runId>/NN-<step>.json` | 同上 |
| 步骤级缓存 | ✅ | `DiskCache`，sha256 key + TTL | `framework/cache.ts` |
| 版本化缓存 key | ✅ | `pipeline.version` 拼进所有 key | `framework/pipeline.ts` |
| 声明校验（拦住写错的 `from`） | ✅ | `validatePipeline()` | 同上 |
| `shouldRun` 守卫 / `optional` 降级 | ✅ | — | 同上 |
| 额度护栏 | ✅ | `DiskQuotaGuard` | `framework/quota.ts` |
| LLM 结构化输出（宽松 JSON 解析 + 校验） | ✅ | `extractJson` / `structureSystem` | `framework/llm-utils.ts` |
| 中文分词（2~3 元滑窗 + 停用词） | ✅ | 零依赖正则 | 同上 |
| 每步产物摘要（链路可见） | ✅ | `autoSummary()` + `Step.summarize()` | `framework/pipeline.ts` |
| **数据目录自动探测（serverless 只读兼容）** | ✅ | `DATA_DIR` → `process.cwd()` → `os.tmpdir()` 逐级探测 | `framework/datadir.ts` |
| **写入容错（写不进去不报错）** | ✅ | 缓存 / 额度 / 产物三处的写操作全部吞异常 | `cache.ts`、`quota.ts`、`adapters/index.ts` |

### L4 · 业务步骤层（核心链路，8 步）

| # | 步骤 | 状态 | 已用 / 待用技术栈 | 规模 |
|---|---|---|---|---|
| 01 | **分诊**（内容 / AI / 真人三路由） | ✅ | 领域信号词典启发式 + LLM 判定取更保守一侧 | — |
| 02 | **问题结构化**（现状/目标/约束/所需经历/检索词） | 🟡 | LLM 结构化输出；无 LLM 时**领域词典驱动**生成检索词。待升级：多意图拆分 + 同义扩展 | M |
| 03 | **混合召回** | 🟡 | **只做了关键词侧**（调知乎 `zhihu_search`，多路查询合并去重）。**向量侧未做** | M |
| 04 | **经历事件抽取**（Experience Event） | 🟡 | LLM 结构化抽取 + `firstPerson` 标记 + 逐字 `quote`；待升级：时间归一化、"Explicit Fact vs Model Inference" 区分、批处理省额度 | M |
| 05 | **创作者聚合** | ✅ | 按 `AuthorName` 聚合 + 用 OAuth 关注列表补主页 URL / 「你已关注」 | — |
| 06 | **重排** | 🟡 | 可解释加权打分（7 项 breakdown，**粉丝量不进公式**）；**权重是拍脑袋的，待用 Golden Set 调** | S |
| 07 | **证据校验** | ✅ | **确定性**子串回溯（不是再问一次模型）；未通过的候选直接剔除 | — |
| 08 | **解释生成** + 别问人路径 + 指标汇总 | ✅ | 三种互补角色 + 诚实性字段「不适合回答」+ `metrics` | — |
| — | **推送决策** | ⬜ | **建议砍** | — |

### L5 · 适配层（外部服务对接）

| 事项 | 状态 | 已用 / 待用技术栈 | 规模 |
|---|---|---|---|
| 知乎 HTTP 内容源（搜索 / 热榜 / 关注 / 创作） | ✅ | `ZhihuHttpSource`，`Bearer` + `X-Request-Timestamp`，含 401/403 业务码处理 | — |
| 本地 fixture 内容源（零凭证可跑） | ✅ | `FixtureSource`，分词加权匹配 | — |
| LLM 三实现（直答 / OpenAI 兼容 / 空实现） | ✅ | `ZhidaLlmClient`、`OpenAICompatLlmClient`、`NoLlmClient` | — |
| 会话加密 | ✅ | `node:crypto` AES-256-GCM | — |
| 装配根（唯一知道所有实现的地方） | ✅ | `adapters/index.ts`，按 env 挑实现 | — |
| **Embedding 适配器** | ⬜ | 见下方「技术选型建议」 | M |
| **真实知乎接口联调** | ⬜ | 需要 `ZHIHU_ACCESS_SECRET`（developer.zhihu.com/profile 生成）；**框架已就绪，只差凭证** | S |
| **隐私脱敏** | ⬜ | 正则清洗 `email` / `phone_no` 等；可复用 zhihu-circle 的 `sanitize.ts` 思路 | S |

### L6 · 数据与评测层（**优先级最高，你目前完全没做**）

| 事项 | 状态 | 建议技术栈 | 规模 |
|---|---|---|---|
| 离线内容抓取 | ✅ | `scripts/harvest.mjs`（Node 原生 fetch + `--env-file`），输出 `src/fixtures/harvested-hits.json` | — |
| **Golden Dataset**（20 个真实问题 + 30~50 位创作者 + ~250 篇内容 + 人工 Ground Truth） | ⬜ | 先用 `harvest.mjs` 抓真实内容，再人工标注成 CSV/JSON | L |
| **对照实验脚本（Baseline A/B/C）** | ⬜ | 纯 Node/TS 脚本，读 `.artifacts/<runId>/*.json` + 标注文件算指标。**这是路演最重要的一页** | M |
| **实验参数化（A/B/C 的前置重构）** | ⬜ | 把 `01` 的检索模式、`06` 的权重提到 pipeline 的启动配置里（当前 `boot` 只是一个 `string`），否则三组对照跑不干净 | S |
| 指标计算 | 🟡 | `AskResult.metrics` 已算 4 项；还差「意外发现率」「P95 响应时间」需在评测脚本里补 | S |

### L7 · 工程与部署层

| 事项 | 状态 | 技术栈 | 规模 |
|---|---|---|---|
| 依赖安全（0 漏洞） | ✅ | next 15.5.25 / react 19 / postcss 8.5.28 + npm `overrides` | — |
| 环境变量模板 | ✅ | `.env.example`，含额度配置与降级开关 | — |
| 类型检查 / 构建 | ✅ | `npm run typecheck` / `npm run build` | — |
| **部署上线** | ⬜ | **Vercel**（Next 15 原生最省事）。⚠️ OAuth 回调必须是公网 HTTPS，且要登记到开放平台；**Vercel 出口 IP 可能被知乎屏蔽导致超时**（zhihu-circle 踩过，它做了代理兜底） | M |
| **演示预热** | ⬜ | `npm run harvest` + 跑一遍要演示的问题让 `.cache/` 生效 | S |
| 代码仓库公开（加分项） | ⬜ | GitHub/Gitee；注意 `.env.local` 已在 `.gitignore` 里 | S |
| 演示视频 / 计划书 | ⬜ | 计划书是**必交项**，且初审重点考核 | L |

---

## 三、未完成项的技术选型建议（可落地的具体方案）

### 1. 向量召回：不要上向量数据库

这是 03 步唯一缺的东西，也是「Version C vs Baseline B」的核心变量。

| 决策点 | 建议 | 理由 |
|---|---|---|
| Embedding 模型 | 优先 **本地 `bge-small-zh-v1.5` / `BGE-M3`**（走 Ollama 或 transformers.js）；其次智谱 `embedding-3` | 本地模型的巨大优势是**没有额度限制、断网也能演示**；hackathon 的 250 篇内容量级很小 |
| 向量存储 | **不要向量库**。向量化一次 → 落盘 JSON（复用现有 `DiskCache`）→ 内存算 cosine | 1000 条 × 1024 维 ≈ 400 万次乘加，Node 里毫秒级。上 Chroma/Qdrant 是纯粹的复杂度浪费 |
| 什么时候才需要向量库 | 超过 1 万条，或需要持久化/增量更新 | 那时用 `sqlite-vec`（单文件、零服务）比 Chroma 更省事 |
| 关键词侧升级 | 自写简化 **BM25**（约 60 行）或 `minisearch`（零依赖纯 JS） | 现在的关键词侧是"命中词数"，不是 BM25，排序质量有上限 |
| 融合策略 | **RRF（Reciprocal Rank Fusion）**：`score = Σ 1/(k + rank)`，k 取 60 | 纯算法、零依赖、不需要归一化不同量纲的分数 —— 比"加权求和"稳得多 |

### 2. 对照实验：先做一个小重构

现在 `runAsk(question: string, ...)` 的启动输入只是一个字符串。要跑 A/B/C 三组，必须是**同一套代码 + 不同配置**，否则对照不干净、也拿不出可信结论。

建议改成：

```ts
runAsk({ question, experiment: 'A' | 'B' | 'C' })
```

- **A（Baseline）**：只用关键词检索，取前 3 位作者，不做经历抽取/校验
- **B**：只用向量检索
- **C**：关键词 + 向量 + RRF → 经历抽取 → 重排 → 证据校验（完整链路）

配置从 `boot` 一路透传到 `03-recall` 和 `06-rank`（可以通过 `StepContext` 加一个 `config` 字段，或直接让它成为 `boot` 的一部分）。

### 3. 其余项

| 事项 | 建议技术栈 | 备注 |
|---|---|---|
| Golden Dataset 标注 | CSV/JSON + 人工；问题用 `AskResult.profile.searchQueries` 辅助扩样 | 20 个问题必须**真实**，别用编的 |
| 评测脚本 | 纯 Node/TS，`import { runAsk }` 复用同一条链路 | 输出 Markdown 表格，直接贴进计划书 |
| 隐私脱敏 | 正则 + 白名单字段 | 服务端清洗，前端拿不到敏感字段 |
| 分享海报 | `html-to-image` + `qrcode.react` | zhihu-circle 同款，已验证可行 |
| 历史记录 | `localStorage` | 跨设备再考虑数据库 |
| 部署 | Vercel；被屏蔽时加代理兜底 | 参考 zhihu-circle 的 `ZHIHU_OAUTH_PROXY_URL` 做法 |

---

## 四、建议的排期（48 小时）

**阶段一 · 让结论能站住（最高优先级）**
1. 实验参数化重构（S）
2. 补向量召回 + RRF（M）
3. 做 Golden Dataset 标注（L，可以和 2 并行）
4. 写对照实验脚本，跑出 A/B/C 三组指标（M）

**阶段二 · 让它更准**
5. 用 Golden Set 调 `06-rank` 权重（S）
6. 提升 `04-extract` 抽取质量 + 时间护栏（M）

**阶段三 · 让它能演**
7. 部署 + OAuth 回调登记 + 真实接口联调（M）
8. 演示预热（跑一遍所有要用的示例问题让缓存生效）（S）
9. 指标看板 + 分享海报（S）
10. 计划书 + 演示视频（L）

**明确不做**：Async Job / 任务轮询、Push 触达、Topic Link API、推送订阅设置页、多 Agent 自主协作、复杂图谱可视化。

---

## 五、一句话风险提示

**最可能翻车的地方不是代码，是"证明不了"** —— 目前链路能跑，但**没有任何数据说明它比关键词搜索强**。评审 40% 权重在 AI 场景价值，而"场景成立"这四个字是要用对照数据支撑的。所以阶段一的四件事，比任何页面都重要。
