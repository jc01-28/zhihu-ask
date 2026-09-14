import {
  findPrivateAgentFixture,
  privateAgentName,
  type PrivateAgentFixture,
} from "@/front/features/private-agent/private-agent-fixture";

/**
 * 私有知识库 Agent 的三种配置状态。
 *
 * 这里只做**展示状态**的推导，不引入任何真实能力：
 *  - `configured`   已配置：主题与可回答范围都齐全；
 *  - `partial`      部分配置：只搭起了架子，范围还不完整；
 *  - `unconfigured` 尚未配置：默认状态，界面只说明「会变成什么样」。
 */
export const PRIVATE_AGENT_STATUSES = ["configured", "partial", "unconfigured"] as const;

export type PrivateAgentStatus = (typeof PRIVATE_AGENT_STATUSES)[number];

export const PRIVATE_AGENT_STATUS_LABELS: Record<PrivateAgentStatus, string> = {
  configured: "已配置",
  partial: "部分配置",
  unconfigured: "尚未配置",
};

export type PrivateAgentView = {
  status: PrivateAgentStatus;
  statusLabel: string;
  name: string;
  /** 知识库主题；未配置时为空数组。 */
  topics: string[];
  /** 可回答范围；未配置时为空数组。 */
  scope: string[];
  /** 示例问题永远可用：未配置时它就是「将来可以问什么」的示意。 */
  sampleQuestions: string[];
  outOfScopeHint: string;
  /** 需要给用户看的、随状态变化的边界说明。 */
  boundary: string;
};

/**
 * 由夹具推导展示状态。
 *
 * `partial` 的判定刻意与夹具内容挂钩（主题少于 3 个，或范围少于 2 条），
 * 而不是写死 ID —— 这样调整夹具时状态会自己跟着变，不会出现「夹具已改、状态没改」
 * 的漂移。
 */
export function privateAgentStatus(fixture: PrivateAgentFixture | null): PrivateAgentStatus {
  if (!fixture) return "unconfigured";
  if (fixture.topics.length < 3 || fixture.scope.length < 2) return "partial";
  return "configured";
}

export function buildPrivateAgentView(
  creatorId: string,
  creatorName: string,
): PrivateAgentView {
  const fixture = findPrivateAgentFixture(creatorId);
  const status = privateAgentStatus(fixture);

  if (!fixture) {
    return {
      status,
      statusLabel: PRIVATE_AGENT_STATUS_LABELS[status],
      name: privateAgentName(creatorName),
      topics: [],
      scope: [],
      // 不在这里复用「答主建议问题」：那组问题已经渲染在聊天输入区，
      // 同一个问句出现两个可点击入口会让「点哪个」变得不可判断。
      sampleQuestions: UNCONFIGURED_SAMPLE_QUESTIONS,
      outOfScopeHint: "答主还没有划定可回答范围，超出公开内容的问题应当由答主本人判断。",
      boundary:
        "这位答主还没有配置私有知识库。这里的示例问题只用于示意将来的交互方式，不会发送任何请求。",
    };
  }

  return {
    status,
    statusLabel: PRIVATE_AGENT_STATUS_LABELS[status],
    name: fixture.name,
    topics: fixture.topics,
    scope: fixture.scope,
    sampleQuestions: fixture.sampleQuestions,
    outOfScopeHint: fixture.outOfScopeHint,
    boundary:
      status === "configured"
        ? "已配置范围之外的问题会被明确挡回，不会用公开内容硬答。"
        : "知识库尚未配置完整，只有部分主题可用；范围之外的问题会被明确挡回。",
  };
}

/**
 * 未配置时的示例问题。
 *
 * 它们只说明「知识库搭起来之后可以怎么问」，与答主的公开建议问题刻意不同措辞，
 * 避免同一个问句在页面上出现两个可点击入口。
 */
export const UNCONFIGURED_SAMPLE_QUESTIONS = [
  "你在这个方向上最常被误解的一点是什么？",
  "如果重来一次，你会先做哪一件事？",
];

/**
 * 全站统一的演示声明。
 *
 * 无论哪种状态都必须显示这句话：本区只是前端展示，没有上传、没有建库、
 * 没有接入 RAG，示例问题也不会发出任何网络请求。
 */
export const PRIVATE_AGENT_DEMO_NOTICE =
  "演示功能：本区不接入真实私有知识库，不上传文件、不保存私有资料，示例问题只填充输入框。";
