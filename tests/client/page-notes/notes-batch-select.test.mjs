/**
 * 「笔记」页的 Shift+↑/↓ 区间选择 + Delete 批量删除。
 *
 * # 为什么这一条必须用真浏览器
 *
 * 这八条行为没有一条是"渲染出来有没有字"能覆盖的，也没有一条能靠纯函数测：
 *
 *   1. **选择是派生状态，不是被存下来的状态**。唯一真源是「锚点 + 游标 + 可见行」
 *      这三样，选中集合由 `selectionRange(rowPaths, anchor, cursor)` 每次渲染现算。
 *      只测 `selectionRange` 的话，测到的是"算法算得对"，测不出"按键到底有没有
 *      走到它"—— 而按键要先过 `document` 捕获阶段的监听、过输入区豁免、还要在
 *      `event.target` 不是树行时靠游标回退去认行。这三道关口任何一道写错，
 *      纯函数测试全绿、键盘全哑。
 *   2. **真机上焦点靠不住**。点完树行 `activeElement` 仍是 `BODY`（本仓滚动键
 *      测试里实测过，见 notes-scroll-keys.test.mjs 顶部）。所以"选中了哪一行"
 *      只能问界面上的 `.is-cursor` / `.is-selected`，不能问 `activeElement`。
 *      这一条只有渲染出真 DOM 才看得见。
 *   3. **"只发一次 RPC"是网络行为**。`removeMany` 一次 vs 循环 `remove` N 次，
 *      差别只在 `fetch` 的调用序列里；光看删除后的 DOM，两者一模一样 —— 而前者
 *      是加这个方法的**全部理由**（宿主每处理完一次写操作就重读全库刷索引，
 *      循环 30 次会让界面卡住）。
 *   4. **Esc 的优先级**（先撤确认条、再撤选择、游标保留）是纯粹的**顺序**行为，
 *      只有把两个状态同时立起来、再按同一个键，才测得出来。
 *   5. **Delete 弹的是本页自己的确认条**（`.zws-nt-confirm`），不是 `window.confirm`。
 *      未确认前磁盘一个字都不能动 —— 这是这页唯一不可逆的动作，必须用真按键
 *      证明"按键只弹条、不删盘"。
 *
 * # ⚠️ 一个有位移的界面会让"点一下"变成"点两下"（本文件抓到的真缺陷）
 *
 * 有区间选择时，计数条 `.zws-nt-selection` 挂在**确认条上方**。而 `pointerdown`
 * 处理器会重置树状态 —— 一旦它在这次 pointerdown 里把锚点清掉，计数条就**当场
 * 卸载**，它下面整块内容**上移**。实测（1200×800，真实 style.css，系统 Edge）：
 *
 *   · 确认条 top 141 → 93（上移 48px），「取消」按钮中心 y 255 → 207；
 *   · 原坐标 (216,255) 处抬起时命中的是 `SPAN :: 第二篇`（树行），不是按钮；
 *   · 浏览器合成的 `click` 因此落在树行上 —— 按钮的 `onClick` 一次都没跑，
 *     `removeMany` 调用数 0、行的数量不变。用户看到的就是「点确认删除没反应」。
 *
 * 根因不是"点得不够用力"，是**按下与抬起之间元素跑掉了**。
 *
 * ## 同一个根因的第二种形状：点树行也落空
 *
 * 选中 3 条后去点树上另一篇，第一下同样打不开。逐行实测（6 行树，每行单独重来）：
 *
 *   | 点的行 | pointerdown 后计数条 | 抬起时同坐标命中 | 结果           |
 *   |--------|----------------------|------------------|----------------|
 *   | 第 0 行 | 卸载                | 同一行本身        | ✅ 歪打正着     |
 *   | 第 1 行 | 卸载                | 下一行            | ❌ 落空         |
 *   | 第 2 行 | 卸载                | 下一行            | ❌ 落空         |
 *   | 第 3 行 | 卸载                | 下一行            | ❌ 落空         |
 *   | 第 4 行 | 卸载                | 树容器 UL        | ❌ 落空         |
 *   | 第 5 行 | 卸载                | 树容器 UL        | ❌ 落空         |
 *
 * 6 行里 5 行中招；位移量是**一行的高度（28px）**，确认条那边是 48px。
 * 第 0 行之所以"通过"纯属巧合 —— 所以 ⑨ 坚持逐行测，只测第 0 行等于没测。
 *
 * ## 结论（这条留给人看，比任何一条断言都重要）
 *
 * **一条会伸缩的横条插在可点击列表上面时，任何"在 pointerdown 里改变它"的逻辑，
 * 都会让按下与抬起落在不同元素上 → click 必然不落在用户按的那个东西上。**
 * 最终的修法是把"清区间选择"整体从 `pointerdown` 挪到 `click`
 * （按下与抬起之间布局完全不动），而不是在每个按钮上加守卫 —— 后者只是补症状。
 *
 * 这类缺陷**源码级正则守卫永远抓不到**（`tests/notes-keyboard-delete.test.mjs`
 * 就是正则级），只有真按一次、且在真布局里按，才看得见。所以本文件里凡是点
 * 确认条 / 计数条 / 树行的地方，要么用 `locator.click()`、要么用 `page.mouse`
 * 按坐标真点（**不能**用 `dispatchEvent` 合成 click：位置不参与，测不出落空），
 * 并且**断言只要一次就生效**。
 *
 * # 覆盖的九条行为
 *
 *   ① 点树上一行 → 该行成为游标（`.zws-nt-row.is-cursor`）；
 *   ② Shift+↓ 两次 → 游标下移两行，**三行**带 `.is-selected`，且计数条可见；
 *   ③ Shift+↑ → 区间**收缩**到 2 行（不是另起一段新的选择）；
 *   ④ 普通 ↓ → 选择塌缩（锚点清空），游标继续下移；
 *   ⑤ 焦点在正文 `textarea` 里时 Shift+↓ **不**选中树行（要留给"选正文文字"），
 *      普通 ↓ 仍然只移动正文光标、不滚正文；
 *   ⑥ Delete（有区间选中时）→ 弹确认条、文案带条数；**此时磁盘没删**；
 *      点一次「取消」就收掉确认条，且**选择原样保留**（反悔 ≠ 放弃选择）；
 *   ⑦ 确认后 → 行消失，且 `fetch` 里只出现过**一次** `removeMany`，payload 正好是那几条；
 *   ⑧ Esc 撤掉区间选择、**保留游标**；确认条挂着时 Esc 先撤确认条、再按一次才撤选择；
 *   ⑨ 有区间选中时点树上另一行 → **一次点击**就切换激活笔记 + 清掉选择（逐行验 6 行）。
 *
 * # 每条断言钉的真实风险
 *
 * 写在每个 test 的函数体注释里 —— 那才是以后改这块代码的人会读到的地方。
 *
 * # 跑法
 *
 *   node --test tests/notes-batch-select.test.mjs
 *
 * 本机 Playwright 自带的 Chromium 常常没装（`chromium.executablePath()` 指向的
 * 文件不存在），所以沿用 notes-scroll-keys.test.mjs 的 `launchBrowser()` 回退链：
 * 退到系统 Edge / Chrome。一个都起不来时 `t.skip` 并说明原因 —— 但绝不静默通过。
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/**
 * 与页面同构的树数据（= 夹具里的"磁盘"）。
 *
 * ⚠️ 数组顺序**不是**断言依据：`buildRows()` 会按「文件夹 → 笔记 → 附件 + 名称
 *    localeCompare」重排，而排序结果取决于浏览器的 ICU。所以每个测试都先读
 *    DOM 里的实际顺序（`rowPaths()`），再拿它做断言 —— 与用户看到的顺序同源。
 *
 * # 为什么是 6 行
 *
 * ⑨ 要逐行验"有选区时点树行能一次切换"。用 3-4 行测不出来：位移恰好是**一行的
 * 高度**（实测 28px），于是位移之后新顶上来的那一行是不是恰好又命中目标，取决于
 * 行数和点在树里的位置。当初用 4 行时第 0 行"歪打正着"是通过的，换成 6 行才
 * 稳定复现"6 行里 5 行落空"。夹具在这里就是仪器的量程，不能省。
 */
