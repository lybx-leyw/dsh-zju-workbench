/**
 * 伴读抽屉：新消息到达时的滚动行为。
 *
 * # 这条测试守的是一个真实的 bug
 *
 * 用户报「伴读 AI 不会自动滚到最新会话的底部」。旧实现的判据是
 * 「当前离底部是否小于 1.5 屏」：
 *
 *   ```js
 *   const away = list.scrollHeight - list.scrollTop - list.clientHeight;
 *   if (away < list.clientHeight * 1.5) list.scrollTop = list.scrollHeight;
 *   ```
 *
 * 展开抽屉时内容**还是空的**（`scrollTop=0`、`maxScroll=0`），历史消息随后
 * **一次性到达**。就在那一刻 `away` 等于**全部历史的高度** —— 历史一多就远超
 * 1.5 屏，于是被误判成「用户正在回看历史」而不贴底，用户看到的就是"停在最上面"。
 *
 * # 修法
 *
 * 用状态位 `userScrolledRef` 取代几何判据：只有**用户真的滚动过**才不贴底，
 * 展开/换会话时清零。程序性滚动用 `programmaticRef` 标记，否则一次自动贴底
 * 会被自己触发的 scroll 事件误记成"用户翻过"，从此再也不贴（更难查）。
 *
 * # 为什么不在测试里跑真实 AI 会话
 *
 * 那要等模型回复，几十秒且不可控。这里验的是**判据的行为**：
 * 贴底后是否在底、用户翻上去后是否被尊重、重开是否重置。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));

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

/** 产物比源码新，否则真机测试会测旧产物并给出假绿灯。 */
function assertBundleFresh(packageName, sourceFiles) {
  const bundle = path.join(root, 'packages', packageName, 'lib', 'client.js');
  assert.ok(existsSync(bundle), `${packageName} 没有构建产物，先跑 npm run build`);
  const bundleAt = statSync(bundle).mtimeMs;
  for (const rel of sourceFiles) {
    const file = path.join(root, 'packages', packageName, 'src', rel);
    if (!existsSync(file)) continue;
    assert.ok(bundleAt >= statSync(file).mtimeMs,
      `${packageName}/src/${rel} 比构建产物新 —— 产物是旧的，这段测试会假通过。先跑 npm run build`);
  }
}

