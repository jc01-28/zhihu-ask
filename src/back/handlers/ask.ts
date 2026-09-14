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
import { toPhases } from '@/back/domain/phases';
import { openSession } from '@/back/adapters/session';
import { runAsk } from '@/back/steps';
import type { AskResponse } from '@/shared/contract';
import { API_ERROR_CODES } from '@/shared/contract';
import { checkRate } from './rate-limit';
import { fail, ok, tooMany, type HandlerResult } from './types';

/**
 * 链路内部错误的码。
 *
 * 刻意**不在前端那份公开错误码清单里** —— 内部异常不该让前端做特殊处理，
 * 走通用错误提示即可。`ApiErrorEnvelope.code` 是 `z.string()`，所以合法。
 */
const INTERNAL_ERROR = 'INTERNAL_ERROR';

/**
 * 问题长度区间。**与前端规格对齐**：4 ~ 300 字。
 *
 * 上限刻意压到 300（原来是 1000）：一是照规格，二是防止有人塞一篇长文
 * 把 LLM 额度一次打光。前端 `FindPage` 用同一组数字（MIN_CHARS / MAX_CHARS），
 * 两边的校验因此不会互相打架。
 */
const MIN_QUESTION_CHARS = Number(process.env.MIN_QUESTION_CHARS ?? 4);
const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS ?? 300);

export interface AskInput {
  /** 已解析的请求体；`null` 表示 JSON 解析失败 */
  body: { question?: unknown; experiment?: unknown } | null;
  /** 会话 cookie 的原始值（route 层从 Cookie 里取出） */
  sessionToken: string | undefined;
  /** 限流用的客户端标识（route 层根据请求头算出） */
  clientKey: string;
}

export async function handleAsk(input: AskInput): Promise<HandlerResult> {
  // 与 /api/agent/search **共用同一份限流计数**（见 rate-limit.ts 的说明）
  const verdict = checkRate(input.clientKey);
  if (!verdict.ok) {
    return tooMany(
      verdict.retryAfterSec,
      '这是为了保护知乎开放平台的每日调用额度，避免演示期间额度被烧穿',
    );
  }

  if (!input.body) {
    return fail(400, API_ERROR_CODES.invalidSearchRequest, '请求体不是合法 JSON');
  }

  const question = typeof input.body.question === 'string' ? input.body.question.trim() : '';

  // 允许从前端指定基线分组（演示对照用）。非法值直接报错而不是静默回退，
  // 否则「我以为在跑 B 组，其实跑的是 C 组」，结论就错了。
  let experiment: ExperimentId | undefined;
  if (typeof input.body.experiment === 'string' && input.body.experiment.trim()) {
    try {
      experiment = resolveExperiment(input.body.experiment).id;
    } catch (error) {
      return fail(
        400,
        API_ERROR_CODES.invalidSearchRequest,
        error instanceof Error ? error.message : '未知的实验分组',
      );
    }
  }

  if (question.length < MIN_QUESTION_CHARS) {
    return fail(
      400,
      API_ERROR_CODES.invalidSearchRequest,
      `请把问题描述得再具体一些（至少 ${MIN_QUESTION_CHARS} 个字），包括你的处境和纠结点`,
    );
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return fail(
      400,
      API_ERROR_CODES.invalidSearchRequest,
      `问题过长（${question.length} 字），请压缩到 ${MAX_QUESTION_CHARS} 字以内`,
    );
  }

  const session = openSession(input.sessionToken);

  try {
    const core = await runAsk(question, {
      getOAuthToken: async () => session?.accessToken ?? null,
      experiment,
    });

    // 展示口径在这里补齐：链路产物（AskResult）+ 6 阶段聚合 = 对外响应（AskResponse）。
    // 刻意放在 handler 而不是步骤里 —— 调阶段划分不该需要重跑链路验证。
    const result: AskResponse = {
      ...core,
      phases: toPhases(core.trace, { authenticated: Boolean(session) }),
    };
    return ok(result);
  } catch (error) {
    console.error('[ask] 流水线失败：', error);
    return fail(
      500,
      INTERNAL_ERROR,
      error instanceof Error ? error.message : '未知错误',
      true,
    );
  }
}
