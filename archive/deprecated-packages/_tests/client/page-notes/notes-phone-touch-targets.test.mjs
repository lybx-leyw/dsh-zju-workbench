/**
 * 笔记页 / 论文页：手机上工具栏的命中区。
 *
 * # 为什么要单独钉
 *
 * 两页的栏头都是一排图标格：笔记 26px（`.zws-nt-explorer-head button`）、顶栏 30px
 * （`.zws-nt-topbar button`）、论文 26px（`.zwp-tree-head button`）。桌面上鼠标够准，
 * 这些尺寸没问题；但手机上相邻两格的中心距只有 28–33px，手指落点差一点就点到邻居 ——
 * 而「全部折叠」隔壁就是删树的入口，点错是有代价的。
 *
 * # 改的是命中区，不是图形
 *
 * 把格子从 26 撑到 44 会把这排工具栏撑高一倍，图标间距也变得稀疏，观感明显变差。
 * WCAG 2.5.8 的判据本来就是**命中区**：透明 `::after` 把可点范围扩开，图形与排布
 * 一像素不动。
 *
 * # 为什么放宽到「≥42」而不是死守 44
 *
 * 相邻两格中心距 28（26 + 2 间隙）。各扩 8 会让两块命中区正好相接、扩 9 就重叠 ——
 * 重叠比略小更糟：点下去是哪一个取决于层叠顺序，**点错了没有任何提示**。
 * 取 8 得到 42 高、彼此留 2px 明确间隔。横向同理，受左边距限制只扩到 42。
 *
 * 真机读数（390×844，Chromium 命中区探针）：笔记栏头 26×26 → 28×44；
 * 论文栏头 26×26 → 28×42。证据见
 * `packages/client/pages-default/docs/evidence/narrow-touch/`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));
const read = relative => readFileSync(path.join(root, relative), 'utf8');

/** 读出 `@media (max-width: Npx) { … }` 块，返回 `{ condition, body }`。 */
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

/** 某一页手机断点（≤ 700px）的规则体。 */
function phoneBlock(css) {
  const block = mediaBlocks(css).find(item => {
    const px = Number(/max-width:\s*(\d+)px/.exec(item.condition)?.[1]);
    return Number.isFinite(px) && px <= 700;
  });
  assert.ok(block, '缺少 ≤ 700px 的手机断点');
  return block.body;
}

/**
 * 某个选择器在这份 CSS 里**最后一条**带 `inset` 的规则。
 *
 * 同特异性时后者生效，所以「这一格最终的可点范围」由最后一条决定。
 * 直接 `indexOf` 会拿到前面那条分组规则（顶栏与栏头共用的 −7px），量出 40 而不是 44。
 *
 * @param css - 规则体文本。
 * @param selector - 选择器片段。
 * @returns `[纵向, 横向]` 或 null。
 */
function lastInsetFor(css, selector) {
  let found = null;
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    if (open < 0 || close < 0) break;
    const body = css.slice(open + 1, close);
    const inset = /inset:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(body);
    if (inset) found = [inset[1], inset[2]];
    from = close + 1;
  }
  return found;
}

const NOTES = read('packages/client/page-notes/src/style.css');
const PAPER = read('packages/client/page-paper/src/style.css');

test('笔记页：栏头与顶栏的图标按钮在手机上撑开命中区', () => {
  const phone = phoneBlock(NOTES);
  for (const selector of [
    '.zws-nt-topbar button',
    '.zws-nt-explorer-head button',
    '.zws-nt-tabnew',
  ]) {
    assert.ok(phone.includes(`${selector}::after`), `${selector} 在手机上要有 ::after 命中区`);
  }
  // 26px 的栏头格：纵向各扩 9 → 44（相邻格中心距 28，扩 9 后彼此留 1px）。
  // 顶栏 30px 那组扩 7 就是 44。两条分开写，取**后一条**（同特异性时后者生效）。
  const inset = lastInsetFor(phone, '.zws-nt-explorer-head button::after');
  assert.ok(inset, '栏头按钮的 ::after 要用 inset 撑开');
  const vertical = Math.abs(Number(inset[0]));
  assert.ok(26 + vertical * 2 >= 44, `栏头按钮纵向命中区应 ≥44，实际 ${26 + vertical * 2}`);
  const topbar = lastInsetFor(phone, '.zws-nt-topbar button::after');
  assert.ok(topbar, '顶栏按钮的 ::after 要用 inset 撑开');
  assert.ok(30 + Math.abs(Number(topbar[0])) * 2 >= 44,
    `顶栏按钮纵向命中区应 ≥44，实际 ${30 + Math.abs(Number(topbar[0])) * 2}`);
});

test('笔记页：命中区不改变可见尺寸', () => {
  const phone = phoneBlock(NOTES);
  const base = NOTES.slice(NOTES.indexOf('body[data-zw] .zws-nt-explorer-head button {'));
  const baseRule = base.slice(0, base.indexOf('}') + 1);
  // 桌面口径的 26×26 一格在手机上必须原样保留 —— 只允许加 position 给 ::after 当定位上下文。
  assert.match(baseRule, /width:\s*26px/, '可见宽度仍是 26');
  assert.match(baseRule, /height:\s*26px/, '可见高度仍是 26');
  const phoneRule = phone.slice(phone.indexOf('body[data-zw] .zws-nt-explorer-head button'), phone.indexOf('button::after', phone.indexOf('body[data-zw] .zws-nt-explorer-head button')));
  assert.doesNotMatch(phoneRule, /width:\s*\d+px/, '手机断点里不许改可见宽度');
  assert.doesNotMatch(phoneRule, /height:\s*\d+px/, '手机断点里不许改可见高度');
});

test('论文页：栏头的图标按钮在手机上撑开命中区', () => {
  const phone = phoneBlock(PAPER);
  assert.ok(phone.includes('.zwp-tree-head button::after'), '论文栏头要有 ::after 命中区');
  assert.ok(phone.includes('.zwp-tree-toggle::after'), '树行展开箭头也要有 ::after 命中区');
  const inset = lastInsetFor(phone, '.zwp-tree-head button::after');
  assert.ok(inset, '::after 要用 inset 撑开');
  const vertical = Math.abs(Number(inset[0]));
  // 26 + 8×2 = 42；相邻中心距 28，扩 8 后彼此留 2px，不重叠。
  assert.ok(26 + vertical * 2 >= 42, `论文栏头纵向命中区应 ≥42，实际 ${26 + vertical * 2}`);
  assert.ok(vertical < 9, '不能再大 —— 相邻两格会重叠，点错没有任何提示');
});

test('两页都没有用窗口宽度当触屏判据之外的新断点', () => {
  // 命中区跟着 `::after` 走，只需要在手机断点（≤700）里定义；不必再引入 pointer 查询 ——
  // 700px 以下已经是「手上拿着」的尺度，而且 ::after 不影响鼠标操作。
  for (const [name, css] of [['笔记', NOTES], ['论文', PAPER]]) {
    const phone = phoneBlock(css);
    assert.match(phone, /::after/, `${name}页的手机断点里要有命中区规则`);
    assert.doesNotMatch(phone, /font-size:\s*\d*\.?\d+px\s*;?\s*\}\s*$/m, `${name}页不该靠缩字号换空间`);
  }
});
