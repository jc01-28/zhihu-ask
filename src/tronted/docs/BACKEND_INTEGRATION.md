# 后端对接文档

> **读者**：负责实现 `src/back` 的同学。
> **目的**：让后端不必读前端代码就能把接口实现出来。
>
> 契约的**唯一真相**是 `src/shared/contracts/*.ts`（Zod Schema，全部 `.strict()`）。
> 本文档是它的可读版本；两者不一致时以代码为准。后端可以直接 `import` 这些 Schema
> 做入参校验与出参序列化，省掉一遍手写。
>
> 边界与职责清单见 [`BACKEND_BOUNDARY.md`](BACKEND_BOUNDARY.md)；前端侧的消费视角见
> [`API_CONTRACT.md`](API_CONTRACT.md)。

---

## 0. 前端怎么调这些接口

前端所有网络访问都经过一个 `ApiClient` 接口（`src/front/api/ApiClient.ts`），有两套实现：

- `HttpApiClient`：真实 HTTP，**每个响应都必须通过对应 Zod Schema 校验**；
- `MockApiClient`：确定性内存后端，用于离线演示与测试。

两套实现遵循同一份契约。这不是「建议」而是硬约束：`HttpApiClient` 在解析响应时会
`safeParse`，**校验不过就直接抛错**，页面进入错误态。

其中一件最容易踩的事放在最前面：

> ### 所有响应体都是 `.strict()` 的
>
> Zod 的 `.strict()` 表示**多余字段会导致校验失败**，而不是被忽略。
>
> 后端「顺手多返回几个字段」（哪怕是有用的调试字段）会让前端拿到：
>
> ```
> ApiError { code: "INVALID_RESPONSE", message: "服务端返回的内容不符合约定契约。" }
> ```
>
> 页面直接进错误态，且错误信息不指向具体字段（完整字段路径只在 `details` 里）。
> **因此：只返回本文档列出的字段，一个不多、一个不少。**
>
> 需要临时加字段时，先在 `src/shared/contracts` 改 Schema，再改后端。

---

## 1. 全局约定

### 1.1 路径与同源

- 所有接口以 `/api` 为前缀，前端只发**相对路径**请求。
- 登录 / 退出 / 回调走浏览器导航，不用 `fetch` 追踪 302。
- 生产环境前端与后端**同源**：跨站部署会让会话 Cookie 带不上，页面表现为「登录后立刻又未登录」。

### 1.2 凭据

每个请求都带 `credentials: "include"`，后端用会话 Cookie 识别用户。除
`/api/auth/session` 与三个 OAuth 导航路径外，其余接口在未授权时应返回 `401`。

### 1.3 请求头

| 场景 | 请求头 |
|---|---|
| 读 JSON | `Accept: application/json` |
| 写 JSON | `Accept: application/json` + `Content-Type: application/json; charset=utf-8` |
| 流式 | `Accept: application/x-ndjson` + `Content-Type: application/json; charset=utf-8` |

### 1.4 错误信封

**所有**非 2xx 响应体统一为这个形状：

```json
{ "code": "FIELD_SEARCH_FAILED", "message": "领域检索暂时不可用。", "retryable": true }
```

- `code` 前端用来决定界面行为，取值见 §1.5；
- `message` 是会展示给用户的中文文案，请写成用户能看懂的话，不要放堆栈或内部术语；
- `retryable` 只表达「重试同一个请求有没有意义」，前端据此决定给不给重试按钮；
- `details` **可选**，只有需要「回正」的接口才用（目前只有咨询 409，见 §3.6）。

信封是 `.strict()` 的：**只允许 `code` / `message` / `retryable` / `details` 这四个键**，
多一个都会让前端判为不符合契约，于是整条响应退回按状态码推断。若需要携带更多上下文，
把它放进 `details`，而不是平铺到顶层。

前端有状态码兜底：若错误体不是合法 JSON 或形状不对，会按状态码推断——
`400 → INVALID_SEARCH_REQUEST`、`401 → ZHIHU_AUTH_REQUIRED`、`403 → DEMO_ROLE_FORBIDDEN`、
`404 → NOT_FOUND`、`409 → CONFLICT`、`429 → RATE_LIMITED`、`503 → PERSISTENCE_UNAVAILABLE`、
其余 → `HTTP_<status>`，且 `retryable = (status >= 500 || status === 429)`。
**但不要依赖兜底**：兜底给出的 `code` 比精确码粗糙，前端可能因此走错分支——
咨询 409 就是例子：一旦信封不合契约，`code` 会从 `INVALID_CONSULTATION_TRANSITION`
退化成 `CONFLICT`，界面就不再回正。

### 1.5 后端需要返回的错误码