test('伴读抽屉：贴底判据尊重用户回看，重开时重置', { timeout: 180000 }, async (t) => {
  assertBundleFresh('dsh-zhiyun-page-paper', ['AssistantDrawer.jsx', 'Paper.jsx']);

  const browser = await launchBrowser();
  if (browser === null) {
    t.skip('没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge');
    return;
  }

  const { initialize, runHost } = await import(pathToFileURL(path.join(root, 'scripts/profile.mjs')).href);
  const { minimalPdf } = await import('./fixtures/minimal-pdf.mjs');

  const home = await mkdtemp(path.join(tmpdir(), 'drawer-scroll-'));
  const runtime = await initialize({ home });
  const dataDir = path.join(runtime.profile, 'data', 'zhiyun-paper');
  await mkdir(path.join(dataDir, '心理学'), { recursive: true });
  await writeFile(path.join(dataDir, '心理学', '甲.pdf'), minimalPdf());

  const server = runHost(runtime, ['--no-open', '--port', '0'], { pipe: true });
  let log = '';
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`宿主启动超时：${log.slice(-2000)}`)), 180000);
      const consume = (d) => {
        log += d;
        const m = log.match(/dsh web: (http:\/\/\S+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      };
      server.stdout.setEncoding('utf8');
      server.stderr.setEncoding('utf8');
      server.stdout.on('data', consume);
      server.stderr.on('data', consume);
      server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`宿主退出 ${code}`)); });
    });

    const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, locale: 'zh-CN' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.zy-page[data-page=today]').waitFor({ timeout: 60000 });
    // 宿主弹层：开着时整个工作台是 `inert` 的，键盘事件会被吞掉。
    for (let i = 0; i < 8; i += 1) {
      const open = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
      if (open === 0) break;
      await page.evaluate(() => document.querySelector('[role="dialog"] button:not([disabled])')?.click());
      await sleep(400);
    }

    await page.evaluate(() => document.querySelector('nav[aria-label="主要页面"] button[aria-label="论文"]')?.click());
    await sleep(2000);
    await page.evaluate(() => [...document.querySelectorAll('.zp-tree-btn')]
      .find((b) => b.dataset.path === '心理学')?.click());
    await sleep(400);
    await page.evaluate(() => [...document.querySelectorAll('.zp-tree-btn')]
      .find((b) => b.dataset.path === '心理学/甲.pdf')?.click());
    await sleep(3000);

    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('AI 助手'))?.click();
    });
    await sleep(1500);

    // ① 用**真实链路**注入一条用户消息：`/api/ask` 会把它写进会话，
    //    SSE 推回浏览器，触发「新消息到达」的滚动路径。
    //
    //    ⚠️ 这一步不能省。用 DOM 直接 append 假气泡是测不出判据的 ——
    //    React 不知道那些节点，滚动 effect 根本不会重跑，于是"旧判据"和
    //    "新判据"走同一条路，测试对两者都亮绿灯（这一段就真踩过）。
    // ⚠️ 必须注入**足够多**的历史才能复现旧 bug：
    //    旧判据是「离底 < 1.5 屏才贴底」，只有一两条消息时离底本来就近，
    //    两个判据都会贴底 —— 那样测不出差别（这一段真踩过）。
    //    这里连发若干条，让积压的历史高度远超一屏。
    for (let i = 0; i < 8; i += 1) {
      const injected = await page.evaluate(async (n) => {
        const response = await fetch('/paper-reader/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            topic: '心理学',
            name: '甲',
            question: `第 ${n} 条用于撑高历史的测试消息 ` + '补充内容 '.repeat(12),
          }),
        });
        return { status: response.status };
      }, i + 1);
      assert.equal(injected.status, 200, `注入第 ${i + 1} 条消息应成功：${JSON.stringify(injected)}`);
      await sleep(600);
    }

    // 等消息经 SSE 回来并被渲染出来。
    await page.waitForFunction(
      () => document.querySelectorAll('.zp-drawer-list .zp-bubble, .zp-drawer-list [class*="bubble"]').length > 0,
      null, { timeout: 25000 },
    );
    await sleep(800);

    // ② 消息到达后应当贴底（这正是用户抱怨的那条）。
    const afterArrival = await page.evaluate(() => {
      const l = document.querySelector('.zp-drawer-list');
      const max = l.scrollHeight - l.clientHeight;
      return { atBottom: Math.abs(l.scrollTop - max) <= 2, scrollTop: Math.round(l.scrollTop), max };
    });
    assert.equal(afterArrival.atBottom, true,
      `消息到达后应自动贴底（旧判据在此会失败）：${JSON.stringify(afterArrival)}`);

    // ③ 用户往上翻：应停在顶部（不被拽回）。
    const userTop = await page.evaluate(async () => {
      const l = document.querySelector('.zp-drawer-list');
      l.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 250));
      return Math.round(l.scrollTop);
    });
    assert.equal(userTop, 0, '用户往上翻后应停在顶部，不被程序拽回');

    // ④ 收起再展开：重置「翻过」标记，重新贴底
    await page.evaluate(() => {
      [...document.querySelectorAll('.zp-drawer-head button')]
        .find((b) => b.getAttribute('aria-label')?.includes('收起'))?.click();
    });
    await sleep(600);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label')?.includes('展开 AI'))?.click();
    });
    await sleep(1200);
    const reopened = await page.evaluate(() => {
      const l = document.querySelector('.zp-drawer-list');
      if (!l) return { found: false };
      const max = l.scrollHeight - l.clientHeight;
      return { found: true, atBottom: Math.abs(l.scrollTop - max) <= 2 };
    });
    assert.equal(reopened.found, true, '重新展开后列表应存在');
    assert.equal(reopened.atBottom, true, '重新展开后应贴底');

    assert.deepEqual(errors, [], '页面不该有异常');
  } finally {
    await browser.close().catch(() => {});
    server.kill();
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
});
