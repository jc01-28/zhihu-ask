import { creatorCardSchema, type CreatorCardData } from "@/shared/contracts/creator";
import type { ConsultationPackage } from "@/shared/contracts/consultation";
import type { PublicUser } from "@/shared/contracts/auth";

/**
 * 稳定的演示数据：所有 ID、分数与文本都固定，不使用 Math.random()，
 * 保证 Mock、测试与截图可以精确复现。
 *
 * 这里的每一个字都明确标注为虚构演示数据，不对应任何真实知乎用户。
 */

export const MAIN_QUERY =
  "我在大厂做了 7 年产品，现在拿到一家 50 人 AI 创业公司的产品负责人 Offer，要降薪 20% 换期权，而且是第一次带团队。我想找真正经历过类似转型的人聊聊。";

export const SAMPLE_QUESTIONS = [
  "大厂产品转 AI 创业公司，值得找谁聊？",
  "工作五年从后端开发转算法工程师",
  "第一次做技术管理，应该请教谁？",
] as const;

export const MOCK_USER: PublicUser = {
  id: "public-user-demo",
  displayName: "演示用户",
  avatarUrl: null,
};

export const DEMO_CREATORS: CreatorCardData[] = [
  {
    id: "lin-zhixing",
    name: "林知行",
    headline: "前大厂产品负责人 · AI 创业团队联合创始人",
    initial: "林",
    avatarTone: "from-slate-950 to-slate-700",
    profileUrl: "https://www.zhihu.com/people/zhihu-wenren-demo-lin-zhixing",
    avatarUrl: null,
    identityConfidence: "low",
    role: "经历最接近",
    relevanceLevel: "高度相关",
    score: 92,
    matchedDimensions: ["大厂转创业", "首次带团队", "AI 产品", "期权权衡"],
    reason:
      "公开内容覆盖从成熟平台加入早期 AI 团队、降薪换期权和第一次负责完整团队三项核心处境。",
    evidence: [
      {
        id: "lin-1",
        title: "离开万人大厂后，我如何适应五十人的创业团队",
        excerpt:
          "真正的变化不是办公环境，而是每个产品判断都直接影响现金流。加入前，我重点核对了创始团队、跑道和期权兑现条件。",
        kind: "亲身经历",
        publishedAt: "2026-05",
        source: "fixture",
        url: null,
      },
      {
        id: "lin-2",
        title: "第一次带十人团队，我低估了什么",
        excerpt:
          "从自己把事情做好，到让团队持续做对事情，中间隔着目标拆解、反馈机制和招聘判断三道门槛。",
        kind: "亲身经历",
        publishedAt: "2026-07",
        source: "fixture",
        url: null,
      },
    ],
    suitableQuestions: [
      "你加入创业公司前重点验证了哪些风险？",
      "第一次带团队时，前三个月应该优先建立什么？",
      "期权条款里最容易被忽略的部分是什么？",
    ],
    limitations: ["人物与内容为 Fixture 演示数据，不对应真实知乎用户。"],
  },
  {
    id: "zhou-yu",
    name: "周屿",
    headline: "AI 产品顾问 · 早期科技公司前产品总监",
    initial: "周",
    avatarTone: "from-blue-700 to-cyan-500",
    profileUrl: "https://www.zhihu.com/people/zhihu-wenren-demo-zhou-yu",
    avatarUrl: null,
    identityConfidence: "low",
    role: "关键维度",
    relevanceLevel: "高度相关",
    score: 86,
    matchedDimensions: ["降薪换期权", "商业化验证", "AI 产品"],
    reason:
      "内容对降薪与期权的比较、AI 产品商业化阶段和早期公司尽调提供了较完整的方法与案例。",
    evidence: [
      {
        id: "zhou-1",
        title: "别只看期权数量：加入创业公司前要算的四笔账",
        excerpt:
          "期权比例必须和公司估值、稀释、归属期以及离职后的行权窗口一起看，单独比较股数没有意义。",
        kind: "专业分析",
        publishedAt: "2026-06",
        source: "fixture",
        url: null,
      },
      {
        id: "zhou-2",
        title: "AI 产品从 Demo 到收入，中间差的不只是模型",
        excerpt:
          "判断团队是否进入有效商业化阶段，应看重复购买、部署成本和客户决策链，而不是发布会上的模型指标。",
        kind: "亲身经历",
        publishedAt: "2026-08",
        source: "fixture",
        url: null,
      },
    ],
    suitableQuestions: [
      "如何把降薪金额和期权的潜在价值放在同一张表里？",
      "怎样判断一家 AI 创业公司是否已经找到真实需求？",
      "加入前应该向创始人追问哪些经营数据？",
    ],
    limitations: ["对首次管理的直接证据较少，更适合询问商业和回报问题。"],
  },
  {
    id: "cheng-che",
    name: "程澈",
    headline: "连续创业者 · 曾经历项目收缩与团队重组",
    initial: "程",
    avatarTone: "from-violet-700 to-fuchsia-500",
    profileUrl: null,
    avatarUrl: null,
    identityConfidence: "low",
    role: "补充视角",
    relevanceLevel: "部分相关",
    score: 74,
    matchedDimensions: ["创业失败复盘", "团队重组", "职业回撤"],
    reason:
      "与前两位的正向经验不同，其公开复盘重点讨论项目收缩、团队重组和重新求职，可帮助补足下行情景。",
    evidence: [
      {
        id: "cheng-1",
        title: "创业项目停止增长后，我重新理解了所谓的职业风险",
        excerpt:
          "最难处理的不是项目停止，而是过去两年的经验很难被外部快速理解。加入前应该想清楚失败后的能力如何被证明。",
        kind: "反面案例",
        publishedAt: "2025-12",
        source: "fixture",
        url: null,
      },
    ],
    suitableQuestions: [
      "如果项目失败，哪些能力仍然能被下一份工作认可？",
      "你当时忽略了哪些公司经营信号？",
      "怎样提前准备最坏情况下的职业退路？",
    ],
    limitations: ["与产品负责人岗位并不完全一致，主要价值是提供风险视角。"],
  },
];

/** Fixture 必须始终满足人物卡契约，避免演示数据与真实数据出现结构漂移。 */
export const FIXTURE_CREATORS: CreatorCardData[] = DEMO_CREATORS.map((creator) =>
  creatorCardSchema.parse(creator),
);

/** 金额单位为人民币分，与后端契约保持一致。 */
export const CONSULTATION_PACKAGES: ConsultationPackage[] = [
  {
    id: "text",
    name: "文字咨询",
    description: "一次结构化文字回复",
    amount: 4900,
    currency: "CNY",
  },
  {
    id: "voice-30",
    name: "30 分钟语音",
    description: "聚焦一个具体决策",
    amount: 9900,
    currency: "CNY",
  },
  {
    id: "voice-60",
    name: "60 分钟深聊",
    description: "梳理复杂背景与行动方案",
    amount: 19900,
    currency: "CNY",
  },
];

export const DEFAULT_PACKAGE_ID = "voice-30" as const;

/**
 * 按 ID 精确查找演示人物。
 *
 * 找不到时返回 null，**不做兜底**：早期实现会在未命中时回退到第一个人物，
 * 结果把 A 的资料当成 B 的展示，在引入多个入口（领域目录 / 问题找人）之后
 * 这种静默替换会直接造成数据串台。
 */
export function findCreatorCard(id: string): CreatorCardData | null {
  return FIXTURE_CREATORS.find((creator) => creator.id === id) ?? null;
}

export function isFixtureCreator(id: string): boolean {
  return FIXTURE_CREATORS.some((creator) => creator.id === id);
}
