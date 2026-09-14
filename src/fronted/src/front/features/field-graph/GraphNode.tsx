import { GRAPH_EDGE, GRAPH_INK, GRAPH_MUTED } from "@/front/features/field-graph/graph-theme";
import type { FieldPerson } from "@/shared/contracts/field";

/** 人物头像节点半径（SVG 逻辑坐标）。 */
export const PERSON_RADIUS = 22;
export const TOPIC_WIDTH = 172;
export const TOPIC_HEIGHT = 48;
export const CENTER_RADIUS = 56;

/**
 * 人物节点。
 *
 * 可聚焦（`tabIndex` + `role="button"`）并在 Enter/Space 下触发同一个回调，
 * 因此键盘用户与鼠标点击走完全相同的路径。
 */
export function PersonNode({
  x,
  y,
  person,
  color,
  dimmed,
  delayMs,
  onOpen,
}: {
  x: number;
  y: number;
  person: FieldPerson;
  color: string;
  dimmed: boolean;
  delayMs: number;
  onOpen: (person: FieldPerson) => void;
}) {
  return (
    <g
      className="graph-node-enter cursor-pointer outline-none"
      style={{ animationDelay: `${delayMs}ms` }}
      tabIndex={0}
      role="button"
      aria-label={`查看人物 ${person.name}，${person.headline}`}
      onClick={() => onOpen(person)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(person);
        }
      }}
    >
      <circle
        cx={x}
        cy={y}
        r={PERSON_RADIUS + 9}
        fill={color}
        opacity={dimmed ? 0.04 : 0.2}
        filter="url(#graph-glow)"
        aria-hidden="true"
      />
      <circle
        cx={x}
        cy={y}
        r={PERSON_RADIUS}
        fill={color}
        opacity={dimmed ? 0.28 : 1}
        stroke="#bfdbfe"
        strokeWidth={2.5}
      />
      <text
        x={x}
        y={y + 6}
        textAnchor="middle"
        fontSize={16}
        fontWeight={700}
        fill="#ffffff"
        opacity={dimmed ? 0.5 : 1}
        aria-hidden="true"
      >
        {person.initial}
      </text>
      <text
        x={x}
        y={y + PERSON_RADIUS + 16}
        textAnchor="middle"
        fontSize={13}
        fontWeight={600}
        fill={GRAPH_INK}
        opacity={dimmed ? 0.4 : 1}
        aria-hidden="true"
      >
        {person.name}
      </text>
      <rect
        x={x - 26}
        y={y + PERSON_RADIUS + 20}
        width={52}
        height={18}
        rx={9}
        fill="#0f1b31"
        stroke="#334155"
        strokeWidth={1}
        opacity={dimmed ? 0.35 : 0.9}
        aria-hidden="true"
      />
      <text
        x={x}
        y={y + PERSON_RADIUS + 33}
        textAnchor="middle"
        fontSize={11}
        fill={GRAPH_MUTED}
        opacity={dimmed ? 0.4 : 1}
        aria-hidden="true"
      >
        {person.relevance}/100
      </text>
    </g>
  );
}

/** 议题节点：点击即筛选，再次点击取消筛选。 */
export function TopicNode({
  x,
  y,
  name,
  color,
  active,
  dimmed,
  delayMs,
  onSelect,
}: {
  x: number;
  y: number;
  name: string;
  color: string;
  active: boolean;
  dimmed: boolean;
  delayMs: number;
  onSelect: () => void;
}) {
  return (
    <g
      className="graph-node-enter cursor-pointer outline-none"
      style={{ animationDelay: `${delayMs}ms` }}
      tabIndex={0}
      role="button"
      aria-pressed={active}
      aria-label={`筛选议题 ${name}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <rect
        x={x - TOPIC_WIDTH / 2}
        y={y - TOPIC_HEIGHT / 2}
        width={TOPIC_WIDTH}
        height={TOPIC_HEIGHT}
        rx={16}
        fill={active ? color : "#0f1b31"}
        stroke={color}
        strokeWidth={active ? 1 : 1.5}
        opacity={dimmed ? 0.4 : 1}
        filter={active ? "url(#graph-glow)" : undefined}
      />
      <text
        x={x}
        y={y + 6}
        textAnchor="middle"
        fontSize={14}
        fontWeight={700}
        fill={active ? "#ffffff" : GRAPH_INK}
        opacity={dimmed ? 0.5 : 1}
        aria-hidden="true"
      >
        {name}
      </text>
    </g>
  );
}

/** 领域中心节点。 */
export function CenterNode({
  x,
  y,
  name,
  caption,
  delayMs,
}: {
  x: number;
  y: number;
  name: string;
  caption: string;
  delayMs: number;
}) {
  return (
    <g className="graph-node-enter" style={{ animationDelay: `${delayMs}ms` }} aria-hidden="true">
      <circle
        cx={x}
        cy={y}
        r={CENTER_RADIUS + 16}
        fill="#2563eb"
        opacity={0.22}
        filter="url(#graph-glow)"
      />
      <circle
        cx={x}
        cy={y}
        r={CENTER_RADIUS + 7}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={1.5}
        strokeDasharray="3 6"
        opacity={0.7}
      />
      <circle cx={x} cy={y} r={CENTER_RADIUS} fill="url(#graph-center-gradient)" />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        fontSize={17}
        fontWeight={800}
        fill="#ffffff"
      >
        {name}
      </text>
      <text x={x} y={y + 26} textAnchor="middle" fontSize={11} fill="#dbeafe">
        {caption}
      </text>
    </g>
  );
}

/** 「其他」分组的底部分隔标注，说明这些人物尚未归入议题。 */
export function OtherGroupLabel({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true">
      <line
        x1={x}
        y1={y - 46}
        x2={x + 880}
        y2={y - 46}
        stroke={GRAPH_EDGE}
        strokeDasharray="6 6"
      />
      <text x={x} y={y - 52} fontSize={12} fill={GRAPH_MUTED} fontWeight={600}>
        其他（尚未归入具体议题）
      </text>
    </g>
  );
}
