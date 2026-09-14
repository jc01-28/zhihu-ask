/**
 * 领域域 · 人工定义的骨架
 *
 * ⚠️ 为什么是手写的，而不是让模型从语料里聚类：
 *   1. **知乎开放平台没有「领域 / 议题」概念**，没有现成接口可接；
 *   2. 领域名称是**产品叙事**（「专业领域社交」这张脸），必须可控、可讲、可评审，
 *      不能每次跑出来都不一样；
 *   3. 聚类结果无法解释——而「可解释」是这条产品线的内核。
 *
 * 但**人物不是编的**：谁属于哪个议题、相关度多少，全部由真实知乎内容算出来
 * （见 `field-graph.ts`）。所以这套数据是「人工定骨架 + 真实内容挂人」。
 *
 * ── 关键词怎么定的 ──────────────────────────────────────────────────────
 * 全部对着真实语料校准过（180 条 harvested 内容）。定关键词时避开了两类坑：
 *   · **太泛的词**（如「模型」「管理」「数据」）会把人人都匹配进来 → 只用有区分度的
 *   · **只有单字/单词形**的词会漏召回 → 中英文写法、常见同义表述都列上
 * 匹配是大小写不敏感的（见 `field-graph.ts` 的归一化）。
 */

import type { FieldColorToken } from '@/shared/contract';

/** 议题种子（人工定义） */
export interface FieldTopicSeed {
  id: string;
  name: string;
  description: string;
  /** 命中任意一个即认为内容属于该议题 */
  keywords: string[];
}

/** 领域种子（人工定义） */
export interface FieldSeed {
  id: string;
  name: string;
  description: string;
  /**
   * 图标**名称**。前端用白名单映射到具体图标，未知名称回退默认图标。
   * **不用 emoji、不用 URL** —— 前端契约只把它当字符串，绝不会当资源路径。
   * 取值参考前端依赖的 lucide 图标名。
   */
  icon: string;
  /** 主题色 **语义 token**（见 `FIELD_COLOR_TOKENS`），不是十六进制色值 */
  color: FieldColorToken;
  tags: string[];
  /** 领域别名。**领域搜索要能通过这些词命中**（如输入「训练大模型」要能搜到本领域） */
  aliases: string[];
  /**
   * 领域级搜索提示词。
   *
   * 用途：让**具体技术词**也能命中这个领域，即使那个词既不是领域名、也不是任何议题名。
   * 规格里的原例：输入「训练大模型」应同时命中「人工智能应用」和「Agent 开发」——
   * 后者靠的就是这里的「大模型」。
   *
   * 匹配是双向包含（`词包含查询` 或 `查询包含词`），所以写短词召回更广。
   */
  searchHints: string[];
  topics: FieldTopicSeed[];
}

