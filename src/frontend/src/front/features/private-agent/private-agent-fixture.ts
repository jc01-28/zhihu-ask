/**
 * 私有知识库 Agent 的**本地演示夹具**。
 *
 * 明确边界（与 `docs/BACKEND_BOUNDARY.md` 的接口边界一致）：
 *  - 本文件不含任何真实知识库、向量库、RAG 或上传逻辑；
 *  - 不对任何真实用户做「上传过资料」的断言——所有内容都是虚构演示文本；
 *  - 数据完全确定（无随机、无时间），同一人物在每次渲染中结果一致。
 *
 * 未在表中出现的人物一律返回 `unconfigured`：这是默认值，也是最诚实的默认值，
 * 因为现实里绝大多数答主还没有配置私有知识库。
 */

export type PrivateAgentFixture = {
  /** Agent 名称，由答主自己命名。 */
  name: string;
  /** 知识库主题（只描述范围，不包含任何资料内容）。 */
  topics: string[];
  /** 可回答范围：超出范围的问题应当被明确挡回。 */
  scope: string[];
  /** 演示用示例问题，点击只填充输入框。 */
  sampleQuestions: string[];
  /** 出范围时的兜底说明。 */
  outOfScopeHint: string;
};

const FIXTURES: Record<string, PrivateAgentFixture> = {
  "lin-zhixing": {
    name: "林知行的转型笔记",
    topics: ["大厂转创业", "首次带团队", "期权与薪酬结构"],
    scope: ["创业公司入职前的尽调问题", "带团队的早期管理动作", "期权条款的阅读理解"],
    // 刻意与「答主建议问题」措辞不同：那组问题在聊天输入区已经出现过，
    // 两处同名会让键盘用户和读屏用户无法区分是两个不同的入口。
    sampleQuestions: [
      "转型前你最想搞清楚的一个数字是什么？",
      "带团队的第一个季度，你做错了什么？",
    ],
    outOfScopeHint: "这个 Agent 只覆盖转型与团队管理，具体公司的经营数据不在范围内。",
  },
  "zhou-yu": {
    name: "周屿的商业化问答",
    topics: ["AI 产品商业化", "降薪换期权的账怎么算"],
    scope: ["商业化阶段判断", "期权与薪酬的横向比较"],
    sampleQuestions: ["你们当时的付费转化具体是怎么算的？"],
    outOfScopeHint: "这个 Agent 只覆盖商业化与回报比较，招聘与薪资谈判不在范围内。",
  },
  "cheng-che": {
    name: "程澈的复盘库",
    topics: ["创业失败复盘", "团队重组", "职业回撤"],
    scope: ["项目收缩期的处置", "失败经验如何被外部理解"],
    sampleQuestions: ["项目收缩时，你先砍掉了哪一块业务？"],
    outOfScopeHint: "这个 Agent 只覆盖复盘与职业回退，不提供投资建议。",
  },
  "p-shen-yiran": {
    name: "沈亦然的 Agent 编排手记",
    topics: ["工具调用与编排", "失败重试", "上下文管理"],
    scope: ["Agent 工具设计", "长任务的状态管理"],
    sampleQuestions: ["工具调用连续失败三次，你当时的处理顺序是什么？"],
    outOfScopeHint: "这个 Agent 只覆盖 Agent 工程实现，不涉及业务运营问题。",
  },
};

export function findPrivateAgentFixture(creatorId: string): PrivateAgentFixture | null {
  return FIXTURES[creatorId] ?? null;
}

/** 演示模式下的 Agent 命名规则，保证未配置时也有一个可读的占位标题。 */
export function privateAgentName(creatorName: string): string {
  return `${creatorName}的私有知识库`;
}
