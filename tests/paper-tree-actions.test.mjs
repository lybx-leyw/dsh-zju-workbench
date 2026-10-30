/**
 * 论文树：**操作必须真的在栏里**（不是像素对齐）。
 *
 * # 这条测试守的是一个理解偏差
 *
 * 第一版把论文树的字号/行高/缩进都对齐了笔记库，但**交互模型没对齐**：
 * 上传和新建还留在页头的下拉面板里，栏内只有一棵"只能看不能操作"的树。
 * 用户的反馈是"只学了皮毛"——这个判断是对的，因为笔记库那棵树的价值不在
 * 像素，而在**操作不出栏**：栏头一排按钮就能新建、上传、折叠、收起。
 *
 * 所以这里验的是链路，不是样式：
 *   1. 栏头有四个操作按钮；
 *   2. 点「新建文件夹」→ 磁盘真的多了目录，且树里出现；
 *   3. 点「导入 PDF」→ 触发隐藏的 file input（而不是页头的旧下拉）；
 *   4. 页头**不再**有重复的文献库面板（两套入口会让人不知道用哪个）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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

/**
 * 断言构建产物比源码新。
 *
 * ⚠️ 真机测试跑的是宿主加载的 `lib/client.js`。改了源码没重建时，测试会测旧产物
 * 并给出**假绿灯**（本轮踩过）。这条守卫把它变成明确的失败。
 */
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

test('论文树：新建/上传的链路在栏头，不在页头', { timeout: 180000 }, async (t) => {
  // 守卫放最前：产物过期时立刻失败，不用先花 20 秒起浏览器。
  assertBundleFresh('dsh-zhiyun-page-paper', ['Paper.jsx', 'PaperTree.jsx', 'style.css', 'client.jsx']);

  const browser = await launchBrowser();
  if (browser === null) {
    t.skip('没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge');
    return;
  }

  const { initialize, runHost } = await import(pathToFileURL(path.join(root, 'scripts/profile.mjs')).href);
  const { minimalPdf } = await import('./fixtures/minimal-pdf.mjs');

  const home = await mkdtemp(path.join(tmpdir(), 'paper-head-'));
  const runtime = await initialize({ home });
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
    await page.evaluate(() => document.querySelector('nav[aria-label="主要页面"] button[aria-label="论文"]')?.click());
    await sleep(2000);

    // ① 栏头四个操作
    const headButtons = await page.evaluate(() => {
      const head = document.querySelector('.zp-tree-head');
      return head ? [...head.querySelectorAll('button')].map((b) => b.title) : null;
    });
    assert.ok(Array.isArray(headButtons), '应有一排栏头按钮');
    assert.equal(headButtons.length, 4, `栏头应有 4 个操作，实际：${JSON.stringify(headButtons)}`);
    assert.ok(headButtons.includes('导入 PDF'), `缺少「导入 PDF」：${JSON.stringify(headButtons)}`);
    assert.ok(headButtons.includes('新建文件夹'), `缺少「新建文件夹」：${JSON.stringify(headButtons)}`);

    // ② 过滤框在栏内
    assert.equal(await page.locator('.zp-tree-filter').count(), 1, '树上方应有过滤框');

    // ③ 页头不再有重复的文献库下拉
    assert.equal(await page.locator('.zp-library').count(), 0,
      '页头不该再有文献库面板（两套入口会让人不知道用哪个）');

    // ④ 新建文件夹：磁盘 + 树都要有
    const before = (await readdir(dataDir)).length;
    await page.evaluate(() => {
      [...document.querySelectorAll('.zp-tree-head button')].find((b) => b.title === '新建文件夹')?.click();
    });
    await sleep(1500);
    const after = await readdir(dataDir);
    assert.equal(after.length, before + 1, `磁盘应多一个目录：${JSON.stringify(after)}`);
    assert.ok(after.some((name) => name.includes('新文件夹')), `新目录名不对：${JSON.stringify(after)}`);
    const treeHasNew = await page.evaluate(() => [...document.querySelectorAll('.zp-tree-btn')]
      .some((b) => (b.dataset.path ?? '').includes('新文件夹')));
    assert.ok(treeHasNew, '新建的文件夹应出现在树里');

    // ⑤ 导入 PDF 走的是隐藏 file input（不是页头旧下拉）
    const triggered = await page.evaluate(() => {
      const input = document.querySelector('input[type=file]');
      if (!input) return { found: false };
      let opened = 0;
      const original = input.click.bind(input);
      input.click = () => { opened += 1; /* 不真的弹系统对话框 */ };
      [...document.querySelectorAll('.zp-tree-head button')].find((b) => b.title === '导入 PDF')?.click();
      input.click = original;
      return { found: true, opened };
    });
    assert.equal(triggered.found, true, '应存在隐藏的 file input');
    assert.equal(triggered.opened, 1, '「导入 PDF」应触发 file input');

    assert.deepEqual(errors, [], '页面不该有异常');
  } finally {
    await browser.close().catch(() => {});
    server.kill();
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
});
