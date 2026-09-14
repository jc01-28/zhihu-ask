#!/usr/bin/env node
/**
 * 生成 Golden Dataset 的 fixture 与标注文件。
 *
 * 用法：
 *   node scripts/gold/build.mjs
 *
 * 产出：
 *   src/back/fixtures/gold-hits.json   ← 检索用语料（hits，**不含 _gold**）
 *   scripts/gold/labels.json           ← ground truth 标注（评测脚本读它）
 *
 * 为什么分两个文件：`_gold` 绝不能进入检索语料 ——
 * 一旦搜索引擎能看到「谁是亲历者」，这个实验就变成了作弊。
 * 物理隔离是唯一可靠的做法。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateCorpus, TOPIC_TERMS } from './corpus.mjs';

const ROOT = process.cwd();
const HITS_OUT = path.join(ROOT, 'src/back/fixtures/gold-hits.json');
const LABELS_OUT = path.join(ROOT, 'scripts/gold/labels.json');

const DOC_COUNT = Number(process.env.GOLD_DOCS || 168);

async function main() {
  const docs = generateCorpus(DOC_COUNT);

  // 语料：剥离 _gold
  const hits = docs.map(({ _gold, ...hit }) => ({
    ...hit,
    // 注意：这里不能写 rankingScore 之外的 score —— 检索器自己会算
  }));

  // 标注：docId → ground truth
  //
  // ⚠️ 关键设计：作者级标注必须是 **topic 维度**的。
  // 一位作者写了 5 篇内容，其中 1 篇是关于「期权」的亲历、其余是别的主题的评论 ——
  // 那么他对「期权怎么估值」是有效人选，但对「IC 转管理」不是。
  // 如果只标「这个人有没有亲历过任何事」，那几乎所有作者都会被标成有效，
  // 指标就失去区分度了（我们第一版就踩了这个坑）。
  const authors = {};
  for (const d of docs) {
    const a = (authors[d.authorName] ??= {
      docCount: 0,
      /** 该作者在哪些主题上有第一人称亲历 → 只有这些主题上他才是有效人选 */
      firstPersonTopics: new Set(),
      /** 该作者在哪些主题上写过内容（含非亲历），用于分析「写了但没做过」 */
      writtenTopics: new Set(),
    });
    a.docCount += 1;
    a.writtenTopics.add(d._gold.topic);
    if (d._gold.firstPerson) a.firstPersonTopics.add(d._gold.topic);
  }
  for (const [, a] of Object.entries(authors)) {
    a.firstPersonTopics = [...a.firstPersonTopics];
    a.writtenTopics = [...a.writtenTopics];
  }

  const labels = {
    generatedAt: new Date().toISOString(),
    docCount: docs.length,
    note:
      '合成语料。firstPerson=true 表示作者第一人称讲述自己的决策经历，' +
      '即「有效人选」的客观定义。此文件仅供评测，绝不参与检索。' +
      '作者级判定按 topic 维度：只有在该主题上写过第一人称亲历的作者才算有效人选。',
    topicTerms: TOPIC_TERMS,
    docs: Object.fromEntries(
      docs.map((d) => [d.contentId, { ...d._gold, authorName: d.authorName }]),
    ),
    authors,
  };

  await mkdir(path.dirname(HITS_OUT), { recursive: true });
  await writeFile(HITS_OUT, JSON.stringify({ hits }, null, 2), 'utf8');
  await writeFile(LABELS_OUT, JSON.stringify(labels, null, 2), 'utf8');

  const fp = docs.filter((d) => d._gold.firstPerson).length;
  const byNoise = docs
    .filter((d) => !d._gold.firstPerson)
    .reduce((acc, d) => {
      const k = d._gold.noise ?? 'other';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

  // 主题维度的有效人选池：这是分母/分子的基础
  const poolByTopic = {};
  for (const [name, a] of Object.entries(labels.authors)) {
    for (const t of a.firstPersonTopics) {
      (poolByTopic[t] ??= []).push(name);
    }
  }

  console.log(`语料：${docs.length} 条`);
  console.log(`  第一人称亲历：${fp} 条（${((fp / docs.length) * 100).toFixed(0)}%）  ← 有效人选`);
  console.log(`  噪声：${docs.length - fp} 条  ${JSON.stringify(byNoise)}`);
  console.log(`  作者：${Object.keys(labels.authors).length} 位`);
  console.log('');
  console.log('各主题的有效人选池（亲历型作者数）：');
  for (const [topic, names] of Object.entries(poolByTopic)) {
    console.log(`  ${topic.padEnd(20)} ${names.length} 位`);
  }
  console.log('');
  console.log(`输出：${HITS_OUT}`);
  console.log(`输出：${LABELS_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