const TREE = [
  { type: 'note', path: '第一篇甲', title: '第一篇甲', folder: '', preview: '', chars: 20 },
  { type: 'note', path: '第二篇乙', title: '第二篇乙', folder: '', preview: '', chars: 20 },
  { type: 'note', path: '第三篇丙', title: '第三篇丙', folder: '', preview: '', chars: 20 },
  { type: 'note', path: '第四篇丁', title: '第四篇丁', folder: '', preview: '', chars: 20 },
  { type: 'note', path: '第五篇戊', title: '第五篇戊', folder: '', preview: '', chars: 20 },
  { type: 'note', path: '第六篇己', title: '第六篇己', folder: '', preview: '', chars: 9000 },
];

/**
 * 页面引导脚本：把真实组件挂到 `#host` 上，并用桩替换 `fetch`。
 *
 * `window.__calls` 记下每次 RPC 的 `{ method, args, route }` —— ⑦ 的
 * 「只调一次 removeMany」以及 ⑥ 的「确认前一次都没调」都靠它断言。
 * `window.__tree` 是可变夹具：`removeMany` 真的从里面摘掉条目，于是删完后
 * `tree` 返回的行会变少，页面的 `refreshTree()` 才有东西可刷。
 */
const BOOTSTRAP = `
import React from "react";
import { createRoot } from "react-dom/client";
import { NotesLibrary } from "./packages/client/page-notes/src/client.jsx";

const TREE = ${JSON.stringify(TREE)};
window.__fixtureCount = TREE.length;
window.__tree = TREE.slice();
window.__calls = [];

window.fetch = async (url, init) => {
  let method = "";
  let args = null;
  try {
    const body = JSON.parse(init?.body ?? "{}");
    method = body?.payload?.method ?? "";
    args = body?.payload?.args ?? null;
  } catch (error) { /* 不是 JSON 就当方法名空着 */ }
  window.__calls.push({
    method,
    args: args === null ? null : JSON.parse(JSON.stringify(args)),
    route: String(url),
  });

  let value = null;
  if (method === "tree") {
    value = window.__tree.slice();
  } else if (method === "read") {
    const name = String(args?.name ?? "");
    // 多行正文：⑤ 要靠 shift+↓ 在 textarea 里真的选中下一行文字。
    value = { name, markdown: "# " + name + "\\n\\n第一行正文。\\n第二行正文。\\n第三行正文。\\n" };
  } else if (method === "removeMany") {
    const paths = Array.isArray(args?.paths) ? args.paths : [];
    const removed = [];
    for (const p of paths) {
      const before = window.__tree.length;
      window.__tree = window.__tree.filter((entry) => !(entry.path === p || entry.path.startsWith(p + "/")));
      if (window.__tree.length < before) removed.push({ path: p, kind: "note", contained: 0 });
    }
    value = { removed, missing: [], skipped: [], coveredCount: 0 };
  } else if (method === "backlinks" || method === "tags") {
    value = [];
  } else if (method === "graph") {
    value = { nodes: [], edges: [] };
  }
  return { status: 200, ok: true, json: async () => ({ result: { ok: true, value } }) };
};

createRoot(document.getElementById("host")).render(React.createElement(NotesLibrary));
`;

