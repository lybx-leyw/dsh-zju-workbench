/**
 * 全站基础控件的工效学尺寸。
 *
 * # 审计发现的问题（用 Chromium 渲染后量 bounding box）
 *
 *   输入框  21px   ← 浏览器默认样式，全站从未被覆盖
 *   下拉框  19px   ← 同上
 *   文字按钮 25px
 *   普通按钮 33px
 *
 * 输入框和下拉框只有 19-21px，比按钮还矮。笔记 / 论文 / 反馈三页的
 * style.css 里 0 处 input 规则 —— 用户点进输入框命中率很低。
 *
 * # 修在 shell-ui，不逐页补
 *
 * 这是所有页面共用的控件。分散写会出现「题库输入框 32px、笔记 21px」
 * 这种不一致。集中一处，新增页面自动受益。
 *
 * # 尺寸取值的取舍
 *
 * 44px 是**触屏**下限。桌面端把一排工具按钮全做 44px 会让工具栏过高、
 * 信息密度下降。所以分档：
 *   输入类 32px（表单主体，要给足）
 *   主按钮 36px（一屏通常只有一个）
 *   次要按钮 32px
 *   文字按钮 30px（水平方向靠 padding 补）
 * 真正按 44 做的是导轨图标和独立大按钮。
 *
 * 这是有意的取舍：工效学服务真实使用场景，不是机械套数字。
 *
 * 用法：node tests/control-ergonomics.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = p => fs.readFileSync(path.resolve(p), 'utf8');

const SHELL_UI = read('packages/dsh-zhiyun-shell-ui/src/style.css');
const WORKBENCH = read('packages/dsh-zhiyun-shell-workbench/src/style.css');

const ruleOf = (css, pattern) => {
  const m = css.match(new RegExp(pattern.source + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
};
/**
 * 按字面前缀找到规则体（选择器里方括号引号太多，正则不好写）。
 *
 * `last: true` 取**最后一条**同名规则 —— 层叠上后写的赢，
 * 而 .zs-primary / .zs-text 在文件里各有一条旧定义在前、新的尺寸规则在后。
 * 断言第一条只会测到旧值。
 */
const blockAfter = (literal, { last = false, source = SHELL_UI } = {}) => {
  const i = last ? source.lastIndexOf(literal) : source.indexOf(literal);
  if (i < 0) return null;
  const open = source.indexOf('{', i);
  const close = source.indexOf('}', open);
  return open < 0 || close < 0 ? null : source.slice(open + 1, close);
};

const px = (block, prop) => {
  if (!block) return null;
  const m = block.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*(-?[\\d.]+)px`));
  return m ? Number(m[1]) : null;
};

test('输入类控件最小高度 32px（此前是浏览器默认的 19-21px）', () => {
  const block = blockAfter('body[data-zhiyun] :is(input:not([type])');
  assert.ok(block, '找不到输入框规则');
  assert.equal(px(block, 'min-height'), 32, '输入框高度不够时命中率很低');
});

test('多行输入 72px，可纵向拉伸', () => {
  const block = blockAfter('body[data-zhiyun] textarea');
  assert.ok(block, '找不到 textarea 规则');
  assert.equal(px(block, 'min-height'), 72);
  assert.match(block, /resize:\s*vertical/, '用户常需要放大输入区');
});

test('主按钮 36px / 次要按钮 32px / 文字按钮 30px', () => {
  // 用字面定位：这三条规则的完整选择器是 `body[data-zhiyun] .zs-button {`，
  // 用正则描述会因为方括号与点号转义出错
  assert.equal(px(blockAfter('body[data-zhiyun] .zs-button {'), 'min-height'), 32);
  // 这两条取最后一条：文件里各有一条旧定义在前
  assert.equal(px(blockAfter('body[data-zhiyun] .zs-primary {', { last: true }), 'min-height'), 36);
  assert.equal(px(blockAfter('body[data-zhiyun] .zs-text {', { last: true }), 'min-height'), 30);
});

test('复选框/单选框 16px（默认 13px 太小）', () => {
  const block = blockAfter('body[data-zhiyun] :is(input[type="checkbox"], input[type="radio"])');
  assert.ok(block, '找不到 checkbox 规则');
  assert.equal(px(block, 'width'), 16);
  assert.equal(px(block, 'height'), 16);
  assert.match(block, /accent-color/, '用强调色，避免浏览器默认蓝');
});

test('全站层只声明尺寸，不与页面层争视觉属性', () => {
  // border / outline / background 归页面层；全站层写这些会靠挂载顺序决胜
  const start = SHELL_UI.indexOf('基础控件的工效学尺寸');
  assert.ok(start > 0, '找不到基础控件段');
  const section = SHELL_UI.slice(start);
  // 输入框那条规则里不该出现 border 声明
  const inputBlock = (() => {
    const i = section.indexOf('body[data-zhiyun] :is(input:not([type])');
    if (i < 0) return null;
    const open = section.indexOf('{', i);
    const close = section.indexOf('}', open);
    return open < 0 || close < 0 ? null : section.slice(open + 1, close);
  })();
  assert.ok(inputBlock, '找不到输入框规则');
  assert.ok(!/border\s*:/.test(inputBlock), '全站层不写 border —— 与题库页争同一属性');
  assert.ok(!/outline\s*:/.test(inputBlock), '全站层不写 outline —— 焦点环归 workbench');
});

test('焦点环覆盖 a / [tabindex] / summary，不只是 button', () => {
  const idx = WORKBENCH.indexOf(':focus-visible');
  assert.ok(idx > 0, '找不到焦点环规则');
  const block = WORKBENCH.slice(Math.max(0, idx - 400), idx + 300);
  for (const sel of ['button', 'a', '[tabindex]', 'summary']) {
    assert.ok(block.includes(sel), `焦点环漏了 ${sel} —— 键盘用户在那类元素上看不见焦点`);
  }
});

test('输入类控件的焦点环贴边 1px（外扩 3px 会压到相邻标签）', () => {
  const block = (() => {
    const i = WORKBENCH.indexOf('.zy-page :is(input, textarea, select):focus-visible');
    if (i < 0) return null;
    const open = WORKBENCH.indexOf('{', i);
    const close = WORKBENCH.indexOf('}', open);
    return open < 0 || close < 0 ? null : WORKBENCH.slice(open + 1, close);
  })();
  assert.ok(block, '找不到输入类焦点规则');
  assert.equal(px(block, 'outline-offset'), 1);
});

test('表格/列表里的输入框也不低于 32px（选择器不依赖特定容器）', () => {
  // 关键：基础规则不绑 .zy-page/.zs-page 祖先，否则新容器里的控件会退回默认尺寸
  const block = SHELL_UI.match(/body\[data-zhiyun\] :is\(input:not\(\[type\]\)[^}]*\}/);
  assert.ok(block, '找不到基础输入规则');
  assert.ok(
    !/\.zy-page|\.zs-page/.test(block[0]),
    '不该依赖容器类 —— 之前绑了容器，导致页面外的输入框仍是 21px',
  );
});
