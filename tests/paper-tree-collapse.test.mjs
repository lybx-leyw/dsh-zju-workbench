/**
 * 论文页：树栏能收起、能再展开、状态被记住。
 *
 * # 这条测试守的是一个真实缺失
 *
 * 第一版把树栏写死成 `width: 232px`，**根本没实现收起** —— 用户报「抽屉无法收起」
 * 时，不是开关坏了，而是那个开关不存在。
 *
 * # 为什么"收起后按钮必须还在"
 *
 * 收起如果连按钮一起拔掉，用户就再也叫不回来，那比"收不起"更糟。
 * 所以断言分成三条：变窄 / 按钮仍在 / 能展开回来。
 *
 * # 为什么用真浏览器
 *
 * 验的是**实际布局宽度**（`getBoundingClientRect`）与 localStorage 记忆，
 * jsdom 给不出真实宽度。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { statSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * 断言构建产物比源码新。
 *
 * ⚠️ 这条守卫是**必须的**，来自一次真实的假绿灯：
 *    我改完 CSS 忘了 `npm run build`，测试照样通过 —— 因为宿主加载的是
 *    `lib/client.js`，而它还是旧的。于是"测试通过"与"改动生效"脱钩，
 *    等于测了个寂寞。
 *
 * 这类测试（真机、跑构建产物）都要有这一道，否则它的绿没有任何意义。
 */
function assertBundleFresh(packageName, sourceFiles) {
  const bundle = path.join(root, 'packages', packageName, 'lib', 'client.js');
  assert.ok(existsSync(bundle), `${packageName} 没有构建产物，先跑 npm run build`);
  const bundleAt = statSync(bundle).mtimeMs;
  for (const rel of sourceFiles) {
    const file = path.join(root, 'packages', packageName, 'src', rel);
    if (!existsSync(file)) continue;
    const at = statSync(file).mtimeMs;
    assert.ok(bundleAt >= at,
      `${packageName}/src/${rel} 比构建产物新 —— 产物是旧的，这段测试会假通过。先跑 npm run build`);
  }
}

/** 找一个能真启动的浏览器（本机常常只有系统 Edge，没有 Playwright 自带的）。 */
async function launchBrowser() {
  const bundled = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
  const attempts = [];
  if (existsSync(bundled)) attempts.push({ executablePath: bundled });
  attempts.push({ channel: 'msedge' });
  attempts.push({});
  for (const options of attempts) {
    try { return await chromium.launch({ headless: true, ...options }); } catch { /* 试下一个 */ }
  }
  return null;
}

test('论文页：树栏可收起、可展开、状态被记住', { timeout: 180000 }, async (t) => {
  // ⚠️ 守卫放在**最前面**：产物过期时立刻失败，不用先花 20 秒起浏览器再报错。
  //    这条是必须的 —— 见 assertBundleFresh 的说明（它来自一次真实的假绿灯）。
  assertBundleFresh('dsh-zhiyun-page-paper', ['Paper.jsx', 'PaperTree.jsx', 'style.css', 'client.jsx']);

  const browser = await launchBrowser();
  if (browser === null) {
    t.skip('没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge');
    return;
  }

  const { initialize, runHost } = await import(pathToFileURL(path.join(root, 'scripts/profile.mjs')).href);
  const { minimalPdf } = await import('./fixtures/minimal-pdf.mjs');

  const home = await mkdtemp(path.join(tmpdir(), 'paper-collapse-'));
  const runtime = await initialize({ home });
  // 预置一篇文献，树栏才有内容可收起。
  const dataDir = path.join(runtime.profile, 'data', 'zhiyun-paper');
  await mkdir(path.join(dataDir, '心理学'), { recursive: true });
  await writeFile(path.join(dataDir, '心理学', '总论.pdf'), minimalPdf());

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
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (['继续', '稍后配置'].includes(b.textContent?.trim() ?? '')) b.click();
      }
    });
    await sleep(500);

    /** 进论文页。用页内 click：宿主常驻遮罩会拦真实点击。 */
    const goPaper = async () => {
      await page.evaluate(() => {
        document.querySelector('nav[aria-label="主要页面"] button[aria-label="论文"]')?.click();
      });
      await sleep(1500);
    };
    /** 树栏的实际像素宽度。 */
    const paneWidth = () => page.locator('.zp-tree-pane').first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    /**
     * 点收起/展开（绕开宿主遮罩）。
     *
     * ⚠️ 两个状态下的按钮**不是同一个元素**：
     *   - 展开时，收起入口在**栏头**（与笔记库同一排按钮，`title="收起论文库"`）；
     *   - 收起后整棵树卸掉，只剩一个窄条上的 `title="展开论文库"`。
     * 这是照笔记库的结构做的，测试必须按这个结构点，而不是固守某个 class。
     */
    const clickToggle = () => page.evaluate(() => {
      const head = [...document.querySelectorAll('.zp-tree-head button')]
        .find((b) => b.title === '收起论文库');
      if (head) { head.click(); return; }
      document.querySelector('.zp-tree-toggle')?.click();
    });

    await goPaper();
    assert.equal(await page.locator('.zp-tree-pane').count(), 1, '树栏应存在');

    const openWidth = await paneWidth();
    assert.ok(openWidth > 150, `默认应展开，实际宽=${openWidth}`);

    await clickToggle();
    await sleep(500);
    const closedWidth = await paneWidth();
    assert.ok(closedWidth < 60, `点收起后应变窄：${openWidth} → ${closedWidth}`);
    assert.equal(await page.locator('.zp-tree-toggle').count(), 1, '收起后必须留一个展开按钮，否则叫不回来');

    await clickToggle();
    await sleep(500);
    assert.ok(await paneWidth() > 150, '再点应能展开回来');

    // 收起是长期偏好：切走再回来仍该是收起的。
    await clickToggle();
    await sleep(400);
    await page.evaluate(() => {
      document.querySelector('nav[aria-label="主要页面"] button[aria-label="笔记"]')?.click();
    });
    await sleep(1200);
    await goPaper();
    assert.ok(await paneWidth() < 60, '切换页面后仍应保持收起');

    assert.deepEqual(errors, [], '页面不该有异常');
  } finally {
    await browser.close().catch(() => {});
    server.kill();
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
});
