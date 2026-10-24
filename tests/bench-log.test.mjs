/**
 * 日志契约测试。
 *
 * 日志是基准的**唯一真相**：动画是它的播放器，追查产物也是它。
 * 所以这里测的不是"能写文件"，而是：
 *   ① 事件形状统一（act / subject / data / t）；
 *   ② `fold()` 折出的状态**自洽**（计数与集合对得上）；
 *   ③ `fold(upto)` 能回到任意时刻（这是"逐步调试"的基础）；
 *   ④ 每个阶段都能取到**产物快照**（这是"探针"的基础）；
 *   ⑤ 坏行不致命、但要如实计数。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LOG_VERSION, PHASES, phaseOf, createWriter, readLog, fold, artifactOf, artifacts, summarize,
} from '../scripts/knowledge_tree_bench/log.mjs';

/** 造一条事件（与 `events.mjs` 的 `makeEvent` 同形）。 */
const ev = (act, subject, data, t) => ({ kind: 'event', act, subject, data, t });

/** 一段最小但完整的运行：2 页 → 3 块 → 2 知识点 → 1 章 2 节 → 润色。 */
function sampleRecords() {
  const raw = [
    { kind: 'meta', what: 'start', section: 'sec-1', title: '测试课', at: '2026-01-01T00:00:00Z' },
    ev('vision', 1, { chars: 100, hasText: true }, 10),
    ev('vision', 2, { chars: 200, hasText: true }, 20),
    ev('mix', 1, { blocks: 2, lines: 5, chars: 100 }, 30),
    ev('mix', 2, { blocks: 1, lines: 3, chars: 200 }, 40),
    ev('mark', 1, { page: 1, role: '主线', facets: ['概念'], summary: '甲', chars: 40 }, 50),
    ev('mark', 2, { page: 1, role: '主线', facets: ['概念'], summary: '乙', chars: 60 }, 60),
    ev('mark', 3, { page: 2, role: '支线', facets: ['教学安排'], summary: '丙', chars: 200 }, 70),
    ev('sieve', 3, { page: 2, why: '支线', summary: '丙' }, 80),
    ev('stash', 1, { page: 1, blocks: 2, pendingTok: 100 }, 90),
    ev('stash', 2, { page: 2, blocks: 1, pendingTok: 200 }, 100),
    ev('merge', 0, { split: false, parts: 0, deep: 0 }, 110),
    ev('merge', 1, { split: true, parts: 2, deep: 0 }, 120),
    ev('regroup', 'n0', { tok: 100, merged: 2, pages: [1], chars: 100, title: '甲' }, 130),
    ev('regroup', 'n1', { tok: 200, merged: 1, pages: [2], chars: 200, title: '乙' }, 140),
    ev('chapter', '第一章', { title: '第一章', chars: 300 }, 150),
    ev('lecture', '甲', { chapter: '第一章', title: '甲', chars: 100, blocks: 2, covered: true }, 160),
    ev('lecture', '乙', { chapter: '第一章', title: '乙', chars: 200, blocks: 1, covered: true }, 170),
    ev('polish', null, { unchanged: true, changes: 0, chars: 300 }, 180),
    { kind: 'meta', what: 'end', ms: 190, status: 'ready' },
  ];
  /* ⚠️ 真实日志的 `seq` 由 `createWriter` 分配。内存里造的数据必须自己补，
   * 否则 `fold(upto)` 的比较（`record.seq > upto`）永远为 false，截断失效。 */
  return raw.map((r, i) => ({ v: LOG_VERSION, seq: i + 1, ...r }));
}

test('① 阶段表覆盖全部 act，且每个 act 只属于一个阶段', () => {
  const seen = new Map();
  for (const phase of PHASES) {
    for (const act of phase.acts) {
      assert.equal(seen.has(act), false, `${act} 出现在多个阶段`);
      seen.set(act, phase.key);
    }
  }
  for (const [act, key] of seen) assert.equal(phaseOf(act)?.key, key);
  assert.equal(phaseOf('不存在的动作'), null, '未知动作应当返回 null，而不是猜');
});

