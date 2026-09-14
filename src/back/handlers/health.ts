/**
 * 处理器 · 健康检查与能力自检
 *
 * 部署后先打这个接口：能一眼看出是「凭证没配」还是「磁盘不可写」还是「代码有问题」。
 * 只回布尔值与路径，不回任何密钥内容。
 */

import { CACHE_DIR } from '@/back/adapters';
import { fixtureComposition } from '@/back/adapters/source-fixture';
import { dataDirInfo } from '@/back/framework/datadir';
import { DiskQuotaGuard } from '@/back/framework/quota';
import type { HealthResponse } from '@/shared/contract';
import { ok, type HandlerResult } from './types';

export async function handleHealth(): Promise<HandlerResult> {
  const dir = dataDirInfo();
  const quota = new DiskQuotaGuard(CACHE_DIR, {});
  const fixtureMode = process.env.USE_FIXTURES === '1';

  const body: HealthResponse = {
    ok: true,
    mode: fixtureMode ? 'fixtures' : 'live',
    configured: {
      accessSecret: Boolean(process.env.ZHIHU_ACCESS_SECRET),
      /**
       * ⚠️ App Key 必须**两个名字都认**，和 `zhihu-oauth.ts` 保持一致。
       * 官方模板用 `ZHIHU_OAUTH_APP_KEY`（为和开放平台 Access Secret 区分），
       * 这里曾经只判 `ZHIHU_APP_KEY` ⇒ 明明配好了却报 `oauth: false`，
       * 把排查方向整个带偏（部署后就是被这个误报骗了一轮）。
       */
      oauth: Boolean(
        process.env.ZHIHU_APP_ID &&
          (process.env.ZHIHU_OAUTH_APP_KEY || process.env.ZHIHU_APP_KEY),
      ),
      oauthRedirect: process.env.ZHIHU_REDIRECT_URI ?? null,
      sessionSecret: Boolean(process.env.SESSION_SECRET),
      llmProvider: process.env.LLM_PROVIDER || 'zhida',
    },
    // 语料构成。演示前先看这里：real=0 说明还没跑过 harvest；
    // synthetic>0 而你在做产品演示，页面上就会出现虚构作者（如「林一舟」）。
    corpus: fixtureMode
      ? { ...fixtureComposition(), source: 'fixture' }
      : { scope: 'live', synthetic: 0, real: 0, total: 0, source: 'zhihu-http' },
    runtime: {
      // serverless 上 process.cwd() 是只读的，这里能看到实际回退到了哪个目录
      dataDir: dir.root,
      dataDirWritable: dir.writable,
      node: process.version,
    },
    quotaUsedToday: await quota.snapshot(),
    time: new Date().toISOString(),
  };

  return ok(body);
}
