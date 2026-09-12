/**
 * 框架层 · LLM 输出处理
 *
 * 知乎直答是 OpenAI 兼容接口，但不支持 response_format: json_object，
 * 所以「结构化输出」要靠：提示词约束 + 宽松解析 + 调用方校验 三件套。
 * 这段逻辑与业务无关，所以留在框架层。
 */

/** 用 JSON Schema 风格的描述约束模型只吐 JSON */
export function structureSystem(system: string, schemaHint: string): string {
  return [
    system.trim(),
    '',
    '【输出格式】',
    '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释性文字。',
    '严格遵循以下结构（字段名不得改动）：',
    schemaHint.trim(),
  ].join('\n');
}

/**
 * 从模型输出里「挖」出第一个完整 JSON。能容忍常见的三种脏输出：
 *   ```json 围栏、前后解释文字、字符串里的花括号。
 */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error('模型输出中找不到 JSON');

  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error('模型输出的 JSON 不闭合');
}

/** 常用断言：调用方在各 step 里校验字段时反复用到 */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`字段 ${field} 缺失或不是非空字符串`);
  }
  return value;
}

export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`字段 ${field} 缺失或不是非空数组`);
  }
  return value;
}

/** 稳定序列化，用于生成缓存 key */
export function stableKey(...parts: unknown[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p ?? null)))
    .join('|');
}

/** 中文分词只做到「切词 + 去停用词」的程度，够用且零依赖 */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '怎么', '什么', '如何', '为什么', '可以', '应该', '该不该',
  '一个', '一家', '我们', '他们', '但是', '而且', '因为', '所以', '如果', '还是',
  '是否', '现在', '已经', '可能', '需要', '觉得', '认为', '感觉', '其实', '然后',
]);

/**
 * 中文切分：对连续汉字做 2~3 元滑窗，而不是贪婪切块。
 * 贪婪切块（每 4 字一刀）会把「大厂创业公司」切成「大厂创业 / 公司」这种伪词，
 * 导致关键词匹配全线失效。滑窗会让「大厂」「创业」「公司」都能命中。
 */
export function tokenize(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z0-9_+#.-]{2,}/g) ?? [];
  const runs = text.match(/[\u4e00-\u9fa5]+/g) ?? [];

  const grams = new Set<string>();
  for (const run of runs) {
    const max = Math.min(3, run.length);
    for (let n = 2; n <= max; n += 1) {
      for (let i = 0; i + n <= run.length; i += 1) {
        const gram = run.slice(i, i + n);
        if (!STOP_WORDS.has(gram)) grams.add(gram);
      }
    }
  }
  return [...latin, ...grams];
}
