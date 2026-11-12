/**
 * 笔记页的工具按钮必须**横排在本页顶部**，不能是左边那条竖列。
 *
 * # 这条守卫钉的是什么
 *
 * 真机反馈原话：「笔记库有两个导航bar，一个是 dsh pages 自带的，另一个是笔记库的
 * page 自带的」。页面壳（dsh-pages）在窗口最左边已经有一条**竖**导轨，页面自己
 * 再竖一条 46px 的图标列（Obsidian 的 ribbon），于是同一屏里并排两条竖导航：
 * 一条切页面、一条管笔记库内部。用户第一眼看不出哪条是干什么的。
 *
 * 所以这是**产品口径**：本页的操作按钮横排到页顶，左侧竖列只留页面壳的。
 * 它很容易被后来者"顺手改回 Obsidian 原样"，而那样改不会报错、测试也不红 ——
 * 只会让这个毛病重新出现。因此用静态断言钉住。
 *
 * # 为什么断言在源码上而不是截图上
 *
 * 截图能证明"这一次是横的"，但守不住下一次。这里钉的是三个结构事实：
 *   1. 页面上不再有 `.zws-nt-ribbon` 这个竖列容器；
 *   2. 操作按钮在 `.zws-nt-topbar` 里，且它是 `role="toolbar"`；
 *   3. `.zws-nt-work`（三栏）里**不含**工具栏 —— 工具栏在工作区之外、之上。
 *
 * 位置关系（在 `.zws-nt-work` 之前）这条 3 是纯粹的 DOM 顺序，读源码就能判，
 * 不需要造 DOM 桩。真机上的交互（开关文件树 / 右栏、新建笔记真的落盘）
 * 另由 `notes-batch-select.test.mjs` 那套真浏览器用例与提交记录里的实测覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));
const CLIENT = 'packages/client/page-notes/src/client.jsx';
const STYLE = 'packages/client/page-notes/src/style.css';
const src = readFileSync(path.join(root, CLIENT), 'utf8');
const css = readFileSync(path.join(root, STYLE), 'utf8');

/** 取 `<section className="zws-nt"` 到文件末尾的渲染树（只在 JSX 里找，注释先剥掉）。 */
function renderTree() {
  const at = src.indexOf('return <section className="zws-nt"');
  assert.ok(at >= 0, '找不到笔记页的渲染树');
  return src
    .slice(at)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')   // JSX 注释
    .replace(/\/\*[\s\S]*?\*\//g, '')       // 块注释
    .replace(/(^|\s)\/\/.*$/gm, '$1');       // 行注释
}

test('本页不再有左侧竖列（ribbon）—— 竖导航只留页面壳那一条', () => {
  assert.doesNotMatch(src, /zws-nt-ribbon/, '渲染树里不该再出现 zws-nt-ribbon');
  assert.doesNotMatch(css, /\.zws-nt-ribbon/, '样式表里不该再出现 .zws-nt-ribbon');
  assert.doesNotMatch(css, /\.zws-nt-ribbon-gap/, '样式表里不该再出现 .zws-nt-ribbon-gap');
});

test('操作按钮横排在页面顶部的工具栏里，且是 role="toolbar"', () => {
  const tree = renderTree();
  const barAt = tree.indexOf('className="zws-nt-topbar"');
  assert.ok(barAt >= 0, '找不到顶部工具栏 .zws-nt-topbar');

  // 工具栏要在 `.zws-nt-work`（三栏工作区）**之前**：它是页面的一条顶栏，
  // 不是工作区里的一列。顺序反了就是"又回到侧栏"。
  const workAt = tree.indexOf('className="zws-nt-work"');
  assert.ok(workAt >= 0, '找不到工作区 .zws-nt-work');
  assert.ok(barAt < workAt, '顶部工具栏必须在工作区之前（DOM 顺序即视觉上的上/左）');

  // role="toolbar" 是这排按钮的无障碍身份：一串图标按钮不带 role 时，
  // 读屏软件只能逐个念「按钮」，说不出这是一组本页操作。
  const bar = tree.slice(barAt, tree.indexOf('</div>', barAt));
  assert.match(bar, /role="toolbar"/, '顶部工具栏要声明 role="toolbar"');

  // 原有五类操作一个都不能在搬家路上丢掉。
  for (const label of ['文件树', '新建笔记', '新建文件夹', '导入 PDF', '过滤笔记', '右栏']) {
    assert.match(bar, new RegExp(`aria-label="${label}"`), `顶部工具栏缺少「${label}」`);
  }
});

test('工具栏是横排：flex-direction 不是 column，且没有固定竖列宽度', () => {
  const at = css.indexOf('body[data-zw] .zws-nt-topbar {');
  assert.ok(at >= 0, '找不到 .zws-nt-topbar 的样式规则');
  const rule = css.slice(at, css.indexOf('}', at));
  // 断言"没写 column"，而不是要求显式写 row：flex 默认就是 row，
  // 硬写一条 `flex-direction: row` 只会多一行没人维护的噪音。
  assert.doesNotMatch(rule, /flex-direction:\s*column/, '工具栏不该是竖列');
  assert.doesNotMatch(rule, /width:\s*\d+px/, '工具栏不该有固定宽度（它横跨整页）');
  assert.match(rule, /flex:\s*none/, '工具栏不参与纵向伸缩，否则会被三栏挤压');
  assert.match(rule, /border-bottom/, '横排到顶之后，分隔线在下边（原来那条竖列是 border-right）');
});
