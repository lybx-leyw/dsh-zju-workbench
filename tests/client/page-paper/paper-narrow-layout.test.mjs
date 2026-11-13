/**
 * 论文页在手机宽度下必须**竖着叠**，不能并排。
 *
 * # 这条守卫钉的是什么
 *
 * 真机反馈原话：「各 page 对手机模式不友好」。宽度 390px 时实测：树栏
 * `min-width: 190px` 配上一个横排的落地页，落地页只剩 **84px** 宽 ——
 * 那行「惟学无际」被压成一条竖排的字，正文完全读不了。
 *
 * 修法只动**排布方向**，不动「树开着还是关着」（那归用户与导轨那只鲸鱼）。
 *
 * # 为什么钉在源码上
 *
 * 这是**断点与排布方向**的产品口径：改回 `row` 不会报错、也不会让任何功能
 * 测试变红，只会让手机上重新看不见正文。
 *
 * 真机效果与截图见 `packages/client/pages-default/docs/evidence/narrow/`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));
const CSS = readFileSync(path.join(root, 'packages/client/page-paper/src/style.css'), 'utf8');

/** 读出 `@media (max-width: Npx) { … }` 块，返回 `{ condition, body }`（跳过整块）。 */
function mediaBlocks(css) {
  const blocks = [];
  const re = /@media\s*\(([^)]*max-width[^)]*)\)\s*\{/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    const start = re.lastIndex;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ condition: match[1], body: css.slice(start, i - 1) });
  }
  return blocks;
}

/** ≤ 700px 那个断点；没有则 undefined。 */
function phoneBlock(css) {
  return mediaBlocks(css).find(block => {
    const px = Number(/max-width:\s*(\d+)px/.exec(block.condition)?.[1]);
    return Number.isFinite(px) && px <= 700;
  });
}

test('手机断点把页面改成竖排，且树栏限高、地板收回 0', () => {
  const phone = phoneBlock(CSS);
  assert.ok(phone, '缺少 ≤ 700px 的手机断点');
  assert.match(phone.body, /\.zwp-page\s*\{[^}]*flex-direction:\s*column/,
    '手机断点里 .zwp-page 必须改成 flex-direction: column');
  assert.match(phone.body, /\.zwp-tree-pane[^{]*\{[^}]*max-height/, '论文库树栏要限高');
  assert.match(phone.body, /\.zwp-tree-pane[^{]*\{[^}]*min-width:\s*0/,
    '树栏的 190px 地板在手机上要收回 0');
});

test('落地页在手机上不被压成一条竖排字', () => {
  // 真机实测：并排时落地页只剩 84px 宽，那行「惟学无际」竖着排成一条。
  // 修法两条一起才成立：整页改列向（上面那条）+ 落地页自己占满整行。
  const phone = phoneBlock(CSS);
  assert.match(phone.body, /\.zwp-landing[^{]*\{[^}]*width:\s*100%/,
    '手机断点里落地页必须占满整行');
});

test('收起态的窄条仍在原位、仍可点 —— 不删入口', () => {
  // 那 28px 竖窄条本来是「在正文旁边留个展开入口」。竖排后改成一条**横**的
  // 浅条（按钮位置不变），而不是 `display:none` —— 删掉一个用户已经学会的
  // 入口不是排布调整该做的决定。
  const phone = phoneBlock(CSS);
  assert.match(phone.body, /\.zwp-tree-pane\.is-collapsed\s*\{[^}]*flex-direction:\s*row/,
    '收起态应当改成一条横条，而不是消失');
  assert.doesNotMatch(phone.body, /\.zwp-tree-pane\.is-collapsed\s*\{[^}]*display:\s*none/,
    '收起态不能整个藏掉（那会删掉展开入口）');
});

test('手机断点在基规则之后 —— 否则是死规则', () => {
  // 与 `scripts/check-css-order.mjs` 同一条道理：@media 覆盖写在它要覆盖的
  // 基规则之前，同特异性下永远输。
  const baseAt = CSS.indexOf('body[data-zw] .zwp-page {');
  const phoneAt = CSS.search(/@media\s*\(max-width:\s*700px\)/);
  assert.ok(baseAt >= 0, '找不到 .zwp-page 的基规则');
  assert.ok(phoneAt >= 0, '找不到 700px 断点');
  assert.ok(phoneAt > baseAt, '手机断点必须写在基规则之后');
});
