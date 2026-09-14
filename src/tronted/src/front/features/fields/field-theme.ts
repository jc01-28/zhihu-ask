import {
  Bot,
  Database,
  Landmark,
  Layers,
  Rocket,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { FieldColorToken } from "@/shared/contracts/field";

/**
 * 领域主题色的**固定映射表**。
 *
 * 契约层已经把 `color` 限制成白名单 token，这里再把它翻成具体的 Tailwind 类。
 * 服务端永远无法让一个任意字符串进入 `className`——这是这套设计的目的。
 * 注意：类名必须是字面量，Tailwind 才能在构建期扫描到它们。
 */
type ColorClasses = {
  /** 卡片左上角图标底色 */
  chip: string;
  /** 卡片顶部细色条 */
  bar: string;
  /** 悬停边框 */
  hoverBorder: string;
  /** 标签底色 */
  tag: string;
};

const COLOR_CLASSES: Record<FieldColorToken, ColorClasses> = {
  blue: {
    chip: "bg-blue-50 text-blue-700",
    bar: "bg-blue-500",
    hoverBorder: "hover:border-blue-300",
    tag: "border-blue-100 bg-blue-50/70 text-blue-800",
  },
  cyan: {
    chip: "bg-cyan-50 text-cyan-700",
    bar: "bg-cyan-500",
    hoverBorder: "hover:border-cyan-300",
    tag: "border-cyan-100 bg-cyan-50/70 text-cyan-800",
  },
  violet: {
    chip: "bg-violet-50 text-violet-700",
    bar: "bg-violet-500",
    hoverBorder: "hover:border-violet-300",
    tag: "border-violet-100 bg-violet-50/70 text-violet-800",
  },
  amber: {
    chip: "bg-amber-50 text-amber-700",
    bar: "bg-amber-500",
    hoverBorder: "hover:border-amber-300",
    tag: "border-amber-100 bg-amber-50/70 text-amber-800",
  },
  emerald: {
    chip: "bg-emerald-50 text-emerald-700",
    bar: "bg-emerald-500",
    hoverBorder: "hover:border-emerald-300",
    tag: "border-emerald-100 bg-emerald-50/70 text-emerald-800",
  },
  rose: {
    chip: "bg-rose-50 text-rose-700",
    bar: "bg-rose-500",
    hoverBorder: "hover:border-rose-300",
    tag: "border-rose-100 bg-rose-50/70 text-rose-800",
  },
  indigo: {
    chip: "bg-indigo-50 text-indigo-700",
    bar: "bg-indigo-500",
    hoverBorder: "hover:border-indigo-300",
    tag: "border-indigo-100 bg-indigo-50/70 text-indigo-800",
  },
  teal: {
    chip: "bg-teal-50 text-teal-700",
    bar: "bg-teal-500",
    hoverBorder: "hover:border-teal-300",
    tag: "border-teal-100 bg-teal-50/70 text-teal-800",
  },
};

export function fieldColorClasses(token: FieldColorToken): ColorClasses {
  return COLOR_CLASSES[token] ?? COLOR_CLASSES.blue;
}

/**
 * 领域图标白名单。
 *
 * `icon` 只是一个名称，未知名称回退到通用图标；它不会被当作路径、类名或 HTML 使用。
 */
const ICONS: Record<string, LucideIcon> = {
  bot: Bot,
  landmark: Landmark,
  database: Database,
  rocket: Rocket,
  sparkles: Sparkles,
  layers: Layers,
  shield: Shield,
};

export function fieldIcon(name: string | null): LucideIcon {
  if (!name) return Layers;
  return ICONS[name] ?? Layers;
}
