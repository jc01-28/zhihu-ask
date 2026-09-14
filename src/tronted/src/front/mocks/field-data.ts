import {
  fieldGraphResponseSchema,
  fieldSummarySchema,
  type FieldGraphResponse,
  type FieldPerson,
  type FieldSummary,
} from "@/shared/contracts/field";
import { creatorCardSchema, type CreatorCardData } from "@/shared/contracts/creator";

/**
 * 领域、议题与人物聚类的确定性演示数据。
 *
 * 与 `demo-data.ts` 一样：所有 ID、坐标、数值与文本全部固定，不使用 `Math.random()`，
 * 因此 Mock、单元测试、E2E 与截图都能精确复现。所有人物均为虚构演示数据。
 *
 * 三条必须遵守的约定：
 *  1. 议题坐标是 0～1 的**相对**坐标，前端负责映射进视口，因此坐标天然落在可视区内；
 *  2. 人物只声明自己关联的议题 ID，位置由前端布局函数推导，后端不下发人物坐标；
 *  3. `profileUrl` 一律带 `zhihu-wenren-demo-` 前缀，避免暗示任何真实知乎用户主页。
 */

const DEMO_PROFILE = (slug: string) =>
  `https://www.zhihu.com/people/zhihu-wenren-demo-${slug}`;

/** 议题相对坐标：三议题用三角分布，四议题用十字分布，都是固定值。 */
const TRIANGLE = [
  { x: 0.5, y: 0.16 },
  { x: 0.18, y: 0.74 },
  { x: 0.82, y: 0.74 },
] as const;

const CROSS = [
  { x: 0.5, y: 0.14 },
  { x: 0.15, y: 0.5 },
  { x: 0.5, y: 0.86 },
  { x: 0.85, y: 0.5 },
] as const;

type FieldSeed = {
  field: FieldSummary;
  topics: Array<{ id: string; name: string; description: string }>;
  people: FieldPerson[];
};