/**
 * 把页面打成单文件 IIFE（连 React 一起打进去）。
 *
 * 打 IIFE 而不是 ESM：浏览器不能解析裸模块名，而这里要的是一个能直接
 * `<script src>` 的产物。三个外部包的桩照抄 notes-scroll-keys.test.mjs。
 */
async function bundle() {
  const dir = await mkdtemp(path.join(root, '.verify-render-'));
  const outfile = path.join(dir, 'app.js');
  const { build } = await import('esbuild');
  const STUBS = {
    '@lybx-leyw/dsh-zju-ui-shared': `import React from "react";
      export const Icon = () => React.createElement("i");
      export const Notice = (p) => React.createElement("div", { className: "notice" }, p.children);
      export const mountStyle = () => {};
      // 页面半边 import 了这个（见 page-notes/client.jsx 的 apply）。
      // 桩里缺它会让 esbuild 构建失败，而失败后的进程不退出，看着像 hang。
      export const registerPageContent = () => {};`,
    '@lybx-leyw/dsh-zju-ui-graph-render': `export const NoteGraph = () => null; export const css = "";`,
    '@deepseek-ai/dsh-client-ui-primitives': `import React from "react";
      export const MarkdownText = (p) => React.createElement("div", { className: "md" }, p.text);`,
  };
  await build({
    stdin: { contents: BOOTSTRAP, resolveDir: root, loader: 'jsx' },
    bundle: true, write: true, outfile, format: 'iife', jsx: 'automatic', logLevel: 'silent',
    loader: { '.css': 'text', '.svg': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: new RegExp(`^(${Object.keys(STUBS).map((n) => n.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})$`) },
          (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'jsx', resolveDir: root }));
      },
    }],
  });
  return { dir, outfile };
}

/**
 * 真机的布局链 + 本页需要的几个类。
 *
 * 样式本身不是断言对象（选中与否看类名），但**必须让元素可点、可滚**：
 * ⑦ 要真点确认条上的按钮，⑤ 要靠 textarea 的内部滚动与光标。所以照抄
 * notes-scroll-keys.test.mjs 里那条带上 `min-height:0` 的 flex 链 —— 那条链是
 * 从真机量测反推出来的，随便简化会让 `.zws-nt-scroll` 与树容器失去限高。
 */
const CSS = [
  'html,body{margin:0;height:100%;overflow:hidden}',
  '.zw-page{display:flex;flex-direction:column;height:100%;min-width:0}',
  '.zw-scroll{flex:1;overflow:auto;min-height:0}',
  '.zw-content.zw-content-flush{max-width:none;padding:0;height:100%;display:flex;flex-direction:column;min-height:0}',
  '.host{display:flex;flex-direction:column;flex:1;min-height:0}',
  /* 与 style.css 一致：工具栏要贴着下面的三栏，所以根容器没有 gap。 */
  '.zws-nt{display:flex;flex-direction:column;gap:0;flex:1;min-height:0}',
  '.zws-nt-work{display:flex;flex:1;min-height:0;overflow:hidden}',
  '.zws-nt-topbar{display:flex;align-items:center;gap:3px;padding:5px 8px}',
  '.zws-nt-explorer{width:240px;display:flex;flex-direction:column;min-height:0}',
  '.zws-nt-tree{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1;min-height:0}',
  '.zws-nt-rowbtn{display:block;width:100%;text-align:left;padding:6px}',
  '.zws-nt-row.is-cursor .zws-nt-rowbtn{outline:2px solid #5b8cff}',
  '.zws-nt-row.is-selected{background:#dfe8ff}',
  '.zws-nt-selection{display:flex;gap:8px;align-items:center;padding:4px 8px;background:#eef3ff;font-size:12px}',
  '.zws-nt-confirm{padding:8px;background:#fff4e5;border:1px solid #e0a040;font-size:12px}',
  '.zws-nt-confirm-list{margin:4px 0;padding-left:18px}',
  '.zws-nt-main{flex:1 1 auto;min-width:400px;min-height:0;display:flex;flex-direction:column}',
  '.zws-nt-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;padding:20px}',
  '.zws-nt-input{width:100%;min-height:420px;border:0;resize:none;font:15.5px/1.9 sans-serif;display:block}',
].join('\n');

