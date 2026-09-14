/**
 * 适配器 · 会话
 *
 * 官方安全要求：OAuth access token 不能进浏览器、不能进前端日志。
 * 这里把 token 用 AES-256-GCM 加密后放进 HttpOnly Cookie：
 *   - 浏览器 JS 读不到；
 *   - 服务端无状态，Vercel / Serverless 也能用（进程内 Map 在 serverless 上会丢）；
 *   - 加密密钥只在服务端环境变量里。
 * 另外单独放一个短小的 state cookie，用于回调关联性校验（知乎回调不保证回传 state）。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { MyProfile } from '@/back/framework/ports';

export const SESSION_COOKIE = 'zh_session';
export const STATE_COOKIE = 'zh_oauth_state';

export interface OAuthSession {
  accessToken: string;
  expiresAt: number;
  /**
   * 授权用户的公开资料，在回调时取一次并随会话一起加密保存。
   * 这样 /api/oauth/status 不用每次都去打知乎接口（省额度、也不增加延迟）。
   */
  profile?: MyProfile | null;
}

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET 未配置，无法安全保存会话（生成方式：openssl rand -hex 32）');
  }
  return createHash('sha256').update(secret).digest();
}

export function sealSession(session: OAuthSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(session), 'utf8'),
    cipher.final(),
  ]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function openSession(token: string | undefined): OAuthSession | null {
  if (!token) return null;
  const [ivPart, tagPart, bodyPart] = token.split('.');
  if (!ivPart || !tagPart || !bodyPart) return null;

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(bodyPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    const session = JSON.parse(plain) as OAuthSession;
    if (!session.accessToken || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function newState(): string {
  return randomBytes(16).toString('base64url');
}