| code | 建议状态码 | retryable | 什么时候用 |
|---|---|---|---|
| `INVALID_SEARCH_REQUEST` | 400 | `false` | 检索入参不合法（`query` 长度 4～300） |
| `INVALID_MESSAGE` | 400 | `false` | 消息内容为空或超过 2000 字 |
| `ZHIHU_AUTH_REQUIRED` | 401 | `false` | 未登录 / 无会话 |
| `ZHIHU_AUTH_EXPIRED` | 401 | `false` | 有会话但凭据已失效 |
| `DEMO_ROLE_FORBIDDEN` | 403 | `false` | 演示角色开关关闭时，答主视角动作被调用 |
| `FIELD_NOT_FOUND` | 404 | `false` | 领域 ID 不存在 |
| `CONVERSATION_NOT_FOUND` | 404 | `false` | 会话 ID 不存在 |
| `RUN_NOT_FOUND` | 404 | `false` | run 不存在或已过期 |
| `NOT_FOUND` | 404 | `false` | 其他资源不存在（如人物公开资料缺失） |
| `CONVERSATION_SOURCE_UNAVAILABLE` | 409 | `true` | 建会话时 `sourceRunId` 指向的检索已过期 |
| `INVALID_CONSULTATION_TRANSITION` | 409 | `false` | 咨询动作与当前状态不匹配，**必须带 `details.currentStatus`** |
| `RATE_LIMITED` | 429 | `true` | 触发限流 |
| `FIELD_SEARCH_FAILED` | 503 | `true` | 领域检索后端不可用 |
| `PERSISTENCE_UNAVAILABLE` | 503 | `true` | 持久化不可用（写不进去时**不要**假装成功） |

`REQUEST_ABORTED`、`INCOMPLETE_STREAM`、`STREAM_UNAVAILABLE`、`INVALID_RESPONSE`、
`NETWORK_ERROR`、`UNKNOWN_ERROR` 是**纯前端错误码，后端不需要返回**。

### 1.6 URL 字段必须是 https

所有 URL 字段（`avatarUrl`、`evidence.url`、`backgroundDocument.url`、
`fieldPerson.profileUrl`、`creator.profileUrl` …）走契约里的 `httpsUrlSchema`，
只接受 **https 绝对地址**。

这是刻意收紧的：`z.string().url()` 会放行 `javascript:alert(1)`，而这串值最终会进
`<img src>` 或 `<a href>`。返回 `http://` 或以 `//` 开头的地址都会被判为不符合契约。

人物主页地址（`profileUrl`）**必须由后端给出**，前端不会按姓名拼接——请返回真实的
知乎主页地址，取不到就返回 `null`（前端会显示「暂无公开主页」而不是死链）。

### 1.7 时间与金额

- 文本时间字段（`createdAt` / `updatedAt` / `publishedAt`）用字符串，建议 ISO 8601；
- 数值时间字段（`editTime`、`runRestore.createdAt` / `expiresAt`）用**毫秒时间戳**；
- 金额单位是**人民币分**（`amount: 12800` 表示 ¥128.00），`currency` 固定为 `"CNY"`。
  分转元的展示由前端完成，后端不要提前转成小数。

---

## 2. 接口总表

⚠️ **注意响应是否带信封**：同一批接口里有的是裸对象，有的包在 `{ items: ... }` /
`{ conversation: ... }` 里。这是契约既定形状，请按表照做。

| # | 方法 | 路径 | 响应形状 | 授权 |
|---|---|---|---|---|
| 1 | `GET` | `/api/auth/session` | `AuthSessionView` | 否 |
| 2 | `GET` | `/api/auth/zhihu/login` | `307` 跳转 | 否 |
| 3 | `GET` | `/auth/callback` | `302` 回 `/?auth=<status>` | 否 |
| 4 | `GET` | `/api/auth/zhihu/logout` | `302` 回 `/` | 是 |
| 5 | `GET` | `/api/topics/hot` | `HotTopicsResponse` | 是 |
| 6 | `GET` | `/api/fields/featured` | `{ items: FieldSummary[] }` | 是 |
| 7 | `GET` | `/api/fields?query=&limit=` | `{ items: FieldSummary[] }` | 是 |
| 8 | `GET` | `/api/fields/:fieldId/graph` | `FieldGraphResponse` | 是 |
| 9 | `GET` | `/api/creators/:creatorId` | `CreatorCardData` | 是 |
| 10 | `POST` | `/api/agent/search` | **NDJSON 流** | 是 |
| 11 | `GET` | `/api/agent/runs/:runId` | `RunRestoreResponse` | 是 |
| 12 | `POST` | `/api/compare` | `CompareResponse` | 是 |
| 13 | `POST` | `/api/conversations` | `{ conversation: Conversation }` | 是 |
| 14 | `GET` | `/api/conversations/:id` | `{ conversation: Conversation }` | 是 |
| 15 | `GET` | `/api/conversations/:id/messages?limit=50&cursor=` | `{ items: Message[], nextCursor }` | 是 |
| 16 | `POST` | `/api/conversations/:id/messages` | `{ message: Message }` | 是 |
| 17 | `POST` | `/api/conversations/:id/agent-runs` | **NDJSON 流** | 是 |
| 18 | `POST` | `/api/conversations/:id/reset` | `{ conversation, messages }` | 是 |
| 19 | `GET` | `/api/consultation/packages` | `{ items: ConsultationPackage[] }` | 是 |
| 20 | `POST` | `/api/conversations/:id/consultation/actions` | `{ consultation, systemMessage }` | 是 |

---

## 3. 逐接口定义

### 3.1 授权

#### 1. `GET /api/auth/session`

未登录返回 `200` + `authenticated=false`、`user=null`，**不要返回 401**——首页需要区分
「没登录」和「读取失败」。

