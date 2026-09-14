/**
 * 领域检索的输入规则。
 *
 * 这里刻意不做「防抖」以外的任何语义改写：领域搜索词**不会**被转成人物搜索词，
 * 也不会自动补全成人名。查询为空时页面必须回退到推荐领域，而不是发起一次空搜索。
 */

export const FIELD_QUERY_MAX_LENGTH = 40;

/** 把输入归一化：去掉首尾空白并压掉连续空白。 */
export function normalizeFieldQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** 只有非空查询才会调用 `searchFields`；返回 false 时页面展示推荐领域。 */
export function isSearchableFieldQuery(raw: string): boolean {
  const query = normalizeFieldQuery(raw);
  return query.length > 0 && query.length <= FIELD_QUERY_MAX_LENGTH;
}

export type FieldQueryPlan =
  | { action: "clear" }
  | { action: "search"; query: string }
  | { action: "invalid"; message: string };

/**
 * 决定一次提交应该做什么。
 *
 * 空查询 → 回到推荐领域（不是报错）；超长 → 明确提示而不是静默截断。
 */
export function planFieldQuery(raw: string): FieldQueryPlan {
  const query = normalizeFieldQuery(raw);
  if (query.length === 0) return { action: "clear" };
  if (query.length > FIELD_QUERY_MAX_LENGTH) {
    return {
      action: "invalid",
      message: `检索词不能超过 ${FIELD_QUERY_MAX_LENGTH} 个字。`,
    };
  }
  return { action: "search", query };
}

/** 领域计数文案：把「议题数 / 可交流人数」写成一句人话，避免裸数字。 */
export function describeFieldCounts(topicCount: number, memberCount: number): string {
  return `${topicCount} 个议题 · ${memberCount} 位可交流的人`;
}
