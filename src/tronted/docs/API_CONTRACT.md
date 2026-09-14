# API 契约

本工程不实现后端。这里记录的是前端**实际消费**的接口形状：请求体、成功响应、错误码与流事件。

契约的唯一定义在 `src/shared/contracts/*.ts`（Zod，全部 `.strict()`）。`HttpApiClient` 拿真实响应必须先过 Schema；`MockApiClient` 也必须产出同样的形状。任何字段改动都要先改契约，再改两个实现。

---

## 0. 通用规则

- 编码统一 UTF-8。
- 所有请求使用**相对路径**，并显式带 `credentials: "include"`。
- 登录与退出使用浏览器导航（`<a href>`），不用 `fetch` 追踪 302。
- JSON 响应在使用前必须通过对应 Zod Schema；NDJSON **每一行**在交给 UI 前也必须通过事件 Schema。
- 401 / 授权过期由 API 层统一回调 `useRefreshSession()` 触发 Auth Session 刷新，组件不各自复制判断。

错误信封（`apiErrorEnvelopeSchema`）：

```ts
type ApiErrorEnvelope = {
  code: string;
  message: string;
  retryable: boolean;
  /**
   * 可选。少数需要「回正」的接口用它携带业务上下文——目前只有咨询 409：
   * `details` 是服务端当前的**完整 Consultation 对象**，前端拿它把面板改回
   * 真实状态，而不是自己推导下一状态。形状必须与 `consultationSchema` 一致。
   */
  details?: unknown;
};
```

信封本身是 `.strict()` 的，所以 `details` 必须在契约里显式声明。这不是形式问题：
漏掉它，一个带 `details` 的 409 会让**整个信封**解析失败，`code` 退化成按状态码推断的
`CONFLICT`，回正逻辑就永远不会被触发——而 mock 模式与全部单测都看不出这个差别
（`MockApiClient` 直接构造 `ApiError`，不经过信封解析）。已在
`http-api-client.test.ts` 与 `http-api-client.integration.test.ts` 各钉一条回归。

前端只解释 `code` 与 `retryable`，不使用服务端堆栈或内部字段。前端把这些字段装进
`ApiError`（`src/front/api/ApiError.ts`），并补充 `status` 与可选的 `details`。

### URL 字段规则

所有 URL 字段（`avatarUrl` / `evidence.url` / `searchHit.url` / `backgroundDocument.url` / `fieldPerson.profileUrl` …）走 `src/shared/contracts/url.ts` 的 `httpsUrlSchema` / `nullableHttpsUrlSchema`：必须是 **https** 绝对地址。这是刻意的收紧——`z.string().url()` 会放行 `javascript:alert(1)`，而这串值最终会进 `<img src>` 或 `<a href>`。

### 样式 token 规则

领域主题色（`fieldSummary.color`）与图标名（`fieldSummary.icon`）都不是可执行内容：

- `color` 只接受 `FIELD_COLOR_TOKENS` 的 8 个语义 token（`blue` / `cyan` / `violet` / `amber` / `emerald` / `rose` / `indigo` / `teal`），具体色值由前端的固定映射表决定；
- `icon` 是图标**名称**，前端用白名单映射到具体图标，未知名称回退默认图标。

因此即使后端返回 `color: "red; background: url(...)"`，它也不可能落进样式字符串——契约层就会拒绝。

---

## 1. Auth

### `GET /api/auth/session`

| | |
|---|---|
| 请求 | 无请求体 |
| 成功 | `200` + `AuthSessionView` |

```ts
type PublicUser = {
  id: string;              // 后端生成的公开 ID，不是 OAuth UID，也不是数据库主键
  displayName: string;
  avatarUrl: string | null;
};

type AuthSessionView = {
  configured: boolean;
  authenticated: boolean;
  user: PublicUser | null; // 未登录时必须为 null
};
```

未登录返回 `200` 且 `authenticated=false, user=null`（不返回 401），这样首页能区分「没登录」和「读取失败」。

**正常路径就是上面的 200。** 只有在服务端认为「本该有会话、但凭据已失效」时才返回 `401`；前端把它与未登录等价处理（回到授权门禁），不会重试。

