/**
 * 窄屏（手机宽度）下，笔记页与论文页的面板必须**竖着叠**，不能并排。
 *
 * # 这条守卫钉的是什么
 *
 * 真机反馈原话：「各 page 对手机模式不友好」。宽度 390px 时实测：
 *
 * | 页面 | 症状 | 数字 |
 * | --- | --- | --- |
 * | 笔记 | 正文被挤出容器，右侧一片空白 | `.zws-nt-main` x=241 宽 400 → 右端 641 > 390 |
 * | 论文 | 落地页被压成一条竖排字 | `.zwp-landing` 宽 **84px** |
 *
 * 根因是两页都用「两侧面板 + 中间正文」的横排 flex，而正文有 `min-width: 400px`
 * 的地板（笔记）、树栏有 `min-width: 190px` 的地板（两页）。这些地板在桌面端是
 * 对的 —— 它们保证"别把编辑器压成一条" —— 但手机屏宽还不够两块地板之和。
 *
 * # 为什么钉在源码上
 *
 * 这是**断点与排布方向**的产品口径，不是某一次的实现细节：改回 `flex-direction: row`
 * 不会报错、也不会让任何功能测试变红，只会让手机上重新看不见正文。所以静态断言
 * 三个结构事实：
 *   1. 有一个 ≤ 700px 的断点把工作区改成列向；
 *   2. 正文的 `min-width` 在该断点里被收回 `0`（否则列向也还是会溢出）；
 *   3. 面板自己限高并滚动，展开时不会把正文顶出屏幕。
 *
 * 真机上的效果（1300px 日志、截图）由提交记录与 `docs/evidence/` 覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));

/** 读出某个样式表里所有 `@media (max-width: Npx) { … }` 块，返回 `{ condition, body }`。 */
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

/** 取 `body[data-zw] .cls {` 那条规则的声明块（只取第一条）。 */
function ruleBody(css, selector) {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return null;
  return css.slice(at, css.indexOf('}', at));
}

/** 一个样式表里 ≤ 700px 那个断点（若存在）。 */
function phoneBlock(css) {
  return mediaBlocks(css).find(block => {
    const px = Number(/max-width:\s*(\d+)px/.exec(block.condition)?.[1]);
    return Number.isFinite(px) && px <= 700;
  });
}

const NOTES_CSS = readFileSync(path.join(root, 'packages/client/page-notes/src/style.css'), 'utf8');
const PAPER_CSS = readFileSync(path.join(root, 'packages/client/page-paper/src/style.css'), 'utf8');

test('笔记页：手机宽度断点把工作区改成竖排', () => {
  const phone = phoneBlock(NOTES_CSS);
  assert.ok(phone, '笔记页缺少 ≤ 700px 的手机断点');
  // 工作区那一块（树 / 正文 / 右栏的父级）在这个断点里必须是列向。
  assert.match(phone.body, /\.zws-nt-work\s*\{[^}]*flex-direction:\s*column/,
    '手机断点里 .zws-nt-work 必须改成 flex-direction: column');
});

test('笔记页：正文的 min-width 地板在手机上收回 0', () => {
  // 桌面端 `min-width: 400px` 是刻意的（别把编辑器压成一条）；
  // 但手机屏宽 390 比它还窄，留着这块地板就是把正文推出容器。
  const desktop = ruleBody(NOTES_CSS, 'body[data-zw] .zws-nt-main');
  assert.ok(desktop, '找不到 .zws-nt-main 的基规则');
  assert.match(desktop, /min-width:\s*400px/, '桌面端应当保留 400px 地板（本测试的对照项）');

  const phone = phoneBlock(NOTES_CSS);
  assert.match(phone.body, /\.zws-nt-main\s*\{[^}]*min-width:\s*0/,
    '手机断点里 .zws-nt-main 的 min-width 必须收回 0');
});

test('笔记页：面板在手机上自己限高并滚动', () => {
  const phone = phoneBlock(NOTES_CSS);
  // 树与右栏是被塞进同一段选择器的；`max-height` 让它们展开时不吃掉整屏。
  assert.match(phone.body, /\.zws-nt-explorer[^{]*\{[^}]*max-height/, '文件树要限高');
  assert.match(phone.body, /overflow-y:\s*auto/, '文件树要自己滚动，不能把正文顶出去');
});

test('论文页：手机宽度断点把页面改成竖排，且树栏限高', () => {
  const phone = phoneBlock(PAPER_CSS);
  assert.ok(phone, '论文页缺少 ≤ 700px 的手机断点');
  assert.match(phone.body, /\.zwp-page\s*\{[^}]*flex-direction:\s*column/,
    '手机断点里 .zwp-page 必须改成 flex-direction: column');
  assert.match(phone.body, /\.zwp-tree-pane[^{]*\{[^}]*max-height/, '论文库树栏要限高');
  assert.match(phone.body, /\.zwp-tree-pane[^{]*\{[^}]*min-width:\s*0/,
    '树栏的 190px 地板在手机上要收回 0');
});

test('论文页：落地页在手机上不被压成一条竖排字', () => {
  // 真机实测：并排时落地页只剩 84px 宽，那行「惟学无际」竖着排成一条。
  // 修法两条一起才成立：整页改列向（上面那条）+ 落地页自己不再吃 `flex:1` 的
  // 横向剩余空间，而是占满整行。
  const phone = phoneBlock(PAPER_CSS);
  assert.match(phone.body, /\.zwp-landing[^{]*\{[^}]*width:\s*100%/,
    '手机断点里落地页必须占满整行');
});

test('两页的手机断点都在各自基规则之后 —— 否则是死规则', () => {
  // 与 `scripts/check-css-order.mjs` 同一条道理：@media 覆盖写在它要覆盖的
  // 基规则之前，同特异性下永远输。这里额外钉一次，因为这两条覆盖是新增的。
  for (const [name, css, selector] of [
    ['笔记', NOTES_CSS, 'body[data-zw] .zws-nt-main'],
    ['论文', PAPER_CSS, 'body[data-zw] .zwp-page'],
  ]) {
    const baseAt = css.indexOf(selector + ' {');
    const phoneAt = css.search(/@media\s*\(max-width:\s*700px\)/);
    assert.ok(baseAt >= 0, `${name}页找不到基规则 ${selector}`);
    assert.ok(phoneAt >= 0, `${name}页找不到 700px 断点`);
    assert.ok(phoneAt > baseAt, `${name}页的手机断点必须写在基规则之后`);
  }
});
