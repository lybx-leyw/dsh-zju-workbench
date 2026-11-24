/**
 * 页面外壳的**滚动几何**守卫。
 *
 * # 这条在防什么
 *
 * DSH 的 \`main\` 槽只决定「谁占着中央面板」，官方 \`ui-layout\` 的
 * \`.mainPanel\` / \`.centerCol\` 都是 \`overflow: hidden\` —— **滚动归占位者**。
 *
 * 迁移到原生槽时，第三方页面壳的 \`PageFrame\` 被删掉，而那三层几何
 * （\`.zw-page\` / \`.zw-scroll\` / \`.zw-content\`）正是它提供的。少了它们，
 * 内容比屏幕高时下面那截**看不见也滚不到**。
 *
 * 症状极具迷惑性：页面看起来「渲染正常」，只是滚不动；没有任何报错，
 * 浏览器控制台干净。所以只能靠静态守卫拦。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const native = readFileSync(path.join(ROOT, 'packages/client/ui-shared/src/page-native.jsx'), 'utf8');
const css = readFileSync(path.join(ROOT, 'packages/client/ui-shared/src/style.css'), 'utf8');

test('页面内容被包进可滚动外壳（zw-page / zw-scroll / zw-content 三层）', () => {
  // 三层缺一不可：
  //   · zw-page   —— 撑满 mainPanel，给出确定高度；
  //   · zw-scroll —— flex:1 + overflow:auto，真正滚的是这一层；
  //   · zw-content —— 内容列（版心 / 内边距）。
  assert.match(native, /className="zw-page"/, '缺少 .zw-page：.zw-scroll 会没有确定高度');
  assert.match(native, /className="zw-scroll"/, '缺少 .zw-scroll：页面滚不动');
  assert.match(native, /className="zw-content zw-content-flush"/, '缺少 .zw-content：版心与内边距丢失');
  // data-page 是页面样式的锚点：学习页 / 论文页的 `.zw-content` 覆盖都写成
  // `.zw-page[data-page=<id>] .zw-content`，缺了它那些规则一条都不生效
  // （表现是内边距与版心全部退回默认值，页面看着「挤在一起」）。
  assert.match(native, /data-page=\{page\}/, '缺少 data-page：页面自有样式全部失配');

  // 面板注册必须真的把它包上 —— 只定义不调用等于没修。
  // 允许属性（`page` 用于写 data-page），只要求真的把内容包进去。
  assert.match(native, /<PageSurface[\s>][\s\S]*<\/PageSurface>/, 'main 面板没有用 PageSurface 包裹');
});

test('三条几何规则仍然存在且含义未变', () => {
  // 规格来自祖先页面的实测（见 style.css 该段注释）。
  assert.match(css, /\.zw-page\s*\{[^}]*height:\s*100%/, '.zw-page 必须有确定高度');
  assert.match(css, /\.zw-scroll\s*\{[^}]*overflow:\s*auto/, '.zw-scroll 必须是滚动容器');
  assert.match(css, /\.zw-scroll\s*\{[^}]*min-height:\s*0/, '.zw-scroll 少了 min-height:0 会被内容撑破而不滚');
});
