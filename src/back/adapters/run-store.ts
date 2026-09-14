/**
 * 适配器 · 运行结果存储
 *
 * 把一次搜索的结果落盘，供**刷新页面后恢复**（`GET /api/agent/runs/:runId`）。
 *
 * 为什么不用 `Cache` 端口：那个端口只有 `getOrSet`，没有「按 id 读回来」这一半，
 * 而恢复恰恰只需要读。硬套会变成「用一个必然 miss 的 producer 去取」这种绕法。
 *
 * 为什么不用数据库：项目至今是**零数据库**（JSON 语料 + 磁盘 KV），
 * 运行结果的生命周期只有两小时，落一个文件完全够用。
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '@/back/framework/datadir';
import type { PersonSearchResult } from '@/shared/contract';

/** 保留多久。演示场景两小时足够，也避免磁盘被历史运行堆满。 */
const RUN_TTL_MS = Number(process.env.RUN_TTL_MS ?? 2 * 60 * 60 * 1000);

/** 同 conversation-store：落 `.cache/` 下——既不被 git 扫到，也不触发 dev watcher */
const RUNS_SUBDIR = path.join('.cache', 'runs');

/** runId 是 uuid。**用它做路径前必须校验** —— 否则 `../` 就能写到目录外。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredRun {
  runId: string;
  createdAt: number;
  expiresAt: number;
  result: PersonSearchResult;
}

/**
 * 存一次运行结果。
 *
 * 返回 `false` 表示**存不下来**（serverless 只读磁盘等）。
 * 这不是错误：契约里有 `persistence: 'saved' | 'unavailable'` 两个取值，
 * 前端据此决定要不要显示「结果已保存」。**绝不能因为存不下来就让整次搜索失败** ——
 * 用户已经在等结果了，保存只是锦上添花。
 */
export async function saveRun(run: StoredRun): Promise<boolean> {
  if (!UUID_RE.test(run.runId)) {
    console.warn(`[run-store] 拒绝保存非 uuid 的 runId：${run.runId}`);
    return false;
  }
  try {
    const dir = dataDir(RUNS_SUBDIR);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${run.runId}.json`),
      JSON.stringify(run),
      'utf8',
    );
    return true;
  } catch (error) {
    console.warn('[run-store] 保存运行结果失败（不影响本次结果展示）：', error);
    return false;
  }
}

/** 读回一次运行结果。未找到、已过期、格式非法都返回 null。 */
export async function loadRun(runId: string): Promise<StoredRun | null> {
  // 先挡路径穿越，再碰文件系统
  if (!UUID_RE.test(runId)) return null;
  try {
    const raw = await readFile(path.join(dataDir(RUNS_SUBDIR), `${runId}.json`), 'utf8');
    const run = JSON.parse(raw) as StoredRun;
    if (!run?.result || typeof run.expiresAt !== 'number') return null;
    if (run.expiresAt < Date.now()) return null;
    return run;
  } catch {
    return null;
  }
}

/** 主动清理（过期文件不清理也不会出错，只是占地方） */
export async function deleteRun(runId: string): Promise<void> {
  if (!UUID_RE.test(runId)) return;
  try {
    await unlink(path.join(dataDir(RUNS_SUBDIR), `${runId}.json`));
  } catch {
    /* 不存在就算了 */
  }
}

/** 计算一个新的运行结果的过期时间 */
export function runExpiry(from = Date.now()): number {
  return from + RUN_TTL_MS;
}