const SEEDS: FieldSeed[] = [
  {
    field: {
      id: "agent-development",
      name: "Agent 开发",
      description:
        "把大模型接入真实业务系统的工程方向，覆盖任务规划、工具调用、记忆管理与效果评测。",
      icon: "bot",
      color: "blue",
      tags: ["Agent", "工具调用", "多智能体"],
      memberCount: 6,
      topicCount: 4,
    },
    topics: [
      {
        id: "t-agent-planning",
        name: "任务规划与分解",
        description: "把模糊目标拆成可执行步骤，并决定何时回到人类确认。",
      },
      {
        id: "t-agent-tooluse",
        name: "工具调用与编排",
        description: "函数调用协议、失败重试、并发编排与权限边界。",
      },
      {
        id: "t-agent-memory",
        name: "记忆与上下文检索",
        description: "长对话的压缩、检索增强与状态一致性。",
      },
      {
        id: "t-agent-eval",
        name: "效果评测与回流",
        description: "离线评测集、线上回流与回归防护。",
      },
    ],
    people: [
      {
        id: "p-shen-yiran",
        name: "沈亦然",
        headline: "多智能体框架作者 · 前搜索团队工程负责人",
        avatarUrl: null,
        initial: "沈",
        avatarTone: "from-sky-700 to-blue-500",
        topicIds: ["t-agent-planning", "t-agent-tooluse"],
        relevance: 94,
        profileUrl: DEMO_PROFILE("shen-yiran"),
      },
      {
        id: "p-luo-qi",
        name: "罗琪",
        headline: "Agent 评测体系搭建者 · 开源项目维护者",
        avatarUrl: null,
        initial: "罗",
        avatarTone: "from-indigo-700 to-violet-500",
        topicIds: ["t-agent-eval", "t-agent-tooluse"],
        relevance: 88,
        profileUrl: DEMO_PROFILE("luo-qi"),
      },
      {
        id: "p-he-zhiyuan",
        name: "何知远",
        headline: "AI 基础设施工程师 · 专注函数调用协议",
        avatarUrl: null,
        initial: "何",
        avatarTone: "from-slate-800 to-slate-500",
        topicIds: ["t-agent-tooluse"],
        relevance: 84,
        profileUrl: null,
      },
      {
        id: "p-tan-shu",
        name: "谭舒",
        headline: "对话产品经理 · 记忆系统设计",
        avatarUrl: null,
        initial: "谭",
        avatarTone: "from-teal-700 to-emerald-500",
        topicIds: ["t-agent-memory", "t-agent-planning"],
        relevance: 79,
        profileUrl: DEMO_PROFILE("tan-shu"),
      },
      {
        id: "p-wei-an",
        name: "韦岸",
        headline: "检索工程师 · 向量库运维与召回优化",
        avatarUrl: null,
        initial: "韦",
        avatarTone: "from-cyan-700 to-teal-400",
        topicIds: ["t-agent-memory"],
        relevance: 72,
        profileUrl: null,
      },
      {
        id: "p-gu-chengyu",
        name: "顾承宇",
        headline: "技术负责人 · 从规则系统迁移到 Agent",
        avatarUrl: null,
        initial: "顾",
        avatarTone: "from-blue-800 to-sky-600",
        topicIds: ["t-agent-planning", "t-agent-eval"],
        relevance: 68,
        profileUrl: DEMO_PROFILE("gu-chengyu"),
      },
    ],
  },
  {
    field: {
      id: "fintech",
      name: "金融科技",
      description:
        "信贷风控、支付清结算与量化交易三条主线，对稳定性、合规和可解释性的要求高于一般互联网系统。",
      icon: "landmark",
      color: "emerald",
      tags: ["风控", "支付", "量化"],
      memberCount: 5,
      topicCount: 3,
    },
    topics: [
      {
        id: "t-fintech-risk",
        name: "风控建模与反欺诈",
        description: "评分卡与模型监控，欺诈团伙识别与策略迭代。",
      },
      {
        id: "t-fintech-payment",
        name: "支付与清结算",
        description: "账务一致性、对账差错处理与资金链路可用性。",
      },
      {
        id: "t-fintech-quant",
        name: "量化与交易系统",
        description: "策略研究框架、低延迟链路与回测陷阱。",
      },
    ],
    people: [
      {
        id: "p-xue-muran",
        name: "薛沐然",
        headline: "风控算法负责人 · 零售信贷",
        avatarUrl: null,
        initial: "薛",
        avatarTone: "from-emerald-800 to-green-500",
        topicIds: ["t-fintech-risk"],
        relevance: 91,
        profileUrl: DEMO_PROFILE("xue-muran"),
      },
      {
        id: "p-qin-yue",
        name: "秦悦",
        headline: "支付清结算架构师",
        avatarUrl: null,
        initial: "秦",
        avatarTone: "from-green-800 to-emerald-500",
        topicIds: ["t-fintech-payment"],
        relevance: 86,
        profileUrl: DEMO_PROFILE("qin-yue"),
      },
      {
        id: "p-leng-siqi",
        name: "冷思齐",
        headline: "量化研究员 · 中低频策略",
        avatarUrl: null,
        initial: "冷",
        avatarTone: "from-teal-800 to-green-500",
        topicIds: ["t-fintech-quant"],
        relevance: 81,
        profileUrl: DEMO_PROFILE("leng-siqi"),
      },
      {
        id: "p-bai-yun",
        name: "白筠",
        headline: "反欺诈策略专家 · 交易反洗钱",
        avatarUrl: null,
        initial: "白",
        avatarTone: "from-lime-800 to-emerald-500",
        topicIds: ["t-fintech-risk", "t-fintech-payment"],
        relevance: 75,
        profileUrl: null,
      },
      {
        id: "p-zhou-bin",
        name: "周斌",
        headline: "交易系统低延迟优化",
        avatarUrl: null,
        initial: "周",
        avatarTone: "from-cyan-800 to-emerald-400",
        topicIds: ["t-fintech-quant"],
        relevance: 69,
        profileUrl: null,
      },
    ],
  },
  {
    field: {
      id: "data-modeling",
      name: "数据建模",
      description:
        "从原始日志到可复用指标的数据底座方向，关心建模规范、指标口径和特征复用效率。",
      icon: "database",
      color: "cyan",
      tags: ["数仓", "指标体系", "特征工程"],
      memberCount: 4,
      topicCount: 3,
    },
    topics: [
      {
        id: "t-data-warehouse",
        name: "数仓分层与建模",
        description: "维度建模、分层职责划分与历史变更处理。",
      },
      {
        id: "t-data-metrics",
        name: "指标体系治理",
        description: "指标口径统一、口径冲突裁决与血缘追踪。",
      },
      {
        id: "t-data-feature",
        name: "特征工程与特征平台",
        description: "训练与推理特征一致性、特征复用与漂移监控。",
      },
    ],
    people: [
      {
        id: "p-fan-ruoyu",
        name: "樊若瑜",
        headline: "数仓架构师 · 维度建模",
        avatarUrl: null,
        initial: "樊",
        avatarTone: "from-cyan-800 to-sky-500",
        topicIds: ["t-data-warehouse"],
        relevance: 92,
        profileUrl: DEMO_PROFILE("fan-ruoyu"),
      },
      {
        id: "p-mu-qingchen",
        name: "穆清晨",
        headline: "指标体系负责人",
        avatarUrl: null,
        initial: "穆",
        avatarTone: "from-sky-800 to-cyan-500",
        topicIds: ["t-data-metrics"],
        relevance: 85,
        profileUrl: DEMO_PROFILE("mu-qingchen"),
      },
      {
        id: "p-jiang-li",
        name: "江黎",
        headline: "特征平台工程师",
        avatarUrl: null,
        initial: "江",
        avatarTone: "from-blue-800 to-cyan-500",
        topicIds: ["t-data-feature", "t-data-warehouse"],
        relevance: 77,
        profileUrl: null,
      },
      {
        id: "p-shi-yi",
        name: "石屹",
        headline: "数据治理 · 元数据建设",
        avatarUrl: null,
        initial: "石",
        avatarTone: "from-slate-700 to-cyan-600",
        topicIds: ["t-data-metrics", "t-data-warehouse"],
        relevance: 66,
        profileUrl: null,
      },
    ],
  },
  {
    field: {
      id: "product-startup",
      name: "产品与创业",
      description:
        "早期公司里的产品判断、商业化验证与团队组织。这里的三位人物同时也是「问题找人」的演示人物，便于对比两条入口。",
      icon: "rocket",
      color: "violet",
      tags: ["从 0 到 1", "商业化", "早期团队"],
      memberCount: 6,
      topicCount: 3,
    },
    topics: [
      {
        id: "t-product-zero",
        name: "从 0 到 1 的产品判断",
        description: "需求真伪辨别、最小验证与取舍标准。",
      },
      {
        id: "t-product-monetize",
        name: "商业化与定价",
        description: "从免费到付费的转化路径、成本结构与定价策略。",
      },
      {
        id: "t-product-team",
        name: "早期团队与组织",
        description: "前二十人的招聘、分工与反馈机制。",
      },
    ],
    people: [
      {
        id: "lin-zhixing",
        name: "林知行",
        headline: "前大厂产品负责人 · AI 创业团队联合创始人",
        avatarUrl: null,
        initial: "林",
        avatarTone: "from-slate-950 to-slate-700",
        topicIds: ["t-product-zero", "t-product-team"],
        relevance: 95,
        profileUrl: DEMO_PROFILE("lin-zhixing"),
      },
      {
        id: "zhou-yu",
        name: "周屿",
        headline: "AI 产品顾问 · 早期科技公司前产品总监",
        avatarUrl: null,
        initial: "周",
        avatarTone: "from-blue-700 to-cyan-500",
        topicIds: ["t-product-monetize", "t-product-zero"],
        relevance: 88,
        profileUrl: DEMO_PROFILE("zhou-yu"),
      },
      {
        id: "p-cen-hao",
        name: "岑皓",
        headline: "早期投资人 · 关注 AI 应用商业模型",
        avatarUrl: null,
        initial: "岑",
        avatarTone: "from-violet-800 to-purple-500",
        topicIds: ["t-product-monetize"],
        relevance: 82,
        profileUrl: DEMO_PROFILE("cen-hao"),
      },
      {
        id: "p-ning-wan",
        name: "宁晚",
        headline: "用户研究负责人 · 需求验证方法",
        avatarUrl: null,
        initial: "宁",
        avatarTone: "from-purple-800 to-fuchsia-500",
        topicIds: ["t-product-zero"],
        relevance: 76,
        profileUrl: null,
      },
      {
        id: "cheng-che",
        name: "程澈",
        headline: "连续创业者 · 曾经历项目收缩与团队重组",
        avatarUrl: null,
        initial: "程",
        avatarTone: "from-violet-700 to-fuchsia-500",
        topicIds: ["t-product-team"],
        relevance: 74,
        profileUrl: null,
      },
      {
        id: "p-fang-zhou",
        name: "方舟",
        headline: "创业公司 HR 负责人 · 早期招聘",
        avatarUrl: null,
        initial: "方",
        avatarTone: "from-indigo-800 to-violet-500",
        topicIds: ["t-product-team"],
        relevance: 64,
        profileUrl: null,
      },
    ],
  },
  {
    field: {
      id: "ai-application",
      name: "AI 应用",
      description:
        "把模型能力做成可交付产品的方向，关注检索增强、多模态交互与企业场景真实落地成本。",
      icon: "sparkles",
      color: "amber",
      tags: ["RAG", "多模态", "企业落地"],
      memberCount: 5,
      topicCount: 3,
    },
    topics: [
      {
        id: "t-ai-rag",
        name: "检索增强生成",
        description: "切分策略、召回排序与答案溯源。",
      },
      {
        id: "t-ai-multimodal",
        name: "多模态交互",
        description: "语音、视觉与文本混合输入的交互设计。",
      },
      {
        id: "t-ai-adoption",
        name: "企业场景落地",
        description: "私有化部署、成本核算与人工兜底流程。",
      },
    ],
    people: [
      {
        id: "p-lu-yanzhi",
        name: "陆言之",
        headline: "RAG 系统工程师 · 服务大型知识库",
        avatarUrl: null,
        initial: "陆",
        avatarTone: "from-amber-800 to-orange-500",
        topicIds: ["t-ai-rag"],
        relevance: 90,
        profileUrl: DEMO_PROFILE("lu-yanzhi"),
      },
      {
        id: "p-yin-ke",
        name: "殷可",
        headline: "多模态产品经理 · 语音与视觉交互",
        avatarUrl: null,
        initial: "殷",
        avatarTone: "from-orange-800 to-amber-500",
        topicIds: ["t-ai-multimodal"],
        relevance: 84,
        profileUrl: DEMO_PROFILE("yin-ke"),
      },
      {
        id: "p-shang-wen",
        name: "尚文",
        headline: "企业 AI 落地顾问",
        avatarUrl: null,
        initial: "尚",
        avatarTone: "from-yellow-800 to-amber-500",
        topicIds: ["t-ai-adoption", "t-ai-rag"],
        relevance: 78,
        profileUrl: null,
      },
      {
        id: "p-ke-zhou",
        name: "柯舟",
        headline: "模型部署与推理成本优化",
        avatarUrl: null,
        initial: "柯",
        avatarTone: "from-amber-900 to-yellow-600",
        topicIds: ["t-ai-adoption"],
        relevance: 71,
        profileUrl: null,
      },
      {
        id: "p-tang-yu",
        name: "汤禹",
        headline: "效果标注与人工反馈闭环",
        avatarUrl: null,
        initial: "汤",
        avatarTone: "from-orange-900 to-amber-600",
        // 尚未归入具体议题：星图必须把它放进「其他」分组，而不是丢弃或猜一个议题。
        topicIds: [],
        relevance: 62,
        profileUrl: null,
      },
    ],
  },
];

