/**
 * 框架层 · 并发受限的 map
 *
 * 为什么需要：一个步骤内部经常要「对 N 条数据各调一次外部服务」。
 * 串行做会线性累加延迟 —— 实测 SenseNova 单次结构化抽取要 10~30 秒，
 * 8 条内容串行就是 80~240 秒，直接超过 route handler 的 maxDuration。
 * 并发做能让总耗时接近「单次耗时 × 批次数」，而不是「单次耗时 × 条数」。
 *
 * 为什么不是无脑 Promise.all：外部服务有速率限制。
 * 一次打太多并发会撞限流，反而更慢。所以这里是有上限的并发池。
 */

export interface PMapOptions {
  /** 最大并发数，默认 4 */
  concurrency?: number;
  /** 单条失败时的回调；返回 undefined 表示丢弃该条结果 */
  onError?: (error: unknown, index: number) => void;
}

/**
 * 按并发上限对数组做异步 map，**保持返回顺序与输入一致**。
 * 单条失败不会中断整体（除非 onError 抛错），失败项为 undefined。
 */
export async function pMap<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: PMapOptions = {},
): Promise<(R | undefined)[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, items.length || 1));
  const results: (R | undefined)[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index]!, index);
      } catch (error) {
        options.onError?.(error, index);
        results[index] = undefined;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

/** 并发数配置项：允许用环境变量按模型速度调整 */
export function llmConcurrency(): number {
  return Math.max(1, Number(process.env.LLM_CONCURRENCY || 4));
}
