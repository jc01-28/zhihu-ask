/**
 * 框架层 · 磁盘缓存
 *
 * 为什么黑客松必须有它：
 *   - 知乎搜索 1000 次/天、直答 100 次/天，跑几次评测就见底了；
 *   - 现场演示时网络抖一下、额度超一次，Demo 就废了；
 *   - 对照实验要求同样输入得到同样输出，缓存让复跑结果可复现。
 *
 * ⚠️ 工程边界：写入必须容错。
 * serverless 上磁盘可能只读 —— 写不进去只是「失去缓存这个优化」，
 * 绝不能让它变成「整个请求失败」。所以所有写操作都吞掉异常。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Cache } from './ports';

interface Entry<T> {
  key: string;
  expiresAt: number;
  value: T;
}

export class DiskCache implements Cache {
  private writeWarned = false;

  constructor(private readonly dir: string) {}

  private fileFor(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 40);
    return path.join(this.dir, `${hash}.json`);
  }

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    producer: () => Promise<T>,
  ): Promise<{ value: T; hit: boolean }> {
    const file = this.fileFor(key);

    try {
      const raw = await readFile(file, 'utf8');
      const entry = JSON.parse(raw) as Entry<T>;
      if (entry.expiresAt > Date.now()) {
        return { value: entry.value, hit: true };
      }
    } catch {
      // 未命中、文件损坏或磁盘不可读：都走 producer 重建
    }

    const value = await producer();

    try {
      await mkdir(this.dir, { recursive: true });
      const entry: Entry<T> = { key, expiresAt: Date.now() + ttlMs, value };
      await writeFile(file, JSON.stringify(entry), 'utf8');
    } catch (error) {
      if (!this.writeWarned) {
        this.writeWarned = true;
        console.warn(
          `[cache] 无法写入 ${this.dir}，本次及后续将跳过缓存（不影响功能，但会重复消耗接口额度）：` +
            `${(error as Error).message}`,
        );
      }
    }

    return { value, hit: false };
  }
}

/** 测试 / 特殊场景用：不缓存，永远直连 */
export class NoopCache implements Cache {
  async getOrSet<T>(_key: string, _ttl: number, producer: () => Promise<T>) {
    return { value: await producer(), hit: false };
  }
}
