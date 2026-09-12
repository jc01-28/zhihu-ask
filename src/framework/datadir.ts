/**
 * 框架层 · 数据目录解析
 *
 * 这是一个真实的工程边界：**serverless 平台的文件系统是只读的**。
 * Vercel 上 `process.cwd()` 是 `/var/task`，往里写文件会抛 EROFS。
 * 而 OAuth 回调必须公网 HTTPS ⇒ 必须部署 ⇒ 如果数据目录写死 cwd，部署后链路直接挂。
 *
 * 解决方式：启动时探测一次「哪个目录真的可写」，按 DATA_DIR → cwd → os.tmpdir() 顺序回退。
 * 同时缓存/额度/产物三处的写入都必须容错 —— 写不进去只是「失去优化」，绝不能变成「功能失败」。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let resolvedRoot: string | null = null;
let didWarn = false;

function probe(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, '.write-probe');
    writeFileSync(file, 'ok');
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

function resolveRoot(): string {
  if (resolvedRoot) return resolvedRoot;

  const candidates = [process.env.DATA_DIR, process.cwd(), tmpdir()].filter(
    (c): c is string => Boolean(c),
  );

  for (const candidate of candidates) {
    if (probe(candidate)) {
      resolvedRoot = candidate;
      return candidate;
    }
  }

  // 理论上到不了这里（tmpdir 基本总是可写），保底返回 tmpdir
  resolvedRoot = tmpdir();
  return resolvedRoot;
}

/** 取某个子目录的绝对路径，并保证根目录可写 */
export function dataDir(subdir: string): string {
  return path.join(resolveRoot(), subdir);
}

/** 只在第一次失败时告警，避免刷屏 */
export function warnOnce(logger: (msg: string) => void, message: string): void {
  if (didWarn) return;
  didWarn = true;
  logger(message);
}

/** 供 /api/health 自检用：当前实际使用的数据目录 + 是否可写 */
export function dataDirInfo(): { root: string; writable: boolean } {
  const root = resolveRoot();
  return { root, writable: probe(root) };
}