function positionFor(index: number, total: number): { x: number; y: number } {
  const table = total === 4 ? CROSS : TRIANGLE;
  const slot = table[index % table.length];
  return { x: slot.x, y: slot.y };
}

const GRAPHS: FieldGraphResponse[] = SEEDS.map((seed) => {
  const topics = seed.topics.map((topic, index) => ({
    ...topic,
    position: { ...positionFor(index, seed.topics.length) },
  }));
  return fieldGraphResponseSchema.parse({
    field: seed.field,
    topics,
    people: seed.people,
  });
});

const SUMMARIES: FieldSummary[] = GRAPHS.map((graph) =>
  fieldSummarySchema.parse(graph.field),
);

/** 推荐领域的展示顺序：与产品首页主推方向一致，固定不随机。 */
export const FEATURED_FIELD_IDS = [
  "agent-development",
  "product-startup",
  "ai-application",
  "fintech",
  "data-modeling",
] as const;

export const FIELD_SUMMARIES: FieldSummary[] = SUMMARIES;

export const FIELD_GRAPHS: FieldGraphResponse[] = GRAPHS;

/** 用于领域检索的议题关键词表：领域搜索按名称/标签/简介/议题关键词匹配。 */
const FIELD_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  GRAPHS.map((graph) => [
    graph.field.id,
    [
      ...graph.topics.map((topic) => topic.name),
      ...graph.topics.map((topic) => topic.description),
    ],
  ]),
);

