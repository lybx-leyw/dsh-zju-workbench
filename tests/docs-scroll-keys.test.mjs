/**
 * 「文档」页的四个滚动键：PageUp / PageDown / ↑ / ↓（真机）。
 *
 * # 为什么这一条必须用真浏览器
 *
 * 它验的是**事件路由与布局**，纯函数与 SSR 都测不出来。改这一版之前先跑了一个
 * 探针（1200×700，三栏铺开，`maxScroll=3168`），量出三件事 —— 它们决定了实现形状：
 *
 *   1. **焦点在 `<body>` 上时，Chrome 原生就会滚 `.zyd-main`**（PageDown 576px、
 *      ↓ 40px）。所以"完全没反应"不是全貌，只按这一条写测试，会得到一个
 *      "改之前也绿"的假测试。
 *   2. **焦点在按钮上时一动不动**（连按两个键 `scrollTop` 仍是 0）。而点左侧目录
 *      跳篇、点右侧目录跳节之后焦点正好落在按钮上 —— 这才是用户报的"不支持"。
 *      原生不滚的原因：按钮所在的 `.zyd-nav` 没有溢出，再往外 `html/body` 是
 *      `overflow:hidden`，浏览器找不到可滚的东西。
 *   3. **滤镜框里 ↑/↓ 归输入框**（实测 `scrollTop` 不变、输入框自己处理）——
 *      这条是必须保留的豁免，测试要反过来钉住"不许接管"。
 *
 * 所以下面的断言全部**先把焦点放到按钮上**再按键：那才是改之前会失败的那条路径。
 *
 * # 为什么不用启动整个宿主
 *
 * 这一页只 inject `slots`，不依赖任何领域服务 —— 页面组件本身可以直接渲染。
 * 起宿主会让这条测试慢几十秒、还要处理宿主的 `inert` 弹层（见
 * `tests/paper-tree-keys.test.mjs` 里那段 dismissDialogs），收益为零。
 * 布局链照抄真机（`.zy-page > .zy-scroll > .zy-content-flush`），并且**真的**
 * 把本包的 `style.css` 贴进去 —— 少了它 `.zyd-main` 根本不会被限高，
 * "能滚"就是假象（这一条是笔记页那边踩过的坑）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = path.join(root, 'packages', 'client', 'page-docs');

/** 外壳的布局链 + 主题变量。页面样式表依赖 `--zy-*` 与 `.zy-content-flush`。 */
const SHELL_CSS = [
  'html,body{margin:0;height:100%;overflow:hidden}',
  '.zy-page{display:flex;flex-direction:column;height:100%;min-width:0}',
  '.zy-scroll{flex:1;overflow:auto;min-height:0}',
  '.zy-content.zy-content-flush{max-width:none;padding:0;height:100%;display:flex;flex-direction:column;min-height:0}',
  '.host{display:flex;flex-direction:column;flex:1;min-height:0}',
  ':root{--zy-bg:#fff;--zy-surface:#fafafa;--zy-sidebar:#f4f4f5;--zy-soft:#f0f0f2;--zy-line:#e2e2e6;',
  '--zy-hover:#f2f2f4;--zy-text:#1a1a1a;--zy-secondary:#555;--zy-muted:#888;--zy-accent:#2f6feb;',
  '--zy-font:system-ui,sans-serif}',
].join('\n');

/**
 * 把页面打成单文件 IIFE（React 一起打进去）。
 *
 * 两个 stub 的取舍：
 *   · `MarkdownText` 要**真的产出 h2/h3**，否则右目录不出现，"点页内目录之后
 *     焦点在按钮上"这条路径就测不到；
 *   · `mountStyle` 是空函数，所以本包的 `style.css` 由宿主页 `<style>` 贴进去
 *     （见上方注释：少了它布局是假的）。
 */