const HTML = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <div class="zw-page" data-page="notes"><main class="zw-scroll"><div class="zw-content zw-content-flush">
  <div class="host" id="host"></div></div></main></div><script src="/app.js"></script>`;

const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();

/** 一个浏览器都起不来时给用户的动作指引（不含任何本机路径）。 */
const NO_BROWSER = '没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge / Chrome / Playwright Chromium';

/**
 * 找一个能真正启动的浏览器。
 *
 * 为什么不能只用 `chromium.executablePath()`：那条路径指向 Playwright **自带的**
 * Chromium，本机常常没装（`exists: false`），于是整条测试永久 skip —— 一个永远
 * 不跑的测试等于没有。系统装的 Edge / Chrome 是同一套内核，用作回退足够。
 */
async function launchBrowser() {
  const attempts = [];
  if (existsSync(browserPath)) attempts.push({ executablePath: browserPath });
  attempts.push({ channel: 'msedge' });
  attempts.push({ channel: 'chrome' });
  attempts.push({ headless: true });

  for (const attempt of attempts) {
    try {
      const options = { headless: true };
      if (attempt.executablePath) options.executablePath = attempt.executablePath;
      if (attempt.channel) options.channel = attempt.channel;
      return await chromium.launch(options);
    } catch { /* 试下一个 */ }
  }
  return null;
}

/**
 * 整个文件共用的浏览器 + 打包产物 + 本地静态服务器。
 *
 * 打包和启动都很贵（esbuild 一次、浏览器一次），所以**只做一次**；每个测试
 * 各开一个新 page —— `window` 状态天然隔离，夹具（`__tree` / `__calls`）互不污染。
 */
let harnessPromise = null;

async function ensureHarness() {
  if (harnessPromise === null) {
    harnessPromise = (async () => {
      const browser = await launchBrowser();
      if (browser === null) return null;
      const { dir, outfile } = await bundle();
      const pageFile = path.join(dir, 'host.html');
      await writeFile(pageFile, HTML);
      const server = createServer(async (req, res) => {
        const name = (req.url ?? '/').split('?')[0];
        const isScript = name === '/app.js';
        res.writeHead(200, { 'content-type': isScript ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
        res.end(await readFile(isScript ? outfile : pageFile));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return { browser, server, dir, port: server.address().port };
    })();
  }
  return harnessPromise;
}

after(async () => {
  const harness = await harnessPromise?.catch(() => null);
  if (!harness) return;
  await harness.browser.close().catch(() => {});
  await new Promise((resolve) => harness.server.close(resolve));
  await rm(harness.dir, { recursive: true, force: true }).catch(() => {});
});

/** 等 React 把状态变化渲染出来。这里刻意不猜"多久够"，只是给一帧以上的余量。 */
const settle = (page) => page.waitForTimeout(150);

/** 打开一个新的页面，跑完 `body` 后关掉它；页面异常一律算失败。 */
async function withPage(t, body) {
  const harness = await ensureHarness();
  if (harness === null) {
    t.skip(NO_BROWSER);
    return;
  }
  const page = await harness.browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${harness.port}/`, { waitUntil: 'networkidle' });
    // 首屏会把整棵树读出来并自动打开第一篇 —— 等行数到齐再动手，避免和挂载竞速。
    await page.waitForFunction(
      () => document.querySelectorAll('.zws-nt-rowbtn[data-path]').length === window.__fixtureCount,
    );
    await body(page);
    assert.deepEqual(errors, [], '页面不该有异常');
  } finally {
    await page.close().catch(() => {});
  }
}

// ── 读界面 / 读夹具的小工具（全部只读 DOM 与 window，不假设任何实现细节）──

/** 可见行的路径，**按屏幕顺序**（就是 `.zws-nt-rowbtn[data-path]` 的 DOM 顺序）。 */
const rowPaths = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.zws-nt-rowbtn[data-path]')].map((btn) => btn.dataset.path));

/** 游标所在行（真机上 `activeElement` 靠不住，只能看这个类）。 */
const cursorPath = (page) => page.evaluate(() =>
  document.querySelector('.zws-nt-row.is-cursor .zws-nt-rowbtn')?.dataset?.path ?? null);

/** 带选中标记的行，按屏幕顺序。 */
const selectedPaths = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.zws-nt-row.is-selected .zws-nt-rowbtn')].map((btn) => btn.dataset.path));

/** 计数条的文案（没有计数条就是 null）。 */
const selectionText = (page) => page.evaluate(() =>
  document.querySelector('.zws-nt-selection')?.textContent?.trim() ?? null);

/** 已经发出去的 RPC 方法名序列。 */
const callMethods = (page) => page.evaluate(() => window.__calls.map((call) => call.method));

/** 夹具里的条目数（在这个测试里，它就代表"磁盘上还有几篇"）。 */
const fixtureLen = (page) => page.evaluate(() => window.__tree.length);

/**
 * 像用户那样点一行：pointerdown → pointerup → click。
 *
 * ⚠️ 这里**不能**用 `page.click()` / `focus()`：真机上宿主会把焦点拿走，
 *    `page.click()` 还会被常驻遮罩拦下且失败是静默的（notes-scroll-keys 的实测）。
 *    派发等价的 PointerEvent 走的是与用户点击同一条 `pointerdown → click` 路径，
 *    页面靠 `pointerdown` 记录"用户在树上"，靠 `click` 打开笔记。
 */
