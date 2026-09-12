/**
 * 框架层 · 额度护栏
 *
 * 知乎各接口有单日调用上限（搜索 1000、热榜 100、直答 100）。
 * 配额被烧穿是最典型的黑客松事故：现场演示到一半接口开始报错。
 * 这里做的是「本地计数 + 上限拦截」—— 宁可早一点抛错，也不要把额度打光。
 *
 * ⚠️ 两条工程边界，别误以为它是安全机制：
 * 1. **磁盘不可写时退回进程内计数**（serverless 上磁盘只读，见 datadir.ts）。
 * 2. **进程内计数在多实例部署下不是全局的** —— 每个 lambda 实例各算各的。
 *    它是一道「本地保险丝」，不是全局配额管理。真要全局限流得接 Redis/KV。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { QuotaExceededError, type QuotaGuard } from './ports';

export class DiskQuotaGuard implements QuotaGuard {
  /** 进程内计数：磁盘不可写时的兜底，同时也是读缓存 */
  private readonly memory = new Map<string, number>();
  private loadAttempted = false;
  private diskOk = true;

  constructor(
    private readonly dir: string,
    private readonly policy: Record<string, number>,
  ) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private fileFor(day: string): string {
    return path.join(this.dir, `quota-${day}.json`);
  }

  private async load(day: string): Promise<void> {
    if (this.loadAttempted || !this.diskOk) return;
    this.loadAttempted = true;
    try {
      const parsed = JSON.parse(
        await readFile(this.fileFor(day), 'utf8'),
      ) as Record<string, number>;
      for (const [k, v] of Object.entries(parsed)) this.memory.set(k, v);
    } catch {
      // 文件不存在或磁盘不可读：从 0 开始计
    }
  }

  async consume(bucket: string): Promise<void> {
    const day = this.today();
    await this.load(day);

    const limit = this.policy[bucket];
    const used = this.memory.get(bucket) ?? 0;

    if (limit !== undefined && used >= limit) {
      throw new QuotaExceededError(bucket, limit);
    }

    this.memory.set(bucket, used + 1);

    if (this.diskOk) {
      try {
        await mkdir(this.dir, { recursive: true });
        await writeFile(
          this.fileFor(day),
          JSON.stringify(Object.fromEntries(this.memory)),
          'utf8',
        );
      } catch {
        // 磁盘只读（serverless）：退回纯进程内计数，不报错
        this.diskOk = false;
        console.warn('[quota] 磁盘不可写，额度计数改为进程内，多实例部署下不再是全局配额');
      }
    }
  }

  async snapshot(): Promise<Record<string, number>> {
    await this.load(this.today());
    return Object.fromEntries(this.memory);
  }
}
