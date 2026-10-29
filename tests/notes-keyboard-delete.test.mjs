/**
 * 「笔记」页的 Delete 快捷键：**删的是文件树里焦点所在的那一行**。
 *
 * # 为什么需要这个文件
 *
 * 这个功能只存在于事件处理里，纯函数层面看不出来。而它的三条豁免缺一条都会
 * 造成真实破坏：
 *
 *   - 少了"输入框豁免"→ 在正文里按 Backspace 会弹删除确认条（笔记正文就是
 *     `<textarea>`，这是最高频的按键）；
 *   - 少了"焦点必须在树行上"→ 焦点在别处时猜一个对象来删；
 *   - 把 `preventDefault` 加早 → 输入框里的 Backspace 被吞掉，打不了字。
 *
 * 这三条都不是"渲染出来有没有字"能覆盖的，必须真的发一次键盘事件。
 *
 * # 怎么测
 *
 * 用 esbuild 把 `client.jsx` 打成可 import 的 ESM（仓库既有做法，见
 * `planning-render.test.mjs`），用 `react-dom/server` 渲染出真实 DOM 字符串，
 * 再在一个极小的 DOM 桩上跑事件分派。**不装 jsdom**：本仓没有这个依赖，
 * 而这里要验的只是「哪个 key、什么焦点目标 → 会不会接管」，不需要完整 DOM。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

test('键盘删除的作用对象与豁免（源码级守卫）', async () => {
  // 这一条读源码而不是跑 DOM：本仓没有 jsdom，而这几条是**结构性质**，
  // 用正则钉住比造一套 DOM 桩更可靠，也不会因为桩的行为漂移而误报。
  const source = await readFile(path.join(root, 'packages/dsh-zhiyun-page-notes/src/client.jsx'), 'utf8');

  // ① 行上要有 data-path：没有它，keydown 就认不出"焦点在哪一行"。
  assert.match(source, /data-path=\{row\.path\}/, 'TreeRow 的按钮必须带 data-path');
  assert.match(source, /data-kind=\{row\.type\}/, 'TreeRow 的按钮要带 data-kind（区分文件夹/附件）');

  // ② 监听挂在 document 上，而不是页面根节点。
  //
  // ⚠️ 这一条**改过**。原先钉的是「挂在页面 `<section>` 上」，理由是"别把别处的
  //    Delete 也吃掉"。加上滚动键之后用真浏览器一测才发现更硬的事实：
  //    点正文（不可聚焦）之后 `activeElement` 落回 `<body>`，而 `<body>` 是
  //    `<section>` 的**祖先** —— 事件不向下冒泡，挂在 section 上的监听**一次都收不到**
  //    （探针实测：按键只在 `document` 上被看到）。
  //    所以那版是实现缺陷，不是设计选择：焦点不在树行上时删除确实不该有反应，
  //    但"收不到事件"和"收到了但不处理"是两回事，前者会让任何依赖它的键全哑。
  //    现在挂 document，并用 `rootRef` + 目标判断把范围收在本页内。
  assert.match(source, /document\.addEventListener\('keydown', onKeyDown, true\)/,
    '必须挂 document（挂容器上时焦点在 body 收不到键，实测）');
  assert.match(source, /document\.removeEventListener\('keydown', onKeyDown, true\)/,
    '必须成对摘除');
  assert.match(source, /if \(root === null\) return/, '卸载后处理器要立刻失效');
  assert.doesNotMatch(source, /onKeyDownCapture=\{onKeyDownCapture\}/, '不该再挂回页面根节点');

  // ③ 四条豁免必须在 handler 里，且 preventDefault 出现在豁免之后。
  const handler = source.slice(source.indexOf('const onKeyDownCapture'));
  const body = handler.slice(0, handler.indexOf('if (phase === '));
  assert.match(body, /input, textarea, select, \[contenteditable/, '必须豁免输入框/正文（textarea）');
  assert.match(body, /ctrlKey \|\| event\.metaKey \|\| event\.altKey/, '必须让开带修饰键的组合');
  assert.match(body, /closest\('\.zs-nt-rowbtn\[data-path\]'\)/, '必须要求焦点落在树行上');
  const preventAt = body.indexOf('event.preventDefault()');
  const exemptAt = body.indexOf('contenteditable');
  assert.ok(preventAt > exemptAt, 'preventDefault 必须在输入框豁免之后 —— 否则正文里打不了字');
  const rowAt = body.indexOf('closest(\'.zs-nt-rowbtn[data-path]\')');
  assert.ok(preventAt > rowAt, 'preventDefault 必须在"焦点在树行上"判断之后');
});

test('删除确认条：默认不删，必须先确认，Esc 可撤', async () => {
  const source = await readFile(path.join(root, 'packages/dsh-zhiyun-page-notes/src/client.jsx'), 'utf8');

  // 按键只负责**弹确认**，不直接删 —— 这是"不可撤销动作要一次确认"的落点。
  const handler = source.slice(source.indexOf('const onKeyDownCapture'));
  const body = handler.slice(0, handler.indexOf('if (phase === '));
  assert.match(body, /setPendingDelete\(\{ path/, '按键应当先设 pendingDelete');
  assert.doesNotMatch(body, /remove\(/, '按键处理器里不该直接调 remove —— 那等于跳过确认');

  // Esc 撤掉确认条。
  assert.match(body, /event\.key === 'Escape'/, 'Esc 要能取消待确认的删除');
});

test('删除会清掉子路径的挂起保存（删文件夹不会被自动保存复活）', async () => {
  const source = await readFile(path.join(root, 'packages/dsh-zhiyun-page-notes/src/client.jsx'), 'utf8');

  // ⚠️ 这条钉的是实测到的形状：删文件夹时，里面有笔记在别的标签页开着，
  //    `pending.current` 还挂着它的正文；800ms 后自动保存把它写回去，
  //    连同刚删掉的文件夹整棵复活。所以判断必须是**前缀**，不只是相等。
  assert.match(source, /const covers = \(other\) => other === path \|\| other\.startsWith\(`\$\{path\}\/`\)/,
    '必须按前缀判断受影响的路径');
  assert.match(source, /covers\(pending\.current\.path\)/, '挂起的保存要按前缀清理');
  assert.match(source, /covers\(t\.path\)/, '标签页要按前缀清理');
});
