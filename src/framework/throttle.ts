/**
 * 框架层 · 进程内限流
 *
 * 为什么需要：`POST /api/ask` 是「一次请求消耗多次搜索额度」的接口。
 * 演示链接一旦公开放到作品广场，任何一个人（或爬虫）连点几十次，
 * 1000 次/天的搜索额度就被烧穿了，现场演示直接失败。
 *
 * ⚠️ 边界：这是**保险丝，不是安全机制**。
 *   - 计数在进程内，多实例部署下每实例各算各的；
 *   - 识别依据是 `x-forwarded-for` 首段，可伪造；
 *   - 重启即清零。
 * 要真正的全局限流请接 Redis / Vercel KV。
 */

interface Bucket {
  hits: number[];
}

export class MemoryThrottle {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** @returns ok=false 表示已超出窗口内配额 */
  check(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    const bucket = this.buckets.get(key) ?? { hits: [] };
    const cutoff = now - this.windowMs;
    bucket.hits = bucket.hits.filter((t) => t > cutoff);

    if (bucket.hits.length >= this.limit) {
      const oldest = bucket.hits[0] ?? now;
      this.buckets.set(key, bucket);
      return { ok: false, retryAfterSec: Math.ceil((oldest + this.windowMs - now) / 1000) };
    }

    bucket.hits.push(now);
    this.buckets.set(key, bucket);

    // 顺手清理过期桶，避免长时间运行内存无限增长
    if (this.buckets.size > 5000) {
      for (const [k, v] of this.buckets) {
        if (v.hits.every((t) => t <= cutoff)) this.buckets.delete(k);
      }
    }

    return { ok: true, retryAfterSec: 0 };
  }
}

/** 从请求头里取一个尽量稳定的客户端标识（可伪造，仅供限流用） */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'anonymous';
}
