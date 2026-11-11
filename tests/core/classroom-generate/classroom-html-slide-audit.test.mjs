import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../../support/browser.mjs';
import { renderSlideChapter } from '../../../packages/core/classroom-generate/src/html-slide-shell.js';
import { auditSlideHtml } from '../../../packages/core/classroom-generate/src/html-slide-audit.js';

const slide = { title: '图示与公式', points: ['固定横版画布'], summary: '只有公式逐步展示',
  visualHtml: '<svg viewBox="0 0 800 560"><rect x="100" y="140" width="400" height="200" fill="#176c68"/><text x="140" y="230" fill="#fff" font-size="32">条件 → 结论</text></svg>',
  formulas: [{ html: 'P(A) + P(B) = 1' }], explanation: '长解释位于画布外，改变公式步骤不会隐藏讲解。' };

test('real Chromium audits landscape bounds, notes, formula steps and mobile scaling', async () => {
  const browser = await launchBrowser();
  if (browser === null) return t.skip('没有可启动的 Chromium');
  try {
    const result = await auditSlideHtml(renderSlideChapter({ title: '版式自检', slides: [slide, { ...slide, title: '第二页' }] }), { browser });
    assert.equal(result.ok, true);
    assert.equal(result.pages.length, 2);
    assert.equal(result.networkRequests, 0);
    assert.deepEqual(result.mobile.overflowSlides, []);
    // 超长公式必须被拦下，且原因要指向**公式行**而不只是泛泛的「版面不对」。
    // 措辞会随排版规则演进（这里曾写死英文 `formula exceeds`），所以断言「点名了
    // formula-row 或公式超出」这一行为，而不是某一串固定英文。
    await assert.rejects(
      auditSlideHtml(renderSlideChapter({ title: '超长公式', slides: [{ ...slide, formulas: [{ html: 'P(A) + '.repeat(80) + '1' }] }] }), { browser }),
      /formula-row|formula|公式/,
    );
    // 越界报错必须给出方向与像素数，否则模型只能猜着挪（实测连修两次只顾着改 x 值）。
    await assert.rejects(
      auditSlideHtml(renderSlideChapter({ title: '越界标签', slides: [{ ...slide, visualHtml: '<svg viewBox="0 0 800 560"><text x="790" y="180">不允许出界的长标签</text></svg>' }] }), { browser }),
      (error) => {
        assert.match(error.message, /右侧超出 \d+px/);
        assert.match(error.message, /锚点 x=790/);
        assert.match(error.message, /安全区/);
        return true;
      },
    );
  } finally { await browser.close(); }
});

test('a centred label bleeding off the left edge is reported as left overflow', async () => {
  const browser = await launchBrowser();
  if (browser === null) return t.skip('没有可启动的 Chromium');
  try {
    // 真实事故：居中锚点在 x=60，7 个汉字宽约 168px，左边界 x=-24。
    await assert.rejects(
      auditSlideHtml(renderSlideChapter({ title: '左侧出血', slides: [{ ...slide, visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" text-anchor="middle" font-size="24">预训练内嵌去偏</text></svg>' }] }), { browser }),
      (error) => {
        assert.match(error.message, /左侧超出 \d+px/, '必须指出是左侧，而不是笼统的「越界」');
        assert.match(error.message, /text-anchor=middle/, '必须报出锚点方式，模型才知道居中会让左边界负值');
        return true;
      },
    );
  } finally { await browser.close(); }
});

test('overlapping labels report which direction and how much', async () => {
  const browser = await launchBrowser();
  if (browser === null) return t.skip('没有可启动的 Chromium');
  try {
    const svg = '<svg viewBox="0 0 800 560"><text x="200" y="200" font-size="28">Kim 2024</text><text x="200" y="210" font-size="28">Ching 2026</text></svg>';
    await assert.rejects(
      auditSlideHtml(renderSlideChapter({ title: '标签重叠', slides: [{ ...slide, visualHtml: svg }] }), { browser }),
      (error) => {
        assert.match(error.message, /标签重叠「Kim 2024」与「Ching 2026」/);
        assert.match(error.message, /水平重叠 \d+px/);
        assert.match(error.message, /垂直重叠 \d+px/);
        return true;
      },
    );
  } finally { await browser.close(); }
});