const clickRow = (page, index) => page.evaluate((at) => {
  const btn = document.querySelectorAll('.zws-nt-rowbtn[data-path]')[at];
  if (!btn) throw new Error(`树里没有第 ${at} 行`);
  const options = {
    bubbles: true, cancelable: true, composed: true,
    clientX: 10, clientY: 10, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
  };
  btn.dispatchEvent(new PointerEvent('pointerdown', options));
  btn.dispatchEvent(new PointerEvent('pointerup', options));
  btn.dispatchEvent(new MouseEvent('click', options));
}, index);

/**
 * 只派发 pointerdown（不点开笔记）。
 *
 * ⑤ 需要造一个"游标在某行、但焦点在正文 textarea 里"的状态。真机上点到
 * textarea 一定会先发一次 pointerdown 把游标清掉，所以那个状态**只能靠这里合成**。
 * 它测的是一条硬性顺序：输入区豁免必须排在"认游标"之前 —— 否则用户想在正文里
 * Shift+↓ 选一行字，结果框住了左边的树。
 */
const pointerDownRow = (page, index) => page.evaluate((at) => {
  const btn = document.querySelectorAll('.zws-nt-rowbtn[data-path]')[at];
  if (!btn) throw new Error(`树里没有第 ${at} 行`);
  btn.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, composed: true,
    clientX: 10, clientY: 10, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
  }));
}, index);

/** 「点第一行 → Shift+↓ 两次」：②⑥⑦⑧ 的前置状态（前三行选中、游标在第三行）。 */
async function selectFirstThree(page, order) {
  await clickRow(page, 0);
  await settle(page);
  await page.keyboard.press('Shift+ArrowDown');
  await settle(page);
  await page.keyboard.press('Shift+ArrowDown');
  await settle(page);
  assert.deepEqual(await selectedPaths(page), order.slice(0, 3), '前置：前三行应已选中');
}

test('① 点树上一行 → 该行成为游标，且界面上看得见', async (t) => {
  // 钉的风险：真机上点完树行 `activeElement` 是 `BODY`、focusin 为空 ——
  // 若实现拿焦点当"选中"，这条会红；若实现只记 ref 不记可见状态，用户按了 ↑/↓
  // 也看不到任何反馈。所以断言落在 `.is-cursor` 这个**渲染结果**上。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    assert.equal(order.length, TREE.length, `夹具应有 ${TREE.length} 行，实际 ${JSON.stringify(order)}`);
    assert.equal(await cursorPath(page), null, '还没点过任何行，不该有游标');

    await clickRow(page, 0);
    await settle(page);

    assert.equal(await cursorPath(page), order[0], '点过的那一行应成为游标');
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.zws-nt-row.is-cursor').length), 1,
      '游标只能有一个');
    assert.deepEqual(await selectedPaths(page), [], '单纯点一下不等于区间选择');
    assert.equal(await selectionText(page), null, '没框到多行时不该出现计数条');
  });
});

test('② Shift+↓ 两次 → 游标下移两行，三行都选中，计数可见', async (t) => {
  // 钉的风险：锚点只在**第一次**按住 Shift 时记下来。若实现每次按键都重置锚点，
  // 用户永远只能选中相邻两行（"越按越短"）；若按下时记的是移动**之后**的游标，
  // 三行会变成两行。两种错法都只在连按两次后才看得出来。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    await clickRow(page, 0);
    await settle(page);

    await page.keyboard.press('Shift+ArrowDown');
    await settle(page);
    assert.equal(await cursorPath(page), order[1], '第一次 Shift+↓ 游标应到第二行');
    assert.deepEqual(await selectedPaths(page), order.slice(0, 2), '第一次 Shift+↓ 应选中前两行');

    await page.keyboard.press('Shift+ArrowDown');
    await settle(page);
    assert.equal(await cursorPath(page), order[2], '第二次 Shift+↓ 游标应到第三行');
    assert.deepEqual(await selectedPaths(page), order.slice(0, 3), '三行都要带选中标记');

    const bar = await selectionText(page);
    assert.ok(bar !== null, '选中多行时必须出现计数条');
    assert.match(bar, /已选中 3 条/, `计数条要说清条数，实际文案：${bar}`);
    assert.equal(await fixtureLen(page), TREE.length, '选择不该动磁盘上的任何东西');
  });
});

test('③ Shift+↑ → 区间收缩到 2 行（不是另起一段）', async (t) => {
  // 钉的风险：往回按必须是**缩**同一段选择。如果实现把锚点改成"上次游标"，
  // Shift+↑ 会从第三行重新起一段，结果还是 2 行——但方向反了；更常见的是锚点
  // 被覆盖成第三行，于是区间变成「第三行→第二行」= 依然两行，看不出错，
  // 直到用户按第三次才发现自己框的不是想要的那一段。这里钉死**留下的是第一二行**。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    await selectFirstThree(page, order);

    await page.keyboard.press('Shift+ArrowUp');
    await settle(page);

    assert.equal(await cursorPath(page), order[1], 'Shift+↑ 应把游标退回第二行');
    assert.deepEqual(await selectedPaths(page), order.slice(0, 2), '区间应收缩成前两行（锚点没动）');
    assert.match(await selectionText(page) ?? '', /已选中 2 条/, '计数要跟着缩');
  });
});

