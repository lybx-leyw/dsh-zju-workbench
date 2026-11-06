/**
 * 在**真实课程的原始材料**上跑知识树测评。
 *
 * # 数据是什么
 *
 * `data/<course>-<section>/` 下是智云课堂的**原始材料**（`fetch-raw.mjs` 拉的）：
 *   · `0001-<hash>.jpg` … 课件原图（1280×720，老师的 PPT 本体）
 *   · `subtitles.json`    逐句字幕（原始时间轴 + 文本）
 *   · `pages.json`        页码 ↔ 文件 ↔ 时间锚点
 *
 * **不是** vision 转述稿。这一点很重要：转述稿是"模型对原稿的解读"，
 * 拿它当基准输入，测的是"复现上一次模型的解读"，而不是"这条链在原始材料上的表现"。
 *
 * # 测什么（分两层，不混）
 *
 * **结构层（本文件，不需要模型）**：从字幕 + 页序排布出块，走
 * 筛支线 → 挂账 → 审查 → 合并 → 拆叶 → 重聚，度量树形与 token 分布。
 * 这一层完全可复现，是**参数调优的依据**（斩杀线扫描就在这里）。
 *
 * **视觉层（需要模型）**：图片 → vision → 块。那一步不在这里跑（不可复现），
 * 靠真正跑一次解析得到，不在基准的结构层里冒充。
 *
 * 用法：
 *
 *     node scripts/knowledge_tree_bench/measure.mjs
 *     node scripts/knowledge_tree_bench/measure.mjs --split 600,900,1200,1800
 *     node scripts/knowledge_tree_bench/measure.mjs --json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { setRoot } from './_base.mjs';
import { treeFunctions, tokenizeFunctions } from './parser.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
setRoot(ROOT + path.sep);
const DATA = path.join(HERE, 'data');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/**
 * 把一节的**原始材料**排成「候选块」。
 *
 * 复现产品的分页逻辑：每页有一个时间锚点（`createdSec`），字幕按时间落进
 * 它所属的那一页窗口（与解析器的 `anchor()` 同口径：从本页锚点开始、
 * 到下一页锚点为止）。
 *
 * ⚠️ 这里**不猜块边界**。真实块边界是 mix 阶段由模型按语义切的；基准若自己
 * 切一遍，就测不出产品形状。所以结构层用「一页一块」这个**下界粒度**，
 * 并在报告里标明 `grain: 'page'` —— 它度量的是"页级材料上建树会怎样"，
 * 而不是"产品的块级形状"。
 */
export function pagesToBlocks(pagesDoc, subtitles) {
  const pages = [...(pagesDoc.pages ?? [])].sort((a, b) => a.page - b.page);
  const anchors = pages.map((p) => (p.createdSec > 0 ? p.createdSec * 1000 : null));
  const ordered = [...subtitles].sort((a, b) => a.startMs - b.startMs);
  const buckets = pages.map(() => []);

  // 时间窗：本页锚点 → 下一个有效锚点（与 `anchor()` 同口径）
  const starts = [], ends = [];
  for (let i = 0; i < pages.length; i++) {
    starts[i] = anchors.slice(0, i + 1).findLast((a) => a !== null) ?? null;
    ends[i] = anchors.slice(i + 1).find((a) => a !== null) ?? null;
  }
  let cursor = 0;
  for (let i = 0; i < pages.length; i++) {
    while (cursor < ordered.length) {
      const line = ordered[cursor];
      if (line.startMs < (starts[i] ?? -1)) { buckets[i].push(line); cursor++; continue; }
      if (ends[i] !== null && line.startMs >= ends[i]) break;
      buckets[i].push(line); cursor++;
    }
  }
  const unassigned = ordered.slice(cursor);

  const blocks = [];
  let index = 0;
  for (let i = 0; i < pages.length; i++) {
    const lines = buckets[i];
    if (!lines.length) continue;
    index += 1;
    blocks.push({
      index,
      page: pages[i].page,
      // 块正文 = 这一页窗口里的字幕。这是**原始材料**，未经任何模型处理。
      text: lines.map((l) => l.text).join(''),
      tag: { role: '主线', facets: ['概念'], summary: null },
      startMs: starts[i] ?? 0,
    });
  }
  return { blocks, unassigned, pages: pages.length, anchored: anchors.filter((a) => a !== null).length };
}