> **这条接口的 401 不会触发全局会话刷新。**
>
> `HttpApiClient` 的规则是「任何 401 都通知 `refreshSession()`」，但会话探测是**唯一**的例外。原因是它自己就是授权状态的权威来源：如果它的 401 也去要求刷新会话，而 `useAuthSession` 的 effect 又依赖刷新计数器，就会变成
>
> ```
> 401 → authEpoch++ → 会话探测重跑 → 又是 401 → …
> ```
>
> 实测在真实后端上 3 秒内发出 652 次请求。Mock 后端从不返回 401，所以这个循环在 mock 模式下完全不可见——它是在 `pnpm run test:e2e:live` 里被查出来的。
>
> 业务接口（`/api/fields/**`、`/api/creators/**`、`/api/conversations/**` …）的 401 仍然照常触发会话刷新。

### OAuth 导航接口

| 方法与路径 | 前端动作 |
|---|---|
| `GET /api/auth/zhihu/login` | 浏览器导航发起登录 |
| `GET /auth/callback` | 由后端处理并 302 回 `/?auth=<status>` |
| `GET /api/auth/zhihu/logout` | 浏览器导航退出并回到 `/` |

`status` 取值与前端文案（`src/front/features/auth/auth-messages.ts`）：

| status | 文案 |
|---|---|
| `success` | 不提示 |
| `required` | 请先使用知乎账号完成授权，再进入找人页面。 |
| `unconfigured` | 当前部署缺少知乎授权配置，暂时无法进入。请先完成服务端配置。 |
| `code_missing` | 知乎没有返回授权码，请重新发起授权。 |
| `state_missing` | 授权校验缺少必要参数，请重新发起知乎授权。 |
| `state_mismatch` | 授权校验未通过，请重新发起知乎授权。 |
| `token_type_unsupported` | 知乎返回了暂不支持的令牌类型，请稍后重试或联系管理员。 |
| `exchange_failed` | 授权码换取令牌失败，请稍后重试或检查应用配置。 |

URL 参数只用于一次性提示；**是否已登录始终以 `getSession()` 为准**。

---

## 2. 热榜

### `GET /api/topics/hot`

```ts
type BackgroundDocument = {
  scope: "background";                 // 背景资料永远不是人物证据
  source: "global_search" | "hot_list";
  title: string;
  excerpt: string;
  url: string;                         // https
  thumbnailUrl: string | null;         // https
  publishedAt: number | null;
};

type HotTopicsResponse = {
  topics: BackgroundDocument[];
  unavailable: boolean;
};
```

`unavailable=true` 或请求失败时，前端隐藏热榜但保留主搜索（静默失败）。

---

## 3. 专业领域

四条接口，共同点是**只返回领域与公开资料，不做人物检索**。

### `GET /api/fields/featured`

推荐领域。

```ts
type FieldSummary = {
  id: string;                    // 1～64，用于 `/app/fields/:fieldId`
  name: string;                  // 1～40
  description: string;           // ≤ 240
  icon: string | null;           // 图标名，前端白名单映射，未知回退默认图标
  color: FieldColorToken;        // 8 个语义 token 之一
  tags: string[];                // ≤ 6，每项 1～20
  memberCount: number;           // 非负整数
  topicCount: number;            // 非负整数
};

type FieldListResponse = { items: FieldSummary[] };
```

打开页面即请求，失败时展示可重试的错误态，并保留「重新加载」动作。

### `GET /api/fields?query=&limit=`

领域检索：按名称、标签、简介与议题关键词匹配。

| 参数 | 说明 |
|---|---|
| `query` | 检索词，前端 trim 后使用 |
| `limit` | 可选，默认 `8` |

响应同 `FieldListResponse`。

**这条接口永远不会退化成人物搜索**：返回值一定是 `FieldSummary[]`，Schema 在 HTTP 层就会拒绝人物形状；前端在领域目录里也不渲染任何「查看证据」之类的人物级操作（E2E 断言其数量为 0）。

空结果不是错误：展示「没有匹配的领域」+ 回到推荐列表，而不是红条。

失败返回 `503 FIELD_SEARCH_FAILED`（`retryable: true`），前端保留推荐领域的选择，只把检索区切换到错误态。

### `GET /api/fields/:fieldId/graph`

领域星图：中心领域 + 议题节点 + 人物聚类。

