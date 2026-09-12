import { NextResponse } from 'next/server';
import { dataDirInfo } from '@/framework/datadir';
import { DiskQuotaGuard } from '@/framework/quota';
import { CACHE_DIR } from '@/adapters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 健康检查 + 能力自检。
 * 部署后先打这个接口：能一眼看出是「凭证没配」还是「磁盘不可写」还是「代码有问题」。
 * 只回布尔值与路径，不回任何密钥内容。
 */
export async function GET() {
  const dir = dataDirInfo();
  const quota = new DiskQuotaGuard(CACHE_DIR, {});

  return NextResponse.json({
    ok: true,
    mode: process.env.USE_FIXTURES === '1' ? 'fixtures' : 'live',
    configured: {
      accessSecret: Boolean(process.env.ZHIHU_ACCESS_SECRET),
      oauth: Boolean(process.env.ZHIHU_APP_ID && process.env.ZHIHU_APP_KEY),
      oauthRedirect: process.env.ZHIHU_REDIRECT_URI ?? null,
      sessionSecret: Boolean(process.env.SESSION_SECRET),
      llmProvider: process.env.LLM_PROVIDER || 'zhida',
    },
    runtime: {
      // serverless 上 process.cwd() 是只读的，这里能看到实际回退到了哪个目录
      dataDir: dir.root,
      dataDirWritable: dir.writable,
      node: process.version,
    },
    quotaUsedToday: await quota.snapshot(),
    time: new Date().toISOString(),
  });
}
