import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { renderSlideChapter } from '../packages/core/classroom-generate/src/html-slide-shell.js';
import { fitSlideOutput } from '../packages/core/classroom-generate/src/html-slide-fit.js';
import { auditSlideHtml } from '../packages/core/classroom-generate/src/html-slide-audit.js';

test('long equations are deterministically split into rows/pages without deleting terms or shrinking fonts', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const equation = '<math display="block"><mrow><mi>F</mi><mo>=</mo>' + Array.from({ length: 20 }, (_, i) => `${i ? '<mo>+</mo>' : ''}<msub><mi>x</mi><mn>${i + 1}</mn></msub>`).join('') + '</mrow></math>';
  const slides = [{ title: '长公式拆行', points: ['项的顺序不变'], summary: '拆行拆页，不缩小字体', visualHtml: '<svg viewBox="0 0 800 560"><text x="100" y="180" font-size="32">有序求和</text></svg>', formulas: Array.from({ length: 4 }, () => ({ html: equation, label: '展开' })), explanation: '每个求和项必须保留，长公式按顶层运算符拆行，公式行过多则拆到下一页。' }];
  const result = { title: '排版验证', topic: '顺序', slides, html: renderSlideChapter({ title: '排版验证', topic: '顺序', slides }) };
  try {
    await page.setContent(result.html);
    const original = await page.locator('.formula-content').allTextContents();
    assert.ok((await fitSlideOutput(result, { browser })).length);
    assert.ok(result.slides.length > 1);
    await page.setContent(result.html);
    const compiled = await page.locator('.formula-content').allTextContents();
    assert.equal(compiled.join('').replace(/\s/g, ''), original.join('').replace(/\s/g, ''));
    const audit = await auditSlideHtml(result.html, { browser });
    assert.equal(audit.ok, true);
    assert.ok(result.slides.every(s => s.formulas.length <= 3));
  } finally { await page.close(); await browser.close(); }
});
