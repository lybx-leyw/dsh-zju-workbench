/**
 * 已跑完的课在版式改进后要**跟着变**，而不是冻在旧外壳里。
 *
 * 真实缺陷（用户报的）：排版从「上面 PPT / 下面讲解」改成「左边 PPT / 右边滚动讲解」，
 * 但已经生成好的课存的是**当时的 HTML**，直接回放就还是旧排版 ——
 * 而用户明确说过「不重跑」。所以读取时必须用 `slides` 数据重新渲染。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesFromHtmlChapters } from '../packages/core/study/src/ai-teaching-generate.js';

const slide = { title: '一页', points: ['短词'], summary: '总结',
  visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>',
  formulas: [{ html: 'P(A) = 1', label: '起点' }], explanation: '画布外的完整讲解。' };

// 旧外壳：上下排版，并且带一个能被识别出来的旧标记。
const OLD_HTML = '<!doctype html><html><body><main>OLD-LAYOUT</main></body></html>';

test('stored chapter with slides is re-rendered with the current two-column shell', () => {
  const pages = pagesFromHtmlChapters([{ chapterId: 'c1', title: '第一章', html: OLD_HTML, slides: [slide] }]);
  assert.equal(pages.length, 1);
  assert.doesNotMatch(pages[0].html, /OLD-LAYOUT/, '不能回放旧外壳');
  assert.match(pages[0].html, /<main class="deck-layout">/, '左右两栏');
  assert.match(pages[0].html, /<aside class="deck-notes"/, '讲解在右侧独立栏');
  assert.match(pages[0].html, /<div class="stage-viewport">/, '幻灯片固定在左栏');
  assert.equal(pages[0].title, '第一章');
});

test('re-render keeps the explanation content, not just the layout', () => {
  const [page] = pagesFromHtmlChapters([{ chapterId: 'c1', title: '第一章', html: OLD_HTML, slides: [slide] }]);
  assert.match(page.html, /画布外的完整讲解/, '讲解正文必须还在');
  assert.match(page.html, /推导提示/, '公式 label 生成的推导提示也还在');
});

test('a chapter without slides falls back to its archived html', () => {
  const pages = pagesFromHtmlChapters([{ chapterId: 'c1', title: '旧章', html: OLD_HTML }]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].html, OLD_HTML, '更早的存档没有 slides，只能回放旧 html —— 至少打得开');
});

test('legacy small diagram labels do not make an old course unopenable', () => {
  // 历史数据里有 22px 的 SVG 标签；生成期的 24px 下限不该阻断渲染。
  const legacy = { ...slide, visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="22">旧标签</text></svg>' };
  const [page] = pagesFromHtmlChapters([{ chapterId: 'c1', title: '旧章', slides: [legacy] }]);
  assert.match(page.html, /旧标签/);
  assert.match(page.html, /font-size="22"/, '原样渲染，不在渲染期改写字号');
});

test('a broken chapter degrades to its archived html instead of throwing', () => {
  const broken = { chapterId: 'c1', title: '坏章', html: OLD_HTML, slides: [{ title: '' }] };
  const pages = pagesFromHtmlChapters([broken]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].html, OLD_HTML, '重渲染失败时退回存档，而不是让整节课打不开');
});

test('chapters with neither slides nor html are dropped, not rendered empty', () => {
  assert.deepEqual(pagesFromHtmlChapters([{ chapterId: 'c1', title: '空' }]), []);
  assert.deepEqual(pagesFromHtmlChapters([]), []);
});
