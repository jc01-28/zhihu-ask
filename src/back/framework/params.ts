/**
 * 框架层 · 查询参数解析
 *
 * 单独抽出来只因为一个已经踩到的坑：
 *
 *   ```js
 *   Number(null)        // 0   ← 是合法数字！
 *   Number(undefined)   // NaN
 *   Number('')          // 0
 *   ```
 *
 * 所以 `Number(input.limit)` 在参数**缺省**时得到 0，再被 `Math.max(1, …)` 一夹
 * 就成了 1 —— 表现是「列表莫名其妙只返回一条」，而不是报错。
 * 领域搜索和消息列表都中过招：前者被静默截断成 1 条领域，后者只回 1 条消息。
 *
 * 这里统一要求：**缺省就是缺省**，只有显式给出合法数字才生效。
 */

/**
 * 解析分页条数。
 *
 * 同时接受 `string` 与 `number`：有的路由在壳层就转成了数字（`/api/fields`），
 * 有的直接把查询串原值透传进来（`/api/conversations/:id/messages`）。
 * 只认一种类型的话，另一种会在运行时炸（`.trim is not a function`），
 * 而这类错误在 dev 下容易被当成「数据问题」放过去。
 *
 * @param raw  原值，可能是 null / '' / 'abc' / '-3' / NaN / 1e9
 * @param def  缺省值
 * @param max  上限，防止一次捞空整个库
 */
export function pageLimit(raw: unknown, def: number, max: number): number {
  const clamp = (n: number): number => Math.max(1, Math.min(Math.trunc(n), max));

  if (raw == null) return def;
  if (typeof raw === 'number') return Number.isFinite(raw) ? clamp(raw) : def;

  const text = String(raw).trim();
  if (text === '') return def;

  const n = Number(text);
  return Number.isFinite(n) ? clamp(n) : def;
}
