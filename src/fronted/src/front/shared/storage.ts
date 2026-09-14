/**
 * 浏览器存储白名单。
 *
 * 只允许保存「未发送草稿」和「UI 偏好」这类纯前端状态。
 * Conversation、Message、Consultation、Token 与人物结果一律以 API 为业务真相，
 * 不写入本机存储。
 */
const PREFIX = "zhihu-wenren:frontend:v1:";

export const STORAGE_KEYS = {
  searchDraft: `${PREFIX}search-draft`,
  messageDraft: (conversationId: string) => `${PREFIX}message-draft:${conversationId}`,
  viewerRole: `${PREFIX}viewer-role`,
  /**
   * 最近一次搜索运行的**指针**（runId + 查询词），用于刷新后向 API 换取结果。
   *
   * 这里存的是指针而不是结果本身：人物卡、证据与相关度的业务真相永远在服务端，
   * 本机只记「本次会话拿到过哪个运行」，刷新时再向 `restoreRun` 要一次。
   * 用 sessionStorage 而不是 localStorage，因为它天然按标签页会话失效——
   * 关掉标签页后指针对应的运行多半也已过期，留着只会换来一次必然 404 的请求。
   */
  lastSearchRun: `${PREFIX}last-search-run`,
} as const;

/** 所有 key 必须以此前缀开头，避免误用第三方存储。 */
export const STORAGE_PREFIX = PREFIX;

function hasStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function readText(key: string): string | null {
  if (!hasStorage()) return null;
  if (!key.startsWith(STORAGE_PREFIX)) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeText(key: string, value: string): void {
  if (!hasStorage()) return;
  if (!key.startsWith(STORAGE_PREFIX)) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存储不可用（隐私模式 / 配额已满）时静默降级，草稿丢失不影响主流程。
  }
}

export function removeText(key: string): void {
  if (!hasStorage()) return;
  if (!key.startsWith(STORAGE_PREFIX)) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 同上：删除失败不抛出。
  }
}

/** 只清理本工程前缀下的 key，绝不调用 localStorage.clear()。 */
export function clearOwnKeys(): void {
  if (!hasStorage()) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // 忽略。
  }
}

function hasSessionStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.sessionStorage);
}

/** 会话级读取，与 `readText` 同样的前缀白名单与静默降级策略。 */
export function readSessionText(key: string): string | null {
  if (!hasSessionStorage()) return null;
  if (!key.startsWith(STORAGE_PREFIX)) return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSessionText(key: string, value: string): void {
  if (!hasSessionStorage()) return;
  if (!key.startsWith(STORAGE_PREFIX)) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // 存储不可用时静默降级：刷新后需要重新搜索，但主流程不受影响。
  }
}

export function removeSessionText(key: string): void {
  if (!hasSessionStorage()) return;
  if (!key.startsWith(STORAGE_PREFIX)) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 同上：删除失败不抛出。
  }
}
