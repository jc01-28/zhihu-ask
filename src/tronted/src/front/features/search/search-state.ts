import { AGENT_STEP_ORDER, type AgentStep, type SearchAgentEvent } from "@/shared/contracts/agent";
import type {
  PersonSearchResult,
  RunRestoreResponse,
} from "@/shared/contracts/search";

export const MIN_QUERY_LENGTH = 4;
export const MAX_QUERY_LENGTH = 300;

export type SearchStatus = "idle" | "running" | "done" | "error";
export type StepStatus = "waiting" | "running" | "done";

export type StepState = Record<AgentStep, { status: StepStatus; message: string }>;

export type SearchErrorState = {
  code: string;
  message: string;
  retryable: boolean;
} | null;

export type PersonSearchState = {
  status: SearchStatus;
  query: string;
  steps: StepState;
  result: PersonSearchResult | null;
  error: SearchErrorState;
  /** 最近一次成功完成的查询词，用于结果标题与对比弹窗的默认值。 */
  completedQuery: string | null;
};

/** 六个阶段的标签与待机文案：只说做了什么，不暴露模型内部思维。 */
const STEP_LABELS: Record<AgentStep, { label: string; idleMessage: string }> = {
  loading_context: { label: "读取授权上下文", idleMessage: "只读取最小必要的授权数据" },
  understanding: { label: "理解问题", idleMessage: "提取处境、目标与关键约束" },
  retrieving: { label: "检索经历", idleMessage: "从多个搜索方向寻找公开内容" },
  verifying: { label: "核验证据", idleMessage: "区分亲历、分析与第三方案例" },
  ranking: { label: "生成卡片", idleMessage: "选择互补的相关人选" },
  saving: { label: "保存结果", idleMessage: "未开启持久化时只保留在当前会话" },
};

export const AGENT_STEP_META = AGENT_STEP_ORDER.map((name) => ({
  name,
  ...STEP_LABELS[name],
}));

export function createInitialSteps(): StepState {
  return Object.fromEntries(
    AGENT_STEP_META.map((step) => [
      step.name,
      { status: "waiting" as StepStatus, message: step.idleMessage },
    ]),
  ) as StepState;
}

export function createInitialSearchState(query: string): PersonSearchState {
  return {
    status: "idle",
    query,
    steps: createInitialSteps(),
    result: null,
    error: null,
    completedQuery: null,
  };
}

/**
 * 刷新恢复后的阶段快照：六个阶段都已跑完。
 *
 * `restoreRun` 只返还最终结果，不返还逐阶段事件，因此不能伪造服务端上报过的步骤文案；
 * 这里统一使用各阶段的待机说明，只把状态标为完成。
 */
export function createCompletedSteps(): StepState {
  return Object.fromEntries(
    AGENT_STEP_META.map((step) => [
      step.name,
      { status: "done" as StepStatus, message: step.idleMessage },
    ]),
  ) as StepState;
}

/**
 * 只接受契约内的六阶段事件；未知阶段或缺失 message 时保持原状态，
 * 保证界面永远不显示服务端没有真实上报过的步骤。
 */
export function applyStepEvent(current: StepState, event: SearchAgentEvent): StepState {
  if (event.type !== "step.started" && event.type !== "step.completed") return current;
  const step = current[event.step];
  if (!step) return current;
  return {
    ...current,
    [event.step]: {
      status: event.type === "step.started" ? "running" : "done",
      message: event.message || step.message,
    },
  };
}

export function validateQuery(raw: string): string | null {
  const query = raw.trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return "请至少输入 4 个字，让 Agent 能理解你想找什么样的人。";
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return "问题太长了，请控制在 300 字以内。";
  }
  return null;
}

/**
 * 恢复响应 → 页面使用的搜索结果。
 *
 * 逐字段一一对应，不做任何补默认值的「凑数」映射：`modelFallback`、
 * `contextSourceCounts`、`searchedQueries`、`background` 都由服务端随运行一起返回，
 * 因此刷新后的摘要与首次搜索看到的信息量完全相同。
 */
export function restoreResponseToResult(run: RunRestoreResponse): PersonSearchResult {
  return {
    cards: run.cards,
    modeUsed: run.mode,
    fallbackReason: run.fallbackReason,
    modelFallback: run.modelFallback,
    contextStatus: run.contextStatus,
    contextSourceCounts: run.contextSourceCounts,
    searchedQueries: run.searchedQueries,
    background: run.background,
    analyzedContentCount: run.analyzedCount,
    rejectedContentCount: run.rejectedCount,
    runId: run.runId,
    persistence: run.persistence,
  };
}

export type PersonSearchAction =
  | { type: "query.changed"; query: string }
  | { type: "query.rejected"; message: string }
  | { type: "sample.selected"; query: string }
  | { type: "run.started"; query: string }
  | { type: "step"; event: SearchAgentEvent }
  | { type: "run.completed"; result: PersonSearchResult }
  | { type: "run.restored"; result: PersonSearchResult; query: string }
  | { type: "run.failed"; error: NonNullable<SearchErrorState> }
  | { type: "run.aborted" }
  | { type: "reset" };

export function personSearchReducer(
  state: PersonSearchState,
  action: PersonSearchAction,
): PersonSearchState {
  switch (action.type) {
    case "query.changed":
      return { ...state, query: action.query };
    case "query.rejected":
      return {
        ...state,
        status: "error",
        error: { code: "INVALID_SEARCH_REQUEST", message: action.message, retryable: false },
      };
    case "sample.selected":
      // 选示例问题等于换一个待提交的问题：清空上一次结果，但不自动发起搜索。
      return {
        ...createInitialSearchState(action.query),
        completedQuery: null,
      };
    case "run.started":
      return {
        ...state,
        status: "running",
        query: action.query,
        error: null,
        result: null,
        steps: createInitialSteps(),
      };
    case "step":
      return { ...state, steps: applyStepEvent(state.steps, action.event) };
    case "run.completed":
      return {
        ...state,
        status: "done",
        result: action.result,
        error: null,
        completedQuery: state.query.trim(),
      };
    case "run.restored":
      // 刷新恢复：结果来自服务端的一次运行，步骤按「已完成」呈现，不重放动画。
      return {
        ...state,
        status: "done",
        query: action.query,
        steps: createCompletedSteps(),
        result: action.result,
        error: null,
        completedQuery: action.query,
      };
    case "run.failed":
      return { ...state, status: "error", error: action.error, result: null };
    case "run.aborted":
      // 取消不是失败：保留输入，不显示错误红条。
      return { ...state, status: "idle", error: null, steps: createInitialSteps() };
    case "reset":
      return createInitialSearchState(state.query);
    default:
      return state;
  }
}