async function bundle(workdir) {
  const dir = await mkdtemp(path.join(workdir, 'bundle-'));
  const outfile = path.join(dir, 'app.js');
  const { build } = await import('esbuild');
  const STUBS = {
    '@lybx-leyw/dsh-zju-ui-shared': `import React from "react";
      export const Icon = () => React.createElement("i");
      export const Empty = (p) => React.createElement("div", null, p.title, p.children);
      export const mountStyle = () => {};`,
    '@deepseek-ai/dsh-client-ui-primitives': `import React from "react";
      export const MarkdownText = (p) => React.createElement("div", null,
        String(p.text).split(/\\n\\n/).map((block, i) => {
          const h2 = /^## (.+)$/.exec(block);
          if (h2 !== null) return React.createElement("h2", { key: i }, h2[1]);
          const h3 = /^### (.+)$/.exec(block);
          if (h3 !== null) return React.createElement("h3", { key: i }, h3[1]);
          return React.createElement("p", { key: i, style: { minHeight: 200 } }, block.slice(0, 30));
        }));`,
  };
  await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { Docs } from "./packages/client/page-docs/src/client.jsx";
        document.body.dataset.zhiyun = "";
        createRoot(document.getElementById("host")).render(React.createElement(Docs));
      `,
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true, write: true, outfile, format: 'iife', jsx: 'automatic', logLevel: 'silent',
    loader: { '.css': 'text', '.svg': 'text', '.md': 'text' },
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

/** 找一个能真启动的浏览器（本机常常只有系统 Edge）。 */
async function launchBrowser() {
  const bundled = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
  const attempts = [];
  if (existsSync(bundled)) attempts.push({ executablePath: bundled });
  attempts.push({ channel: 'msedge' });
  attempts.push({});
  for (const options of attempts) {
    try { return await chromium.launch({ headless: true, ...options }); } catch { /* 下一个 */ }
  }
  return null;
}

test('文档页：四个滚动键在任何焦点下都滚正文，且在输入框里让位', { timeout: 180000 }, async (t) => {
  const browser = await launchBrowser();
  if (browser === null) {
    t.skip('没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge');
    return;
  }

  // 产物目录建在仓库内：本机的系统临时目录写不了（沙箱），而且
  // `.verify-scratch/` 已被 .gitignore 排除。用完删掉。
  const workdir = path.join(root, '.verify-scratch');
  await mkdir(workdir, { recursive: true });
  const { dir, outfile } = await bundle(workdir);
  const pageCss = await readFile(path.join(pkg, 'src', 'style.css'), 'utf8');
  const pageFile = path.join(dir, 'host.html');
  await writeFile(pageFile, `<!doctype html><meta charset="utf-8">
    <style>${SHELL_CSS}</style><style>${pageCss}</style>
    <div class="zy-page" data-page="docs"><main class="zy-scroll"><div class="zy-content zy-content-flush">
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
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    page.setDefaultTimeout(8000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    const scroller = page.locator('.zyd-main').first();
    await scroller.waitFor();
    await page.waitForTimeout(200);

    const top = () => scroller.evaluate((el) => Math.round(el.scrollTop));
    const maxScroll = () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
    const activeLabel = () => page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
    const reset = () => scroller.evaluate((el) => { el.scrollTop = 0; });

    // 前提：正文真的能滚，右目录真的存在。任一不成立，下面的断言都没有意义。
    assert.ok(await maxScroll() > 600,
      `正文应明显超过一屏（实测 maxScroll=${await maxScroll()}）；CSS 链没接上时这里会是 0`);
    assert.ok(await page.locator('.zyd-toc-link').count() >= 2,
      '应有页内目录（MarkdownText 的 stub 要真的产出 h2）');

    // ── ① 点正文（焦点落回 body）后 PageDown 要滚 ──
    await scroller.click({ position: { x: 60, y: 60 } });
    assert.equal(await activeLabel(), 'BODY', '点不可聚焦的正文之后焦点应落回 body');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(450);
    const bodyPage = await top();
    assert.ok(bodyPage > 0, `焦点在 body 上时 PageDown 应滚正文，实际 ${bodyPage}`);

    // ── ② ↑/↓ 的幅度明显小于一次翻页 ──
    await reset();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(350);
    const bodyLine = await top();
    assert.ok(bodyLine > 0, `ArrowDown 应滚动，实际 ${bodyLine}`);
    assert.ok(bodyLine < bodyPage / 3,
      `按行应远小于按屏：arrow=${bodyLine}, page=${bodyPage}`);

    // ── ③ PageUp 往回滚 ──
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(450);
    assert.ok(await top() < bodyLine, 'PageUp 应往回滚');

    // ── ④ **改之前会失败的那条**：焦点在左侧目录按钮上 ──
    //
    // 点左侧目录换篇 → 页面回到顶部、焦点留在那个 <button> 上。
    // 改之前实测：这里连按 PageDown / ↓，scrollTop 恒为 0。
    await page.locator('.zyd-link').nth(2).click();
    await page.waitForTimeout(250);
    await reset();
    assert.equal(await activeLabel(), 'BUTTON', '点目录之后焦点应在 button 上');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(450);
    const navPage = await top();
    assert.ok(navPage > 0,
      `焦点在目录按钮上时 PageDown 必须由本页接管（改之前这里恒为 0），实际 ${navPage}`);

    await reset();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(350);
    const navLine = await top();
    assert.ok(navLine > 0, `焦点在目录按钮上时 ↓ 应滚正文，实际 ${navLine}`);

    // 目录按钮自己不该被"方向键选中"那套逻辑吃掉 —— 这一页不做游标（见 client.jsx 的注释）。
    assert.equal(await activeLabel(), 'BUTTON');

    // ── ⑤ 焦点在页内目录按钮上，同样要滚 ──
    await page.locator('.zyd-toc-link').nth(1).click();
    await page.waitForTimeout(500);
    const afterJump = await top();
    assert.ok(afterJump > 0, `点页内目录第 2 项应跳到第二节，实际 ${afterJump}`);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(350);
    assert.ok(await top() < afterJump,
      `焦点在页内目录上时 ↑ 应往回滚：跳转后=${afterJump}, 按后=${await top()}`);

    // ── ⑥ 输入框里必须让位（不许接管） ──
    await reset();
    const filter = page.locator('.zyd-filter input');
    await filter.click();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    assert.equal(await top(), 0, '筛选框里按 ↓ 不该滚正文（那是光标）');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(250);
    assert.equal(await top(), 0, '筛选框里按 PageDown 也不该滚正文');

    // ── ⑦ 长按要跟得上，不能被 smooth 动画拖住 ──
    //
    // 笔记页实测过同一件事：`smooth` 的缓动约 300ms，而键盘重复约 30 次/秒，
    // 每次新 scrollBy 都从当前位置起重画 → 按住不放反而几乎不动。
    // 这里先用同方向的单次按键建立基线，再连发 36 次（约 1.2 秒）。
    //
    // ⚠️ 不能用 `keyboard.down()` 模拟长按：Playwright 不产生键盘自动重复
    //    （按住 1 秒只发 1 个 keydown，repeat 全是 false），那测的是单次按键。
    await reset();
    await scroller.click({ position: { x: 60, y: 60 } });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(600);
    const single = await top();
    assert.ok(single > 0, `单次 ↓ 应滚动，实际 ${single}`);

    await reset();
    await page.evaluate(async (duration) => {
      const fire = (repeat) => document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', repeat, bubbles: true, cancelable: true, composed: true,
      }));
      fire(false);
      const start = performance.now();
      while (performance.now() - start < duration) {
        await new Promise((resolve) => setTimeout(resolve, 33));
        fire(true);
      }
    }, 1200);
    // ⚠️ 必须**立即**取样：等 400ms 再取，smooth 会追上来、把回归测成通过。
    const held = await top();
    await page.waitForTimeout(250);
    const settled = await top();
    assert.ok(held > single * 10,
      `长按 1.2 秒应立刻走到多次按键的量（smooth 会滞后，手感是"越按越慢"）：长按=${held}, 单次=${single}`);
    assert.ok(Math.abs(settled - held) < single,
      `松开后画面不该继续爬：采样时=${held}, 250ms 后=${settled}`);

    // ── ⑧ 换页之后仍能用（处理器挂在 document 上，不能因为换页就失效） ──
    await page.locator('.zyd-section').nth(1).click();
    await page.waitForTimeout(300);
    await reset();
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(450);
    assert.ok(await top() > 0, '切分区之后滚动键仍应有效');

    // ── ⑨ 宿主开着模态对话框时不许抢键 ──
    //
    // 宿主里 Ctrl+K 的「跳转到」与账号浮层都是 `showModal()` 打开的。那时用户看的是
    // 对话框，按 ↓ 应该走对话框自己的列表，而不是把背后的文档滚走。
    //
    // ⚠️ 判据必须是 `:modal`，不能是 `[role="dialog"]`：宿主里非模态浮层也带
    //    `role="dialog"`（生成长面板、任务队列），那些开着时用户还在读正文。
    await reset();
    const modalOpen = await page.evaluate(() => {
      const dialog = document.createElement('dialog');
      dialog.id = 'probe-modal';
      dialog.textContent = '模态探针';
      document.body.appendChild(dialog);
      dialog.showModal();
      return dialog.matches(':modal');
    });
    assert.equal(modalOpen, true, '探针对话框应处于模态态（否则这条断言什么都没测到）');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(350);
    assert.equal(await top(), 0, '模态对话框开着时不该把背后的文档滚走');
    // 关掉之后立刻恢复。
    await page.evaluate(() => document.querySelector('#probe-modal')?.remove());
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(450);
    assert.ok(await top() > 0, '模态关掉之后滚动键应立刻恢复');

    assert.deepEqual(errors, [], '页面不该有异常');
  } finally {
    await browser.close().catch(() => {});
    server.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('滚动键的接线守卫：挂 document、成对摘除、输入区豁免在 preventDefault 之前', async () => {
  // 上面那条证明"行为对"；这一条钉住"实现不会在下一次重构里退回错的那版"。
  const source = await readFile(path.join(pkg, 'src', 'client.jsx'), 'utf8');

  assert.match(source, /document\.addEventListener\('keydown', onKeyDown, true\)/,
    '必须挂 document —— 挂在页面容器上的话，焦点在 body 时一次都收不到（实测）');
  assert.match(source, /document\.removeEventListener\('keydown', onKeyDown, true\)/,
    '必须成对摘除，否则离开这一页后还在抢别人的键');
  assert.match(source, /if \(root === null\) return/, '卸载后要让处理器立刻失效');
  assert.match(source, /ref=\{rootRef\}/, '根节点要把 ref 接上，否则那条失效判断恒为真');
  // 宿主模态对话框（Ctrl+K / 账号浮层）开着时按键归它，本页不许抢。
  assert.match(source, /dialog:modal/, '要用 :modal 判模态（role="dialog" 会把非模态浮层也算进去）');
  assert.match(source, /if \(hasModalDialog\(\)\) return/, '模态开着时处理器要提前返回');

  // 判据本身在 keys.js 里，页面只负责把量出来的尺寸喂进去。
  assert.match(source, /scrollIntent\(/, '判据必须走纯函数层，别在组件里复写一遍');
  assert.match(source, /scrollAmount\(/, '步长必须走纯函数层');
  assert.match(source, /scrollBy\(\{ top: amount/, '必须自己 scrollBy（焦点在按钮上时原生不滚）');

  // ⚠️ 切片必须到**下一个函数的开头**为止，不能用 `slice(0, -1)` 那种兜底：
  //    `handleScrollKeys` 是本页最后一个 handler，找不到锚点时切出来的就是整个文件尾部，
  //    下面几条断言会拿注释里的字去证明实现 —— 永远绿，等于没测。
  const start = source.indexOf('const handleScrollKeys');
  const end = source.indexOf('const onKeyDown = event');
  assert.ok(start > 0 && end > start, `切片锚点变了（start=${start}, end=${end}），请同步这条守卫`);
  const body = source.slice(start, end);
  assert.match(body, /input, textarea, select, \[contenteditable/, '输入区必须豁免（筛选框在那儿）');
  // preventDefault 必须在豁免之后，否则会把输入框里的按键吃掉。
  assert.ok(body.indexOf('preventDefault') > body.indexOf('contenteditable'),
    'preventDefault 必须在输入区豁免之后');
  // 键盘滚动是人的动作：要解掉"点目录钉住"的那条高亮。
  assert.match(body, /pinned\.current = null/, '键盘滚动要解钉，否则右目录高亮停在点过的那一节');
});