export const FIELD_SEEDS: FieldSeed[] = [
  {
    id: 'agent-dev',
    name: 'Agent 开发',
    description: '把大模型接上工具、记忆与协作机制，做成能真正干活的智能体。',
    icon: 'bot',
    color: 'blue',
    tags: ['LLM', 'Agent', '工程'],
    aliases: ['智能体', 'agent', 'AI Agent', '多智能体', 'agent开发'],
    searchHints: ['大模型', 'LLM', '智能体', 'prompt 工程', '工具调用'],
    topics: [
      {
        id: 'agent-arch',
        name: 'Agent 架构与源码',
        description: 'ReAct、Plan-and-Execute、多智能体协作等架构选择与取舍。',
        keywords: ['agent', '智能体', '多智能体', '源码剖析', '架构设计', 'workflow 引擎'],
      },
      {
        id: 'tool-use',
        name: '工具调用与协议',
        description: '函数调用、MCP、工具编排与外部系统接入。',
        keywords: ['工具调用', 'function call', 'function calling', 'mcp', '插件', '工具链'],
      },
      {
        id: 'agent-eval',
        name: '评测与可靠性',
        description: 'Agent 的评测方法、幻觉抑制与线上可靠性。',
        keywords: ['评测', '幻觉', '可靠性', '基准', '回归测试', 'agent 评测'],
      },
    ],
  },
  {
    id: 'ai-app',
    name: '人工智能应用',
    description: '把大模型落到具体业务里，并让它稳定上线、跑得起成本。',
    icon: 'sparkles',
    color: 'violet',
    tags: ['大模型', '落地', '工程化'],
    aliases: ['AI 应用', '大模型应用', 'LLM 应用', '人工智能', '大模型'],
    searchHints: ['大模型', 'LLM', '模型微调', '推理部署', '知识库'],
    topics: [
      {
        id: 'llm-landing',
        name: '大模型落地',
        description: '垂直领域的大模型选型、微调与效果调优。',
        keywords: ['大模型', 'llm', '落地', '微调', 'fine-tun', '垂域', '行业模型'],
      },
      {
        id: 'rag',
        name: '检索增强与知识库',
        description: 'RAG、向量检索、知识库构建与召回质量。',
        keywords: ['rag', '检索增强', '知识库', '向量数据库', 'embedding', '召回'],
      },
      {
        id: 'ai-eng',
        name: 'AI 工程化与上线',
        description: '推理性能、Prompt 工程、成本与线上稳定性。',
        keywords: ['工程化', '上线', '部署', '推理', 'prompt', 'vibe coding', 'harness'],
      },
    ],
  },
  {
    id: 'fintech',
    name: '金融科技',
    description: '在高约束、强监管的环境里做系统：一笔都不能错。',
    icon: 'credit-card',
    color: 'rose',
    tags: ['金融', '风控', '量化'],
    aliases: ['金融', 'fintech', '支付', '银行科技', '金融系统'],
    searchHints: ['金融', '交易系统', '风控', '量化', '支付'],
    topics: [
      {
        id: 'fin-arch',
        name: '金融系统架构',
        description: '交易、支付、核心系统的架构演进与一致性设计。',
        keywords: ['金融', '银行', '支付', '交易系统', '核心系统', '金融架构'],
      },
      {
        id: 'quant',
        name: '量化交易',
        description: '策略、因子、回测与实盘之间的落差。',
        keywords: ['量化', '策略', '回测', '因子', '交易模型', '量化交易'],
      },
      {
        id: 'risk',
        name: '风控与合规',
        description: '风险识别、压力测试与监管合规。',
        keywords: ['风控', '风险管理', '合规', '压力测试', '黑天鹅'],
      },
    ],
  },
  {
    id: 'data-model',
    name: '数据建模',
    description: '把业务共识固化成口径清晰、可复用的数据与指标体系。',
    icon: 'bar-chart',
    color: 'emerald',
    tags: ['数据', '指标', '建模'],
    aliases: ['数据体系', '指标体系', '数仓', '数据治理', '数据仓库'],
    searchHints: ['数据', '指标', '数仓', '数据治理', '埋点'],
    topics: [
      {
        id: 'metrics',
        name: '指标体系',
        description: '北极星指标、指标体系搭建与指标口径治理。',
        keywords: ['指标体系', '北极星', 'kpi', '数据指标', '指标口径'],
      },
      {
        id: 'warehouse',
        name: '数仓与维度建模',
        description: '分层建模、维度设计、ETL 与数据链路。',
        keywords: ['数仓', '数据仓库', '维度建模', 'etl', '数据建模', '分层建模'],
      },
      {
        id: 'data-quality',
        name: '数据质量与治理',
        description: '数据质量、血缘、一致性校验。',
        keywords: ['数据质量', '数据治理', '数据血缘', '一致性校验'],
      },
    ],
  },
  {
    id: 'product-startup',
    name: '产品与创业',
    description: '从 0 到 1 做产品，以及从一个人到一支队伍的成长。',
    icon: 'rocket',
    color: 'amber',
    tags: ['产品', '创业', '从0到1'],
    aliases: ['创业', '产品经理', 'startup', '产品设计', '产品'],
    searchHints: ['产品', '创业', '需求', '从0到1', '用户增长'],
    topics: [
      {
        id: 'zero-to-one',
        name: '从 0 到 1',
        description: '验证需求、冷启动、做出第一版并活下来。',
        keywords: ['从0到1', '从 0 到 1', '0到1', '冷启动', 'mvp', '创业'],
      },
      {
        id: 'pm-growth',
        name: '产品经理成长',
        description: '需求分析、用户研究、以及产品经理的职业路径。',
        keywords: ['产品经理', '需求分析', '用户研究', 'prd', '产品设计', '转产品'],
      },
      {
        id: 'team-build',
        name: '团队与组织',
        description: '带团队、招人、绩效与组织设计。',
        keywords: ['带团队', '管理岗', '组织设计', '招聘', '绩效', '团队管理'],
      },
    ],
  },
  {
    id: 'indie-dev',
    name: '独立开发',
    description: '一个人做完产品、运营和收款，并且真的赚到钱。',
    icon: 'puzzle',
    color: 'teal',
    tags: ['独立开发', '副业', '变现'],
    aliases: ['独立开发者', '副业', 'solo', 'indie', '个人开发'],
    searchHints: ['独立开发', '副业', '变现', '小程序', '个人开发者'],
    topics: [
      {
        id: 'indie-income',
        name: '变现与收入',
        description: '定价、收款、被动收入与可持续性。',
        keywords: ['独立开发', '副业', '变现', '收入', '接单', '被动收入'],
      },
      {
        id: 'side-project',
        name: '项目与技术选型',
        description: '一个人能维护的技术栈与产品形态选择。',
        keywords: ['独立开发者', '技术选型', '小程序', '一个人开发', 'solo', 'side project'],
      },
      {
        id: 'solo-ops',
        name: '一个人的运营',
        description: '没有团队时怎么做推广、获客与增长。',
        keywords: ['独立运营', '推广', '获客', '增长', '上架', 'aso'],
      },
    ],
  },
  {
    id: 'research-eng',
    name: '科研与工程实践',
    description: '把论文变成能跑的系统，把实验变成可复现的结论。',
    icon: 'flask-conical',
    color: 'indigo',
    tags: ['科研', '工程', '机器学习'],
    aliases: ['科研', '论文', '机器学习工程', '算法工程', 'machine learning'],
    searchHints: ['机器学习', '大模型', '模型训练', '论文', '算法', '复现'],
    topics: [
      {
        id: 'paper-repro',
        name: '论文复现',
        description: '读论文、跑通代码、对齐实验结果的完整过程。',
        keywords: ['论文', '复现', 'paper', '实验复现', '代码复现'],
      },
      {
        id: 'ml-eng',
        name: '机器学习工程',
        description: '训练、调参、分布式与推理加速的工程侧。',
        keywords: ['机器学习', '模型训练', 'pytorch', 'tensorflow', '深度学习', '训练框架'],
      },
      {
        id: 'feature-eng',
        name: '特征工程',
        description: '从原始数据到有效特征的构造与验证。',
        keywords: ['特征工程', 'feature engineering', 'pandas', 'scikit', '特征构造'],
      },
    ],
  },
];

/** 按 id 取领域种子。找不到返回 undefined —— 调用方负责报 404 */
export function findFieldSeed(id: string): FieldSeed | undefined {
  return FIELD_SEEDS.find((f) => f.id === id);
}

/** 议题种子 → 它所属的领域 */
export function fieldOfTopic(topicId: string): FieldSeed | undefined {
  return FIELD_SEEDS.find((f) => f.topics.some((t) => t.id === topicId));
}
