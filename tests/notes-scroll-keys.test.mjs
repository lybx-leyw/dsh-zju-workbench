/**
 * 「笔记」页的四个滚动键：PageUp / PageDown / ↑ / ↓。
 *
 * # 为什么这一条必须用真浏览器
 *
 * 这几条全是**事件路由与布局**行为，SSR 与纯函数都测不出来。本轮实现时正是靠
 * 浏览器探针推翻了两个凭读代码得出的错误结论：
 *
 *   1. 以为「不拦截就交给浏览器原生滚」—— 实测焦点在 `<body>` 上时按 PageDown，
 *      正文容器 `scrollTop` 仍是 0（它没焦点，浏览器不滚它）。所以必须自己 `scrollBy`。
 *   2. 以为「把 keydown 挂在页面 `<section>` 上就够」—— 实测点正文之后
 *      `activeElement` 落回 `<body>`，而 `<body>` 是 `<section>` 的**祖先**，
 *      事件不向下冒泡，挂在 section 上的监听一次都收不到。必须挂 `document`。
 *
 * 这两条如果只靠读代码，会写出一个"看起来对、按下去没反应"的功能。
 *
 * # 覆盖的行为
 *
 *   - 焦点不在页内（点过不可聚焦的正文）时，四个键仍滚正文；
 *   - ↑/↓ 幅度小于 PageUp/PageDown（一个按行、一个按屏）；
 *   - 焦点在文件树行上时，↑/↓ **移动焦点**而**不滚正文**（B 方案）；
 *   - 焦点在树行上时 PageDown 不滚正文（A 方案：交给树自己）；
 *   - 编辑态（textarea 有焦点）时 ↑/↓ 移动**光标**，不接管、不滚正文。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/** 与页面同构的树数据。顺序不是断言依据 —— `buildRows` 会按名称排序。 */
const TREE = [
  { type: 'note', path: '长笔记', title: '长笔记', folder: '', preview: '', chars: 9000 },
  { type: 'note', path: '第二篇', title: '第二篇', folder: '', preview: '', chars: 10 },
  { type: 'note', path: '第三篇', title: '第三篇', folder: '', preview: '', chars: 10 },
];

/**
 * 把页面打成单文件 IIFE（连 React 一起打进去）。
 *
 * 打成 IIFE 而不是 ESM：浏览器不能解析裸模块名（`import React from 'react'`），
 * 而这里要的是一个能直接 `<script src>` 的产物。
 */
