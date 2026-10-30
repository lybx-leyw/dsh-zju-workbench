/**
 * 论文树：Delete 删除、F2 改名（真机）。
 *
 * # 两个关键事实决定了实现形状，必须写在这里
 *
 * **1. Delete 不能直接删。** 上游 `deletePaper` 会连带删掉
 * `PAPER_SIDECARS`（`.txt` / `.pages.json` / `-zh.pdf` / `-dual.pdf` / `.study.json`）——
 * 转录、译文、学习档案全都没了，不可逆。所以先弹就地确认。
 *
 * **2. F2 的输入框必须 portal 到 `document.body`。** 真机查出来：宿主的
 * 主容器（`document.body > div`）**常年**带 `inert`，整个工作台都在它里面。
 * `inert` 下任何元素都拿不到焦点 —— 实测树里的 `<input>` `focus()` 无效，
 * 手动移除 `inert` 后同一行代码立刻成功，挂到 `body` 下也成功。
 * 所以用 `createPortal` 把对话框渲染到 body 的另一个子节点上。
 *
 * ⚠️ 曾经用过 `window.prompt`，测试里能过 —— 但那是 **Playwright 拦截 dialog 的假通过**。
 *    DSH Desktop 是 Electron 壳，Electron 默认禁用 `window.prompt`（返回 null 且不弹框），
 *    真实用户按 F2 毫无反应。这类"测试绿、真机死"的坑必须靠真实键入来验。
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

test('论文树：Delete 需确认并连带删派生文件，F2 用 portal 对话框改名', { timeout: 180000 }, async (t) => {
  assertBundleFresh('dsh-zhiyun-page-paper', ['Paper.jsx', 'PaperTree.jsx', 'style.css', 'client.jsx']);

  const browser = await launchBrowser();
  if (browser === null) {
    t.skip('没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge');
    return;
  }

  const { initialize, runHost } = await import(pathToFileURL(path.join(root, 'scripts/profile.mjs')).href);
  const { minimalPdf } = await import('./fixtures/minimal-pdf.mjs');

  const home = await mkdtemp(path.join(tmpdir(), 'paper-keys-'));
  const runtime = await initialize({ home });
  const dataDir = path.join(runtime.profile, 'data', 'zhiyun-paper');
  await mkdir(path.join(dataDir, '心理学'), { recursive: true });
  await writeFile(path.join(dataDir, '心理学', '待删.pdf'), minimalPdf());
  // 派生文件：删除时应连带消失（这正是"必须确认"的理由）
  await writeFile(path.join(dataDir, '心理学', '待删.txt'), 'transcript');
  await writeFile(path.join(dataDir, '心理学', '待改名.pdf'), minimalPdf());

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
    /**
     * 关掉宿主的「预览版说明」弹层。
     *
     * ⚠️ 这不是可选的清理步骤 —— 它开着时整个工作台被包在一个 `inert` 容器里，
     *    而 `inert` 会**吞掉键盘事件**：F2 根本到不了我们的 keydown 处理器
     *    （实测带 `inert` 时 F2 完全没反应，关掉后正常）。
     *    同理，`inert` 下的元素也拿不到焦点 —— 这是改名当初改用 prompt 的原因。
     */
    const dismissDialogs = async () => {
      for (let round = 0; round < 10; round += 1) {
        const open = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
        if (open === 0) return true;
        // 弹层里的按钮文案不固定，按候选逐个试。
        let clicked = false;
        for (const name of ['继续', '稍后配置', '知道了', '关闭', '我了解']) {
          const btn = page.getByRole('button', { name, exact: true });
          if (await btn.count() > 0) {
            await btn.first().click({ timeout: 4000 }).catch(() => {});
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          // 兜底：弹层里第一个可点按钮
          await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            const b = d?.querySelector('button:not([disabled])');
            b?.click();
          });
        }
        await sleep(500);
      }
      return false;
    };
    await dismissDialogs();
    await sleep(600);
    await page.evaluate(() => document.querySelector('nav[aria-label="主要页面"] button[aria-label="论文"]')?.click());
    await sleep(2000);

    /** 点树上一行（页内 click 绕开宿主遮罩）。 */
    const clickRow = (target) => page.evaluate((p) => {
      [...document.querySelectorAll('.zp-tree-btn')].find((b) => b.dataset.path === p)?.click();
    }, target);

    // 等树真的渲染出来（宿主启动后还有客户端模块加载的时序）。
    await page.locator('.zp-tree-btn').first().waitFor({ timeout: 30000 });
    await clickRow('心理学');
    await sleep(600);
    // 展开后要等子行出现，否则下面的 clickRow 会落空。
    await page.waitForFunction(
      () => [...document.querySelectorAll('.zp-tree-btn')].some((b) => b.dataset.path === '心理学/待删.pdf'),
      null, { timeout: 15000 },
    );

    // ① 选中一行 → 出现游标（不然用户不知道快捷键作用在谁身上）
    await clickRow('心理学/待删.pdf');
    await page.waitForFunction(
      () => document.querySelector('.zp-tree-row.is-cursor .zp-tree-btn')?.dataset?.path === '心理学/待删.pdf',
      null, { timeout: 15000 },
    );
    assert.equal(
      await page.evaluate(() => document.querySelector('.zp-tree-row.is-cursor .zp-tree-btn')?.dataset?.path ?? null),
      '心理学/待删.pdf',
      '点一行后应出现游标高亮',
    );

    // ② Delete → 弹确认，**不直接删**
    await page.keyboard.press('Delete');
    await sleep(600);
    assert.equal(await page.locator('.zp-tree-confirm').count(), 1, 'Delete 应先弹确认条');
    assert.ok((await readdir(path.join(dataDir, '心理学'))).includes('待删.pdf'), '未确认前不该删文件');

    // ③ 确认 → 本体与派生文件一起消失
    await page.evaluate(() => {
      [...document.querySelectorAll('.zp-tree-confirm-actions button')]
        .find((b) => b.textContent?.includes('确认删除'))?.click();
    });
    await sleep(2000);
    const afterDelete = await readdir(path.join(dataDir, '心理学'));
    assert.ok(!afterDelete.includes('待删.pdf'), `确认后本体应删除：${JSON.stringify(afterDelete)}`);
    assert.ok(!afterDelete.includes('待删.txt'), `派生文件应连带删除：${JSON.stringify(afterDelete)}`);

    // ④ F2 → portal 对话框 → 改名 → 磁盘跟着变
    //
    // ⚠️ 不用 Playwright 的 dialog 拦截来"模拟 prompt"：那是假通过。
    //    真实环境是 Electron 壳，**默认禁用 window.prompt**（返回 null 且不弹框），
    //    所以曾经那版在测试里绿、在用户那里死。
    //    改成真对话框 + **真实键入**，这才是用户实际经历的路径。
    await clickRow('心理学/待改名.pdf');
    await sleep(800);
    await dismissDialogs();

    await page.keyboard.press('F2');
    // 对话框 portal 到 body：等它真的出现。
    await page.locator('.zp-rename-input').waitFor({ timeout: 15000 });

    // 输入框必须能真正拿到焦点（这是 portal 方案的全部意义）。
    const focused = await page.evaluate(() => document.activeElement?.className?.includes('zp-rename-input') ?? false);
    assert.equal(focused, true, '重命名输入框应能获得焦点（工作台内部是 inert 的，故 portal 到 body）');

    // 全选后键入新名字（真实键盘输入）。
    await page.keyboard.press('Control+a');
    await page.keyboard.type('改过的名字');
    await page.keyboard.press('Enter');
    await sleep(2500);

    const afterRename = await readdir(path.join(dataDir, '心理学'));
    assert.ok(afterRename.includes('改过的名字.pdf'), `改名后磁盘应是新名：${JSON.stringify(afterRename)}`);
    assert.ok(!afterRename.includes('待改名.pdf'), `旧名应不存在：${JSON.stringify(afterRename)}`);

    assert.deepEqual(errors, [], '页面不该有异常');
  } finally {
    await browser.close().catch(() => {});
    server.kill();
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
});
