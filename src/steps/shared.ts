/**
 * 业务步骤层的公共辅助
 *
 * 一个贯穿全流程的原则：**每个用到 LLM 的地方都必须有确定性降级路径**。
 * 理由有三个：直答只有 100 次/天；现场网络可能不通；
 * 而计划书里的「信心护栏」本来就要求低证据时宁缺毋滥，而不是编。
 */

import type { StepContext } from '@/framework/pipeline';

export async function llmOrFallback<T>(
  ctx: StepContext,
  req: {
    system: string;
    input: unknown;
    schemaHint: string;
    cacheKey?: string;
    validate?: (raw: unknown) => T;
  },
  fallback: () => T,
  label = 'LLM',
): Promise<T> {
  try {
    return await ctx.llm.structured<T>(req);
  } catch (error) {
    ctx.logger.warn(`${label} 不可用，走确定性降级：${(error as Error).message}`);
    return fallback();
  }
}

/** 证据比对用：去掉空白与标点，避免因格式差异误判「找不到证据」 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[\s\u3000]/g, '')
    .replace(/[「」『』“”"'`（）()【】[\]{}，。；：、,.!?！？—\-~·]/g, '');
}

/** 判断一条摘录能否在原文中定位到 —— 证据护栏的执行点 */
export function quoteIsTraceable(quote: string, sourceText: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 6) return false;
  return normalizeForMatch(sourceText).includes(q);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function topN<T>(items: T[], n: number): T[] {
  return items.slice(0, Math.max(0, n));
}
