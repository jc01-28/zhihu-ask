/**
 * 处理器 · 一次提问
 *
 * 这一层只做四件事：限流、解析意图、校验输入、调流水线。**不要在这里写业务逻辑** ——
 * 8 步链路在 `src/back/steps`。
 *
 * 与框架解耦：不 import next/*、不读 cookie。route 层把 HTTP 上下文拍平成参数传进来，
 * 所以这个函数可以直接在评测脚本里调用。
 */

import { resolveExperiment, type ExperimentId } from '@/back/domain/experiment';
import { openSession } from '@/back/adapters/session';
import { MemoryThrottle } from '@/back/framework/throttle';
import { runAsk } from '@/back/steps';
import { fail, ok, tooMany, type HandlerResult } from './types';

/**
 * 进程内限流。默认 10 分钟 20 次/客户端 —— 正常人够用，
 * 但能挡住「连点几十次把当天额度烧穿」这种情况。
 * 可用 ASK_RATE_LIMIT / ASK_RATE_WINDOW_MS 调整，设为 0 关闭。
 */
const throttle = new MemoryThrottle(
  Number(process.env.ASK_RATE_LIMIT ?? 20),
  Number(process.env.ASK_RATE_WINDOW_MS ?? 600000),
);

const rateLimitEnabled = Number(process.env.ASK_RATE_LIMIT ?? 20) > 0;

/** 输入长度上限：防止有人塞一篇长文把 LLM 额度一次打光 */
const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS ?? 1000);

export interface AskInput {
  /** 已解析的请求体；`null` 表示 JSON 解析失败 */
  body: { question?: unknown; experiment?: unknown } | null;
  /** 会话 cookie 的原始值（route 层从 Cookie 里取出） */
  sessionToken: string | undefined;
  /** 限流用的客户端标识（route 层根据请求头算出） */
  clientKey: string;
}

export async function handleAsk(input: AskInput): Promise<HandlerResult> {
  if (rateLimitEnabled) {
    const verdict = throttle.check(input.clientKey);
    if (!verdict.ok) {
      return tooMany(
        verdict.retryAfterSec,
        '这是为了保护知乎开放平台的每日调用额度，避免演示期间额度被烧穿',
      );
    }
  }

  if (!input.body) return fail(400, '请求体不是合法 JSON');

  const question = typeof input.body.question === 'string' ? input.body.question.trim() : '';

  // 允许从前端指定基线分组（演示对照用）。非法值直接报错而不是静默回退，
  // 否则「我以为在跑 B 组，其实跑的是 C 组」，结论就错了。
  let experiment: ExperimentId | undefined;
  if (typeof input.body.experiment === 'string' && input.body.experiment.trim()) {
    try {
      experiment = resolveExperiment(input.body.experiment).id;
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : '未知的实验分组');
    }
  }

  if (question.length < 6) {
    return fail(400, '请把问题描述得再具体一些（至少 6 个字），包括你的处境和纠结点');
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return fail(400, `问题过长（${question.length} 字），请压缩到 ${MAX_QUESTION_CHARS} 字以内`);
  }

  const session = openSession(input.sessionToken);

  try {
    const result = await runAsk(question, {
      getOAuthToken: async () => session?.accessToken ?? null,
      experiment,
    });
    return ok(result);
  } catch (error) {
    console.error('[ask] 流水线失败：', error);
    return fail(500, error instanceof Error ? error.message : '未知错误');
  }
}