```ts
type FieldTopic = {
  id: string;                    // 1～64
  name: string;                  // 1～40
  description: string;           // ≤ 200
  position: { x: number; y: number };  // 固定在 0～1
};

type FieldPerson = {
  id: string;                    // 1～64，可直接传给 `GET /api/creators/:id`
  name: string;                  // 1～80
  headline: string;              // ≤ 200
  avatarUrl: string | null;      // https
  initial: string;               // 头像占位首字，1～2（中文姓名取姓，英文取首字母）
  avatarTone: string;            // ≤ 80
  topicIds: string[];            // ≤ 8；可能为空数组
  relevance: number;             // 0～100
  profileUrl: string | null;     // https；前端不按姓名拼接
};

type FieldGraphResponse = {
  field: FieldSummary;
  topics: FieldTopic[];          // ≥ 1
  people: FieldPerson[];         // ≥ 1
};
```

约定与前端行为：

- `position` 是**相对坐标**，前端负责映射到实际视口。`layoutGraph()`（纯函数，无随机数）会把坐标裁剪进 `[0.06, 0.94]`，所以服务端即使给出 `0` 或 `1`，节点也不会贴边或出框。
- `topicIds` 为空、或指向不存在的议题，人物都会归入「其他（尚未归入具体议题）」分组，**不会被丢弃**。
- 一个人可以同时归入多个议题。因此筛选器里各议题的人数之和**不等于**星图总人数——总人数用的是去重后的 `people.length`。
- 领域来源的人物没有内容证据：前端打开的统一人物名片只展示领域相关度与关联议题，如实写「暂无内容证据」，不虚构。

不存在 / 已下线返回 `404 FIELD_NOT_FOUND`（`retryable: false`），页面给出「返回领域目录」，**不提供重试按钮**——重试同一个不存在的 ID 不会变好。

### `GET /api/creators/:id`

人物公开资料。领域星图与问题找人共用这一个出口，返回的是同一份 `CreatorCardData`。

```ts
type Evidence = {
  id: string;
  title: string;
  excerpt: string;
  kind: "亲身经历" | "专业分析" | "反面案例";
  publishedAt: string;
  source: "zhihu_search" | "fixture";
  url: string | null;              // https 或 null（fixture 无外链）
};

type CreatorCardData = {
  id: string;
  name: string;
  headline: string;
  initial: string;
  avatarTone: string;
  avatarUrl: string | null;
  identityConfidence: "high" | "medium" | "low";
  /**
   * 前三项属于「问题找人」的检索角色；`领域相关` 属于「专业领域」入口——
   * 领域目录只能说明公开内容与议题相关，不能说某人「经历最接近」。
   */
  role: "经历最接近" | "关键维度" | "补充视角" | "领域相关";
  relevanceLevel: "高度相关" | "部分相关" | "补充视角";
  score: number;                   // 0～100
  matchedDimensions: string[];     // ≤ 4
  reason: string;                  // ≤ 500
  evidence: Evidence[];            // ≤ 3；领域来源为空数组
  suitableQuestions: string[];     // ≤ 3
  limitations: string[];           // ≤ 4
  profileUrl: string | null;       // https；无主页时为 null
};
```

- 检索来源（`source="search"`）展示相关度、匹配维度、逐条内容证据与「适合问 TA」；
- 领域来源（`source="field"`）展示「领域相关度」「关联议题」与「暂无内容证据」，并解释为什么没有——不用占位文字凑满版式；
- `profileUrl` 为空时禁用主页按钮并写明原因，后端没给就不生成知乎链接。

找不到返回 `404 NOT_FOUND`（`retryable: false`）。

---

## 4. 搜索

### `POST /api/agent/search` → NDJSON 流

请求：

```ts
type SearchRequest = {
  query: string;                   // trim 后 4～300 字符
  sessionId: string;               // crypto.randomUUID()
  mode?: "fixture" | "live" | "auto";
};
```

响应头：`Content-Type: application/x-ndjson; charset=utf-8`，每行一个 JSON 事件。

