import { useEffect, useState } from "react";

/**
 * 动画工具。
 *
 * 本工程不引入 Framer Motion 一类的动画库：所有过渡都由 `styles/globals.css`
 * 的 keyframes 完成，`prefers-reduced-motion` 在 CSS 层把时长压到 0.01ms
 * （见该文件的媒体查询）。但 CSS 只能改**时长**，改不了 keyframes 上挂的
 * `animation-delay`——星图为了做出「中心 → 议题 → 人物」的层次感，给每个节点
 * 加了错峰延迟。若只压时长不压延迟，reduced-motion 用户反而会看到节点先隐形
 * 再逐个闪现，比不做动画更糟。因此延迟必须由 JS 归零。
 *
 * 二进制的 `data-reduced-motion` 属性同时写回 `<html>`，好处有两点：
 *  1. 断点/动画之外的样式也能复用同一个开关，不必到处写媒体查询；
 *  2. 测试与快照可以直接断言这个属性，而不是去模拟 matchMedia 的返回值。
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 单个节点的错峰间隔与总上限，避免长列表出现「半分钟才完全显形」。 */
export const MOTION_STAGGER_MS = 55;
export const MOTION_MAX_DELAY_MS = 440;

/** 无 matchMedia（SSR / 老旧环境）时按「不减弱」处理，与 CSS 默认行为一致。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * 订阅用户的动效偏好。用户可以在系统设置里随时改，因此必须监听变化，
 * 而不是只在挂载时读一次。
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
}

/** 把偏好写到 `<html data-reduced-motion>`，供 CSS 与测试使用。 */
export function useReducedMotionAttribute(): boolean {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.reducedMotion = reduced ? "true" : "false";
  }, [reduced]);

  return reduced;
}

/**
 * 第 `index` 个节点的入场延迟。
 *
 * `reduced` 为真时一律返回 0：顺序仍然是「中心 → 议题 → 人物」的先后关系，
 * 只是不再有等待时间。`max` 是对同一批节点的封顶，避免人物多的领域出现
 * 「半分钟才完全显形」。
 */
export function motionDelay(
  index: number,
  reduced: boolean,
  options: { base?: number; stagger?: number; max?: number } = {},
): number {
  if (reduced) return 0;
  const { base = 0, stagger = MOTION_STAGGER_MS, max = MOTION_MAX_DELAY_MS } = options;
  return base + Math.min(Math.max(index, 0) * stagger, max);
}

/** 需要淡入的元素类名；reduced-motion 下返回空串，不走动画路径。 */
export function enterClass(reduced: boolean, name = "card-enter"): string {
  return reduced ? "" : name;
}
