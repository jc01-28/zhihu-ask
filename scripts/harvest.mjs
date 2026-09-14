#!/usr/bin/env node
/**
 * 离线预热（harvest）
 *
 * 黑客松架构的核心心法：**把不确定性推到离线，在线只留确定性**。
 *   - 离线：用一批种子问题把内容抓下来，落成 fixture。
 *   - 在线：只做检索/重排/校验/解释，几乎不依赖实时网络。
 * 这样现场演示不会因为网络抖动、额度耗尽、接口临停而失败。
 *
 * 用法：
 *   node --env-file=.env.local scripts/harvest.mjs
 *   node --env-file=.env.local scripts/harvest.mjs "自定义查询1" "自定义查询2"
 *
 * 输出：src/back/fixtures/harvested-hits.json
 * 之后把 FixtureSource 指到它即可离线跑（见 README「预热与离线演示」）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.ZHIHU_API_BASE || 'https://developer.zhihu.com').replace(/\/$/, '');
const SECRET = process.env.ZHIHU_ACCESS_SECRET;
const OUT = path.resolve(process.cwd(), 'src/back/fixtures/harvested-hits.json');

/**
 * 默认种子查询。分成两组是刻意的 —— 它们服务两个不同功能，但**落在同一份语料**里：
 *
 *   组一「职业抉择」：供「问题找人」的 8 步链路做召回（产品主场景）
 *   组二「专业领域」：供「领域星图」把真实创作者挂到议题上
 *
 * 合成一份而不是两份的理由：同一个人应该**既能**在找人里被推荐、**也能**在星图里被看到，
 * 否则产品看起来就是两套互不相干的东西，而且「证据驱动」这个内核会只剩一半。
 */
const DEFAULT_SEEDS = [
  // ── 组一：职业抉择（问题找人 · 8 步链路的语料）──────────────────────
  '大厂 降薪 去创业公司 该不该',
  '大厂 晋升放缓 离职 能力曲线',
  '创业公司 期权 降薪 怎么算',
  'IC 转管理 第一年 踩坑',
  '技术管理 带团队 该不该接',
  '传统产品转 AI 产品 转型路径',
  '35岁 转岗 AI产品 非科班',
  '应届生 大厂 还是 创业公司',

  // ── 组二：专业领域（领域星图 · 覆盖 7 个推荐领域）──────────────────
  //   Agent 开发
  'Agent 开发 实践 踩坑',
  //   人工智能应用
  '大模型应用 落地 经验',
  'AI 产品 工程化 上线',
  //   金融科技
  '金融科技 从业 经历',
  '量化 风控 实践 经验',
  //   数据建模
  '数据建模 指标体系 设计',
  //   产品与创业
  '创业 从0到1 做产品 经历',
  //   独立开发
  '独立开发 副业 收入',
  //   科研与工程实践
  '科研 转 工程 论文复现',
  '机器学习工程 特征工程 经验',
];

function requireSecret() {
  if (!SECRET) {
    console.error('缺少 ZHIHU_ACCESS_SECRET。');
    console.error('1) 打开 https://developer.zhihu.com/profile 生成 Access Secret');
    console.error('2) 写入 .env.local 的 ZHIHU_ACCESS_SECRET');
    console.error('3) 重新执行：node --env-file=.env.local scripts/harvest.mjs');
    process.exit(1);
  }
}

async function searchZhihu(query, count = 10) {
  const url = new URL(`${BASE}/api/v1/content/zhihu_search`);
  url.searchParams.set('Query', query);
  url.searchParams.set('Count', String(Math.min(count, 10)));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);

  const body = JSON.parse(text);
  if (body.Code !== 0) throw new Error(`Code=${body.Code} ${body.Message ?? ''}`);
  return body.Data?.Items ?? [];
}

function mapItem(item) {
  return {
    title: item.Title ?? '',
    contentType: item.ContentType ?? '',
    contentId: item.ContentID == null ? '' : String(item.ContentID),
    contentText: item.ContentText ?? '',
    url: item.Url ?? '',
    commentCount: item.CommentCount ?? 0,
    voteUpCount: item.VoteUpCount ?? 0,
    authorName: item.AuthorName ?? '',
    authorAvatar: item.AuthorAvatar ?? '',
    authorBadgeText: item.AuthorBadgeText ?? '',
    editTime: item.EditTime ?? 0,
    comments: (item.CommentInfoList ?? []).map((c) => c.Content ?? '').filter(Boolean),
    authorityLevel: Number(item.AuthorityLevel ?? 1) || 1,
    rankingScore: item.RankingScore ?? 0,
  };
}

async function main() {
  requireSecret();

  const seeds = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SEEDS;
  const byId = new Map();
  const failed = [];

  for (const [index, query] of seeds.entries()) {
    try {
      const items = await searchZhihu(query);
      let added = 0;
      for (const raw of items) {
        const hit = mapItem(raw);
        const key = hit.contentId || hit.url;
        if (key && !byId.has(key)) {
          byId.set(key, { ...hit, seedQuery: query });
          added += 1;
        }
      }
      console.log(`[${index + 1}/${seeds.length}] ${query} → ${items.length} 条，新增 ${added} 条`);
    } catch (error) {
      failed.push({ query, error: String(error.message ?? error) });
      console.warn(`[${index + 1}/${seeds.length}] ${query} 失败：${error.message ?? error}`);
    }
    // 温和限速，避免撞频率限制
    await new Promise((r) => setTimeout(r, 400));
  }

  const hits = [...byId.values()];
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({ harvestedAt: new Date().toISOString(), seeds, failed, hits }, null, 2),
    'utf8',
  );

  const withBody = hits.filter((h) => (h.contentText ?? '').length > 200).length;
  console.log('');
  console.log(`完成：共 ${hits.length} 条内容，其中 ${withBody} 条正文长度 > 200 字`);
  console.log(`输出：${OUT}`);
  if (failed.length) console.log(`失败 ${failed.length} 条种子查询，详见输出文件的 failed 字段`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
