# 后端职责与接口边界

本文档声明服务端必须承担的职责，以及前端已经依赖的接口边界，供后端按同一份契约实现。

> 这份说明原先是 `src/back/README.md`。本仓库由前后端共同使用，`src/back/` 是后端实现代码的位置，
> 把边界文档挤在别人的实现文件旁边不合适，因此移到 `docs/` 下。

前端是纯浏览器侧工程：通过 `src/front/api` 的 `ApiClient` 访问真实 API 或确定性 Mock，
两者的请求与响应都必须满足 `src/shared/contracts`。

放在前端代码里的任何后端实现（OAuth 处理、数据库访问、Agent Runtime、密钥管理）**都不属于前端**。
`scripts/check-boundaries.mjs` 会拦住这类越界。

逐接口的请求 / 响应示例见 [`BACKEND_INTEGRATION.md`](BACKEND_INTEGRATION.md)。

## 1. 后端职责清单

| 职责域 | 具体内容 |
|---|---|
| 授权 | 知乎 OAuth 发起与回调、state 校验、授权码换令牌、令牌加密存储与刷新、退出时清除会话 |
| 会话 | 服务端会话 Cookie 的签发与校验；只向浏览器暴露「是否已授权」和公开昵称 |
| 领域数据 | 专业领域、子议题、人物与「人物—议题」关联关系；领域主题色与标签 |
| 检索 | 领域检索（名称/别名/标签/简介/议题关键词）、问题检索、内容证据抽取与去重 |
| Agent Runtime | 六阶段检索流程、模型调用与降级、人物卡排序与可解释理由生成 |
| 会话与消息 | Conversation / Message / Consultation 的业务状态机与幂等写入、分页游标 |
| 流式 | Agent 搜索与 Agent 对话的 NDJSON 事件流、断流语义、取消处理 |
| 治理 | 鉴权（401/403）、幂等（`clientMessageId`）、限流（429）、统一错误码 |
| 持久化 | 运行结果（run）与会话的持久化、过期清理 |
| 未来能力 | 私有知识库与 RAG、真实支付——**本次前端计划不实现**，前端只做展示与模拟 |

## 2. 接口边界

所有 JSON 错误体统一为：

```ts
type ApiErrorEnvelope = {
  code: string;
  message: string;
  retryable: boolean;
};
```

> 这个对象在契约里是 `.strict()` 的：**只允许这三个键**，多一个字段前端就会整条响应判为
> `INVALID_RESPONSE`。

### 2.1 授权

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/auth/session` | 当前公开登录状态（`configured` / `authenticated` / `user`） |
| `GET` | `/api/auth/zhihu/login` | 浏览器导航到知乎 OAuth 授权页（307） |
| `GET` | `/api/auth/zhihu/logout` | 浏览器导航退出并清除会话 |

### 2.2 问题找人

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/topics/hot` | 热榜选题（仅作提问参考，不参与人物推荐） |
| `POST` | `/api/agent/search` | 问题找人 NDJSON 事件流 |
| `GET` | `/api/agent/runs/:runId` | 刷新后恢复上一次搜索结果 |
| `POST` | `/api/compare` | 三栏对比测试 |

### 2.3 专业领域

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/fields/featured` | 推荐领域 |
| `GET` | `/api/fields?query=<text>&limit=<number>` | 领域检索，**响应始终是领域列表** |
| `GET` | `/api/fields/:fieldId/graph` | 领域星图：议题节点 + 人物聚类 |
| `GET` | `/api/creators/:creatorId` | 人物公开资料（含 `profileUrl`） |

领域检索规则：服务端按领域名、别名、标签、简介和议题关键词检索，但返回值始终是领域列表；
前端不得把领域搜索的返回结果改造成人物搜索。人物主页地址必须由服务端返回，前端不得按姓名拼接。

### 2.4 会话与咨询

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/conversations` | 创建或幂等恢复会话 |
| `GET` | `/api/conversations/:id` | 获取会话快照 |
| `GET` | `/api/conversations/:id/messages` | 分页获取消息 |
| `POST` | `/api/conversations/:id/messages` | 发送普通消息（按 `clientMessageId` 幂等） |
| `POST` | `/api/conversations/:id/agent-runs` | Agent 对话 NDJSON 事件流 |
| `POST` | `/api/conversations/:id/reset` | 重置会话 |
| `GET` | `/api/consultation/packages` | 咨询套餐（展示用） |
| `POST` | `/api/conversations/:id/consultation/actions` | 咨询状态流转（模拟支付） |

## 3. 后端绝不向前端下发的数据

- 知乎 Access Token、Refresh Token，以及 `ZHIHU_ACCESS_SECRET`、`APP_SESSION_SECRET`
  等密钥材料本身。
- 数据库内部主键、内部用户标识、软删除标记、审计字段。
- Agent 内部 Prompt、模型原始响应、私有知识库原文。
- 任何支付敏感信息（卡号、手机号、身份证）——本项目只有模拟支付。

前端对应地在 `src/shared/contracts` 用 `.strict()` 拒绝未声明字段：一旦后端多下发上述内容，
契约校验会直接失败，而不是静默泄漏到页面上。

## 4. 未实现接口时的前端约定

当后端尚未实现某个接口时：

1. 在 `src/shared/contracts` 补公开 Schema；
2. 在 `src/front/api/ApiClient.ts` 补方法，并在 `HttpApiClient` 与 `MockApiClient` 各实现一次；
3. 在 `docs/API_CONTRACT.md` 记录方法、路径、请求、响应、错误码与流事件。

**不得**为了「先跑起来」把后端代码、密钥或数据库访问写进 `src/front`。
