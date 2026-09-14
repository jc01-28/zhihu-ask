import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名：先做条件组合，再按 Tailwind 语义去重。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