```ts
type AgentStep =
  | "loading_context" | "understanding" | "retrieving"
  | "verifying" | "ranking" | "saving";

type SearchAgentEvent =
  | { type: "run.started"; requestId: string }                    // uuid
  | { type: "step.started" | "step.completed";
      step: AgentStep; message: string;
      meta?: Record<string, string | number | boolean | null> }
  | { type: "run.completed";
      result: PersonSearchResult;
      runId: string | null;                                       // uuid 或 null
      persistence: "saved" | "unavailable" }
  | { type: "run.failed"; error: ApiErrorEnvelope };
```

顺序固定：`run.started` → 六个阶段各 `step.started` + `step.completed` → `run.completed` 或 `run.failed`。

前端行为：

- 未上报的阶段永远保持 waiting，**不允许**自行伪造完成事件；
- 只有 `run.completed` 能写入结果；
- 终态事件到达即结束读取（不等连接自然关闭）；流结束但没有终态 → 抛 `INCOMPLETE_STREAM`；
- 取消（`AbortController`）不等于失败：回到 idle，不显示红条；
- 流**中途被掐断**（socket 断开、中间层切流）→ 收敛成 `NETWORK_ERROR`，**不是**把底层异常原样抛出。裸抛出去的话，`reader.read()` 的错误（undici 是 `TypeError: terminated`，浏览器是 `TypeError: Failed to fetch`）会被当成一般 `Error`，`error.message` 直接显示给用户，界面上就出现一句英文技术错误。这一条同样是在 `pnpm run test:e2e:live` 里查出来的。

NDJSON 的解析必须能承受两种真实分块：一个 chunk 里有多行，以及**一行被拆到多个 chunk**（切点可能落在某个汉字的 3 个字节中间）。空行跳过；非法 JSON 或不符合契约的行一律丢弃，绝不交给 UI 渲染。

### 人物卡与结果

```ts
type PersonSearchResult = {
  cards: CreatorCardData[];        // 最多 3
  modeUsed: "live" | "fixture";
  fallbackReason: string | null;
  modelFallback: boolean;
  contextStatus: "applied" | "partial" | "unavailable";
  contextSourceCounts: { creation: number; followee: number; collection: number; favlist: number };
  searchedQueries: string[];
  background: BackgroundDocument[];
  analyzedContentCount: number;
  rejectedContentCount: number;
  runId: string | null;
  persistence: "saved" | "unavailable";
};
```

前端只展示这些白名单字段，**不根据姓名或标题补充任何事实**。

结果区必须区分：

- **人物证据**（`cards[].evidence`）与**背景资料**（`background[]`）分区展示，背景资料不参与推荐；
- Live 与 Fixture 用不同底色说明；Fixture 时明确写「当前显示虚构演示数据」；
- `modelFallback=true` 说明问题理解阶段降级；
- `persistence="unavailable"` 说明结果只在当前会话有效，且**不会**写入本地指针（见下）。

### `GET /api/agent/runs/:runId`

恢复一次搜索运行。刷新页面时用它把结果重新取回来。

```ts
type RunRestoreResponse = {
  runId: string;                   // uuid
  cards: CreatorCardData[];        // 最多 3
  mode: "live" | "fixture";
  contextStatus: "applied" | "partial" | "unavailable";
  analyzedCount: number;
  rejectedCount: number;
  fallbackReason: string | null;
  modelFallback: boolean;
  contextSourceCounts: { creation: number; followee: number; collection: number; favlist: number };
  searchedQueries: string[];
  background: BackgroundDocument[];
  persistence: "saved";
  createdAt: number;
  expiresAt: number;               // 非负
};
```

**为什么这个响应要给全字段**：恢复后的摘要（已应用上下文、分析条数、降级说明、检索词、背景资料）与首次搜索看到的必须是同一份信息。如果这里少给字段，前端只能拿 `false` / `0` / `[]` 补默认值，等于在界面上伪造一次它并不知道的降级情况。因此 `restoreResponseToResult()` 是严格 1:1 的映射，可以用 `toEqual` 直接断言。

`persistence` 在这里是字面量 `"saved"`：只有真正被保存的运行才有得恢复。

非 UUID → `400`；未登录 → `401`；不存在 / 已过期 / 无权访问统一 `404 RUN_NOT_FOUND`（不泄漏存在性）。

前端恢复流程：

