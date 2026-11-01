import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { renderSlideChapter } from '../packages/dsh-zhiyun-core-classroom-generate/src/html-slide-shell.js';
import { auditSlideHtml } from '../packages/dsh-zhiyun-core-classroom-generate/src/html-slide-audit.js';

const base = {
  title: '要点容量',
  points: ['短要点'],
  summary: '总结',
  visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">图</text></svg>',
  formulas: [],
  explanation: '画布外讲解。',
};

test('a realistic 26-character Chinese point is accepted', () => {
  // 真实论文术语：「Melnychuk 等指出 ATE 存在先验诱导偏差」= 26 字。
  // 内容栏 580px / 30px 字号一行约 18 个汉字，折两行仍读得下，不该被拒。
  const html = renderSlideChapter({ title: '测试', slides: [{
    ...base, points: ['Melnychuk 等指出 ATE 存在先验诱导偏差', '现有工作以朴素方式拟合 PFN'],
  }] });
  assert.ok(html.includes('Melnychuk'));
});

test('genuinely too many points are still rejected with counts', () => {
  assert.throws(
    () => renderSlideChapter({ title: '测试', slides: [{ ...base, points: ['a', 'b', 'c', 'd'] }] }),
    /有 4 条，最多 3 条/,
  );
});

test('an absurdly long point is rejected with its length', () => {
  assert.throws(
    () => renderSlideChapter({ title: '测试', slides: [{ ...base, points: ['很长的要点'.repeat(20)] }] }),
    /max 36|got \d+/,
  );
});

test('real content-pane overflow is caught by the browser gate, not silently clipped', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // 实测：3 条 36 字 + 4 条短公式恰好装得下（溢 0px）；
    // 换成 4 条长公式则溢 149px。上限放宽后必须由这道实测兜住。
    const point = '这是一条刚好到达上限的要点文字'.repeat(3).slice(0, 36);
    const long = Array.from({ length: 4 }, (_, i) => ({
      html: `P(A ∪ B ∪ C) = P(A) + P(B) + P(C) - P(AB) - P(AC) - P(BC) + P(ABC) ${i}`,
    }));
    const html = renderSlideChapter({ title: '溢出', slides: [{ ...base, points: [point, point, point], formulas: long }] });
    await assert.rejects(
      auditSlideHtml(html, { browser }),
      (error) => {
        assert.match(error.message, /右栏内容超出 \d+px/, '必须明确指出右栏溢出多少');
        assert.match(error.message, /拆到下一页|删减要点/, '必须给出处置办法');
        return true;
      },
    );
  } finally { await browser.close(); }
});
