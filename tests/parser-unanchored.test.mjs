/**
 * 「没有课件对照的段落」的契约测试。
 *
 * 一句话：**分块是产品的职责，不是调用方的**。
 *
 * 真课里有「前面几页 PPT、后面讲两小时不看屏」的课型（数据集里 87882 就是：
 * 8 页 PPT 之后还有 144 分钟、占 99% 的内容）。这些字幕：
 *   · 不走vision；必须走无图mix，保留仅转录依据；
 *   · 但**必须造块**，否则后半堂课在树与讲义里彻底消失；
 *   · 旧展示切片工具仍保留字符守恒；新解析窗口不得拆开字幕身份，
 *     不能由每个调用方自己再实现一遍 —— 那样两边口径必然对不上。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { splitUnanchored } from '../packages/dsh-zhiyun-core-parser/src/parser.js';
import { tokensOf } from '../packages/dsh-zhiyun-core-parser/src/tokenize.js';
import { anchor } from '../packages/dsh-zhiyun-core-parser/src/core.js';

/** 造一句 n 字的字幕。 */
const line = (i, chars = 100, gapMs = 1000) => ({
  startMs: i * gapMs, endMs: i * gapMs + gapMs - 200, text: '字'.repeat(chars),
});

test('① 按斩杀线切：每块不超线，内容逐字守恒', () => {
  const lines = Array.from({ length: 40 }, (_, i) => line(i));
  const pieces = splitUnanchored(lines, { splitLine: 500 });

  assert.ok(pieces.length > 1, `应当切成多块，实际 ${pieces.length}`);
  for (const piece of pieces) {
    const tok = piece.sentences.reduce((a, s) => a + tokensOf(s.text), 0);
    assert.ok(tok <= 500, `每块不该超线，实际 ${tok}`);
  }
  // 守恒：拼回去与输入逐字相同
  const joined = pieces.flatMap((p) => p.sentences.map((s) => s.text)).join('');
  assert.equal(joined, lines.map((l) => l.text).join(''), '切分不增删任何字符');
});

test('② 按停顿断段：长停顿处切开（那是老师换话题的信号）', () => {
  // 前 3 句连续，第 4 句之前停 8 秒，再 3 句
  const lines = [
    line(0, 40), line(1, 40), line(2, 40),
    { startMs: 60000, endMs: 61000, text: '字'.repeat(40) },
    { startMs: 61000, endMs: 62000, text: '字'.repeat(40) },
    { startMs: 62000, endMs: 63000, text: '字'.repeat(40) },
  ];
  // 斩杀线开得很大，逼着只能靠"停顿"来断段
  const pieces = splitUnanchored(lines, { splitLine: 10000, gapMs: 3000 });
  assert.equal(pieces.length, 2, `停顿处应断成 2 段，实际 ${pieces.length}`);
  assert.equal(pieces[0].sentences.length, 3);
  assert.equal(pieces[1].sentences.length, 3);
});

test('③ 超长单句：在句末硬切，且不丢字', () => {
  const sentence = '随机试验的结果事先不能确定。'.repeat(40);   // 很长，含句末标点
  const lines = [{ startMs: 0, endMs: 60000, text: sentence }];
  const pieces = splitUnanchored(lines, { splitLine: 300 });

  assert.ok(pieces.length > 1, `超长单句应被切开，实际 ${pieces.length} 块`);
  for (const piece of pieces) {
    const tok = piece.sentences.reduce((a, s) => a + tokensOf(s.text), 0);
    assert.ok(tok <= 300, `切开后每块不该超线，实际 ${tok}`);
  }
  const joined = pieces.flatMap((p) => p.sentences.map((s) => s.text)).join('');
  assert.equal(joined, sentence, '硬切不增删任何字符');
});

test('④ 空输入返回空（不抛）', () => {
  assert.deepEqual(splitUnanchored([]), []);
});

test('⑤ anchor 封顶：最后一页之后的字幕进 unassigned，且句子不丢', () => {
  // 3 页 PPT（0/10/20 秒），然后讲课到 40 分钟
  const slides = [{ page: 1, createdSec: 0 }, { page: 2, createdSec: 10 }, { page: 3, createdSec: 20 }];
  const subtitles = [];
  for (let i = 0; i < 200; i += 1) {
    subtitles.push({ startMs: i * 12000, endMs: i * 12000 + 8000, text: `第${i}句` });
  }
  const a = anchor(slides, subtitles, { maxWindowMs: 10 * 60 * 1000 });

  const inWindows = a.windows.reduce((x, w) => x + w.lines.length, 0);
  assert.equal(inWindows + a.unassigned.length, subtitles.length, '句子不丢');
  assert.ok(a.unassigned.length > 0, '最后一页之后应当有未落页字幕');

  // 关掉上限 → 全部被最后一页吞掉（对照组：证明这个上限确实在起作用）
  const b = anchor(slides, subtitles, { maxWindowMs: 0 });
  assert.equal(b.unassigned.length, 0, '关掉上限时不该有未落页（说明上限是唯一原因）');
});