```text
搜索完成且 persistence="saved"
   └─ sessionStorage 只写一个指针 { runId, query }
        └─ 刷新页面 → GET /api/agent/runs/:runId → dispatch run.restored
             └─ 失败（404 / 网络）→ 静默清掉指针，回 idle，不显示红条
```

**不把结果缓存在浏览器里**：业务真相始终在服务端，本地只记「上次跑的是哪一次」，避免出现第二份会过期的真相。

### `POST /api/compare`

请求复用 `SearchRequest`。

```ts
type SearchHit = {
  contentId: string;
  contentType: "Answer" | "Article" | "Question" | "Other";
  title: string;
  excerpt: string;
  url: string;                     // https
  commentCount: number;
  voteUpCount: number;
  editTime: number;
  rankingScore: number;
  author: {
    syntheticId: string;
    name: string;
    avatarUrl: string | null;
    badgeText: string | null;
    authorityLevel: 1 | 2 | 3 | 4;
  };
  sourceQuery: string;
  provider: "zhihu_search" | "fixture";
};

type CompareResponse = {
  modeUsed: "live" | "fixture";
  modelFallback: boolean;
  contextStatus: "applied" | "partial" | "unavailable";
  raw: { queries: string[]; hits: SearchHit[] };
  agent: PersonSearchResult;
};
```

`raw.hits` 只出现在对比弹窗里，**普通搜索页不得把它当人物卡**。对比弹窗里的按钮是禁用态（只读预览），要操作需回到搜索结果页。

---

## 5. 会话与消息

```ts
type ConsultationStatus = "free_chat" | "proposed" | "offer_created" | "mock_paid" | "consulting";

type Consultation = {
  id: string;
  status: ConsultationStatus;
  packageId: "text" | "voice-30" | "voice-60" | null;
  amount: number | null;           // 人民币分，非负整数
  updatedAt: string;
};

type Conversation = {
  id: string;
  user: PublicUser;
  creator: CreatorCardData;
  sourceRunId: string | null;      // uuid 或 null；来自领域星图时为 null
  consultation: Consultation;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  conversationId: string;
  clientMessageId: string | null;
  sender: "seeker" | "creator" | "agent" | "system";
  content: string;
  createdAt: string;
};
```

| 方法与路径 | 请求 | 成功响应 |
|---|---|---|
| `POST /api/conversations` | `{ creatorId, sourceRunId }` | `{ conversation }`（200 命中已有会话 / 201 新建） |
| `GET /api/conversations/:id` | — | `{ conversation }` |
| `GET /api/conversations/:id/messages?cursor=&limit=50` | — | `{ items: Message[], nextCursor: string \| null }` |
| `POST /api/conversations/:id/messages` | `{ clientMessageId, actorRole:"seeker"\|"creator", content }` | `{ message }` |
| `POST /api/conversations/:id/reset` | — | `{ conversation, messages }` |

约定：

- `clientMessageId` 由前端生成，用于**幂等重试**：同一个 `clientMessageId` 重复提交不得产生第二条消息；
- 普通用户只能发 `actorRole=seeker`；答主演示消息需要服务端允许（否则 `403 DEMO_ROLE_FORBIDDEN`，前端隐藏该操作）；
- 前端允许先显示临时气泡（sending），但成功后必须用服务端 `Message` 替换；
- `reset` 成功后整体替换 Conversation 与 Messages；失败时保留旧页面只提示错误；
- 同一个人可以有多个会话——**路由用的是会话 ID**，不是人物 ID。

---

## 6. 会话内 Agent

### `POST /api/conversations/:id/agent-runs` → NDJSON 流

请求：

```ts
type AgentMessageRequest = {
  clientMessageId: string;   // 1～120 字符
  content: string;           // trim 后 1～2000 字符
};
```

事件：

```ts
type ConversationAgentEvent =
  | { type: "agent.run.started"; requestId: string; userMessage: Message }
  | { type: "agent.message.started"; messageId: string }
  | { type: "agent.message.delta"; messageId: string; delta: string }
  | { type: "agent.message.completed"; message: Message }
  | { type: "agent.run.failed"; requestId: string; error: ApiErrorEnvelope };
```

前端行为：

