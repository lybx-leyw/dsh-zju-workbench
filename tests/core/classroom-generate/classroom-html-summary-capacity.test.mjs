import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../../support/browser.mjs';
import { renderSlideChapter, validateSlideDeck } from '../../../packages/core/classroom-generate/src/html-slide-shell.js';

const base = {
  title: '标题', points: ['要点'],
  visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">图</text></svg>',
  formulas: [], explanation: '画布外讲解。',
};

test('48 characters is the measured two-line bound for the summary', async () => {
  // 实测（1472px 宽、30px 汉字）：48 字仍是两行未裁切，50 字变三行被裁掉。
  const browser = await launchBrowser();
  if (browser === null) return t.skip('没有可启动的 Chromium');
  const page = await browser.newPage({ viewport: { width: 1720, height: 1220 } });
  try {
    for (const len of [40, 48]) {
      await page.setContent(renderSlideChapter({ title: 't', slides: [{ ...base, summary: '本'.repeat(len) }] }));
      const m = await page.evaluate(() => {
        const el = document.querySelector('.summary');
        return { clipped: el.scrollHeight > el.clientHeight + 1, lines: Math.round(el.scrollHeight / 40) };
      });
      assert.equal(m.clipped, false, `${len} 字不该被裁切`);
      assert.ok(m.lines <= 2, `${len} 字应只占两行，实际 ${m.lines} 行`);
    }
  } finally { await browser.close(); }
});

test('48 characters is accepted: the old 40 limit was 8 characters tighter than reality', () => {
  // 曾经卡 40，导致 41-46 字（其实放得下）频繁被打回。
  assert.doesNotThrow(() => validateSlideDeck({ slides: [{ ...base, summary: '本'.repeat(48) }] }));
});

test('over-limit summary explains it is a line-count problem, not a nudge', () => {
  assert.throws(
    () => validateSlideDeck({ slides: [{ ...base, summary: '本'.repeat(52) }] }),
    (error) => {
      assert.match(error.message, /有 52 字，超出 48 字上限 4 字/, '必须报出实际与上限之差');
      assert.match(error.message, /固定高度/, '必须说明位置是固定高度');
      assert.match(error.message, /会被裁掉/, '必须说明超出会怎样');
      assert.match(error.message, /explanation/, '必须指出完整表述放哪里');
      return true;
    },
  );
});

test('over-limit kicker is described the same way', () => {
  assert.throws(
    () => validateSlideDeck({ slides: [{ ...base, summary: '短', kicker: '本'.repeat(32) }] }),
    /kicker（副标题）有 32 字，超出 28 字上限 4 字/,
  );
});

test('over-limit title explains the single-line bound and where the rest goes', () => {
  assert.throws(
    () => validateSlideDeck({ slides: [{ ...base, summary: '短', title: '本'.repeat(30) }] }),
    (error) => {
      assert.match(error.message, /title 有 30 字，超出 24 字上限 6 字/);
      assert.match(error.message, /56px 单行/, '必须说明标题是单行区域');
      assert.match(error.message, /kicker/, '必须指出副标题该放哪');
      assert.match(error.message, /explanation/);
      return true;
    },
  );
});
