import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clientKey, MemoryThrottle } from '@/framework/throttle';
import { openSession, SESSION_COOKIE } from '@/adapters/session';
import { runAsk } from '@/steps';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 业务入口：一次提问 → 跑完整条流水线。
 * 这一层只做三件事：校验输入、取会话、限流。不要在这里写业务逻辑。
 */

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
const MAX_QUESTION_CHARS = 1000;

export async function POST(request: Request) {
  if (rateLimitEnabled) {
    const verdict = throttle.check(clientKey(request));
    if (!verdict.ok) {
      return NextResponse.json(
        {
          error: `请求过于频繁，请 ${verdict.retryAfterSec} 秒后再试`,
          hint: '这是为了保护知乎开放平台的每日调用额度，避免演示期间额度被烧穿',
        },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } },
      );
    }
  }

  let question = '';
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === 'string' ? body.question.trim() : '';
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (question.length < 6) {
    return NextResponse.json(
      { error: '请把问题描述得再具体一些（至少 6 个字），包括你的处境和纠结点' },
      { status: 400 },
    );
  }

  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `问题过长（${question.length} 字），请压缩到 ${MAX_QUESTION_CHARS} 字以内` },
      { status: 400 },
    );
  }

  // Next 15 起 cookies() / headers() 变成异步 API，必须 await
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);

  try {
    const result = await runAsk(question, {
      getOAuthToken: async () => session?.accessToken ?? null,
    });
    return NextResponse.json({ status: 'success', data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[ask] 流水线失败：', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