- `agent.run.started` 带回的 `userMessage` 用来替换本地临时用户气泡（按 `clientMessageId` + 发送方去重）；
- `delta` 只用于增量展示；
- **只有 `agent.message.completed` 是完成态**，到达后用服务端完整消息原子替换流式气泡；
- 流中断 / 无终态 → 临时 Agent 气泡标记失败（可重试），已确认的用户消息保留；
- 用户主动取消 → 丢弃未成型的 Agent 气泡（它不是已保存的消息）；
- Agent 消息必须显示为 **AI Agent**，不得伪装成真实答主。

---

## 7. 咨询

### `GET /api/consultation/packages`

```ts
type ConsultationPackage = {
  id: "text" | "voice-30" | "voice-60";
  name: string;
  description: string;
  amount: number;              // 人民币分，非负整数
  currency: "CNY";
};

// 响应
type ConsultationPackageList = { items: ConsultationPackage[] };
```

加载失败只提示「套餐暂时不可用」，**不阻塞聊天**。

### `POST /api/conversations/:id/consultation/actions`

请求：

```ts
type ConsultationActionRequest = {
  action: "propose" | "cancel" | "create_offer" | "withdraw_offer"
        | "confirm_mock_payment" | "start_consultation";
  actorRole: "seeker" | "creator";
  packageId?: string;
};
```

成功响应必须**同时**包含状态与系统消息：

```ts
type ConsultationActionResponse = {
  consultation: Consultation;
  systemMessage: Message;      // sender = "system"
};
```

状态迁移由服务端决定，前端**不推导下一状态**。非法转移返回 `409 INVALID_CONSULTATION_TRANSITION`，并在 `details` 里带上服务端当前的 `Consultation`；前端用 `details` 校正 UI 并提示，不自行猜测。

Mock 的状态机（`src/front/api/MockApiClient.ts` 的 `ALLOWED_TRANSITIONS`）：

| 角色 | 动作 | 允许的当前状态 | 结果状态 |
|---|---|---|---|
| seeker | `propose` | `free_chat` | `proposed` |
| seeker | `cancel` | `proposed` | `free_chat` |
| seeker | `confirm_mock_payment` | `offer_created` | `mock_paid` |
| creator | `create_offer` | `free_chat` / `proposed` | `offer_created` |
| creator | `withdraw_offer` | `offer_created` | `free_chat` |
| creator | `start_consultation` | `mock_paid` | `consulting` |

状态标签（`CONSULTATION_STATUS_LABELS`）：`free_chat` 免费交流 · `proposed` 已申请咨询 · `offer_created` 咨询方案待确认 · `mock_paid` 模拟支付完成 · `consulting` 咨询进行中。

模拟支付弹窗只展示套餐名、描述与格式化金额，并明确「不会创建真实订单，也不会产生扣款」；不存在银行卡、手机号、身份证字段，也不引入任何真实支付 SDK。

---

## 8. 错误映射

| HTTP / code | 前端行为 |
|---|---|
| `400 INVALID_SEARCH_REQUEST` | 显示输入错误，保留已输入内容 |
| `400 INVALID_MESSAGE` | 恢复输入框内容，显示消息错误 |
| `401 ZHIHU_AUTH_REQUIRED / ZHIHU_AUTH_EXPIRED` | 终止受保护请求，刷新 session，进入 AuthGate |
| `403 DEMO_ROLE_FORBIDDEN` | 隐藏答主演示操作 |
| `404 FIELD_NOT_FOUND` | 领域不存在页，提供返回领域目录（**不给重试**） |
| `404 NOT_FOUND` | 人物公开资料缺失提示，保留当前页面上下文 |
| `404 RUN_NOT_FOUND` | 静默清掉本地运行指针，搜索页回到 idle（用户没做错事，不弹红条） |
| `404 CONVERSATION_NOT_FOUND` | 会话不存在页，提供返回找人 |
| `409 CONVERSATION_SOURCE_UNAVAILABLE` | 保留人物结果，聊天按钮显示可重试错误 |
| `409 INVALID_CONSULTATION_TRANSITION` | 用 `details` 里的**完整 Consultation 对象**回正咨询面板（不是只回状态字符串） |
| `429 RATE_LIMITED` | 保留输入与草稿，提示稍后重试（`person-search.test.tsx` 覆盖「提示 → 重试 → 成功」全程） |
| `503 FIELD_SEARCH_FAILED` | 检索区错误态 + 重试；推荐领域仍可用 |
| `503 PERSISTENCE_UNAVAILABLE` | 不伪造本地成功，显示可重试错误 |
| 网络断开 / 流中断 | 保留已确认数据，临时增量标记失败 |

