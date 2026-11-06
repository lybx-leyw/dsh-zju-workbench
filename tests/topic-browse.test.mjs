/**
 * 知识点自由浏览的测试。
 *
 * 失败形态：
 *   1. 用户翻到第三章，下一帧 timeupdate 就把他拽回第一章
 *   2. 翻回当前知识点后，还挂着一个"回到当前"按钮
 *   3. 当前知识点在一章的第 30 个，列表只显示前 12 个 → 用户看不到自己在哪
 *   4. 章序号缺失时崩溃（讲义可能没有 `no`）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSE_DEFAULTS, groupByChapter, chapterOfIndex, resolveBrowse, stepChapter,
} from '../packages/dsh-zhiyun-page-study/src/topic-browse.js';

const SEC = 1000;
const MIN = 60 * SEC;

/** 造区间；带上章号与标题。 */
const range = (fromMin, toMin, title, chapterNo, chapterTitle) => ({
  fromMs: fromMin * MIN,
  toMs: toMin * MIN,
  title,
  chapterNo,
  chapterTitle,
});

/** 三章，每章 3 个知识点，各 10 分钟。 */
const RANGES = [
  range(0, 10, '甲', 1, '第一章'),
  range(10, 20, '乙', 1, '第一章'),
  range(20, 30, '丙', 1, '第一章'),
  range(30, 40, '丁', 2, '第二章'),
  range(40, 50, '戊', 2, '第二章'),
  range(50, 60, '己', 2, '第二章'),
  range(60, 70, '庚', 3, '第三章'),
  range(70, 80, '辛', 3, '第三章'),
  range(80, 90, '壬', 3, '第三章'),
];

// ── groupByChapter ───────────────────────────────────────

test('按章分组，保持章序号顺序', () => {
  const chapters = groupByChapter(RANGES);
  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((c) => c.chapterNo), [1, 2, 3]);
  assert.equal(chapters[0].items.length, 3);
  assert.deepEqual(chapters[1].items.map((i) => i.title), ['丁', '戊', '己']);
});

test('没有 chapterNo 时按出现顺序补号', () => {
  const chapters = groupByChapter([
    { fromMs: 0, toMs: 1000, title: 'a' },
    { fromMs: 1000, toMs: 2000, title: 'b' },
  ]);
  assert.equal(chapters.length, 1, '都没章号 → 归到同一章');
  assert.equal(chapters[0].chapterNo, 1);
});

test('坏输入返回空数组', () => {
  assert.deepEqual(groupByChapter([]), []);
  assert.deepEqual(groupByChapter(null), []);
  assert.deepEqual(groupByChapter([null]), []);
});

// ── chapterOfIndex ───────────────────────────────────────

test('下标能反查所在章', () => {
  const chapters = groupByChapter(RANGES);
  assert.equal(chapterOfIndex(chapters, 0), 1);
  assert.equal(chapterOfIndex(chapters, 4), 2);
  assert.equal(chapterOfIndex(chapters, 8), 3);
  assert.equal(chapterOfIndex(chapters, 99), null);
  assert.equal(chapterOfIndex(null, 0), null);
});

// ── resolveBrowse：跟随态 ────────────────────────────────

test('默认跟随：显示视频当前所在的章', () => {
  const state = resolveBrowse(RANGES, 35 * MIN, null);
  assert.equal(state.activeChapterNo, 2, '第 35 分钟在第二章');
  assert.equal(state.following, true);
  assert.deepEqual(state.items.map((i) => i.title), ['丁', '戊', '己']);
});

test('跟随态下当前知识点总在可见窗口里', () => {
  // 造一章 30 个知识点
  const many = Array.from({ length: 30 }, (_, i) => ({
    fromMs: i * 10 * MIN, toMs: (i + 1) * 10 * MIN, title: `知识点${i}`, chapterNo: 1, chapterTitle: '第一章',
  }));
  // 视频在第 25 个里
  const state = resolveBrowse(many, 25 * 10 * MIN + MIN, null);
  const visible = state.items.map((i) => i.title);
  assert.ok(visible.includes('知识点25'), `当前知识点不在可见窗口：${visible.join(',')}`);
  assert.equal(state.items.length, BROWSE_DEFAULTS.pageSize);
  assert.ok(state.hidden > 0, '应报告折叠了多少');
});

// ── resolveBrowse：浏览态 ────────────────────────────────

test('坑 1：用户选了别的章 → 不被视频拽回', () => {
  // 视频在第一章（5 分钟），用户翻到第三章
  const state = resolveBrowse(RANGES, 5 * MIN, 3);
  assert.equal(state.activeChapterNo, 3, '必须停在用户选的章');
  assert.equal(state.following, false, '不在跟随态，UI 要显示「回到当前」');
  assert.deepEqual(state.items.map((i) => i.title), ['庚', '辛', '壬']);
});

test('坑 2：用户翻回当前章 → 自动恢复跟随', () => {
  // 视频在第二章，用户选的也是第二章
  const state = resolveBrowse(RANGES, 35 * MIN, 2);
  assert.equal(state.following, true, '翻回来就恢复跟随，不该还挂着按钮');
  assert.equal(state.activeChapterNo, 2);
});

test('浏览态无效章号时退回跟随（不崩）', () => {
  const state = resolveBrowse(RANGES, 5 * MIN, 999);
  assert.equal(state.following, true);
  assert.equal(state.activeChapterNo, 1);
});

// ── stepChapter ──────────────────────────────────────────

test('切到相邻章', () => {
  const chapters = groupByChapter(RANGES);
  assert.equal(stepChapter(chapters, 1, 1), 2);
  assert.equal(stepChapter(chapters, 2, -1), 1);
});

test('头尾不能越界（返回 null 供按钮禁用）', () => {
  const chapters = groupByChapter(RANGES);
  assert.equal(stepChapter(chapters, 1, -1), null);
  assert.equal(stepChapter(chapters, 3, 1), null);
  assert.equal(stepChapter([], 1, 1), null);
  assert.equal(stepChapter(chapters, 999, 1), null, '当前章不存在也返回 null');
});

// ── 退化 ─────────────────────────────────────────────────

test('没有知识点时返回空态，不崩', () => {
  const state = resolveBrowse([], 0, null);
  assert.deepEqual(state.items, []);
  assert.equal(state.activeChapterNo, null);
  assert.equal(state.chapters.length, 0);
});

test('坏时间不影响结构（退回第一章）', () => {
  const state = resolveBrowse(RANGES, Number.NaN, null);
  assert.equal(state.chapters.length, 3);
  assert.equal(state.activeChapterNo, 1);
});

test('默认一页 12 个', () => {
  assert.equal(BROWSE_DEFAULTS.pageSize, 12);
});

test('章节切换与「回到当前」是两个独立状态（互不覆盖）', () => {
  // 用户在第三章浏览，同时视频还在第一章 —— following 为假，
  // 但 activeChapterNo 仍是 3（切章不会把 following 变回真）
  const browsing = resolveBrowse(RANGES, 5 * MIN, 3);
  assert.equal(browsing.activeChapterNo, 3);
  assert.equal(browsing.following, false);
  // 点「回到当前」就是传 null
  const back = resolveBrowse(RANGES, 5 * MIN, null);
  assert.equal(back.activeChapterNo, 1);
  assert.equal(back.following, true);
});
