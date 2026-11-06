/**
 * 论文页：**在栏头 ＋ 里选一个 PDF，必须真的传上去**。
 *
 * # 这条测试守的是三个都验过的真实故障
 *
 * **1. 清空 `input.value` 把刚选到的文件也清掉了。**
 *    `input.files` 是**活**的 `FileList`，和 input 的选中态是同一个对象。
 *    原来写的是「先取出 `files`、再 `value = ''`、再交给上传函数」，实测清空前后
 *    同一个 `FileList` 的 `length` 由 1 变 0，于是上传函数里
 *    `[...files].filter(是 PDF)` 得到空数组，用户看到「明明选了 PDF，却提示只支持 PDF」。
 *    修法：**先快照成真数组，再清空**（`File` 对象本身不受清空影响，字节照样读得到）。
 *    所以这里必须走**真实的选择器**（`setInputFiles`），而不是伪造 `change` 事件 ——
 *    伪造事件时 `input.files` 本来就没内容，这个 bug 一条都测不出来。
 *
 * **2. 没有打开任何文献时，上传必然 400。**
 *    上游 `/api/library/upload` 见到空 `topic` 就回
 *    「缺少 x-dpr-topic / x-dpr-name 头」。而空库第一次导入时页面上并没有"当前文件夹"，
 *    照直发空 topic 过去，**新用户永远传不进第一篇**。修法：库根上传落进兜底专题。
 *
 * **3. 上传完自动打开那篇文献时，整页崩成空白。**
 *    `ReaderFrame` 里 `contentDocument?.documentElement.classList` 那个 `?.` 只护住
 *    `contentDocument`；iframe 刚换 src 时 `documentElement` 是 `null`，异常抛在 effect 里
 *    被 slot 的 error boundary 接住，`zhiyun.paper.content` 整个塌掉。
 *
 * 三条都在**真机**（真宿主 + 真浏览器 + 真文件选择）上验，因为它们在纯函数层面都不成立。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { toggleFrameClass } from '../packages/dsh-zhiyun-page-paper/src/frame-dom.js';

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
 * 并给出**假绿灯**。这条守卫把它变成明确的失败。
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

test('阅读器 iframe 还没解析出根元素时，开关 class 不能抛', () => {
  // 这一条守的是「上传完自动打开 → 整页空白」的第三层原因。
  // iframe 换 src 后有一段窗口期：`contentDocument` 有值，但 `documentElement` 还是 null。
  // 旧写法 `contentDocument?.documentElement.classList` 在这里抛 TypeError，
  // 被 slot 的 error boundary 接住，整个论文页塌掉。
  //
  // 那个窗口期是**时序相关**的，真机测试时而命中时而不命中 —— 所以判定逻辑抽成
  // 纯函数 `toggleFrameClass` 单独验，不靠运气。
  const makeClassList = () => {
    const set = new Set();
    return { set, toggle: (name, on) => { if (on) set.add(name); else set.delete(name); } };
  };

  // ① contentDocument 整个是 null（还没开始加载）
  assert.equal(toggleFrameClass(null, 'zp-cornell-visible', true), false);

  // ② contentDocument 有值、documentElement 还是 null —— 旧写法正好在这里抛
  assert.equal(toggleFrameClass({ documentElement: null }, 'zp-cornell-visible', true), false);

  // ③ 根元素在，但不带 classList（极端退化输入）
  assert.equal(toggleFrameClass({ documentElement: {} }, 'zp-cornell-visible', true), false);

  // ④ 正常情形：真的开关了
  const classList = makeClassList();
  const doc = { documentElement: { classList } };
  assert.equal(toggleFrameClass(doc, 'zp-cornell-visible', true), true);
  assert.ok(classList.set.has('zp-cornell-visible'));
  assert.equal(toggleFrameClass(doc, 'zp-cornell-visible', false), true);
  assert.ok(!classList.set.has('zp-cornell-visible'));
});

test('论文上传：选了 PDF 就真的传上去，空库第一次也能传', { timeout: 240000 }, async (t) => {
  assertBundleFresh('dsh-zhiyun-page-paper', ['Paper.jsx', 'ReaderFrame.jsx', 'PaperTree.jsx', 'client.jsx']);

  const browser = await launchBrowser();
  if (browser === null) {
    t.skip('没有可启动的浏览器：设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，或安装 Edge');
    return;
  }

  const { initialize, runHost } = await import(pathToFileURL(path.join(root, 'scripts/profile.mjs')).href);
  const { minimalPdf } = await import('./fixtures/minimal-pdf.mjs');

  const home = await mkdtemp(path.join(tmpdir(), 'paper-upload-'));
  const picked = await mkdtemp(path.join(tmpdir(), 'paper-upload-files-'));
  const pdf = path.join(picked, '论文一.pdf');
  const txt = path.join(picked, '不是PDF.txt');
  await writeFile(pdf, minimalPdf());
  await writeFile(txt, 'not a pdf');

  const runtime = await initialize({ home });
  // 刻意**什么都不建**：这就是新用户空库的样子 —— 也正是原来必然失败的那种状态。
  const dataDir = path.join(runtime.profile, 'data', 'zhiyun-paper');
  await mkdir(dataDir, { recursive: true });

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
    const crashed = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().includes('slot entry crashed')) crashed.push(m.text());
    });
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

    // ① 空库直接选一个 PDF —— 走真实的选择器，这正是用户点 ＋ 的那条路
    await page.setInputFiles('input[type=file]', pdf);
    await sleep(3000);

    const errorAfterPdf = await page.evaluate(() =>
      document.querySelector('.zp-tree-error')?.textContent ?? null);
    assert.equal(errorAfterPdf, null, `选了合法 PDF 不该报错，实际：${errorAfterPdf}`);

    // 磁盘上真的有了（而不是"界面看着像成功"）
    const topics = await readdir(dataDir);
    assert.equal(topics.length, 1, `应恰好建出一个专题目录：${JSON.stringify(topics)}`);
    const stored = await readdir(path.join(dataDir, topics[0]));
    assert.deepEqual(stored, ['论文一.pdf'], `PDF 应原样落盘：${JSON.stringify(stored)}`);

    // 树上也能看到，而且带上层级（路径含专题前缀，如 `未分类/论文一.pdf`）
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.zp-tree-btn')].map((b) => b.dataset.path));
    assert.ok(rows.some((p) => p.endsWith('/论文一.pdf') || p === '论文一.pdf'),
      `树上应出现这篇文献：${JSON.stringify(rows)}`);

    // ② 整页没有因为"上传完自动打开"而崩掉
    assert.deepEqual(crashed, [], '上报后整页不该崩（ReaderFrame 的 classList 那处）');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.zp-page'))), true,
      '上传后论文页仍应渲染');

    // ③ 选一个非 PDF：提示要**说清楚是哪个文件**，不能只说"只支持 PDF"
    await page.setInputFiles('input[type=file]', txt);
    await sleep(1500);
    const errorAfterTxt = await page.evaluate(() =>
      document.querySelector('.zp-tree-error')?.textContent ?? null);
    assert.ok(typeof errorAfterTxt === 'string' && errorAfterTxt.includes('不是PDF.txt'),
      `非 PDF 的提示应指名文件，实际：${errorAfterTxt}`);
    // 而且没有再多出一个文件
    assert.deepEqual(await readdir(path.join(dataDir, topics[0])), ['论文一.pdf'],
      '非 PDF 不该落盘');
  } finally {
    await browser.close().catch(() => {});
    server.kill();
    await rm(home, { recursive: true, force: true }).catch(() => {});
    await rm(picked, { recursive: true, force: true }).catch(() => {});
  }
});
