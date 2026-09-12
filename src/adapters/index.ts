/**
 * 装配层（composition root）
 *
 * 这是整个项目唯一一处「知道所有实现」的地方：它按环境变量挑数据源与模型，
 * 拼出流水线运行所需的依赖。业务步骤看不到任何具体的实现类。
 *
 * 想换数据源、换模型、加缓存策略，只改这个文件。
 *
 * ⚠️ 缓存与额度护栏必须是**模块级单例**：
 * 在 serverless 上磁盘只读时会退回「进程内计数」，如果每次请求新建实例，
 * 计数就永远从 0 开始，护栏等于失效。单例能让它在一个实例的生命周期内持续生效。
 */

import path from 'node:path';
import { DiskCache } from '@/framework/cache';
import { dataDir } from '@/framework/datadir';
import type { ContextDeps, Logger } from '@/framework/pipeline';
import { DiskQuotaGuard } from '@/framework/quota';
import type { ContentSource, LlmClient } from '@/framework/ports';
import { NoLlmClient, OpenAICompatLlmClient, ZhidaLlmClient } from './llm';
import { FixtureSource } from './source-fixture';
import { ZhihuHttpSource } from './zhihu-http-source';

// ⚠️ 不要用 process.cwd()：serverless 上它是只读的（Vercel 是 /var/task）。
// dataDir() 会探测出真正可写的目录，回退顺序 DATA_DIR → cwd → os.tmpdir()
export const CACHE_DIR = dataDir('.cache');
export const ARTIFACT_DIR = dataDir('.artifacts');

function quotaPolicy(): Record<string, number> {
  return {
    zhihu_search: Number(process.env.QUOTA_ZHIHU_SEARCH || 1000),
    global_search: Number(process.env.QUOTA_GLOBAL_SEARCH || 1000),
    hot_list: Number(process.env.QUOTA_HOT_LIST || 100),
    zhida: Number(process.env.QUOTA_ZHIDA || 100),
    openai: Number(process.env.QUOTA_OPENAI || 1000),
    user_api: Number(process.env.QUOTA_USER_API || 500),
  };
}

export function createLogger(scope: string): Logger {
  const emit = (level: string, msg: string, meta?: Record<string, unknown>) => {
    const line = `[${scope}] ${msg}`;
    if (level === 'error') console.error(line, meta ?? '');
    else if (level === 'warn') console.warn(line, meta ?? '');
    else console.log(line, meta ?? '');
  };
  return {
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
  };
}

/** 模块级单例 —— 见文件头说明，别改成每次请求新建 */
const cache = new DiskCache(CACHE_DIR);
const quota = new DiskQuotaGuard(CACHE_DIR, quotaPolicy());

let llmSingleton: LlmClient | null = null;

function llm(): LlmClient {
  if (llmSingleton) return llmSingleton;
  const provider = process.env.LLM_PROVIDER || 'zhida';
  if (provider === 'none') llmSingleton = new NoLlmClient();
  else if (provider === 'openai') llmSingleton = new OpenAICompatLlmClient({ cache, quota });
  else llmSingleton = new ZhidaLlmClient({ cache, quota });
  return llmSingleton;
}

function pickSource(getOAuthToken: () => Promise<string | null>): ContentSource {
  if (process.env.USE_FIXTURES === '1') return new FixtureSource();
  return new ZhihuHttpSource({ cache, quota, getOAuthToken });
}

export interface RuntimeOptions {
  /** 当前请求上下文里读取 OAuth token（用于访问授权用户的关注/收藏） */
  getOAuthToken?: () => Promise<string | null>;
  logger?: Logger;
}

/** 造出 runPipeline 需要的依赖集合 */
export function createRuntime(opts: RuntimeOptions = {}): ContextDeps {
  return {
    source: pickSource(opts.getOAuthToken ?? (async () => null)),
    llm: llm(),
    cache,
    quota,
    logger: opts.logger ?? createLogger('pipeline'),
    saveArtifact: async (runId, name, index, value) => {
      // 产物落盘只是为了本地排查与评测；写不进去（serverless 只读）不该影响请求
      try {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const dir = path.join(ARTIFACT_DIR, runId);
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, `${String(index + 1).padStart(2, '0')}-${name}.json`),
          JSON.stringify(value, null, 2),
          'utf8',
        );
      } catch {
        // 静默跳过：线上不需要产物，评测在本地跑
      }
    },
  };
}

export const paths = { CACHE_DIR, ARTIFACT_DIR };