/** 对一棵跑完的树算形状指标。 */
export function shapeOf(api, built) {
  const leaves = built.leaves ?? [];
  const trees = leaves.filter((l) => (l.children ?? []).some((c) => c.kind === 'leaf'));
  const depths = trees.map((t) => api.leafTreeDepth(t));
  const points = built.knowledgePoints ?? [];
  return {
    blocks: built.stats?.main ?? 0,
    board: built.board?.length ?? 0,
    knowledgePoints: points.length,
    flatSegments: built.flat?.length ?? 0,
    leafTrees: trees.length,
    maxDepth: depths.length ? Math.max(...depths) : 0,
    avgDepth: depths.length ? +(depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(2) : 0,
    emptyPoints: points.filter((p) => !(p.blocks ?? []).length).length,
    totalTokens: points.reduce((a, p) => a + (p.tok ?? 0), 0),
    maxPointTokens: points.length ? Math.max(...points.map((p) => p.tok ?? 0)) : 0,
  };
}

export async function loadSections() {
  const manifest = JSON.parse(await fs.readFile(path.join(DATA, 'manifest.json'), 'utf8'));
  const out = [];
  for (const entry of manifest.sections) {
    const dir = path.join(DATA, entry.key);
    const [pagesDoc, subtitles] = await Promise.all([
      fs.readFile(path.join(dir, 'pages.json'), 'utf8').then(JSON.parse),
      fs.readFile(path.join(dir, 'subtitles.json'), 'utf8').then(JSON.parse),
    ]);
    // 图片清单：结构层不用，但报告里要如实说"原稿在不在"
    const images = (await fs.readdir(dir)).filter((n) => /\.jpg$/i.test(n));
    out.push({ key: entry.key, title: entry.title, pagesDoc, subtitles, images });
  }
  return out;
}

async function main() {
  const api = { ...(await treeFunctions()), ...(await tokenizeFunctions()) };
  const splitList = String(arg('split', '600,900,1200,1800,2400')).split(',').map(Number).filter(Number.isFinite);
  const json = process.argv.includes('--json');

  const sections = await loadSections().catch((error) => {
    console.error('读不到 data/ 里的原始材料。先拉一次：node scripts/knowledge_tree_bench/fetch-raw.mjs');
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
    return null;
  });
  if (!sections) return;

  const report = {
    grain: 'page',
    note: '块正文 = 按页窗口聚合的字幕（原始材料）。块边界是页，不是产品 mix 阶段的语义块。',
    defaults: { splitLine: api.kDefaultSplitLine },
    sections: [], sweep: [], skipped: [],
  };

  for (const { key, title, pagesDoc, subtitles, images } of sections) {
    const { blocks, unassigned, pages, anchored } = pagesToBlocks(pagesDoc, subtitles);

    // ── 数据体检：没有字幕的节**明确跳过**，而不是算成"0 知识点" ──────
    if (!blocks.length) {
      report.skipped.push({ key, title, reason: '没有可用字幕', images: images.length });
      if (!json) console.log(`\n── ${key}  ${title ?? ''}\n   ⊘ 跳过：没有可用字幕`);
      continue;
    }

    const tokens = api.tokensOfAll(blocks.map((b) => b.text));
    const built = api.buildTreeFromBlocks(blocks, { splitLine: api.kDefaultSplitLine });
    const shape = shapeOf(api, built);
    const row = {
      key, title, pages, anchored, images: images.length,
      subtitles: subtitles.length,
      unassigned: unassigned.length,
      blocks: blocks.length,
      tokens,
      ...shape,
      tokensPerPoint: shape.knowledgePoints ? Math.round(shape.totalTokens / shape.knowledgePoints) : 0,
      overLinePoints: built.knowledgePoints.filter((p) => (p.tok ?? 0) > api.kDefaultSplitLine).length,
    };
    report.sections.push(row);
    if (!json) {
      console.log(`\n── ${key}  ${title ?? ''}`);
      console.log(`   ${images.length} 张原稿 · ${pages} 页（${anchored} 有时间锚点）/ ${subtitles.length} 句 → ${blocks.length} 块 / ${api.formatTokens(tokens)} token`
        + (unassigned.length ? `  ⚠ ${unassigned.length} 句未落页` : ''));
      console.log(`   知识点 ${row.knowledgePoints} · 摊平段 ${row.flatSegments} · 叶树 ${row.leafTrees}（最深 ${row.maxDepth} 层，均 ${row.avgDepth}）`);
      console.log(`   每知识点 ${api.formatTokens(row.tokensPerPoint)} token · 最大 ${api.formatTokens(row.maxPointTokens)} · 超线 ${row.overLinePoints} · 空点 ${row.emptyPoints}`);
    }
  }

  // ── 斩杀线扫描：同一批材料，看树形怎么变 ──────────────────────────
  if (!json) console.log(`\n── 斩杀线扫描（知识点数 / 叶树 / 最深层 / 超线）`);
  for (const splitLine of splitList) {
    let points = 0, trees = 0, depth = 0, over = 0;
    for (const { pagesDoc, subtitles } of sections) {
      const { blocks } = pagesToBlocks(pagesDoc, subtitles);
      if (!blocks.length) continue;
      const built = api.buildTreeFromBlocks(blocks, { splitLine });
      const shape = shapeOf(api, built);
      points += shape.knowledgePoints;
      trees += shape.leafTrees;
      depth = Math.max(depth, shape.maxDepth);
      over += built.knowledgePoints.filter((p) => (p.tok ?? 0) > splitLine).length;
    }
    report.sweep.push({ splitLine, knowledgePoints: points, leafTrees: trees, maxDepth: depth, overLinePoints: over });
    if (!json) console.log(`   ${String(splitLine).padStart(5)}  →  知识点 ${String(points).padStart(3)} · 叶树 ${String(trees).padStart(3)} · 最深 ${depth} 层 · 超线 ${over}`);
  }

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 1));
  } else {
    const sum = report.sections.reduce((a, s) => ({
      pages: a.pages + s.pages, subtitles: a.subtitles + s.subtitles, tokens: a.tokens + s.tokens,
      knowledgePoints: a.knowledgePoints + s.knowledgePoints,
    }), { pages: 0, subtitles: 0, tokens: 0, knowledgePoints: 0 });
    console.log(`\n合计：${report.sections.length} 节 · ${sum.pages} 页 · ${sum.subtitles} 句 · `
      + `${api.formatTokens(sum.tokens)} token · ${sum.knowledgePoints} 知识点`);
  }
}

// 只在**被直接运行**时执行 main：被 import（例如诊断脚本或测试）时不该跑全量测评，
// 否则 import 一个模块的副作用是"跑一遍基准"，非常难查。
// 判据用 argv[1] 与自身路径比较（Windows 上大小写与分隔符都不稳定，统一规范化）。
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  return norm(entry) === norm(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
})();

if (invokedDirectly) {
  main().catch((error) => {
    console.error(String(error?.stack ?? error));
    process.exitCode = 1;
  });
}
