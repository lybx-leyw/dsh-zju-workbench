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
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../../support/browser.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));


test('PDF：导入后在笔记页里真的能读，并跟随宿主亮暗', {
  timeout: 180000,
  // 这条是**真宿主 + 真浏览器**的端到端，前置条件比其它用例重得多：
  // 宿主必须先登录（或配好 API Key）并选定工作区，工作台页面才会挂载。
  // 全新 home 起出来的宿主只有「新会话 + 登录 / 添加 API Key」落地页，
  // `.zy-page` 永远不出现 —— 那不是 PDF 坏了，而是这台机器跑不了端到端。
  //
  // 所以显式用环境变量开启，而不是靠探测去猜（探测会把「等 60 秒后超时」变成常态）：
  //   ZHIYUN_PDF_E2E=1 npm test   # 已登录的机器上跑
  skip: !process.env.ZHIYUN_PDF_E2E
    && '端到端需要已登录且已选工作区的宿主；设 ZHIYUN_PDF_E2E=1 在那种机器上开启',
}, async (t) => {
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

    const { minimalPdf } = await import('../../fixtures/minimal-pdf.mjs');
    const pdf = minimalPdf();
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, locale: 'zh-CN' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // 宿主首次运行是**多步**的：先「继续」确认预览版说明，之后才轮到登录 / API Key。
    // 所以要反复点掉确认层，并在每一步之后**轮询**落到了哪一屏 —— 一次点击只走一步，
    // 界面也不是瞬时切换。两条出路：
    //   · 工作台页面挂上了（`.zy-page`）→ 正常走端到端；
    //   · 停在「登录 / 添加 API Key」→ 这台机器没有凭证，skip。
    // 把「等页面」与「等决定」分开写，就不会在没有凭证时干等 60 秒再报一句无用的超时。
    let mounted = false;
    let sawCredentialPrompt = false;
    for (let step = 0; step < 12 && !mounted; step += 1) {
      const clicked = await page.evaluate(() => {
        let count = 0;
        for (const b of document.querySelectorAll('button')) {
          if (['继续', '稍后配置', '跳过'].includes(b.textContent?.trim() ?? '')) { b.click(); count += 1; }
        }
        return count;
      });
      const state = await page.evaluate(() => ({
        mounted: document.querySelector('.zy-page') !== null,
        credentials: /登录 DeepSeek 账号|添加 API Key|请选择模型/.test(document.body?.innerText ?? ''),
      }));
      mounted = state.mounted;
      sawCredentialPrompt = sawCredentialPrompt || state.credentials;
      if (mounted) break;
      // 停在没有凭证的落地页上、且已经没有确认按钮可点：再等也不会挂载。
      if (state.credentials && clicked === 0) break;
      await sleep(1000);
    }
    if (!mounted && sawCredentialPrompt) {
      t.skip('宿主未登录、也没有 API Key：工作台页面不会挂载，端到端无从开始');
      return;
    }
    await page.locator('.zy-page[data-page=today]').waitFor({ timeout: 60000 });
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
