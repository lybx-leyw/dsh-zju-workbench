// 真实浏览器检查「左 PPT + 右滚动讲解」版式（不调模型）。
// 用已生成课件的 slides 数据重新渲染，验证：
//   - 桌面端：幻灯片与讲解左右并排、同一屏可见、整页不滚动、讲解独立滚动
//   - 幻灯片在任意窗口尺寸下完整可见、不被裁切
//   - 手机端：自动堆叠（幻灯片在上、讲解在下），幻灯片仍完整
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { renderSlideChapter } from '../packages/core/classroom-generate/src/html-slide-shell.js';

const saved = JSON.parse(await readFile(new URL('../artifacts/html-slides-real/chapter-1-checkpoint.json', import.meta.url), 'utf8'));
// strictFontSize: false —— 这是**已生成**的历史数据，不能拿今天的生成期字号下限去卡它。
const html = renderSlideChapter({ title: '概率的加法公式', topic: '概率论与数理统计', slides: saved.slides, strictFontSize: false });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  for (const viewport of [{ width: 1600, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 700 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('about:blank');
    await page.setContent(html);
    await page.waitForFunction(() => !!window.htmlDeck);

    const probe = await page.evaluate(() => {
      const rect = sel => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
      const stage = rect('.stage-viewport');
      const slide = rect('.slide:not([hidden])');
      const notes = rect('.deck-notes');
      return {
        stageWidth: Math.round(stage.width), stageHeight: Math.round(stage.height),
        slideWidth: Math.round(slide.width), slideHeight: Math.round(slide.height),
        sideBySide: notes.left >= stage.right - 2,
        slideFits: slide.width <= stage.width + 2 && slide.height <= stage.height + 2,
        notesWithinViewport: notes.bottom <= innerHeight + 2,
        stageWithinViewport: stage.bottom <= innerHeight + 2,
        stageVisible: stage.height >= 120,
        pageScrollsVertically: document.documentElement.scrollHeight > innerHeight + 2,
        notesScrolls: (() => { const n = document.querySelector('.deck-notes'); return n.scrollHeight > n.clientHeight + 2; })(),
        ratio: Math.round((slide.width / slide.height) * 1000) / 1000,
      };
    });

    // 翻页：右侧讲解要换成下一页，滚动归零。
    await page.evaluate(() => { document.querySelector('.deck-notes').scrollTop = 400; window.htmlDeck.goTo(1); });
    const afterNav = await page.evaluate(() => {
      const notes = [...document.querySelectorAll('.explanation-panel')];
      const visible = notes.filter(n => !n.hidden);
      return { visibleNotes: visible.length, scrollTop: document.querySelector('.deck-notes').scrollTop,
        heading: visible[0]?.querySelector('h3')?.textContent ?? null };
    });

    const desktop = viewport.width >= 900;
    const ok = probe.slideFits && probe.stageVisible && !errors.length
      && (desktop
        ? probe.sideBySide && !probe.pageScrollsVertically && probe.notesWithinViewport && probe.notesScrolls
        : probe.stageWithinViewport)
      && afterNav.visibleNotes === 1 && afterNav.scrollTop === 0;
    results.push({ viewport, ok, ...probe, afterNav, errors });
    await page.close();
  }
} finally { await browser.close(); }

console.log(JSON.stringify(results.map(r => ({
  viewport: `${r.viewport.width}x${r.viewport.height}`, ok: r.ok, sideBySide: r.sideBySide,
  slide: `${r.slideWidth}x${r.slideHeight}`, ratio: r.ratio, slideFits: r.slideFits,
  pageScrolls: r.pageScrollsVertically, notesScrolls: r.notesScrolls,
  notesHeadingAfterNav: r.afterNav.heading, errors: r.errors,
})), null, 2));
const failed = results.filter(r => !r.ok);
if (failed.length) { console.error(`LAYOUT CHECK FAILED (${failed.length}/${results.length})`); process.exitCode = 1; }
else console.log('所有视口通过：桌面左右并排且整页不滚动，手机自动堆叠，幻灯片始终完整。');
