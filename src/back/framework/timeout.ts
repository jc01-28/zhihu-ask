/**
 * 框架层 · 出站请求超时
 *
 * 这是一个被实测教训出来的模块：
 *   我们跑真实模型链路时，第二次请求卡在抽取步骤**整整 300 秒没有返回**。
 *   根因就是这里的 fetch 没有超时 —— provider 一旦不响应（限流、连接被挂起、
 *   网络黑洞），promise 永远不会 settle，整条链路就永远卡在那里，
 *   现有的降级逻辑（optional / llmOrFallback）根本没机会生效，因为它们只能
 *   在 promise reject 时才触发。
 *
 * 教训：**没有超时的外部调用 = 没有降级**。
 * 任何「允许失败」的调用，都必须同时具备「一定会失败」的能力。
 */

/** 默认超时（毫秒）。LLM 推理慢，给足；普通 HTTP 接口短一些 */
export const LLM_TIMEOUT_MS = () => Number(process.env.LLM_TIMEOUT_MS || 30000);
export const API_TIMEOUT_MS = () => Number(process.env.ZHIHU_TIMEOUT_MS || 15000);

/**
 * 给 fetch 加上超时。返回的 Response 与原生一致；
 * 超时会抛出一个可识别的错误（name === 'TimeoutError'），
 * 上层可以据此走降级而不是当成致命错误。
 */
export function fetchWithTimeout(
  input: string | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  const ms = timeoutMs ?? API_TIMEOUT_MS();

  // 已经是 AbortSignal.timeout 时不要叠加，避免语义混乱
  const timeoutSignal = AbortSignal.timeout(ms);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  return fetch(input, { ...rest, signal: combined });
}

/** 判断一个错误是不是超时导致的 —— 降级逻辑用它来决定日志措辞 */
export function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; code?: string; cause?: { name?: string } };
  return (
    e.name === 'TimeoutError' ||
    e.name === 'AbortError' ||
    e.code === 'UND_ERR_HEADERS_TIMEOUT' ||
    e.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    e.cause?.name === 'TimeoutError'
  );
}
