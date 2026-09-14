/**
 * 领域层 · 头像与标识的小工具
 *
 * 抽出来是因为**两处都要用**：领域星图（`field-graph.ts`）与人物卡（`creator-card.ts`）。
 * 放在任一方都会让另一方反向依赖，所以独立成模块。
 *
 * 全部是确定性的：同一个人在任何页面拿到的 id、首字、底色永远一致 ——
 * 这一点对演示很重要（刷新位置/颜色不变），对前端也重要（可以按 id 去重、跳转）。
 */

/** FNV-1a。要的是**跨环境确定性**，不是密码学强度 —— 所以不用 crypto */
export function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 头像底色候选。用固定调色板而不是随机色，保证同一人永远同色。
 *
 * 契约里 `avatarTone` 是**任意字符串**（≤80 字），但前端会拿它当主题色用，
 * 所以这里给的是可用的十六进制值。
 */
const AVATAR_TONES = [
  '#2F6FED',
  '#1D9E75',
  '#D85A30',
  '#7F77DD',
  '#EF9F27',
  '#639922',
  '#A855F7',
  '#0E7490',
];

/** 头像占位字：中文取首字，英文取首字母。契约限**最多 2 字** */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? '?';
  return first.toUpperCase();
}

export function avatarToneOf(id: string): string {
  return AVATAR_TONES[hash32(id) % AVATAR_TONES.length];
}

/**
 * 人物 id：只由**作者名**决定，不含领域、不含场景。
 *
 * 这样同一个人出现在多个领域、或同时出现在「找人」与「星图」里时 id 一致，
 * 前端可以据此去重，也可以直接用它去 `GET /api/creators/:id`。
 */
export function personIdOf(authorName: string): string {
  return `p_${hash32(authorName).toString(36)}`;
}

/**
 * 只放行 **https 绝对地址**，否则给 null。
 *
 * 契约对 `avatarUrl` / `profileUrl` 的要求是「https 或 null」：
 * 这两个值会被前端**直接塞进 `<img src>` / `<a href>`**，放行别的协议就是注入面。
 * 前端 schema 也会拒，但后端不该把责任推过去 —— 而且这样能保证我们**从不发出**危险值。
 */
export function httpsOrNull(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}
