/**
 * 「文档」页在手机上：目录必须是**能打开、也能关回去**的浮层。
 *
 * # 这条守卫钉的是什么
 *
 * 反馈原话：「设置项移到导航栏，收起侧边抽屉按钮藏在左上角鲸鱼下等诸多设计都没法
 * 很好落实到窄屏上面」。
 *
 * 文档页的目录开关在导轨那只鲸鱼上（`useRegisterPageSidebar('docs', …)`）：
 * 它按 `navOpen` 显示「收起文档目录 / 展开文档目录」，点击翻转 `navOpen`。
 * 而窄屏的样式表原本是 `@media (max-width: 640px) { .zwd-nav { display: none } }`。
 *
 * 两件事凑在一起就是死的：
 *
 *   默认 `navOpen = true` → 鲸鱼写着「收起文档目录」，但目录**根本没显示**；
 *   点一下 → `navOpen = false` → 鲸鱼变「展开文档目录」；
 *   再点 → `navOpen = true`  → 目录仍然 `display: none`。
 *
 * 真机量过（390×844）：改前 `.zwd-nav` 的 rect 恒为 `[0, 0, 0, 0]`，`visible=false`；
 * 点完鲸鱼仍然是 0 —— 手机上的文档目录**永远打不开**。
 *
 * 所以窄屏断点里**不许再把目录 `display: none`**，改成盖在正文上的浮层，并且
 * `navOpen` 的初值跟着视口走（手机默认收起，桌面默认展开）。
 *
 * # 为什么钉在源码而不是只跑浏览器
 *
 * 这是**断点与可见性契约**：改回 `display: none` 不会报错，也不会让任何功能测试
 * 变红，只会让手机上重新没有目录。真机读数与截图见
 * `packages/client/pages-default/docs/evidence/narrow-touch/`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));
const CSS = readFileSync(path.join(root, 'packages/client/page-docs/src/style.css'), 'utf8');
const CLIENT = readFileSync(path.join(root, 'packages/client/page-docs/src/client.jsx'), 'utf8');

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

/** ≤ 640px 那个断点；没有则 undefined。 */
function phoneBlock(css) {
  return mediaBlocks(css).find(block => {
    const px = Number(/max-width:\s*(\d+)px/.exec(block.condition)?.[1]);
    return Number.isFinite(px) && px <= 640;
  });
}

const PHONE = phoneBlock(CSS);

test('手机断点里文档目录不能被 display:none 掉 —— 否则鲸鱼那个开关永远只能「收起」', () => {
  assert.ok(PHONE, '缺少 ≤ 640px 的手机断点');
  assert.doesNotMatch(PHONE.body, /\.zwd-nav\s*\{[^}]*display:\s*none/,
    '目录改回 display:none 会让「展开文档目录」这个动作在手机上永远无效');
});

test('手机断点里目录是盖在正文上的浮层，不是挤占版心的一栏', () => {
  assert.match(PHONE.body, /\.zwd-nav\s*\{[^}]*position:\s*absolute/,
    '手机上目录要脱离流布局，才能既打开又不把正文压成一条');
  assert.match(PHONE.body, /\.zwd-nav\s*\{[^}]*z-index:/,
    '浮层要压在正文之上');
  // 浮层不能盖满整屏 —— 底下要留出「这是一层浮层、外面还有正文」的视觉线索。
  assert.match(PHONE.body, /\.zwd-nav\s*\{[^}]*width:\s*min\(/,
    '浮层宽度要留白，不能 100% 盖死');
  assert.match(PHONE.body, /\.zwd-body\s*\{[^}]*position:\s*relative/,
    '浮层的定位上下文要是 .zwd-body');
});

test('浮层里每一条都是手指能点准的高度', () => {
  // 桌面 29px 一行（padding 3/4）在触屏上相邻两行只差 30px，误点率很高。
  assert.match(PHONE.body, /\.zwd-nav \.zwd-link\s*\{[^}]*padding:\s*10px/,
    '浮层里的目录条目要撑到 ~39px 一行');
  // 筛选框：全站输入框的 32px 地板被文档页写死的 28px 压掉了，手机上要抬起来。
  assert.match(PHONE.body, /\.zwd-filter\s*\{[^}]*height:\s*36px/,
    '筛选框在手机上要 ≥36px');
});

test('navOpen 的初值跟着视口走，不写死 true', () => {
  // 写死 true：手机上一进来就是目录盖住正文，而用户不知道盖住它的是什么东西。
  // 写死 false：桌面用户每次都要多点一下才看得到目录（229 + 740 明明放得下）。
  assert.match(CLIENT, /useState\(\(\)\s*=>\s*!isPhoneViewport\(\)\)/,
    'navOpen 初值必须按视口决定');
  assert.match(CLIENT, /export const PHONE_MAX_WIDTH = 640/,
    '手机断点常量要导出，方便与样式表对齐');
  // 两处必须是同一个数：样式表决定「怎么画」，客户端决定「默认开不开」。
  const cssWidth = Number(/max-width:\s*(\d+)px/.exec(PHONE.condition)?.[1]);
  const jsWidth = Number(/PHONE_MAX_WIDTH = (\d+)/.exec(CLIENT)?.[1]);
  assert.equal(cssWidth, jsWidth, '样式表与客户端用的手机断点必须一致');
});

test('手机上挑完一篇，浮层自己让开', () => {
  // 否则用户读完一篇要再去找一次那只鲸鱼才看得到正文 —— 多一步、且那一步不在视线里。
  const openBody = CLIENT.slice(CLIENT.indexOf('const open = id =>'), CLIENT.indexOf('};', CLIENT.indexOf('const open = id =>')) + 2);
  assert.match(openBody, /isPhoneViewport\(\)/, '切篇时要判断是不是手机');
  assert.match(openBody, /setNavOpen\(false\)/, '手机切篇后要收起浮层');
});
