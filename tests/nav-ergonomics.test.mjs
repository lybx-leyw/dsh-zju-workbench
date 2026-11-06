/**
 * 导航栏（导轨）的点击目标必须符合工效学下限。
 *
 * # 标准与依据
 *
 *   WCAG 2.5.5（Target Size, AAA）：可点击目标至少 44×44 CSS px
 *   Apple HIG：最小 44×44 pt
 *   Material Design：最小 48×48 dp（触屏）
 *
 * 桌面应用常被当作「鼠标精准，可以小一点」，但那是错的：
 * 轨道上的图标点击是**高频动作**，每次都要精准对位会累积成明显的摩擦；
 * 触屏设备（带触摸屏的笔记本）上 34px 基本点不准。
 *
 * # 改了什么
 *
 *   .zy-rail-item   34×34 → 44×44
 *   导航项间距       2px   → 4px      （相邻中心距 36 → 48，防误触）
 *   图标            16px  → 20px     （与更大的目标成比例）
 *   品牌按钮        34×34 → 40×40    （它是标识不是操作，略小于导航项）
 *   圆角             7px  → 9px      （与新尺寸成比例）
 *
 * 导轨宽度保持 55px（宿主侧栏列是 56px，由宿主的 toggleSidebar 定死）：
 * 44px 的按钮在 55px 内仍有左右各 5.5px 余量。
 *
 * 用法：node tests/nav-ergonomics.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CSS = path.resolve('packages/dsh-zhiyun-shell-workbench/src/style.css');
const css = fs.readFileSync(CSS, 'utf8');

/** 取某条规则里某个属性值。 */
function prop(selectorPattern, propName) {
  const re = new RegExp(selectorPattern.source + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  if (!m) return null;
  const p = new RegExp(`(?:^|;|\\s)${propName}\\s*:\\s*([^;]+)`);
  const found = m[1].match(p);
  return found ? found[1].trim() : null;
}

const px = v => (v ? parseFloat(v) : null);

test('导航项点击目标是 44×44（WCAG 2.5.5 下限）', () => {
  const w = px(prop(/\.zy-sidebar\s+\.zy-rail-item/, 'width'));
  const h = px(prop(/\.zy-sidebar\s+\.zy-rail-item/, 'height'));
  assert.equal(w, 44, `宽度应 44px，实际 ${w}`);
  assert.equal(h, 44, `高度应 44px，实际 ${h}`);
});

test('导航项间距 4px，相邻中心距达到 48px', () => {
  const gap = px(prop(/\.zy-rail-nav/, 'gap'));
  assert.equal(gap, 4, `间距应 4px，实际 ${gap}`);
  // 44 + 4 = 48，留出可辨识的间隔，减少误触相邻项
  assert.ok(44 + gap >= 48, '中心距不足 48px');
});

test('图标 20px（与更大的目标成比例）', () => {
  const w = px(prop(/\.zy-rail-item\s+svg/, 'width'));
  assert.equal(w, 20, `图标应 20px，实际 ${w}`);
  assert.ok(w >= 20, '图标不该小于 20px —— 16px 在 44px 目标里显得空');
});

test('品牌按钮 40×40（标识，比导航项略小但也不该太小）', () => {
  const w = px(prop(/\.zy-rail-brand/, 'width'));
  const h = px(prop(/\.zy-rail-brand/, 'height'));
  assert.equal(w, 40);
  assert.equal(h, 40);
});

test('底部控件间距同步改成 4px', () => {
  assert.equal(px(prop(/\.zy-sidebar-bottom/, 'gap')), 4);
  assert.equal(px(prop(/\.zy-rail-actions/, 'gap')), 4);
});

test('导轨宽度 55px，能装下 44px 按钮（不溢出、不贴边）', () => {
  // flex 是简写 `0 0 55px`，不能按单值属性取
  const m = css.match(/\.zy-rail\s*\{[^}]*\}/);
  assert.ok(m, '找不到 .zy-rail 规则');
  const flex = m[0].match(/flex:\s*0\s+0\s+(\d+)px/);
  assert.ok(flex, '.zy-rail 应声明 flex: 0 0 <n>px');
  assert.equal(Number(flex[1]), 55, `导轨应保持 55px，实际 ${flex[1]}px`);
  assert.ok(44 < 55, '按钮不能比容器还宽');
});

test('圆角 9px，与新尺寸成比例', () => {
  const r = px(prop(/\.zy-sidebar\s+\.zy-rail-item/, 'border-radius'));
  assert.equal(r, 9, `圆角应 9px，实际 ${r}`);
});

test('品牌 logo 随按钮放大（24×30 → 28×34）', () => {
  // 容器与 svg 是两条紧邻的规则，一起抓
  const m = css.match(/\.zy-sidebar\s+\.zy-mark-compact\s*\{[^}]*\}\.zy-sidebar\s+\.zy-mark-compact\s+svg\s*\{[^}]*\}/);
  assert.ok(m, '找不到 mark-compact 容器 + svg 规则');
  assert.match(m[0], /width:\s*30px/, 'logo 容器宽度应为 30px');
  assert.match(m[0], /svg\s*\{[^}]*width:\s*28px/, 'logo 本体宽度应为 28px');
});