```json
{ "configured": true, "authenticated": true, "user": { "id": "u_8f3a", "displayName": "田永灿", "avatarUrl": "https://pic1.zhimg.com/v2-xxx.jpg" } }
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `configured` | boolean | 服务端 OAuth 配置是否完整 |
| `authenticated` | boolean | 当前是否已授权 |
| `user` | `PublicUser \| null` | `authenticated=false` 时必须是 `null` |
| `user.id` | string | **公开 ID**，不是 OAuth UID，也不是数据库主键 |
| `user.displayName` | string | 1～80 字 |
| `user.avatarUrl` | https \| null | |

> **这一条接口的 401 不会触发前端的全局会话刷新**，这是契约里的唯一例外。
> 原因是它自己就是授权状态的权威来源：如果它的 401 也去要求刷新会话，而会话探测的
> effect 又依赖刷新计数器，就会形成
> `401 → 刷新 → 重新探测 → 又是 401 → …` 的死循环。
> 实测在真实后端上 3 秒内打出 652 次请求。**所以请照常返回 401，前端已处理。**

#### 2. `GET /api/auth/zhihu/login` → `307`

浏览器导航到此地址，后端 `307` 到知乎授权页（带 `app_id` 与 `state`）。
不以 `fetch` 调用，无需 CORS。

#### 3. `GET /auth/callback`

后端处理知乎回跳，校验 state，用授权码换令牌，加密落库，签发会话 Cookie，
最后 `302` 回 `/?auth=<status>`。

`status` 取值（前端据此显示一次性提示，未知值被忽略）：

| status | 前端文案 |
|---|---|
| `success` | 不提示 |
| `required` | 请先使用知乎账号完成授权，再进入找人页面。 |
| `unconfigured` | 当前部署缺少知乎授权配置，暂时无法进入。请先完成服务端配置。 |
| `code_missing` | 知乎没有返回授权码，请重新发起授权。 |
| `state_missing` | 授权校验缺少必要参数，请重新发起知乎授权。 |
| `state_mismatch` | 授权校验未通过，请重新发起知乎授权。 |
| `token_type_unsupported` | 知乎返回了暂不支持的令牌类型，请稍后重试或联系管理员。 |
| `exchange_failed` | 授权码换取令牌失败，请稍后重试或检查应用配置。 |

**URL 参数只用于一次性提示**，是否已登录始终以 `getSession()` 为准。

#### 4. `GET /api/auth/zhihu/logout` → `302 /`

清除会话 Cookie 后跳回首页。

---

### 3.2 热榜

#### 5. `GET /api/topics/hot`

```json
{
  "topics": [
    {
      "scope": "background",
      "source": "hot_list",
      "title": "大模型落地这一年，哪些判断被证伪了？",
      "excerpt": "……",
      "url": "https://www.zhihu.com/question/123456",
      "thumbnailUrl": null,
      "publishedAt": 1735689600000
    }
  ],
  "unavailable": false
}
```

| 字段 | 约束 |
|---|---|
| `scope` | 固定字面量 `"background"`——**背景资料永远不参与人物推荐** |
| `source` | `"global_search" \| "hot_list"` |
| `title` | ≤ 200 |
| `excerpt` | ≤ 800 |
| `url` | https |
| `thumbnailUrl` | https 或 `null` |
| `publishedAt` | 毫秒时间戳或 `null` |

后端取不到热榜时，返回 `unavailable: true`（`topics` 可为空数组）比返回 5xx 更好：
前端会静默隐藏热榜区但保留主搜索，用户不会被打断。

---

### 3.3 专业领域

四条接口的共同点：**只返回领域与公开资料，不做人物检索**。领域检索即使用户输入了人名，
返回值也必须仍是领域列表——这是产品语义，不是实现细节。

#### 6. `GET /api/fields/featured`

```json
{ "items": [ { "id": "agent-development", "name": "Agent 开发", "description": "……", "icon": "bot", "color": "violet", "tags": ["多智能体", "工具调用"], "memberCount": 128, "topicCount": 6 } ] }
```

#### 7. `GET /api/fields?query=<text>&limit=<number>`

- `query`：必填，服务端按**领域名 / 别名 / 标签 / 简介 / 议题关键词**匹配；
- `limit`：前端默认发 `8`。

响应形状同 #6。查不到时返回 `200` + `{ "items": [] }`，**不要返回 404**——
空结果和「检索失败」在界面上是两种不同的呈现。

服务端不可用时返回 `503 FIELD_SEARCH_FAILED`，前端会给「重新检索」按钮并保留推荐领域区。

#### 8. `GET /api/fields/:fieldId/graph`

```json
{
  "field": { "id": "agent-development", "name": "Agent 开发", "description": "……", "icon": "bot", "color": "violet", "tags": ["多智能体"], "memberCount": 128, "topicCount": 6 },
  "topics": [
    { "id": "tool-calling", "name": "工具调用", "description": "……", "position": { "x": 0.32, "y": 0.18 } }
  ],
  "people": [
    {
      "id": "p_shen-yiran", "name": "沈亦然", "headline": "多智能体系统方向",
      "avatarUrl": null, "initial": "沈", "avatarTone": "violet",
      "topicIds": ["tool-calling"], "relevance": 88,
      "profileUrl": "https://www.zhihu.com/people/xxx"
    }
  ]
}
```

**坐标由后端给**：`position.x` / `position.y` 固定在 `0～1`，前端负责映射到实际视口尺寸，
因此同一份数据在 1440×900 和 390×844 下都能用。星图布局不要求后端做力导向计算，
只要保证节点不重叠、分布可读。

约束：`topics` 与 `people` 都至少有 1 个元素（`.min(1)`）；`topics[].id` ≤ 64；
`people[].topicIds` 最多 8 个，且应是上方 `topics` 里出现过的 ID。

领域不存在返回 `404 FIELD_NOT_FOUND`。前端对 404 的处理是**「领域不存在」+ 返回目录**，
**不给重试按钮**——重试同一个不存在的 ID 没有意义。

`fieldPerson` 刻意是「最小字段集」：不带证据、不带分数理由、不带任何内部标识。
需要展示更多信息时走 #9。

#### 9. `GET /api/creators/:creatorId`

返回完整的 `CreatorCardData`：

```json
{
  "id": "p_shen-yiran",
  "name": "沈亦然",
  "headline": "多智能体系统方向 / 前某厂算法工程师",
  "initial": "沈",
  "avatarTone": "violet",
  "avatarUrl": null,
  "profileUrl": "https://www.zhihu.com/people/xxx",
  "identityConfidence": "high",
  "role": "领域相关",
  "relevanceLevel": "部分相关",
  "score": 78,
  "matchedDimensions": ["方向一致", "有落地经验"],
  "reason": "在知乎持续输出多智能体工程化内容，与议题直接相关。",
  "evidence": [],
  "suitableQuestions": ["多智能体怎么划分职责边界？"],
  "limitations": ["公开内容以工程实践为主，缺少团队管理视角"]
}
```

| 字段 | 约束 | 说明 |
|---|---|---|
| `id` | string ≥1 | |
| `name` | 1～80 | |
| `headline` | ≤ 200 | 一句话身份 |
| `initial` | ≤ 2 | 头像占位字符，通常取姓名首字 |
| `avatarTone` | string | 头像占位色位标识 |
| `avatarUrl` | https \| null | |
| `profileUrl` | https \| null | 知乎公开主页，**取不到给 null** |
| `identityConfidence` | `high \| medium \| low` | 身份确认程度 |
| `role` | `经历最接近 \| 关键维度 \| 补充视角 \| 领域相关` | 见下方说明 |
| `relevanceLevel` | `高度相关 \| 部分相关 \| 补充视角` | |
| `score` | 0～100 | |
| `matchedDimensions` | string[]，≤4 项，每项 ≤40 | |
| `reason` | ≤ 500 | 可解释的推荐理由 |
| `evidence` | 数组，≤3 项 | **可以为空数组**，见下 |
| `suitableQuestions` | string[]，≤3，每项 ≤200 | |
| `limitations` | string[]，≤4，每项 ≤200 | |

> **`role` 的取值分区**
>
> - `经历最接近` / `关键维度` / `补充视角`：属于「问题找人」入口，表示检索出的角色定位；
> - `领域相关`：属于「专业领域」入口。
>
> 领域目录只能说明「公开内容与议题相关」，**不能说某人经历最接近**。从领域星图点进
> 人物卡时请用 `领域相关`。

> **`evidence` 允许为空——请不要为了凑数而虚构**
>
> `evidence: []` 表示「暂无内容证据」。前端在领域来源下会如实显示「暂无内容证据」，
> 并隐藏「适合问 TA」等需要证据支撑的区块。凭空生成证据会让整个产品的可信度归零。
>
> 每项证据的形状：
>
> ```json
> { "id": "e_1", "title": "……", "excerpt": "……", "kind": "亲身经历", "publishedAt": "2024-03-11T08:00:00.000Z", "source": "zhihu_search", "url": "https://www.zhihu.com/question/1/answer/2" }
> ```
>
> `kind` ∈ `亲身经历 \| 专业分析 \| 反面案例`；`source` ∈ `zhihu_search \| fixture`；
> `title` ≤ 200，`excerpt` ≤ 180，`url` 为 https 或 `null`。

---

### 3.4 问题找人

#### 10. `POST /api/agent/search` → NDJSON 流

请求体（`SearchRequest`）：

```json
{ "query": "大厂产品转 AI 创业公司，值得找谁聊？", "sessionId": "s_7f2c9a", "mode": "auto" }
```

| 字段 | 约束 |
|---|---|
| `query` | 去空白后 4～300 字 |
| `sessionId` | 1～100 |
| `mode` | `fixture \| live \| auto`，**可选**（前端通常不传） |

流协议细节见 §4。事件类型：

```json
{"type":"run.started","requestId":"6f9c1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b"}
{"type":"step.started","step":"loading_context","message":"正在读取你的知乎上下文"}
{"type":"step.completed","step":"loading_context","message":"已读取上下文","meta":{"creation":12,"followee":48,"collection":3,"favlist":7}}
{"type":"step.started","step":"understanding","message":"正在理解你的问题"}
{"type":"step.completed","step":"understanding","message":"已拆解为 4 个检索方向"}
{"type":"step.started","step":"retrieving","message":"正在检索知乎公开内容"}
{"type":"step.completed","step":"retrieving","message":"检索到 86 条相关内容","meta":{"hits":86}}
{"type":"step.started","step":"verifying","message":"正在核验内容与身份的对应关系"}
{"type":"step.completed","step":"verifying","message":"筛除 41 条不相关内容","meta":{"rejected":41}}
{"type":"step.started","step":"ranking","message":"正在排序候选中的人选"}
{"type":"step.completed","step":"ranking","message":"已选出 3 位人选"}
{"type":"step.started","step":"saving","message":"正在保存本次结果"}
{"type":"step.completed","step":"saving","message":"结果已保存"}
{"type":"run.completed","result":{ ... },"runId":"9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d","persistence":"saved"}
```

**顺序是固定的**：`run.started` → 六个阶段各一对 `step.started` / `step.completed` → `run.completed`。
六个阶段的顺序为：

```
loading_context → understanding → retrieving → verifying → ranking → saving
```

`requestId` 与 `runId` 必须是**合法的 UUID 字符串**（契约用 `z.string().uuid()` 校验）。
`runId` 允许为 `null`——表示结果没能落库，此时 `persistence` 应为 `"unavailable"`。

`meta` 是可选的，键值只允许 `string | number | boolean | null`。它的用途是让进度条
显示「检索到 86 条」这类具体数字，没有就不传，**不要传嵌套对象**。

`run.completed` 的 `result` 是完整的 `PersonSearchResult`：

```json
{
  "cards": [{ ...CreatorCardData... }],
  "modeUsed": "live",
  "fallbackReason": null,
  "modelFallback": false,
  "contextStatus": "applied",
  "contextSourceCounts": { "creation": 12, "followee": 48, "collection": 3, "favlist": 7 },
  "searchedQueries": ["产品经理 转 AI 创业", "AI 创业 早期 踩坑"],
  "background": [{ ...BackgroundDocument... }],
  "analyzedContentCount": 86,
  "rejectedContentCount": 41,
  "runId": "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d",
  "persistence": "saved"
}
```

| 字段 | 约束 | 说明 |
|---|---|---|
| `cards` | `CreatorCardData[]`，**≤3** | 人物卡，最多三张 |
| `modeUsed` | `live \| fixture` | 本次实际走的数据源 |
| `fallbackReason` | string \| null | 降级原因；没有降级给 `null` |
| `modelFallback` | boolean | 模型是否降级到备用方案 |
| `contextStatus` | `applied \| partial \| unavailable` | 用户知乎上下文的可用程度 |
| `contextSourceCounts` | 四个非负整数 | `creation` / `followee` / `collection` / `favlist` |
| `searchedQueries` | string[] | 实际发出去的检索词，会展示给用户 |
| `background` | `BackgroundDocument[]` | 背景资料，**不参与人物推荐** |
| `analyzedContentCount` | ≥0 | 分析过的内容条数 |
| `rejectedContentCount` | ≥0 | 被筛除的条数 |

流程中若无法继续，用终态事件表达失败（HTTP 仍是 200）：

```json
{"type":"run.failed","error":{"code":"RATE_LIMITED","message":"请求过于频繁，请稍后重试。","retryable":true}}
```

#### 11. `GET /api/agent/runs/:runId`

刷新页面后用它取回一次已完成的检索：

```json
{
  "runId": "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d",
  "cards": [{ ... }],
  "mode": "live",
  "contextStatus": "applied",
  "analyzedCount": 86,
  "rejectedCount": 41,
  "fallbackReason": null,
  "modelFallback": false,
  "contextSourceCounts": { "creation": 12, "followee": 48, "collection": 3, "favlist": 7 },
  "searchedQueries": ["产品经理 转 AI 创业"],
  "background": [{ ... }],
  "persistence": "saved",
  "createdAt": 1735689600000,
  "expiresAt": 1735776000000
}
```

三点要求：

1. **字段要给全。** 这个响应刻意与 `personSearchResultSchema` 一一对应（只是换了运行视角的
   命名），目的是让刷新后的摘要与首次搜索**完全一致**。少给字段，前端只能用 `false` / `0` / `[]`
   去补——那等于在界面上伪造一次它并不知道的降级情况与上下文统计。
2. **`persistence` 固定为 `"saved"`**（字面量类型）：能取回就说明当初存下来了，
   因此这里不接受 `"unavailable"`。
3. 找不到或已过期返回 `404 RUN_NOT_FOUND`。前端会**静默**清掉本地运行指针、搜索页回到
   初始态，不弹红条——用户没做错事，不该被报错打扰。

#### 12. `POST /api/compare`

请求体同 `SearchRequest`，响应给「原始检索结果」与「Agent 结果」的对照：

```json
{
  "modeUsed": "live",
  "modelFallback": false,
  "contextStatus": "applied",
  "raw": {
    "queries": ["产品经理 转 AI 创业"],
    "hits": [
      {
        "contentId": "a_123", "contentType": "Answer", "title": "……", "excerpt": "……",
        "url": "https://www.zhihu.com/question/1/answer/2",
        "commentCount": 34, "voteUpCount": 1200, "editTime": 1710144000000,
        "rankingScore": 0.87,
        "author": { "syntheticId": "p_xxx", "name": "林知行", "avatarUrl": null, "badgeText": "优秀回答者", "authorityLevel": 3 },
        "sourceQuery": "产品经理 转 AI 创业",
        "provider": "zhihu_search"
      }
    ]
  },
  "agent": { ...PersonSearchResult... }
}
```

约束：`contentType` ∈ `Answer | Article | Question | Other`；`provider` ∈ `zhihu_search | fixture`；
`author.authorityLevel` ∈ `1 | 2 | 3 | 4`；`author.badgeText` ≤ 100 或 `null`；
计数字段均为非负整数。

---

### 3.5 会话与消息

#### 13. `POST /api/conversations`

```json
{ "creatorId": "p_lin-zhixing", "sourceRunId": "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d" }
```

`sourceRunId` 可为 `null`（从领域星图进入时没有检索运行）。

响应：`{ "conversation": { ...Conversation... } }`

请做成**幂等**的：同一个 `(user, creatorId)` 若已有会话，直接返回既有的那条，
而不是每次都新建。前端点击「开始私聊」时会复用同一个会话。

`sourceRunId` 指向的检索已过期时返回 `409 CONVERSATION_SOURCE_UNAVAILABLE`，
前端会保留人物结果并把按钮切成可重试状态。

`Conversation` 形状：

```json
{
  "id": "c_3f8a1b2c",
  "user": { "id": "u_8f3a", "displayName": "田永灿", "avatarUrl": null },
  "creator": { ...CreatorCardData... },
  "sourceRunId": "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d",
  "consultation": { "id": "consultation-c_3f8a1b2c", "status": "free_chat", "packageId": null, "amount": null, "updatedAt": "2025-01-01T00:00:00.000Z" },
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z"
}
```

> **会话 ID 不是人物 ID。** 聊天路由是 `/app/chat/:conversationId`，前端不会拿 `creatorId`
> 当会话 ID（`check-boundaries.mjs` 的 `creator-routing` 规则会拦住这种做法）。
> `sourceRunId` 是 UUID 或 `null`。

#### 14. `GET /api/conversations/:id`

响应：`{ "conversation": { ... } }`。不存在返回 `404 CONVERSATION_NOT_FOUND`。

#### 15. `GET /api/conversations/:id/messages?limit=50&cursor=<opaque>`

```json
{ "items": [ { ...Message... } ], "nextCursor": null }
```

前端固定发 `limit=50`，并原样回传上一次拿到的 `nextCursor`。`nextCursor` 的格式由后端
自己定（前端只当不透明字符串），没有更多数据时给 `null`。

`Message` 形状：

```json
{
  "id": "m_001",
  "conversationId": "c_3f8a1b2c",
  "clientMessageId": "cm_9d2e",
  "sender": "seeker",
  "content": "我该先确认哪些事情？",
  "createdAt": "2025-01-01T00:00:12.000Z"
}
```

`sender` ∈ `seeker | creator | agent | system`。`clientMessageId` 仅对用户发出的消息有意义，
其余可给 `null`。

#### 16. `POST /api/conversations/:id/messages`

```json
{ "clientMessageId": "cm_9d2e", "actorRole": "seeker", "content": "我该先确认哪些事情？" }
```

响应：`{ "message": { ... } }`

**`clientMessageId` 必须做幂等**：重复提交同一个 ID 应返回**同一条**消息，而不是插入两条。
前端的行为是「点击发送 → 请求超时 → 用户重试」，没有幂等就会看到重复消息。

内容为空或超长（>2000 字）返回 `400 INVALID_MESSAGE`。

#### 17. `POST /api/conversations/:id/agent-runs` → NDJSON 流

请求体：

```json
{ "clientMessageId": "cm_9d2f", "content": "我该先确认哪些事情？" }
```

事件形状（注意与 #10 的搜索流是**两套不同的事件类型**）：

```json
{"type":"agent.run.started","requestId":"6f9c1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b","userMessage":{"id":"m_002","conversationId":"c_3f8a1b2c","clientMessageId":"cm_9d2f","sender":"seeker","content":"我该先确认哪些事情？","createdAt":"2025-01-01T00:00:30.000Z"}}
{"type":"agent.message.started","messageId":"m_003"}
{"type":"agent.message.delta","messageId":"m_003","delta":"先确认"}
{"type":"agent.message.delta","messageId":"m_003","delta":"你现在的处境。"}
{"type":"agent.message.completed","message":{"id":"m_003","conversationId":"c_3f8a1b2c","clientMessageId":null,"sender":"agent","content":"先确认你现在的处境。","createdAt":"2025-01-01T00:00:35.000Z"}}
```

必须遵守：

- `agent.run.started` 里带上刚落库的**用户消息**（前端据此把它显示出来，不靠本地乐观插入）；
- 中间可以有任意多条 `agent.message.delta`，`delta` 是**增量片段**（不是累积全文）；
- **最后一条必须是 `agent.message.completed`，且 `message.content` 是完整消息。**
  前端会把增量气泡替换成这条完整消息——两者不一致会导致界面「跳字」；
- 失败用 `agent.run.failed` 终止，形状为 `{ "type": "agent.run.failed", "requestId": "...", "error": { code, message, retryable } }`。

#### 18. `POST /api/conversations/:id/reset`

无请求体。响应：

```json
{ "conversation": { ... }, "messages": [] }
```

重置会话状态并返回重置后的快照与消息列表。

---

### 3.6 咨询

> 前端只提交动作，**不自行推导下一状态**。状态机完全由后端持有；前端按响应里的
> `consultation.status` 决定显示什么。

#### 19. `GET /api/consultation/packages`

```json
{ "items": [
  { "id": "text", "name": "文字咨询", "description": "……", "amount": 9900, "currency": "CNY" },
  { "id": "voice-30", "name": "30 分钟语音", "description": "……", "amount": 19900, "currency": "CNY" },
  { "id": "voice-60", "name": "60 分钟语音", "description": "……", "amount": 34900, "currency": "CNY" }
] }
```

`id` 只能是 `text | voice-30 | voice-60`（枚举）；`name` ≤ 60，`description` ≤ 200；
`amount` 是非负整数（单位：分）；`currency` 固定 `"CNY"`。

这三个 ID 是前端用来对应套餐卡的键，请保持一致；名称与价格可以改。

#### 20. `POST /api/conversations/:id/consultation/actions`

```json
{ "action": "create_offer", "actorRole": "creator", "packageId": "voice-30" }
```

| 字段 | 取值 |
|---|---|
| `action` | `propose \| cancel \| create_offer \| withdraw_offer \| confirm_mock_payment \| start_consultation` |
| `actorRole` | `seeker \| creator` |
| `packageId` | 可选，仅 `create_offer` 需要 |

响应：

```json
{
  "consultation": { "id": "consultation-c_3f8a1b2c", "status": "offer_created", "packageId": "voice-30", "amount": 19900, "updatedAt": "2025-01-01T00:01:00.000Z" },
  "systemMessage": { "id": "m_004", "conversationId": "c_3f8a1b2c", "clientMessageId": null, "sender": "system", "content": "答主创建了付费咨询方案（模拟）。", "createdAt": "2025-01-01T00:01:00.000Z" }
}
```

**必须同时返回一条 `sender: "system"` 的消息**，它会被插进对话流里——这是状态变化的
可见记录，前端不会自己造。

期望的状态流转（参考实现 `src/front/api/MockApiClient.ts` 与 `scripts/live-stub-server.mjs`）：

| action | 允许的当前状态 | 流转到 |
|---|---|---|
| `propose` | `free_chat` | `proposed` |
| `cancel` | `proposed` | `free_chat` |
| `create_offer` | `free_chat` \| `proposed` | `offer_created` |
| `withdraw_offer` | `offer_created` | `free_chat` |
| `confirm_mock_payment` | `offer_created` | `mock_paid` |
| `start_consultation` | `mock_paid` | `consulting` |

状态枚举：`free_chat | proposed | offer_created | mock_paid | consulting`。

动作与当前状态不匹配时返回 `409 INVALID_CONSULTATION_TRANSITION`，**并且必须把当前的完整
`Consultation` 对象放在 `details` 里**（不是只放一个状态字符串），前端拿它把面板改回服务端的
真实状态：

```json
{
  "code": "INVALID_CONSULTATION_TRANSITION",
  "message": "当前咨询状态不允许这个操作，已按服务端状态回正。",
  "retryable": false,
  "details": {
    "id": "consultation-c_3f8a1b2c",
    "status": "mock_paid",
    "packageId": "voice-30",
    "amount": 19900,
    "updatedAt": "2025-01-01T00:01:20.000Z"
  }
}
```

`details` 的形状必须与 `consultationSchema` **完全一致**：前端是拿那个 Schema（`.strict()`）
去解析它的，少一个字段或多一个字段都会被判为无效，回正逻辑就会静默跳过（界面停在旧状态，
只留一句提示）。

> 真实支付不在本次范围内。`confirm_mock_payment` 只推进状态，**不接入任何支付渠道、
> 不创建订单、不产生扣款**，前端弹窗里也没有卡号 / 手机号 / 身份证字段。

---

## 4. NDJSON 流协议

两条流式接口（#10 搜索流、#17 会话 Agent 流）共用同一套传输规则。

### 4.1 响应头

```
HTTP/1.1 200 OK
Content-Type: application/x-ndjson; charset=utf-8
Cache-Control: no-cache
X-Accel-Buffering: no        ← 若前面有 Nginx，必须关闭缓冲，否则事件会被攒着一次发出来
```

### 4.2 帧格式

- **一行一个 JSON 对象**，以 `\n` 结尾；不要包成数组，也不要加 SSE 的 `data:` 前缀。
- 每行必须能独立 `JSON.parse`，**不要跨行拆分一个对象**。
- 编码 UTF-8。前端按字节流解析，一个多字节字符被切在两个 TCP 分块之间也能正确拼回
  （这一点已在真实 socket 上验证过，后端不必对齐分块边界）。
- 无法解析的行会被**丢弃**而不是中断整个流。但这只用于容忍心跳之类的填充，
  正常业务事件不应该走到这条路径。

### 4.3 生命周期

1. 第一个事件应尽快速达，不要让用户对着空进度条等——`run.started` 可以立刻发，
   `loading_context` 的耗时体现在它自己的 `step.completed` 上。
2. 阶段之间可以插入心跳（推荐用注释行或合法的空行），避免中间层超时断连。
3. **终态事件到达后，前端立刻结束读取并返回**，不等待连接关闭。所以后端发完终态
   再关闭连接即可，不必刻意保持。
4. 终态必须是以下之一：
   - 搜索流：`run.completed` 或 `run.failed`；
   - Agent 流：`agent.message.completed` 或 `agent.run.failed`。

后端**不需要**保证「总会发终态」——但要知道前端如何处理缺失：

| 情况 | 前端行为 |
|---|---|
| 流正常结束（EOF）但没有终态 | 抛 `INCOMPLETE_STREAM`（可重试），展示「搜索流没有返回完整结果」 |
| 连接中途被切断 | 抛 `NETWORK_ERROR`（可重试），展示「网络中断」 |
| 用户在客户端取消（关闭页面 / 点停止） | 视为**取消**，不是失败：回到初始态，**不显示红色错误条** |

第 3 条要求后端区分「正常 EOF」与「连接异常」——正常结束就正常 `end()`，
不要在写失败时吞掉错误当成正常结束。

### 4.4 已确认的联调事实

真实 socket 上的行为已经被验证过（`tests/api/http-api-client.integration.test.ts`）：

- 跨分块拼接正确，包含**切点落在一个汉字的 3 字节中间**的情况；
- 收到终态后前端立即返回，**即使服务端还没 `end()`**；
- 流被掐断时，前端收敛为可重试的 `NETWORK_ERROR`，不会把 `TypeError: terminated`
  这类底层错误直接显示给用户。

---

## 5. 幂等、并发与限流

| 机制 | 要求 |
|---|---|
| 建会话 | 同一 `(user, creatorId)` 幂等复用既有会话 |
| 发消息 | 按 `clientMessageId` 幂等，重复提交返回同一条 |
| 咨询动作 | 按状态机拒绝非法流转（`409` + `details.currentStatus`），需要事务性 |
| 检索运行 | `runId` 有有效期；过期返回 `404 RUN_NOT_FOUND` |
| 限流 | 触发时返回 `429 RATE_LIMITED`，`retryable: true` |
| 持久化失败 | 返回 `503 PERSISTENCE_UNAVAILABLE`，**不要假装成功** |

搜索流里如果结果没能落库，不是失败——照常发 `run.completed`，把 `runId` 给 `null`、
`persistence` 给 `"unavailable"`。前端会如实展示，刷新后也不会尝试恢复。

---

## 6. 后端实现清单

按依赖顺序推进，每一项都能独立验证：

- [ ] `GET /api/auth/session` 返回 `200`（未登录也是 200，`user: null`）
- [ ] 知乎 OAuth 导航：`/api/auth/zhihu/login` `307`、`/auth/callback` 处理并 `302 ?auth=<status>`、`/api/auth/zhihu/logout`
- [ ] 会话 Cookie 签发与校验；未授权接口返回 `401` + 标准错误信封
- [ ] 统一错误信封 `{ code, message, retryable }`（**三个键，不多不少**）
- [ ] `GET /api/fields/featured` 与 `GET /api/fields` 返回 `{ items: [...] }`
- [ ] `GET /api/fields/:fieldId/graph` 返回带 `0～1` 坐标的星图
- [ ] `GET /api/creators/:creatorId` 返回完整人物卡，`evidence` 允许为空数组
- [ ] `GET /api/topics/hot`（取不到时 `unavailable: true` 而不是 5xx）
- [ ] `POST /api/agent/search` 的 NDJSON 流：13 个事件、顺序固定、UUID 合法
- [ ] `GET /api/agent/runs/:runId` 字段给全、`persistence` 固定 `"saved"`
- [ ] `POST /api/conversations` 幂等建会话
- [ ] 消息分页 + 按 `clientMessageId` 幂等发送
- [ ] `POST /api/conversations/:id/agent-runs` 的 NDJSON 流
- [ ] `GET /api/consultation/packages`（三个固定 ID）
- [ ] 咨询状态机 + `409` 带 `details.currentStatus`
- [ ] 所有 URL 字段是 https 或 `null`

---

## 7. 联调与自测

### 7.1 前端怎么接上你的后端

```bash
cd demo/zhihu-wenren
# 1. 让前端走真实 HTTP，并把 /api、/auth 代理到你的服务
echo 'VITE_API_MODE=live' > .env.local
echo 'VITE_DEV_PROXY_TARGET=http://127.0.0.1:8787' >> .env.local   # 换成你的端口
pnpm dev
```

`.env.local` 已被 `.gitignore` 忽略，不会进仓库。或者用 `pnpm dev:live`（读 `.env.live`）。

### 7.2 手边就有一份可运行的参考实现

`scripts/live-stub-server.mjs` 是**按同一份契约写全的桩服务器**，覆盖会话探测、热榜、
领域目录 / 星图 / 人物、六阶段检索流、刷新恢复：

```bash
pnpm stub                                   # 默认 127.0.0.1:8787
node scripts/live-stub-server.mjs --port 9000 --latency 120
```

它把每个接口的**响应体原样打印在源码里**，可以直接当示例照抄。桩上的调试开关
（仅在桩里存在，不是契约的一部分）：

- `GET /api/__stub/mode?value=<分支>` 切换分支（`expired` / `fields-failed` / `search-truncated` …）；
- `GET /api/__stub/requests` 读取收到的请求记录。

桩**刻意不实现**会话与咨询（返回 `501`）——那两处带真实状态机，在桩里再写一遍就会
变成「第三套后端」，验证的会是桩而不是前端。这两块请直接对着 §3.5 / §3.6 实现。

### 7.3 改完之后怎么验证

```bash
pnpm run test:e2e:live     # 真实浏览器 × 真实 HTTP 服务器
```

这 10 条用例专门覆盖 mock 模式证明不了的东西：真实响应必须过契约、NDJSON 在真实 socket
上分块到达、会话探测拿到 401 时的实际行为、刷新恢复真的走了一次 `GET /api/agent/runs/:runId`。

**它们同时也是你的验收脚本**：把 `--config playwright.live.config.ts` 里的桩换成你的服务
（改 `VITE_DEV_PROXY_TARGET`），这 10 条全绿就说明契约对上了。

---

## 8. 绝对不要下发的字段

（完整清单见 [`BACKEND_BOUNDARY.md`](BACKEND_BOUNDARY.md) §3）

- 知乎 Access Token / Refresh Token，以及 `ZHIHU_ACCESS_SECRET`、`APP_SESSION_SECRET` 等密钥材料；
- 数据库内部主键、内部用户标识、软删除标记、审计字段；
- Agent 内部 Prompt、模型原始响应、私有知识库原文；
- 任何支付敏感信息。

前端用 `.strict()` 拒绝未声明字段，所以多下发**不会被静默吸收**——它会直接让那条响应
判为不符合契约。这是好事：宁可报错，也不要让密钥悄悄进了浏览器。