test('② fold 后计数与集合自洽', () => {
  const s = fold(sampleRecords());
  assert.equal(s.section, 'sec-1');
  assert.equal(s.pages.size, 2);
  assert.equal(s.blocks.size, 3);
  assert.equal(s.board.length, 1);
  assert.equal(s.leaves.length, 2);
  assert.equal(s.merges.length, 2);
  assert.equal(s.points.length, 2);
  assert.equal(s.chapters.length, 1);
  assert.equal(s.chapters[0].topics.length, 2);

  // 计数器必须等于对应集合的大小 —— 这是"数字对得上"的判据
  assert.equal(s.counters.vision, s.pages.size);
  assert.equal(s.counters.mix, s.pages.size);
  assert.equal(s.counters.mark, s.blocks.size);
  assert.equal(s.counters.regroup, s.points.length);
  assert.equal(s.counters.lecture, s.chapters[0].topics.length);
});

test('③ 每页的 vision 与 mix 分别挂在自己名下', () => {
  const s = fold(sampleRecords());
  const p1 = s.pages.get(1);
  const p2 = s.pages.get(2);
  assert.equal(p1.vision.chars, 100);
  assert.equal(p1.mix.blocks, 2);
  assert.equal(p2.vision.chars, 200);
  assert.equal(p2.mix.blocks, 1);
});

test('④ fold(upto) 回到任意时刻，且是单调的', () => {
  const records = sampleRecords();
  const full = fold(records);
  const cut = records.find((r) => r.kind === 'event' && r.act === 'mix' && r.subject === 1).seq;
  const mid = fold(records, cut);

  assert.equal(mid.counters.vision, 2, 'vision 已经跑完');
  assert.equal(mid.counters.mix, 1, 'mix 只到第一页');
  assert.equal(mid.blocks.size, 0, '还没开始标记');
  assert.equal(full.counters.mix, 2, '最终两页都 mix 了');
  assert.ok(mid.points.length < full.points.length, '中间时刻知识点更少');
});

test('⑤ 队列深度优先用产品上报的真实值，没有才退回推算', () => {
  /* ★ 契约变更（审查第 11 条）：
   * 早先的契约是"由事件顺序推出，无需产品上报" —— 那是**错的**。
   * `vision 完成数 − mix 完成数` 不是队列长度：它把正在 mix 的算成在队列里，
   * 也可能包含还没入队的识别结果。用它验收容量与背压会得出错误结论。
   *
   * 现在的契约：**产品上报 `queueDepth` 就用它（measured=true）**；
   * 只有没上报时才退回推算，并且标 `measured=false`，让界面能区分实测与估算。
   */
  const withMeasured = fold([
    ev('vision', 1, { chars: 10, hasText: true, queueDepth: 3 }, 10),
    ev('vision', 2, { chars: 10, hasText: true, queueDepth: 5 }, 20),
    ev('mix', 1, { blocks: 2 }, 30),
  ]);
  assert.deepEqual(withMeasured.queue.map((q) => q.depth), [3, 5]);
  assert.ok(withMeasured.queue.every((q) => q.measured === true), '有上报就标为实测');

  /* 没上报时退回推算，并明确标注"不是实测"。 */
  const estimated = fold([
    ev('vision', 1, { chars: 10, hasText: true }, 10),
    ev('vision', 2, { chars: 10, hasText: true }, 20),
    ev('mix', 1, { blocks: 2 }, 30),
  ]);
  assert.equal(estimated.queue.length, 2, '只有 vision 侧产生深度点');
  assert.ok(estimated.queue.every((q) => q.measured === false), '推算必须标为未实测');
});

test('⑥ 每个阶段都能取到产物快照', () => {
  const s = fold(sampleRecords());
  for (const phase of PHASES) {
    const a = artifactOf(s, phase.key);
    assert.ok(a !== null, `${phase.key} 应有产物`);
    assert.ok(JSON.stringify(a).length > 2, `${phase.key} 产物不该是空`);
  }
  // 具体字段抽查
  assert.equal(artifactOf(s, 'vision').pages.length, 2);
  assert.equal(artifactOf(s, 'mark').counts.total, 3);
  assert.equal(artifactOf(s, 'mark').counts.side, 1);
  assert.equal(artifactOf(s, 'regroup').points.length, 2);
  assert.equal(artifactOf(s, 'lecture').chapters.length, 1);
  assert.equal(artifactOf(s, 'polish').polish.unchanged, true);
  assert.equal(artifactOf(s, '不存在的阶段'), null);
});