async function bundle() {
  const dir = await mkdtemp(path.join(root, '.verify-render-'));
  const outfile = path.join(dir, 'app.js');
  const { build } = await import('esbuild');
  const STUBS = {
    'dsh-zhiyun-shell-ui': `import React from "react";
      export const Icon = () => React.createElement("i");
      export const Notice = (p) => React.createElement("div", { className: "notice" }, p.children);
      export const mountStyle = () => {};`,
    'dsh-zhiyun-graph-render': `export const NoteGraph = () => null; export const css = "";`,
    '@deepseek-ai/dsh-client-ui-primitives': `import React from "react";
      export const MarkdownText = (p) => React.createElement("div", { className: "md" },
        React.createElement("div", { style: { height: 6000 } }, p.text));`,
  };
  await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { NotesLibrary } from "./packages/dsh-zhiyun-page-notes/src/client.jsx";
        const tree = ${JSON.stringify(TREE)};
        window.fetch = async (url, init) => {
          let method = "";
          try { method = JSON.parse(init?.body ?? "{}")?.payload?.method ?? ""; } catch (e) {}
          let value = [];
          if (method === "tree") value = tree;
          else if (method === "read") value = { name: "长笔记", markdown: "正文第一行\\n" + "滚动的正文。\\n".repeat(600) };
          return { json: async () => ({ result: { ok: true, value } }), status: 200 };
        };
        createRoot(document.getElementById("host")).render(React.createElement(NotesLibrary));
      `,
      resolveDir: root,
      loader: 'jsx',
    },
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
 * 照抄真机的布局链。
 *
 * ⚠️ 这条链必须**逐层带上 `min-height:0` / `flex`**。上一版少了真机那三层
 *    （`.zy-page > .zy-scroll > .zy-content-flush`），于是 `.zs-nt-scroll` 的
 *    `scrollHeight` 等于 `clientHeight`（实测 6254/6254）—— 它根本没被限高，
 *    "能滚"是假象，测试也就永远测不出真机上的失效。真机的量测是 sh=2122/ch=851。
 */
const CSS = [
  'html,body{margin:0;height:100%;overflow:hidden}',
  '.zy-page{display:flex;flex-direction:column;height:100%;min-width:0}',
  '.zy-scroll{flex:1;overflow:auto;min-height:0}',
  '.zy-content.zy-content-flush{max-width:none;padding:0;height:100%;display:flex;flex-direction:column;min-height:0}',
  '.host{display:flex;flex-direction:column;flex:1;min-height:0}',
  '.zs-nt{display:flex;flex-direction:column;gap:12px;flex:1;min-height:0}',
  '.zs-nt-work{display:flex;flex:1;min-height:0;overflow:hidden}',
  '.zs-nt-explorer{width:220px;display:flex;flex-direction:column;min-height:0}',
  '.zs-nt-tree{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1;min-height:0}',
  '.zs-nt-rowbtn{display:block;width:100%;text-align:left;padding:6px}',
  '.zs-nt-main{flex:1 1 auto;min-width:400px;min-height:0;display:flex;flex-direction:column}',
  '.zs-nt-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;padding:20px}',
  '.zs-nt-input{width:100%;min-height:420px;border:0;resize:none;font:15.5px/1.9 sans-serif;display:block}',
].join('\n');

const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();

/**
 * 找一个能真正启动的浏览器。
 *
 * 为什么不能只用 `chromium.executablePath()`：那条路径指向 Playwright **自带的**
 * Chromium，本机常常没装（我这边就是 `exists: false`），于是整条测试永久 skip ——
 * 一个永远不跑的测试等于没有。系统装的 Edge 是同一套内核，用作回退足够。
 *
 * @returns `{ launch, why }`：`launch()` 成功返回 browser；全都启动不了时返回 null。
 */
async function launchBrowser() {
  const attempts = [];
  if (existsSync(browserPath)) attempts.push({ executablePath: browserPath, label: 'playwright chromium' });
  // 系统浏览器：Edge 在 Windows 上是标配；按常见顺序试。
  attempts.push({ channel: 'msedge', label: 'system edge' });
  attempts.push({ headless: true, label: 'bundled' });

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

test('笔记页：PageUp/PageDown/↑/↓ 按焦点上下文分派', async (t) => {
  const browser = await launchBrowser();
  if (browser === null) {
    // 一个浏览器都起不来时跳过，并把原因说清楚（而不是静默通过）。
    t.skip('没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge/Playwright Chromium');
    return;
  }
  const { dir, outfile } = await bundle();
  const pageFile = path.join(dir, 'host.html');
  await writeFile(pageFile, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
    <div class="zy-page" data-page="notes"><main class="zy-scroll"><div class="zy-content zy-content-flush">
    <div class="host" id="host"></div></div></main></div><script src="/app.js"></script>`);

  const server = createServer(async (req, res) => {
    const name = (req.url ?? '/').split('?')[0];
    const file = name === '/app.js' ? outfile : pageFile;
    res.writeHead(200, { 'content-type': name === '/app.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(await readFile(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    page.setDefaultTimeout(8000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    const scroller = page.locator('.zs-nt-scroll').first();
    await scroller.waitFor();
    const top = () => scroller.evaluate((el) => Math.round(el.scrollTop));

    // ── ① 焦点在 body（点过不可聚焦的正文）时，PageDown 仍要滚正文 ──
    await scroller.click({ position: { x: 40, y: 40 } });
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BODY',
      '点正文之后焦点应落回 body —— 这正是"挂在 section 上收不到键"的前提');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(400);
    const afterPageDown = await top();
    assert.ok(afterPageDown > 0, `PageDown 应滚动正文，实际 scrollTop=${afterPageDown}`);

    // ── ② ↑/↓ 的幅度小于一次翻页 ──
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const afterArrow = await top();
    assert.ok(afterArrow > 0, `ArrowDown 应滚动，实际 ${afterArrow}`);
    assert.ok(afterArrow < afterPageDown, `按行的幅度应小于按屏：arrow=${afterArrow}, page=${afterPageDown}`);

    // ── ③ PageUp 往回滚 ──
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(400);
    assert.ok(await top() < afterArrow, 'PageUp 应往回滚');

    // ── ④ 注意力在树行上：↑/↓ 移动游标，且不滚正文 ──
    //
    // ⚠️ 这里**不能**用 `focus()` 或 `page.click()`：
    //    - `focus()` 在真机上无效（实测 activeElement 仍是 BODY，focusin 日志为空），
    //      以此为前提写断言，会得到一条"在合成宿主里绿、在真机上红"的假测试；
    //    - `page.click()` 会被宿主常驻遮罩拦下，且失败是静默的。
    //    改成派发等价的 PointerEvent —— 与用户点击走同一条 pointerdown → click 路径，
    //    页面靠它记录"用户在树上"的游标。
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('.zs-nt-rowbtn[data-path]')].map((b) => b.dataset.path));
    assert.ok(order.length >= 2, `树里应有多行，实际 ${JSON.stringify(order)}`);
    await page.evaluate(() => {
      const btn = document.querySelector('.zs-nt-rowbtn[data-path]');
      const opts = { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      btn.dispatchEvent(new PointerEvent('pointerdown', opts));
      btn.dispatchEvent(new PointerEvent('pointerup', opts));
      btn.dispatchEvent(new MouseEvent('click', opts));
    });
    await page.waitForTimeout(600);
    const cursorBefore = await page.evaluate(() =>
      document.querySelector('.zs-nt-row.is-cursor .zs-nt-rowbtn')?.dataset?.path ?? null);
    assert.equal(cursorBefore, order[0], '点击树行后该行应成为游标（真机上焦点留不住，只能靠这个）');

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const cursorAfter = await page.evaluate(() =>
      document.querySelector('.zs-nt-row.is-cursor .zs-nt-rowbtn')?.dataset?.path ?? null);
    assert.equal(cursorAfter, order[1], `↓ 应把游标移到下一行：${order[0]} → ${cursorAfter}`);
    assert.equal(await top(), 0, '注意力在树上时不该滚正文');

    // ── ⑤ 注意力在树上时 PageDown 不滚正文（交给树自己） ──
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(300);
    assert.equal(await top(), 0, '注意力在树上时 PageDown 也不该滚正文');

    // ── ⑥ 编辑态：textarea 有焦点时 ↑ 移光标，不接管 ──
    await page.getByRole('button', { name: '编辑' }).first().click();
    const textarea = page.locator('textarea.zs-nt-input');
    await textarea.waitFor();
    await textarea.click();
    await page.evaluate(() => {
      const el = document.querySelector('textarea.zs-nt-input');
      el.selectionStart = el.selectionEnd = 0;
      el.scrollTop = 0;
      document.querySelector('.zs-nt-scroll').scrollTop = 0;
    });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    assert.equal(await top(), 0, '在 textarea 里按 ↓ 不该滚正文');
    assert.ok(await page.evaluate(() => document.querySelector('textarea.zs-nt-input').selectionStart) > 0,
      '在 textarea 里按 ↓ 应移动光标');

    // ── ⑦ 长按要跟得上，不能被 smooth 动画拖住 ──
    //
    // ⚠️ 这一条钉的是一个真实回归（用户原话："长按上下键好像直接变缓了"）。
    //
    // 实测澄清了一件事：`smooth` 的多次调用**不会互相取消**，它会累加目标位置；
    // 真正的问题是**动画追不上按键** —— 连发 36 次（约 30 次/秒 × 1.2s）后
    //   · smooth：立刻只有 298px，600ms 后才 343px，最终 1680px；
    //   · instant：立刻就是 1620px。
    // 也就是说 smooth 下"手已经松开、画面还在爬"，长按失去加速感。
    //
    // ⚠️ 所以断言必须**在长按结束后立即取样**（下面用 `settleMs = 0`），
    //    等几百毫秒再看会让 smooth 追上来、把回归测成通过 —— 这是本测试
    //    第一版真实的翻车点：它给 smooth 版本也亮了绿灯。
    //
    // ⚠️ 模拟长按不能用 `keyboard.down()`：Playwright 不产生键盘自动重复
    //    （实测按住 1 秒只发 1 个 keydown，repeat 全 false），那测的是单次按键。
    //    改为手动连发 `repeat:true` 的 keydown，与真实浏览器的自动重复同构。
    const holdScroll = async (key, ms, settleMs) => {
      await page.evaluate(async ({ key: k, ms: duration }) => {
        const fire = (repeat) => document.body.dispatchEvent(new KeyboardEvent('keydown', {
          key: k, repeat, bubbles: true, cancelable: true, composed: true,
        }));
        fire(false);
        const start = performance.now();
        while (performance.now() - start < duration) {
          await new Promise((resolve) => setTimeout(resolve, 33));   // ≈30 次/秒
          fire(true);
        }
      }, { key, ms });
      if (settleMs > 0) await page.waitForTimeout(settleMs);
    };

    // 回到阅读态并复位（⑥ 切到了编辑态）
    await page.getByRole('button', { name: '阅读' }).first().click();
    await page.waitForTimeout(300);
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(600);
    const singleStep = await top();
    assert.ok(singleStep > 0, `单次 ↓ 应滚动，实际 ${singleStep}`);

    // 长按 1.2 秒（约 36 次重复），**结束后立即**取样。
    //
    // 阈值 15 倍是怎么定的（两种实现实测）：
    //   · smooth ：即时 653px，是单次的 9 倍；且 100ms 后还在爬到 719px。
    //   · instant：即时 1944px，是单次的 27 倍；之后完全不动。
    // 取 15 倍做分界，两边都留足余量；顺带断言"松开后不再继续爬"，
    // 因为"手松了画面还在动"正是长按体验变差的手感来源。
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await holdScroll('ArrowDown', 1200, 0);
    const heldStep = await top();
    await page.waitForTimeout(250);
    const settled = await top();
    assert.ok(heldStep > singleStep * 15,
      `长按 1.2 秒应立即走到多次按键的量（smooth 会滞后，看起来像"越按越慢"）：长按=${heldStep}, 单次=${singleStep}, 倍数=${(heldStep / singleStep).toFixed(1)}`);
    assert.ok(Math.abs(settled - heldStep) < singleStep,
      `松开后画面不该继续爬（smooth 的特征）：采样时=${heldStep}, 250ms 后=${settled}`);

    assert.deepEqual(errors, [], '页面不该有异常');
  } finally {
    await browser.close().catch(() => {});
    server.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('滚动键的接线守卫：挂 document 而非容器，且四类豁免齐全', async () => {
  // 上面那条浏览器测试证明"行为对"；这一条钉住"实现不会在下一次重构里退回错的那版"。
  const source = await readFile(path.join(root, 'packages/dsh-zhiyun-page-notes/src/client.jsx'), 'utf8');

  assert.match(source, /document\.addEventListener\('keydown', onKeyDown, true\)/,
    '必须挂 document —— 挂在页面容器上的话，焦点在 body 时一次都收不到（实测）');
  assert.match(source, /document\.removeEventListener\('keydown', onKeyDown, true\)/,
    '必须成对摘除，否则离开这一页后还在抢键');
  assert.match(source, /document\.removeEventListener\('pointerdown', onPointerDown, true\)/,
    'pointerdown 也要成对摘除');
  assert.match(source, /if \(root === null\) return/, '卸载后要让处理器立刻失效');

  // 真机事实：焦点靠不住（点完树行 activeElement 仍是 BODY），所以"在不在树上"
  // 必须由 pointerdown 记录的游标决定，不能只认 event.target。
  assert.match(source, /pointerdown/, '必须用 pointerdown 记录用户落在哪一行');
  assert.match(source, /treeCursorRef\.current/, '树上位置要由游标持有，不能靠 activeElement');
  assert.match(source, /is-cursor/, '游标要在界面上看得见（真机上没有焦点环）');

  const fn = source.slice(source.indexOf('const handleScrollKeys'));
  const body = fn.slice(0, fn.indexOf('const onKeyDownCapture'));
  assert.match(body, /PageDown[\s\S]*PageUp[\s\S]*ArrowDown[\s\S]*ArrowUp/, '四个键都要认');
  assert.match(body, /input, textarea, select, \[contenteditable/, '输入区必须豁免（编辑态正文是 textarea）');
  assert.match(body, /\.zs-nt-rowbtn\[data-path\]/, '要能认出注意力在树行上');
  assert.match(body, /scrollBy/, '正文滚动必须自己算（原生不生效）');
  // preventDefault 必须在豁免之后，否则会把输入框里的按键吃掉。
  assert.ok(body.indexOf('preventDefault') > body.indexOf('contenteditable'),
    'preventDefault 必须在输入区豁免之后');
});
