import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSlideDeck } from '../../../packages/core/classroom-generate/src/html-slide-shell.js';

const svg = (inner, attrs = 'viewBox="0 0 800 560"') =>
  `<svg ${attrs}>${inner}</svg>`;
const slide = visualHtml => ({
  title: '无障碍', points: ['短'], summary: '总结',
  visualHtml, formulas: [], explanation: '画布外讲解。',
});
const ok = deck => validateSlideDeck({ slides: [deck] });

test('role="img" is allowed on the svg root and on a wrapping g', () => {
  // 无障碍标注：读屏软件按 aria-label 整段朗读，而不是逐个读形状。
  // 模型两种写法都会用，实测 55 张图里有 2 张放在 <g> 上。
  ok(slide(svg('<rect x="10" y="10" width="40" height="40" role="img" aria-label="x"/>'.replace(' role="img" aria-label="x"', ''),
    'viewBox="0 0 800 560" role="img" aria-label="整图"')));
  ok(slide(svg('<g role="img" aria-label="分组"><rect x="10" y="10" width="40" height="40"/></g>')));
});

test('role values other than img are rejected', () => {
  // `role="button"` 之类会改语义，不是标注。
  assert.throws(() => ok(slide(svg('', 'viewBox="0 0 800 560" role="button"'))), /attribute role/);
  assert.throws(() => ok(slide(svg('', 'viewBox="0 0 800 560" role="presentation"'))), /attribute role/);
});

test('role on elements it does not belong to is rejected', () => {
  assert.throws(
    () => ok(slide(svg('<rect x="1" y="1" width="9" height="9" role="img"/>'))),
    /attribute role/,
  );
});
