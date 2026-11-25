/**
 * 笔记页在手机宽度下必须**竖着叠**，不能并排。
 *
 * # 这条守卫钉的是什么
 *
 * 真机反馈原话：「各 page 对手机模式不友好」。宽度 390px 时实测：文件树
 * `min-width: 190px` + 正文 `min-width: 400px` = 590，超过屏宽 390。
 * 正文被挤到容器外（`x=241`、宽 400 → 右端 641），`overflow:hidden` 又把
 * 多出来的部分裁掉 —— 用户看到的是「右边一片空白」。
 *
 * 那两块地板在桌面端是对的（保证"别把编辑器压成一条"），手机屏宽不够而已。
 *
 * # 为什么钉在源码上
 *
 * 这是**断点与排布方向**的产品口径，不是某一次的实现细节：改回 `row`
 * 不会报错、也不会让任何功能测试变红，只会让手机上重新看不见正文。
 *
 * 真机效果与截图见 `packages/client/pages-default/docs/evidence/narrow/`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));
const CSS = readFileSync(path.join(root, 'packages/client/page-notes/src/style.css'), 'utf8');

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

/** 取 `body[data-zw] .cls {` 那条规则的声明块（只取第一条）。 */
function ruleBody(css, selector) {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return null;
  return css.slice(at, css.indexOf('}', at));
}

/** ≤ 700px 那个断点；没有则 undefined。 */
function phoneBlock(css) {
  return mediaBlocks(css).find(block => {
    const px = Number(/max-width:\s*(\d+)px/.exec(block.condition)?.[1]);
    return Number.isFinite(px) && px <= 700;
  });
}

test('手机断点把工作区改成竖排', () => {
  const phone = phoneBlock(CSS);
  assert.ok(phone, '缺少 ≤ 700px 的手机断点');
  assert.match(phone.body, /\.zws-nt-work\s*\{[^}]*flex-direction:\s*column/,
    '手机断点里 .zws-nt-work 必须改成 flex-direction: column');
});

test('正文的 min-width 地板在手机上收回 0', () => {
  // 桌面端 400px 是刻意的（别把编辑器压成一条）；
  // 手机屏宽 390 比它还窄，留着这块地板就是把正文推出容器。
  const desktop = ruleBody(CSS, 'body[data-zw] .zws-nt-main');
  assert.ok(desktop, '找不到 .zws-nt-main 的基规则');
  assert.match(desktop, /min-width:\s*400px/, '桌面端应当保留 400px 地板（本测试的对照项）');

  const phone = phoneBlock(CSS);
  assert.match(phone.body, /\.zws-nt-main\s*\{[^}]*min-width:\s*0/,
    '手机断点里 .zws-nt-main 的 min-width 必须收回 0');
});

test('面板在手机上自己限高并滚动', () => {
  const phone = phoneBlock(CSS);
  // 树与右栏共用同一段选择器；`max-height` 让它们展开时不吃掉整屏。
  assert.match(phone.body, /\.zws-nt-explorer[^{]*\{[^}]*max-height/, '文件树要限高');
  assert.match(phone.body, /overflow-y:\s*auto/, '文件树要自己滚动，不能把正文顶出去');
});

test('手机断点在基规则之后 —— 否则是死规则', () => {
  // 与 `scripts/check-css-order.mjs` 同一条道理：@media 覆盖写在它要覆盖的
  // 基规则之前，同特异性下永远输。
  const baseAt = CSS.indexOf('body[data-zw] .zws-nt-main {');
  const phoneAt = CSS.search(/@media\s*\(max-width:\s*700px\)/);
  assert.ok(baseAt >= 0, '找不到 .zws-nt-main 的基规则');
  assert.ok(phoneAt >= 0, '找不到 700px 断点');
  assert.ok(phoneAt > baseAt, '手机断点必须写在基规则之后');
});
