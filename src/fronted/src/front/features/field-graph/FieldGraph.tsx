import { useCallback, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

import { Button } from "@/front/components/ui/button";
import {
  CenterNode,
  OtherGroupLabel,
  PersonNode,
  TopicNode,
} from "@/front/features/field-graph/GraphNode";
import {
  GRAPH_VIEWBOX,
  layoutGraph,
  toViewBox,
  type GraphLayout,
} from "@/front/features/field-graph/graph-layout";
import {
  GRAPH_EDGE,
  colorForTopicIndex,
  topicSoftColor,
} from "@/front/features/field-graph/graph-theme";
import type { FieldGraphResponse, FieldPerson } from "@/shared/contracts/field";
import { motionDelay, useReducedMotion } from "@/front/shared/motion";

const MIN_SCALE = 0.6;
const MAX_SCALE = 2;
const SCALE_STEP = 0.2;

/** 拖动阈值（px）：超过它才算拖拽，而不是把「点一下节点」误判成拖拽。 */
const DRAG_THRESHOLD = 4;

/** 议题与人物两批节点的入场延迟区间：中心之后依次登场。 */
const TOPIC_DELAY = { base: 80, stagger: 30, max: 380 } as const;
const PERSON_DELAY = { base: 140, stagger: 30, max: 620 } as const;

function curvedPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  bend = 0.12,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const controlX = (from.x + to.x) / 2 - dy * bend;
  const controlY = (from.y + to.y) / 2 + dx * bend;
  return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
}

/**
 * 领域星图。
 *
 * 实现要点：
 *  - 布局由 `layoutGraph`（纯函数）算好，组件只负责画；因此同一份数据永远得到同一张图；
 *  - 用 SVG + 属性 transform 做缩放与拖拽，不引入任何图表或力导向库；
 *  - 窄屏（< 768px）不强行显示完整星图，改为按议题分组的头像卡片，
 *    用 CSS 断点切换而不是 JS 媒体查询，避免首屏渲染抖动；
 *  - 人物节点可聚焦、可回车打开，键盘与鼠标走同一个回调。
 */
