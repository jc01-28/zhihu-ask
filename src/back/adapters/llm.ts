/**
 * 适配器 · 大模型
 *
 * 两个实现，共用同一套「结构化输出」协议：
 *   1. ZhidaLlmClient        —— 知乎直答，OpenAI 兼容，用 Access Secret 鉴权，100 次/天
 *   2. OpenAICompatLlmClient —— 任意 OpenAI 兼容服务
 *   3. NoLlmClient           —— LLM_PROVIDER=none 时启用，调用即抛错，
 *                               各步骤据此走启发式降级（对应计划书的「信心护栏」）
 *
 * 注意：直答不支持 response_format，所以结构化输出靠提示词约束 + 宽松解析 + 校验。
 */

import type { DiskCache } from '@/back/framework/cache';
import { extractJson, structureSystem } from '@/back/framework/llm-utils';
import type { LlmClient, QuotaGuard } from '@/back/framework/ports';
import { fetchWithTimeout, LLM_TIMEOUT_MS } from '@/back/framework/timeout';

interface ChatChoice {
  message?: { content?: string; reasoning_content?: string };
}

abstract class ChatCompletionsLlm implements LlmClient {
  abstract readonly name: string;

  constructor(protected readonly opts: { cache: DiskCache; quota: QuotaGuard; ttlMs?: number }) {}

  protected abstract call(body: unknown): Promise<ChatChoice | undefined>;
  protected abstract bucket(): string;

  protected ttl(): number {
    return this.opts.ttlMs ?? Number(process.env.CACHE_TTL_MS || 86400000);
  }

  async complete(req: {
    system: string;
    input: unknown;
    cacheKey?: string;
    temperature?: number;
  }): Promise<string> {
    const payload = {
      system: req.system,
      input: req.input,
      temperature: req.temperature ?? 0,
    };
    const key = req.cacheKey;

    const run = async () => {
      await this.opts.quota.consume(this.bucket());
      const choice = await this.call({
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: JSON.stringify(req.input) },
        ],
        temperature: payload.temperature,
        stream: false,
      });
      const content = choice?.message?.content ?? '';
      if (!content.trim()) throw new Error(`${this.name} 返回空内容`);
      return content;
    };

    if (!key) return run();
    // ⚠️ key 里必须带模型名：只按 provider 区分时，换 LLM_MODEL 会读到
    // 另一个模型算出来的旧结果，且同样是「全 cached、看起来正常」。
    const model = process.env.LLM_MODEL || '';
    const { value } = await this.opts.cache.getOrSet(
      `${this.name}:${model}:complete:${key}:${JSON.stringify(payload)}`,
      this.ttl(),
      run,
    );
    return value;
  }

  async structured<T>(req: {
    system: string;
    input: unknown;
    schemaHint: string;
    cacheKey?: string;
    temperature?: number;
    validate?: (raw: unknown) => T;
  }): Promise<T> {
    const system = structureSystem(req.system, req.schemaHint);
    const raw = await this.complete({
      system,
      input: req.input,
      cacheKey: req.cacheKey ? `structured:${req.cacheKey}` : undefined,
      temperature: req.temperature ?? 0,
    });

    const parsed = extractJson(raw);
    return req.validate ? req.validate(parsed) : (parsed as T);
  }
}

export class ZhidaLlmClient extends ChatCompletionsLlm {
  readonly name = 'zhida';

  protected bucket(): string {
    return 'zhida';
  }

  protected async call(body: unknown): Promise<ChatChoice | undefined> {
    const secret = process.env.ZHIHU_ACCESS_SECRET;
    if (!secret) throw new Error('ZHIHU_ACCESS_SECRET 未配置，无法调用知乎直答');

    const base = (process.env.ZHIHU_API_BASE || 'https://developer.zhihu.com').replace(/\/$/, '');
    // 必须带超时：provider 不响应时，没有超时的 fetch 会让整条链路永久卡住，
    // 而 optional / llmOrFallback 这些降级逻辑只在 promise reject 时才生效。
    const res = await fetchWithTimeout(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'zhida-fast-1p5',
        ...(body as Record<string, unknown>),
      }),
      cache: 'no-store',
      timeoutMs: LLM_TIMEOUT_MS(),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`直答 HTTP ${res.status}：${text.slice(0, 200)}`);

    const data = JSON.parse(text) as { choices?: ChatChoice[]; error?: { message?: string } };
    if (data.error) throw new Error(`直答返回错误：${data.error.message ?? 'unknown'}`);
    return data.choices?.[0];
  }
}

export class OpenAICompatLlmClient extends ChatCompletionsLlm {
  readonly name = 'openai';

  protected bucket(): string {
    return 'openai';
  }

  protected async call(body: unknown): Promise<ChatChoice | undefined> {
    const key = process.env.LLM_API_KEY;
    if (!key) throw new Error('LLM_API_KEY 未配置');
    const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

    const res = await fetchWithTimeout(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        ...(body as Record<string, unknown>),
      }),
      cache: 'no-store',
      timeoutMs: LLM_TIMEOUT_MS(),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}：${text.slice(0, 200)}`);

    const data = JSON.parse(text) as { choices?: ChatChoice[] };
    return data.choices?.[0];
  }
}

/** 无 LLM 模式：让各步骤走确定性降级，保证没有模型也能完整演示 */
export class NoLlmClient implements LlmClient {
  readonly name = 'none';

  async complete(): Promise<string> {
    throw new Error('LLM_PROVIDER=none，当前不调用大模型');
  }

  async structured<T>(): Promise<T> {
    throw new Error('LLM_PROVIDER=none，当前不调用大模型');
  }
}