test('⑦ artifacts() 一次给出全部阶段', () => {
  const all = artifacts(fold(sampleRecords()));
  assert.deepEqual(Object.keys(all).sort(), PHASES.map((p) => p.key).sort());
});

test('⑧ summarize 给概览（不读全量事件也算得出）', () => {
  const sum = summarize(sampleRecords());
  assert.equal(sum.section, 'sec-1');
  assert.equal(sum.ms, 190);
  assert.equal(sum.status, 'ready');
  assert.equal(sum.events, 18);
  /* ⚠️ `perPhase` 是**按阶段**计数，不是按 act。
   * 01「识别」段里既有 vision 也有 mix，所以这里是 2 + 2 = 4。 */
  assert.equal(sum.perPhase.vision, 4, '识别段 = vision 2 + mix 2');
  assert.equal(sum.perPhase.mark, 3);
  assert.equal(sum.perPhase.polish, 1);
  assert.equal(sum.perPhase.regroup, 2);
});

test('⑨ 写入 / 读取往返：seq 递增、坏行如实计数', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bench-log-'));
  const file = path.join(dir, 'run.jsonl');
  try {
    const w = createWriter(file);
    await w.meta({ what: 'start', section: 's1' });
    await Promise.all([
      w.event(ev('vision', 1, { chars: 1 }, 1)),
      w.event(ev('vision', 2, { chars: 2 }, 2)),
      w.event(ev('mix', 1, { blocks: 1 }, 3)),
    ]);
    await w.close();

    const { records, broken, missing, version } = await readLog(file);
    assert.equal(missing, false);
    assert.equal(broken, 0);
    assert.equal(version, LOG_VERSION);
    assert.deepEqual(records.map((r) => r.seq), [1, 2, 3, 4], '并发写也不许乱序');

    // 手工插一行坏数据 → 应当被跳过但计数
    const fs = await import('node:fs/promises');
    await fs.appendFile(file, '{ 这不是 json }\n', 'utf8');
    const again = await readLog(file);
    assert.equal(again.broken, 1, '坏行要如实报出来，不能假装完整');
    assert.equal(again.records.length, 4, '好的记录一条不丢');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('⑩ 读不存在的文件不抛，如实返回 missing', async () => {
  const r = await readLog(path.join(tmpdir(), 'definitely-not-here-bench.jsonl'));
  assert.equal(r.missing, true);
  assert.deepEqual(r.records, []);
});

test('⑪ 空的 data / subject 不会让 fold 崩', () => {
  const s = fold([
    ev('vision', 1, undefined, 0),
    ev('mark', 1, {}, 1),
    ev('polish', null, undefined, 2),
  ]);
  assert.equal(s.pages.size, 1);
  assert.equal(s.blocks.get(1).role, null);
  assert.equal(s.polish.unchanged, false);
});

test('mix实时带标记，编号汇总只替换临时身份，正式组织正文可回放', () => {
  const records = [
    { ...ev('mix', 9, { tags: [{ localIndex: 1, tag: { role: '主线', facets: ['概念'], summary: '定义' } }] }, 10), seq: 1 },
    { ...ev('bind', 12, { page: 9, mixLocalIndex: 1, role: '主线', facets: ['概念'], summary: '定义', deferred: true }, 20), seq: 2 },
    { ...ev('organize', 'p9', { before: '这个东西', after: '电容定义为电荷量与电势差之比。', blockIndexes: [12] }, 30), seq: 3 },
  ];
  assert.equal(fold(records, 1).blocks.get('p9b1').role, '主线');
  const state = fold(records);
  assert.equal(state.blocks.size, 1);
  assert.equal(state.blocks.get(12).summary, '定义');
  assert.equal(artifactOf(state, 'merge').organizations[0].after, '电容定义为电荷量与电势差之比。');
});