export function FieldGraph({
  graph,
  selectedTopicId,
  onSelectTopic,
  onOpenPerson,
}: {
  graph: FieldGraphResponse;
  selectedTopicId: string | null;
  onSelectTopic: (topicId: string | null) => void;
  onOpenPerson: (person: FieldPerson) => void;
}) {
  const layout = useMemo<GraphLayout>(() => layoutGraph(graph), [graph]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    /** 是否已经因为真实位移而捕获指针。 */
    captured: boolean;
  } | null>(null);
  // 只订阅一次：节点数量再多也不会重复注册 matchMedia 监听。
  const reducedMotion = useReducedMotion();

  const topicIndex = useMemo(
    () => new Map(layout.topics.map((topic, index) => [topic.id, index])),
    [layout.topics],
  );

  const activeIndex = selectedTopicId ? topicIndex.get(selectedTopicId) ?? null : null;

  const clampScale = useCallback((value: number) => {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))));
  }, []);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  /** 只高亮与当前筛选相关的人物；不隐藏，避免用户以为人「丢了」。 */
  const isDimmed = useCallback(
    (topicIds: string[]) => {
      if (!selectedTopicId) return false;
      return !topicIds.includes(selectedTopicId);
    },
    [selectedTopicId],
  );

  const center = toViewBox(layout.center);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {selectedTopicId
            ? `已筛选议题，其余节点变淡；点击同一议题取消筛选。`
            : "点击议题筛选，点击头像打开人物名片；可缩放与拖拽。"}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="缩小星图"
            onClick={() => setScale((value) => clampScale(value - SCALE_STEP))}
          >
            <Minus />
          </Button>
          <span className="w-12 text-center text-xs text-muted-foreground" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="放大星图"
            onClick={() => setScale((value) => clampScale(value + SCALE_STEP))}
          >
            <Plus />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="复位星图" onClick={reset}>
            <Maximize2 />
          </Button>
        </div>
      </div>

      {/* 桌面：完整星图 */}
      <div
        data-testid="field-graph-canvas"
        data-graph-theme="constellation"
        className="field-graph-shell hidden overflow-hidden rounded-2xl border border-slate-800 md:block"
      >
        <svg
          viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
          role="group"
          aria-label={`${graph.field.name} 领域星图`}
          className="field-graph-svg h-[560px] w-full touch-none select-none"
          onPointerDown={(event) => {
            dragRef.current = {
              x: event.clientX,
              y: event.clientY,
              ox: offset.x,
              oy: offset.y,
              captured: false,
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;

            if (!drag.captured) {
              // 必须先判断「这是不是一次拖拽」再决定捕获指针。
              //
              // 在 `pointerdown` 里就调用 `setPointerCapture` 会让浏览器把随后合成的
              // `click` 重定向到被捕获的 `<svg>` 上，于是 `<g>` 上的 onClick 永远不触发——
              // 表现就是「鼠标点人物头像毫无反应」。jsdom 里 `userEvent.click` 直接派发
              // click 事件，不会经过指针捕获，所以单元测试发现不了这个问题。
              const moved = Math.hypot(
                event.clientX - drag.x,
                event.clientY - drag.y,
              );
              if (moved < DRAG_THRESHOLD) return;
              drag.captured = true;
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }

            setOffset({
              x: drag.ox + (event.clientX - drag.x) * (GRAPH_VIEWBOX.width / 1000),
              y: drag.oy + (event.clientY - drag.y) * (GRAPH_VIEWBOX.height / 640),
            });
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerLeave={() => {
            dragRef.current = null;
          }}
        >
          <defs>
            <radialGradient id="graph-surface-glow" cx="50%" cy="45%" r="65%">
              <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.28" />
              <stop offset="48%" stopColor="#172554" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#020617" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="graph-center-gradient" cx="35%" cy="25%" r="85%">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="55%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#1e3a8a" />
            </radialGradient>
            <filter id="graph-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <pattern id="graph-stars" width="84" height="84" patternUnits="userSpaceOnUse">
              <circle cx="8" cy="18" r="1" fill="#bfdbfe" opacity="0.22" />
              <circle cx="58" cy="46" r="1.2" fill="#93c5fd" opacity="0.16" />
              <circle cx="32" cy="72" r="0.8" fill="#e0f2fe" opacity="0.18" />
            </pattern>
          </defs>
          <rect width={GRAPH_VIEWBOX.width} height={GRAPH_VIEWBOX.height} fill="#020617" />
          <rect
            width={GRAPH_VIEWBOX.width}
            height={GRAPH_VIEWBOX.height}
            fill="url(#graph-surface-glow)"
          />
          <rect
            width={GRAPH_VIEWBOX.width}
            height={GRAPH_VIEWBOX.height}
            fill="url(#graph-stars)"
          />
          <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
            {/* 中心 → 议题 */}
            {layout.topics.map((topic) => {
              const point = toViewBox(topic);
              const index = topicIndex.get(topic.id) ?? 0;
              return (
                <path
                  key={`edge-center-${topic.id}`}
                  className="graph-edge-enter"
                  d={curvedPath(center, point, 0.08)}
                  fill="none"
                  stroke={activeIndex === null || activeIndex === index ? GRAPH_EDGE : "#1e293b"}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              );
            })}

            {/* 议题 → 人物 */}
            {layout.groups.flatMap((group) => {
              const anchor =
                group.topicId === null
                  ? null
                  : toViewBox(
                      layout.topics.find((topic) => topic.id === group.topicId) ?? layout.center,
                    );
              if (!anchor) return [];
              return group.people.map((node) => {
                const point = toViewBox(node);
                return (
                  <path
                    key={`edge-${group.id}-${node.person.id}`}
                    className="graph-edge-enter"
                    d={curvedPath(anchor, point, 0.1)}
                    fill="none"
                    stroke={topicSoftColor(topicIndex.get(group.topicId ?? "") ?? 0)}
                    strokeWidth={1.7}
                    strokeLinecap="round"
                  />
                );
              });
            })}

            {layout.topics.map((topic, index) => {
              const point = toViewBox(topic);
              return (
                <TopicNode
                  key={topic.id}
                  x={point.x}
                  y={point.y}
                  name={topic.name}
                  color={colorForTopicIndex(index)}
                  active={selectedTopicId === topic.id}
                  dimmed={activeIndex !== null && activeIndex !== index}
                  delayMs={motionDelay(index, reducedMotion, TOPIC_DELAY)}
                  onSelect={() =>
                    onSelectTopic(selectedTopicId === topic.id ? null : topic.id)
                  }
                />
              );
            })}

            {layout.groups.some((group) => group.id === layout.otherGroupId) && (
              <OtherGroupLabel x={60} y={GRAPH_VIEWBOX.height - 20} />
            )}

            {layout.people.map((node, index) => {
              const point = toViewBox(node);
              return (
                <PersonNode
                  key={node.person.id}
                  x={point.x}
                  y={point.y}
                  person={node.person}
                  color={colorForTopicIndex(
                    node.topicId === null ? null : topicIndex.get(node.topicId) ?? 0,
                  )}
                  dimmed={isDimmed(node.topicIds)}
                  delayMs={motionDelay(index, reducedMotion, PERSON_DELAY)}
                  onOpen={onOpenPerson}
                />
              );
            })}

            <CenterNode
              x={center.x}
              y={center.y}
              name={graph.field.name}
              caption={`${graph.field.topicCount} 议题 · ${graph.field.memberCount} 人`}
              delayMs={0}
            />
          </g>
        </svg>
      </div>

      {/* 移动端：按议题分组的头像卡片，不做「缩小版的星图」 */}
      <div data-testid="field-graph-cards" className="space-y-4 md:hidden">
        {layout.groups.map((group) => (
          <section
            key={group.id}
            className="rounded-2xl border border-border bg-white p-4"
            aria-label={`${group.name} 分组`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">{group.name}</h3>
              <span className="text-xs text-muted-foreground">{group.people.length} 人</span>
            </div>
            <ul className="mt-3 space-y-2">
              {group.people.map((node) => (
                <li key={node.person.id}>
                  <button
                    type="button"
                    onClick={() => onOpenPerson(node.person)}
                    // 与桌面 SVG 节点使用同一个可访问名：同一个动作不该因为断点而改名。
                    aria-label={`查看人物 ${node.person.name}，${node.person.headline}`}
                    className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                      style={{
                        backgroundColor: colorForTopicIndex(
                          node.topicId === null ? null : topicIndex.get(node.topicId) ?? 0,
                        ),
                      }}
                    >
                      {node.person.initial}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {node.person.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {node.person.headline}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {node.person.relevance}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
