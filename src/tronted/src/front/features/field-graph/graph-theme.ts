/**
 * 星图配色。
 *
 * 全部是**固定字面量**：议题颜色由议题在契约中的顺序决定，服务端无法影响任何色值。
 * 这样即使后端下发了奇怪的主题色，也不可能进入 SVG 的 `fill`。
 */
export const TOPIC_HEX = [
  "#056de8",
  "#0e9384",
  "#7c3aed",
  "#d97706",
  "#0891b2",
  "#e11d48",
  "#4f46e5",
  "#059669",
] as const;

/** 「其他」分组使用中性灰：它不是一个真实议题，不应该获得主题色。 */
export const OTHER_HEX = "#64748b";

export const GRAPH_INK = "#0f172a";
export const GRAPH_MUTED = "#64748b";
export const GRAPH_EDGE = "#cbd5e1";

export function topicColor(index: number): string {
  return TOPIC_HEX[((index % TOPIC_HEX.length) + TOPIC_HEX.length) % TOPIC_HEX.length];
}

/** 8 位十六进制（末两位为 alpha），用于大面积浅色底。 */
export function topicSoftColor(index: number): string {
  return `${topicColor(index)}1f`;
}

export function colorForTopicIndex(index: number | null): string {
  return index === null ? OTHER_HEX : topicColor(index);
}