test('④ 普通 ↓ → 选择塌缩，游标继续下移', async (t) => {
  // 钉的风险：不带 Shift 的移动必须放弃选择（与资源管理器一致）。若实现忘了清锚点，
  // 用户"松手后随便走走"时选择会跟着一路长大，下一次 Delete 删掉的东西比看到的多 ——
  // 这是这一页最危险的一类错（不可逆）。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    await selectFirstThree(page, order);
    assert.ok((await selectedPaths(page)).length === 3, '前置：三行已选中');

    await page.keyboard.press('ArrowDown');
    await settle(page);

    assert.equal(await cursorPath(page), order[3], '游标应继续移到第四行');
    assert.deepEqual(await selectedPaths(page), [], '普通 ↓ 之后选择应整体消失');
    assert.equal(await selectionText(page), null, '计数条也要跟着消失');
  });
});

test('⑤ 焦点在正文 textarea 时：Shift+↓ 不选中树行，↓ 只移光标', async (t) => {
  // 钉的风险（两条，都是真实破坏）：
  //   1. 少了输入区豁免 → 用户在正文里 Shift+↓ 想选一行字，左边树却框住了几篇笔记，
  //      紧接着一个 Delete 就删了它们；
  //   2. 把"认游标"排在豁免之前 → 即使豁免写在后面也晚了：游标一命中就 moveCursor +
  //      preventDefault，正文里再也选不了字（textarea 的原生选区被吃掉）。
  // 所以这里刻意把"游标非空"和"焦点在 textarea"同时立起来，再按 Shift+↓。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    await page.getByRole('button', { name: '编辑' }).first().click();
    const textarea = page.locator('textarea.zws-nt-input');
    await textarea.waitFor();

    // 合成出"游标在第一行、焦点在 textarea"的状态（真机上这个组合只能这样造）。
    await pointerDownRow(page, 0);
    await settle(page);
    assert.equal(await cursorPath(page), order[0], '前置：游标应在第一行');
    await page.evaluate(() => {
      const el = document.querySelector('textarea.zws-nt-input');
      el.focus();
      el.selectionStart = el.selectionEnd = 0;
      el.scrollTop = 0;
      document.querySelector('.zws-nt-scroll').scrollTop = 0;
    });
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'TEXTAREA',
      '前置：焦点要真的在正文里');

    await page.keyboard.press('Shift+ArrowDown');
    await settle(page);
    assert.deepEqual(await selectedPaths(page), [], '正文里的 Shift+↓ 不该选中树行');
    assert.equal(await selectionText(page), null, '不该出现计数条');
    assert.equal(await cursorPath(page), order[0], '游标不该被正文里的按键推走');
    assert.ok(await page.evaluate(() => document.querySelector('textarea.zws-nt-input').selectionEnd) > 0,
      'Shift+↓ 必须留给浏览器去选正文文字（被 preventDefault 掉就选不了了）');

    // 普通 ↓：仍然只移光标，不滚正文。
    await page.evaluate(() => {
      const el = document.querySelector('textarea.zws-nt-input');
      el.selectionStart = el.selectionEnd = 0;
    });
    await page.keyboard.press('ArrowDown');
    await settle(page);
    assert.ok(await page.evaluate(() => document.querySelector('textarea.zws-nt-input').selectionStart) > 0,
      '正文里按 ↓ 应移动光标');
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.zws-nt-scroll').scrollTop)), 0,
      '正文里按 ↓ 不该滚正文容器');
    assert.deepEqual(await selectedPaths(page), [], '更不该因为按 ↓ 而选中树行');
  });
});

test('⑥ Delete（有区间选中）→ 弹确认条、磁盘未删、取消后行还在', async (t) => {
  // 钉的风险：
  //   1. 按键直接删盘 —— 没有确认条就是"手滑一次少三篇"，且这一页没有回收站；
  //   2. 确认条弹了但文案不写条数 / 不写不可撤销 → 用户不知道自己确认的是什么；
  //   3. 有选择时仍要求"焦点落在树行上"（真机上永远不成立）→ 按 Delete 毫无反应，
  //      一个"看起来实现了、按下去没动静"的功能。所以这里**先把焦点挪走**再按。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    await selectFirstThree(page, order);

    // 模拟真机：点过别处之后 activeElement 落回 BODY，而选择还在。
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Delete');
    const confirm = page.locator('.zws-nt-confirm');
    await confirm.waitFor();

    const text = await confirm.innerText();
    assert.match(text, /删除这 3 条/, `确认条要说清一共几条：${text}`);
    assert.match(text, /找不回来/, '确认条要说清不可撤销');
    const listed = await page.evaluate(() =>
      [...document.querySelectorAll('.zws-nt-confirm-list li')].map((li) => li.textContent.trim()));
    assert.deepEqual(listed, order.slice(0, 3), '缩略清单要逐条列出被删的路径（用户眼睛未必数过）');

    // 确认之前，一个字都不能动：RPC 里不许有 removeMany，夹具（磁盘）仍是 4 条。
    const methods = await callMethods(page);
    assert.equal(methods.filter((method) => method === 'removeMany').length, 0,
      `确认之前不该发出 removeMany，实际调用序列：${JSON.stringify(methods)}`);
    assert.equal(await fixtureLen(page), TREE.length, '确认之前磁盘上什么都不该少');
    assert.deepEqual(await rowPaths(page), order, '确认之前树里一行都不该少（确认条只是叠在上面）');

    // ⚠️ 这一下点击**必须一次就生效**。它同时钉着两个 bug：
    //    1. 确认条按钮第一下落空（见文件顶部"布局位移"那一段）；
    //    2. 取消把选择一起清掉 —— "我反悔了"不等于"我放弃这段选择"。
    //       清掉的话用户再按一次 Delete 就什么都不弹了，得从头 Shift+↓ 一遍。
    await page.locator('.zws-nt-confirm-actions').getByRole('button', { name: '取消' }).click();
    await settle(page);
    assert.equal(await page.locator('.zws-nt-confirm').count(), 0, '取消后确认条要一次点击就消失');
    assert.deepEqual(await rowPaths(page), order, '取消后树里一行都不能少');
    assert.equal(await fixtureLen(page), TREE.length, '取消后磁盘上一条都不能少');
    assert.deepEqual(await selectedPaths(page), order.slice(0, 3),
      '取消只是撤销"这次删除"，区间选择要原样保留（否则用户得从头 Shift+↓ 一遍）');
    assert.match(await selectionText(page) ?? '', /已选中 3 条/, '计数条也要还在');
  });
});