「可重试」与「不可重试」是产品语义，不只是按钮有无：404 表示目标本身不存在，重试同一个 ID 不会变好，所以给的是**换一条路**的动作（返回目录 / 返回找人），不是重试按钮。

仅前端产生的错误码（服务端不会返回）：`REQUEST_ABORTED`、`INCOMPLETE_STREAM`、`STREAM_UNAVAILABLE`、`INVALID_RESPONSE`、`NETWORK_ERROR`、`UNKNOWN_ERROR`。完整清单见 `src/shared/contracts/errors.ts`。

---

## 9. `ApiClient` 接口

`src/front/api/ApiClient.ts` 是网络访问的唯一出口，17 个方法：

```ts
export interface ApiClient {
  /* 基础 */
  getSession(signal?: AbortSignal): Promise<AuthSessionView>;
  getHotTopics(signal?: AbortSignal): Promise<HotTopicsResponse>;

  /* 专业领域 */
  getFeaturedFields(signal?: AbortSignal): Promise<FieldSummary[]>;
  searchFields(query: string, limit?: number, signal?: AbortSignal): Promise<FieldSummary[]>;
  getFieldGraph(fieldId: string, signal?: AbortSignal): Promise<FieldGraphResponse>;
  getCreator(creatorId: string, signal?: AbortSignal): Promise<CreatorCardData>;

  /* 问题找人 */
  streamSearch(
    input: SearchRequest,
    onEvent: (event: SearchAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<Extract<SearchAgentEvent, { type: "run.completed" }>>;
  restoreRun(runId: string, signal?: AbortSignal): Promise<RunRestoreResponse>;
  compare(input: SearchRequest, signal?: AbortSignal): Promise<CompareResponse>;
  createConversation(
    input: { creatorId: string; sourceRunId: string | null },
    signal?: AbortSignal,
  ): Promise<Conversation>;

  /* 会话与咨询 */
  getConversation(id: string, signal?: AbortSignal): Promise<Conversation>;
  listMessages(
    id: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ items: Message[]; nextCursor: string | null }>;
  sendMessage(
    id: string,
    input: { clientMessageId: string; actorRole: "seeker" | "creator"; content: string },
    signal?: AbortSignal,
  ): Promise<Message>;
  streamConversationAgent(
    id: string,
    input: AgentMessageRequest,
    onEvent: (event: ConversationAgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<Extract<ConversationAgentEvent, { type: "agent.message.completed" }>>;
  getConsultationPackages(signal?: AbortSignal): Promise<ConsultationPackage[]>;
  applyConsultationAction(
    id: string,
    input: { action: ConsultationAction; actorRole: "seeker" | "creator"; packageId?: string },
    signal?: AbortSignal,
  ): Promise<{ consultation: Consultation; systemMessage: Message }>;
  resetConversation(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ conversation: Conversation; messages: Message[] }>;
}
```

两个实现：`HttpApiClient`（真实 HTTP + 响应校验 + 错误转换）与 `MockApiClient`（确定性内存后端）。组件只通过 `useApiClient()` 取接口，不判断当前是 Mock 还是真实后端。

模拟支付等**不做前端展示以外的事**的能力没有对应方法：私有知识库 Agent 只读本地的展示夹具（`src/front/features/private-agent/private-agent-fixture.ts`），不接任何接口，也不上传文件。

---

## 10. 后端 TODO（本工程不实现，但接口已按此形状约定）

- OAuth 授权码换取令牌、令牌加密存储与刷新，全部留在服务端；
- NDJSON 流的分块与心跳节奏；
- `runId` 的有效期与访问控制；
- 领域目录的数据来源、议题聚类与人物归属算法；
- `clientMessageId` 幂等的落库实现；
- 咨询状态机的事务性与并发冲突（409）判定；
- 限流（`429 RATE_LIMITED`）与持久化降级（`503 PERSISTENCE_UNAVAILABLE`）。
