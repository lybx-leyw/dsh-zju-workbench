/**
 * 导轨的触摸命中区（手机 / 平板）。
 *
 * # 这条守卫钉的是什么
 *
 * 用户反馈：「设置项移到导航栏，收起侧边抽屉按钮藏在左上角鲸鱼下……都没法很好
 * 落实到窄屏上面」。位置已经对了（鲸鱼在导轨顶上、每个 page 都能点），但手机上
 * 那枚鲸鱼的可点区域只有 **23×17**，导航项 37×37 —— 手指点不准。
 *
 * # 为什么修的是命中区而不是可见尺寸
 *
 * 导轨宽度 51 是产品口径（`DEFAULT_RAIL_WIDTH`；壳层与页面层的 `--zw-pane-w: 229`
 * 都由它推出来），而且 51 宽的列里塞满 44 的方块会把图标挤散。WCAG 2.5.8 的判据
 * 本来就是**命中区**而不是可见图形 —— 透明 `::after` 既让手指点得准，又不改变
 * 用户看到的这条细导轨。
 *
 * # 为什么只在 `(pointer: coarse)` 下生效
 *
 * 鼠标不需要放大：桌面上相邻两个按钮各扩 12px 会互相盖住，点下去是哪一个取决于
 * 层叠顺序。`pointer` 是**设备能力**而不是窗口宽度 —— 桌面把窗口拖窄仍然是鼠标。
 *
 * # 为什么不许重叠
 *
 * 相邻导航项中心距 43px（37 按钮 + 6 间隙），各扩 3px 正好把间隙对半分。再大就
 * 有两个按钮抢同一块区域 —— 那比小一点更糟，因为**点错了没有任何提示**。
 *
 * 真机读数（390×844，Chromium，`isMobile: true, hasTouch: true`）：命中区探针从
 * 中心向四方向逐像素外扩，量到鲸鱼 **24×18 → 44×45**、导航项 **36×37 → 50×43**。
 * 证据见 `packages/client/pages-default/docs/evidence/narrow-touch/`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));
const SRC = readFileSync(path.join(root, 'packages/client/pages-default/src/rail-action.jsx'), 'utf8');

/**
 * 取出源文件里的一份模板串文本（`const NAME = \`…\``）。
 *
 * 本包的样式分成两块：`CSS`（隐藏原生折叠按钮）与 `TOUCH_CSS`（触摸命中区），
 * 前者用 `${TOUCH_CSS}` 拼进后者。测试要读的是**源码里的原文** —— 读打包产物
 * 就变成在验构建器了。
 */
function template(name) {
  const start = SRC.indexOf(`const ${name} = \``);
  assert.ok(start > 0, `rail-action.jsx 里应有 const ${name} 模板串`);
  const end = SRC.indexOf('`;', start);
  return SRC.slice(start, end);
}

/** 命中区规则都在这一份里。 */
const TOUCH = template('TOUCH_CSS');

/** 取出某个选择器的规则体；选择器按 `{` 前的原文匹配。 */
function ruleBody(css, selectorFragment) {
  const at = css.indexOf(selectorFragment);
  assert.ok(at >= 0, `样式表里应有 ${selectorFragment}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}


test('触摸命中区只在粗指针设备上生效', () => {
  // 鼠标侧一个像素都不该变 —— 桌面窗口拖窄仍然是鼠标，把图标扩开会互相误点。
  assert.match(TOUCH, /@media \(pointer: coarse\)/, '命中区规则必须在 (pointer: coarse) 里');
  assert.equal(/@media \(max-width: \d+px\)/.test(TOUCH), false,
    '不能用窗口宽度当触屏判据 —— 桌面把窗口拖窄不是手机');
});

test('导轨顶上的鲸鱼（收起/展开侧栏）命中区 ≥ 44×44', () => {
  const body = ruleBody(TOUCH, '[data-zju-rail-collapse]::after');
  /**
   * 图形本身 23×17，位于导轨顶部那格（y=14..31）。上边只剩 14px 到视口顶，
   * 所以纵向取 −13.5（14 − 13.5 = 0.5，刚好不出屏）。
   *
   *   宽 23 + 10.5 × 2 = 44
   *   高 17 + 13.5 × 2 = 44
   */
  const inset = /inset:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(body);
  assert.ok(inset, '命中区要用 inset 撑开');
  const vertical = Math.abs(Number(inset[1]));
  const horizontal = Math.abs(Number(inset[2]));
  assert.ok(23 + horizontal * 2 >= 44, `横向命中区应 ≥44，实际 ${23 + horizontal * 2}`);
  assert.ok(17 + vertical * 2 >= 44, `纵向命中区应 ≥44，实际 ${17 + vertical * 2}`);
  assert.ok(vertical <= 14, `纵向最多扩 14（再多就出屏了），实际 ${vertical}`);
});

test('导航项的命中区把行距用满，但不与相邻项重叠', () => {
  const body = ruleBody(TOUCH, 'button:not([data-zju-rail-collapse])::after');
  const inset = /inset:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(body);
  assert.ok(inset, '导航项命中区也要用 inset 撑开');
  const vertical = Math.abs(Number(inset[1]));
  // 相邻项中心距 43（37 按钮 + 6 间隙）。各扩 3 正好把间隙对半分；
  // 扩到 4 就会重叠，两块命中区抢同一行像素。
  assert.equal(vertical, 3, '纵向各扩 3px 才能分掉 6px 间隙且不重叠');
  // 横向：37 + 6×2 = 49，在 38 的导轨内宽之外多出一点 —— 仍在 51 的列内。
  assert.ok(37 + Math.abs(Number(inset[2])) * 2 <= 51, '横向不能越过导轨列宽');
});

test('两条规则的特异性拉开，鲸鱼不会被通用那条盖掉', () => {
  /**
   * 鲸鱼按钮本身也在 `[data-dsh-pages-rail]` 里。若两条都写 `… button::after`，
   * 更具体的那条会连鲸鱼一起命中，鲸鱼只剩 24px（真机量到 24×18）。
   *
   * 所以通用那条必须显式排除鲸鱼。改回 `button::after` 不会报错、不会让任何功能
   * 测试变红，只会让「点鲸鱼收侧栏」在手机上重新变难 —— 这正是要钉住的。
   */
  assert.match(TOUCH, /\[data-dsh-pages-rail\] button:not\(\[data-zju-rail-collapse\]\)::after/,
    '通用规则必须排除鲸鱼，否则两条 ::after 会互相覆盖');
});

test('命中区规则不碰可见外观', () => {
  // 只允许 position（为了给 ::after 定位）与 inset —— 不能顺手改 width/height/font-size。
  for (const fragment of ['[data-zju-rail-collapse]::after', 'button:not([data-zju-rail-collapse])::after']) {
    const body = ruleBody(TOUCH, fragment);
    assert.doesNotMatch(body, /font-size|background|color|border/, `${fragment} 只该定义可点范围`);
    assert.match(body, /content:\s*""/, `${fragment} 必须是空内容的透明层`);
  }
});