export function findFieldSummary(fieldId: string): FieldSummary | null {
  return SUMMARIES.find((field) => field.id === fieldId) ?? null;
}

export function findFieldGraph(fieldId: string): FieldGraphResponse | null {
  return FIELD_GRAPHS.find((graph) => graph.field.id === fieldId) ?? null;
}

export function featuredFields(): FieldSummary[] {
  const ordered = FEATURED_FIELD_IDS.map((id) => findFieldSummary(id)).filter(
    (field): field is FieldSummary => field !== null,
  );
  // 推荐列表里的领域与全量领域始终一致，避免新增领域后从推荐位「消失」。
  const rest = SUMMARIES.filter((field) => !ordered.includes(field));
  return [...ordered, ...rest];
}

/**
 * 领域检索：命中领域名、标签、简介或议题关键词时返回该领域。
 *
 * 返回值**始终**是 `FieldSummary[]`；领域搜索不会退化成人物搜索，
 * 因此这里既不返回人物，也不接受「找人」这类语义改写。
 */
export function searchFixtureFields(query: string, limit = 8): FieldSummary[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [];
  const matched = SUMMARIES.filter((field) => {
    const haystack = [
      field.name,
      field.description,
      ...field.tags,
      ...(FIELD_KEYWORDS[field.id] ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });
  return matched.slice(0, Math.max(0, limit));
}

/** 全部领域与全部星图人物，用于「人物公开资料」的跨领域查找。 */
export function findFieldPerson(creatorId: string): FieldPerson | null {
  for (const graph of FIELD_GRAPHS) {
    const person = graph.people.find((item) => item.id === creatorId);
    if (person) return person;
  }
  return null;
}

export function fieldOfPerson(creatorId: string): FieldSummary | null {
  for (const graph of FIELD_GRAPHS) {
    if (graph.people.some((item) => item.id === creatorId)) return graph.field;
  }
  return null;
}

function relevanceLevelFor(score: number): CreatorCardData["relevanceLevel"] {
  if (score >= 85) return "高度相关";
  if (score >= 70) return "部分相关";
  return "补充视角";
}

/**
 * 把星图人物转换为统一人物名片数据。
 *
 * 领域来源的人物没有可核验的内容证据，因此 `evidence` 为空数组、`suitableQuestions`
 * 为空，并在 `limitations` 里如实说明。这里**不**为了界面好看去伪造证据或经历。
 */
export function fieldPersonToCreatorCard(person: FieldPerson): CreatorCardData {
  const graph = FIELD_GRAPHS.find((item) =>
    item.people.some((node) => node.id === person.id),
  );
  const topicNames = (graph?.topics ?? [])
    .filter((topic) => person.topicIds.includes(topic.id))
    .map((topic) => topic.name)
    .slice(0, 4);

  return creatorCardSchema.parse({
    id: person.id,
    name: person.name,
    headline: person.headline,
    initial: person.initial,
    avatarTone: person.avatarTone,
    avatarUrl: person.avatarUrl,
    profileUrl: person.profileUrl,
    identityConfidence: "low",
    role: "领域相关",
    relevanceLevel: relevanceLevelFor(person.relevance),
    score: person.relevance,
    matchedDimensions: topicNames,
    reason: graph
      ? `来自「${graph.field.name}」领域：公开内容主要涉及${
          topicNames.length > 0 ? topicNames.join("、") : "该领域的多个议题"
        }。`
      : "来自专业领域目录的公开人物资料。",
    evidence: [],
    suitableQuestions: [],
    limitations: [
      "人物来自领域目录，只表示公开内容与议题相关，尚未核验其具体经历细节。",
      "领域相关度只用于排序展示，不代表可咨询程度或回答质量。",
    ],
  });
}
