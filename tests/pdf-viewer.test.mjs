/**
 * PDF 阅读器：**真浏览器**端到端。
 *
 * 必须用真浏览器：pdf.js 要在真实 canvas 上绘制，iframe 同源与 postMessage
 * 也只有在真实文档里才成立。这一条覆盖的是「导入之后到底能不能看」——
 * 纯单测只能证明字节落对了盘。
 *
 * 覆盖：
 *   - 阅读器路由可达、pdf.js 静态资源可被伺服；
 *   - 打开 PDF 标签后真的画出页面（canvas 数量、页码）；
 *   - **暗色跟随**：宿主切主题后 iframe 收到并变深（这是用户明确要的那条）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 找一个能真启动的浏览器（本机常常只有系统 Edge，没有 Playwright 自带的）。 */
async function launchBrowser() {
  const bundled = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
  const attempts = [];
  if (existsSync(bundled)) attempts.push({ executablePath: bundled });
  attempts.push({ channel: 'msedge' });
  attempts.push({});
  for (const options of attempts) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch { /* 试下一个 */ }
  }
  return null;
}

test('PDF：导入后在笔记页里真的能读，并跟随宿主亮暗', { timeout: 180000 }, async (t) => {
  const browser = await launchBrowser();
  if (browser === null) {
    t.skip('没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge');
    return;
  }

  const home = await mkdtemp(path.join(tmpdir(), 'pdf-e2e-'));
  const { initialize, runHost } = await import(pathToFileURL(path.join(root, 'scripts/profile.mjs')).href);
  const runtime = await initialize({ home });
  const server = runHost(runtime, ['--no-open', '--port', '0'], { pipe: true });

  let log = '';
  let url;
  try {
    url = await new Promise((resolve, reject) => {
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

    const { minimalPdf } = await import('./fixtures/minimal-pdf.mjs');
    const pdf = minimalPdf();
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, locale: 'zh-CN' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.zy-page[data-page=today]').waitFor({ timeout: 60000 });
    // 宿主首次运行弹层：按用户的方式确认掉。
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (['继续', '稍后配置'].includes(b.textContent?.trim() ?? '')) b.click();
      }
    });
    await sleep(500);

    // 导入（走与页面相同的 RPC 信封）
    const imported = await page.evaluate(async (base64) => {
      const r = await fetch('/api/zhiyun-vault-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'i', payload: { method: 'importAsset', args: { title: '端到端', folder: '', ext: 'pdf', base64 } } }),
      });
      return (await r.json()).result;
    }, pdf.toString('base64'));
    assert.equal(imported.ok, true, `导入应成功：${JSON.stringify(imported.error)}`);
    const pdfPath = imported.value.path;
    assert.match(pdfPath, /\.pdf$/);

    // 进笔记页，打开那一篇（用页内 click：宿主常驻遮罩会拦真实点击）
    await page.evaluate(() => document.querySelector('nav[aria-label="主要页面"] button[aria-label="笔记"]')?.click());
    await sleep(1500);
    await page.evaluate((p) => {
      [...document.querySelectorAll('.zs-nt-rowbtn[data-path]')].find((b) => b.dataset.path === p)?.click();
    }, pdfPath);
    await sleep(2500);

    assert.equal(await page.locator('iframe.zs-nt-pdf').count(), 1, 'PDF 应渲染成 iframe');

    const frame = page.frameLocator('iframe.zs-nt-pdf');
    await frame.locator('.pdf-page canvas').first().waitFor({ timeout: 30000 });

    const drawn = await frame.locator('body').evaluate(() => ({
      pages: document.querySelectorAll('.pdf-page').length,
      canvases: document.querySelectorAll('.pdf-page canvas').length,
      pager: document.getElementById('pager')?.textContent ?? '',
      theme: document.documentElement.dataset.theme ?? '',
      bg: getComputedStyle(document.documentElement).getPropertyValue('--pdf-bg').trim(),
    }));
    assert.ok(drawn.pages > 0 && drawn.canvases > 0, `pdf.js 应画出页面：${JSON.stringify(drawn)}`);
    assert.match(drawn.pager, /\d+\s*\/\s*\d+/, `页码应显示：${drawn.pager}`);
    assert.equal(drawn.theme, 'light', '首帧应是亮色');

    // ── 暗色跟随（用户明确要的那条）──
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
    await sleep(900);
    const dark = await frame.locator('html').evaluate((el) => ({
      theme: el.dataset.theme ?? '',
      bg: getComputedStyle(document.documentElement).getPropertyValue('--pdf-bg').trim(),
    }));
    assert.equal(dark.theme, 'dark', '切暗色后 iframe 应收到');
    assert.notEqual(dark.bg, drawn.bg, `暗色下 PDF 底色应变化：亮=${drawn.bg} 暗=${dark.bg}`);

    // 切回亮色也要跟得上（单向同步是半个功能）
    await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
    await sleep(700);
    assert.equal(await frame.locator('html').evaluate((el) => el.dataset.theme ?? ''), 'light', '切回亮色也要同步');

    assert.deepEqual(errors, [], '页面不该有异常');
  } finally {
    await browser.close().catch(() => {});
    server.kill();
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
});
