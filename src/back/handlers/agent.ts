/**
 * 处理器 · 问题找人域
 *
 * 这一层负责把 8 步链路的产物**映射成前端契约的形状**，并承载流式协议。
 * 目前只有热榜；搜索 / run 恢复 / 三栏对比会加在这里。
 */

import { createRuntime } from '@/back/adapters';
import { httpsOrNull } from '@/back/domain/avatar';
import type { BackgroundDocument, HotTopicsResponse } from '@/shared/contract';
import { ok, type HandlerResult } from './types';

const MAX_TOPICS = 12;

/**
 * 热榜选题。
 *
 * ⚠️ **不可用时不是错误**。契约用 `unavailable: true` 作为降级信号
 * （前端据此隐藏整个热榜区），而不是返回 5xx 让前端弹红条 ——
 * 热榜只是「不知道问什么」时的参考，它挂了不该影响主流程。
 *
 * 同理，某一条拿不到 https 地址就**直接丢弃**：宁可少一条，
 * 也不要发一个会被前端契约拒绝、或点进去是坏页的链接。
 */
export async function handleHotTopics(): Promise<HandlerResult> {
  const runtime = createRuntime({ getOAuthToken: async () => null });

  try {
    const items = await runtime.source.hotList(MAX_TOPICS);

    const topics: BackgroundDocument[] = items
      .map((item) => ({
        scope: 'background' as const,
        source: 'hot_list' as const,
        title: item.title,
        excerpt: item.summary,
        url: httpsOrNull(item.url) ?? '',
        thumbnailUrl: null,
        publishedAt: null,
      }))
      .filter((doc) => doc.url !== '');

    return ok({ topics, unavailable: false } satisfies HotTopicsResponse);
  } catch (error) {
    console.warn('[agent] 热榜不可用，按契约降级为空列表 + unavailable:true：', error);
    return ok({ topics: [], unavailable: true } satisfies HotTopicsResponse);
  }
}