test('⑦ 确认后：行消失，且只发出一次 removeMany', async (t) => {
  // 钉的风险（这一条是本任务的**核心**）：
  //   1. 批量走成"N 次单条 remove" → 宿主每处理一次写都重读全库刷索引，删 30 篇
  //      会卡好几秒，中间失败还会留下"删了一半、索引只刷了一半"的状态。
  //      光看删除后的 DOM 无法区分这两种实现 —— 必须数 fetch 调用。
  //   2. payload 多带/漏带路径：多带会把没选中的也删掉（不可逆），漏带会少删。
  //      所以断言 `paths` 与选中行**逐条相等**，不是只断言长度。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    await selectFirstThree(page, order);
    await page.keyboard.press('Delete');
    const confirm = page.locator('.zws-nt-confirm');
    await confirm.waitFor();
    assert.equal(await page.locator('.zws-nt-confirm .zws-nt-confirm-list li').count(), 3, '前置：确认条列了 3 条');

    await page.locator('.zws-nt-confirm-actions .zws-nt-danger').click();
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.zws-nt-rowbtn[data-path]').length === expected,
      TREE.length - 3,
    );
    await settle(page);

    const removeMany = await page.evaluate(() =>
      window.__calls.filter((call) => call.method === 'removeMany'));
    assert.equal(removeMany.length, 1,
      `批量删除必须只发一次 removeMany（循环 remove 会让宿主重复重读全库），实际发了 ${removeMany.length} 次`);
    assert.deepEqual(removeMany[0].args.paths, order.slice(0, 3), 'payload 要正好是选中的那三条');
    assert.deepEqual(await rowPaths(page), order.slice(3), '树里应只剩没被选中的那几行');
    assert.equal(await fixtureLen(page), TREE.length - 3, '磁盘上真的只剩没被选中的那几条');
    assert.equal(await page.locator('.zws-nt-confirm').count(), 0, '删完确认条要收掉');
    assert.equal(await selectionText(page), null, '删完选择与计数条都要清掉（不能指向已不存在的路径）');
  });
});

test('⑧ Esc：撤区间选择但保留游标；确认条挂着时先撤确认条', async (t) => {
  // 钉的风险（顺序是这条的全部）：
  //   1. 把 Esc 只接到"撤确认条" → 选择了一堆之后按 Esc 退不出去，只能去点鼠标
  //      （而点鼠标会顺带把游标也清了，等于把用户的位置也弄丢）；
  //   2. 把 Esc 只接到"撤选择" → 确认条挂着时按 Esc，选择没了、确认条还在，
  //      再按一次 Delete 又弹一次，用户会以为 Esc 没反应；
  //   3. 撤选择时顺手把游标也清了 → 用户按 Esc 只是想放弃"这一段"，位置该留住。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    await clickRow(page, 0);
    await settle(page);
    await page.keyboard.press('Shift+ArrowDown');
    await settle(page);
    assert.deepEqual(await selectedPaths(page), order.slice(0, 2), '前置：两行已选中');

    await page.keyboard.press('Escape');
    await settle(page);
    assert.deepEqual(await selectedPaths(page), [], 'Esc 应撤掉区间选择');
    assert.equal(await selectionText(page), null, '计数条也要消失');
    assert.equal(await cursorPath(page), order[1], 'Esc 不该撤游标：游标是"我在哪一行"');

    // 再框一段，然后验优先级：确认条挂着时第一次 Esc 只撤确认条。
    await page.keyboard.press('Shift+ArrowDown');
    await settle(page);
    assert.deepEqual(await selectedPaths(page), order.slice(1, 3), '从游标原处重新起一段（锚点=游标）');
    await page.keyboard.press('Delete');
    await page.locator('.zws-nt-confirm').waitFor();

    await page.keyboard.press('Escape');
    await settle(page);
    assert.equal(await page.locator('.zws-nt-confirm').count(), 0, '第一次 Esc 先撤确认条');
    assert.deepEqual(await selectedPaths(page), order.slice(1, 3), '第一次 Esc 不该顺带把选择也撤掉');

    await page.keyboard.press('Escape');
    await settle(page);
    assert.deepEqual(await selectedPaths(page), [], '再按一次才撤选择');
    assert.equal(await cursorPath(page), order[2], '游标一路都在（两次 Esc 都不动它）');
    assert.equal(await fixtureLen(page), TREE.length, '两次 Esc 都不该删任何东西');
  });
});

/**
 * 用**真鼠标**点树上的第 `index` 行（按下与抬起落在同一坐标，与真人一致）。
 *
 * ⚠️ 这里**不能**用上面 `clickRow()` 那种合成事件派发：合成派发是直接对同一个
 *    元素 `dispatchEvent`，**位置根本不参与**，所以"按下之后元素跑掉了"这种
 *    缺陷它永远测不出来 —— 那正是 ⑨ 要钉的东西。必须让浏览器自己按坐标做命中
 *    测试（`page.mouse`），click 才会像真机一样落到"抬起时那个坐标下面的元素"上。
 */
const realClickRow = async (page, index) => {
  const point = await page.evaluate((at) => {
    const btn = document.querySelectorAll('.zws-nt-rowbtn[data-path]')[at];
    if (!btn) throw new Error(`树里没有第 ${at} 行`);
    const rect = btn.getBoundingClientRect();
    return {
      path: btn.dataset.path,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  }, index);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  return point.path;
};

/** 当前**打开**（激活）的那一行 —— 真机上就是正文区在显示谁。 */
const activePath = (page) => page.evaluate(() =>
  document.querySelector('.zws-nt-row.is-current .zws-nt-rowbtn')?.dataset?.path ?? null);

test('⑨ 有区间选中时点树上另一行：**一次点击**就切换激活笔记，并清掉选择', async (t) => {
  // # 这条钉的缺陷（真机上"第一下点击落空"的第二种形状）
  //
  // 选中 3 条之后想改主意、去点树上另一篇 —— 第一下打不开，得点两下。逐行实测
  // （1200×800，真实 style.css，系统 Edge，6 行树，每行单独重来一遍）：
  //
  //   | 点的行 | pointerdown 后计数条 | 抬起时同坐标命中 | 结果           |
  //   |--------|----------------------|------------------|----------------|
  //   | 第 0 行 | 卸载                | 同一行本身        | ✅ 歪打正着     |
  //   | 第 1 行 | 卸载                | 下一行            | ❌ 落空         |
  //   | 第 2 行 | 卸载                | 下一行            | ❌ 落空         |
  //   | 第 3 行 | 卸载                | 下一行            | ❌ 落空         |
  //   | 第 4 行 | 卸载                | 树容器 UL        | ❌ 落空         |
  //   | 第 5 行 | 卸载                | 树容器 UL        | ❌ 落空         |
  //
  // 也就是 6 行里 5 行中招。真实事件序列（点第 1 行）：
  //
  //   pointerdown → SPAN:第六篇己     ← 按下时还在目标行上
  //   pointerup   → SPAN:第四篇丁     ← 计数条已卸载，整棵树**上移一行（28px）**
  //   click       → UL:树容器         ← 合成 click 落在容器上，行的 onClick 没跑
  //
  // 根因与确认条那条**同一个**：`.zws-nt-selection` 是插在树**上面**的一条会伸缩的
  // 横条。任何"在 pointerdown 里改变它"的逻辑，都会把下面整片内容推动，
  // 让按下与抬起落在不同元素上 —— 于是 click 必然不落在用户按的那个东西上。
  // 修法是把"清选择"挪到 `click`（按下与抬起之间布局完全不动）。
  //
  // # 为什么必须逐行测，不能只测第 0 行
  //
  // 位移恰好是**一行的高度**：位移后顶上来的那一行是不是又恰好命中目标，取决于
  // 点在树里的位置。第 0 行在旧实现里就是"歪打正着"通过的 —— 只测它等于没测。
  // 这里把 6 行**全部**测一遍（原先落空的 1/2/3/5 行都在其中）。
  await withPage(t, async (page) => {
    const order = await rowPaths(page);
    assert.equal(order.length, 6, `这一条要 6 行才测得准，实际 ${JSON.stringify(order)}`);
    const failures = [];

    for (let index = 0; index < order.length; index += 1) {
      // 每一轮都从干净状态开始：重新加载 → 点第一行 → Shift+↓ 两次。
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(
        (expected) => document.querySelectorAll('.zws-nt-rowbtn[data-path]').length === expected,
        TREE.length,
      );
      await clickRow(page, 0);
      await settle(page);
      await page.keyboard.press('Shift+ArrowDown');
      await settle(page);
      await page.keyboard.press('Shift+ArrowDown');
      await settle(page);
      assert.deepEqual(await selectedPaths(page), order.slice(0, 3), '前置：前三行已选中');

      const before = await activePath(page);
      const target = await realClickRow(page, index);
      await settle(page);

      const after = {
        active: await activePath(page),
        selected: await selectedPaths(page),
        bar: await selectionText(page),
      };

      if (after.active !== target) {
        failures.push(`点第 ${index} 行「${target}」：激活仍是「${after.active}」（点击前是「${before}」）`);
      }
      if (after.selected.length !== 0) {
        failures.push(`点第 ${index} 行「${target}」：区间选择没清掉，仍有 ${after.selected.length} 条选中`);
      }
      if (after.bar !== null) {
        failures.push(`点第 ${index} 行「${target}」：计数条没消失（${after.bar}）`);
      }
    }

    assert.deepEqual(failures, [],
      `有区间选中时点树行必须**一次点击**就切换笔记并清掉选择；以下是落空的行：\n${failures.join('\n')}`);
  });
});
