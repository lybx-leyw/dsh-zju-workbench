import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { initialize, lock, root, runHost } from './profile.mjs';
import { CLIENT_PACKAGES } from './build.mjs';
import { LEARNING_SPACE_TITLE } from '../packages/core/study/src/learning-space.js';
import { NAV, RAIL_DEFAULT } from '../packages/client/ui-shared/src/pages-model.js';

const evidence = path.join(root, 'artifacts');

/**
 * 当前 profile **真实具备**哪些产品能力。
 *
 * 这个脚本原先写死了一套装配（必有 today 页、必有四个启动标记）。profile 瘦身
 * 之后那套装配不存在了，脚本就在第一屏超时 —— 看起来像「宿主不兼容」，
 * 实际是「测试对象被移除了」。所以改成先问 profile：你有什么，我就验什么。
 *
 * @returns `{ hasShell, pages, hasClassroom, hasParser, hasLecture, hasStore }`。
 */
async function profileCapabilities() {
  const template = JSON.parse(await readFile(path.join(root, 'profiles', lock.profile, 'package.json'), 'utf8'));
  const bundles = template.dsh.profile.bundles;
  const has = name => bundles.includes(name);
  return {
    bundles,
    // 外壳：决定页面上有没有 .zw-page 与智云导轨。
    hasShell: has('dsh-zju-shell-workbench'),
    // 页面包：决定导航里能不能点开具体页。
    pages: bundles.filter(name => name.startsWith('@lybx-leyw/dsh-zju-page-')),
    // 四个启动标记的产出方（都是业务插件，瘦身后不在 profile 里）。
    hasClassroom: has('@lybx-leyw/dsh-zju-core-classroom-studio'),
    hasParser: has('@lybx-leyw/dsh-zju-core-parser'),
    hasLecture: has('@lybx-leyw/dsh-zju-core-lecture'),
    hasStore: has('@lybx-leyw/dsh-zju-core-quiz') || has('@lybx-leyw/dsh-zju-core-notes') || has('@lybx-leyw/dsh-zju-core-knowledge'),
  };
}

/**
 * 等「产品面」出现。
 *
 * 有外壳时等 `.zw-page[data-page=today]`（原行为）；没有外壳时只等 DOM 就绪 ——
 * 界面是原生 DSH，不存在 .zw-page，硬等只会得到一个与根因无关的超时。
 *
 * @param page - Playwright 页面。
 * @param caps - {@link profileCapabilities} 的返回值。
 * @param timeout - 毫秒。
 */
async function waitForProductSurface(page, caps, timeout = 60000) {
  if (!caps.hasShell) {
    await page.waitForLoadState('domcontentloaded');
    return;
  }
  await page.locator('.zw-page[data-page=today]').waitFor({ timeout });
}

/** The host runs its own first-run steps — the developer-preview notice and the
 *  "add an API key" model step. They belong to host onboarding, not to this
 *  product, so acknowledge them the way a user would and then
 *  require a genuinely quiet page before touching it. Only a *visible* mask
 *  counts: the modal layer stays attached when nothing is open.
 *
 *  # 按钮文案随宿主版本变（实测）
 *
 *  | 宿主 | 首次引导的按钮 |
 *  | --- | --- |
 *  | 0.2.0-rc.2 / 0.2.1-alpha.1 | 「继续」、「稍后配置」 |
 *  | 0.2.1-rc.5 / 0.2.2-rc.1 | 「开始使用」弹窗：「添加 API Key」、「登录」、右上角 × |
 *
 * 只认旧版文案的后果不是「兼容性差」，而是**卡在 45 秒超时**，且报错说的是
 * 「overlay 挡住了」，看不出真正原因是文案变了。所以这里两份都认。
 *
 * 「添加 API Key」是**关闭引导最轻的一步**（它只是打开配置，不会真的写 key）；
 * 不点「登录」—— 那需要账号，跑测试不该依赖它。 */
async function settleHostOverlays(page) {
  const steps = [
    // 旧版
    page.getByRole('button', { name: '继续', exact: true }),
    page.getByRole('button', { name: '稍后配置', exact: true }),
    // 新版「开始使用」弹窗：走「添加 API Key」把引导收掉
    page.getByRole('button', { name: '添加 API Key', exact: true }),
  ];
  const mask = page.locator('div[role="presentation"] > div[aria-hidden="true"]').first();
  const deadline = Date.now() + 45000;
  let quiet = 0;
  while (Date.now() < deadline) {
    let acknowledged = false;
    for (const step of steps) {
      if (!await step.isVisible().catch(() => false)) continue;
      // 0.2.1-alpha 的「继续」先禁用、等一个异步步骤之后才可点：
      // 可见 ≠ 可点，硬点会让 Playwright 一直等 enabled 直到超时。
      if (!await step.isEnabled().catch(() => false)) continue;
      try {
        await step.click({ timeout: 5000 });
      } catch {
        // 弹层可能在点击途中被宿主换掉（新版会自己消失）——下一轮再看，不算失败。
      }
      acknowledged = true;
      break;
    }
    if (acknowledged) { quiet = 0; continue; }
    quiet = (await mask.isVisible().catch(() => false)) ? 0 : quiet + 1;
    if (quiet >= 8) return;
    await page.waitForTimeout(250);
  }
  throw new Error('a host onboarding overlay is still blocking the page after 45s');
}

/** A user click that may be temporarily blocked by a host onboarding layer that
 *  appears after the page looked quiet (the host re-runs first-run steps on some
 *  loads). Settling and retrying keeps the assertion about the product action. */
async function clickAfterOnboarding(page, locator) {
  const deadline = Date.now() + 90000;
  let last;
  while (Date.now() < deadline) {
    await settleHostOverlays(page).catch(() => {});
    try {
      await locator.click({ timeout: 5000 });
      return;
    } catch (error) {
      last = error;
      await page.waitForTimeout(500);
    }
  }
  throw last;
}

/** Load the document again and wait for the product page to mount. A row added
 *  to the profile joins the browser boot graph on the next document load: the
 *  host injects window.__DSH_BOOT__ per index.html request. */
async function reloadProduct(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForProductSurface(page, CAPS, 60000);
  await settleHostOverlays(page);
}

/** Profile patching is applied by the host watcher asynchronously. A reload
 *  issued before it settles boots the previous graph, so retry until the
 *  product surface is actually back instead of sleeping a fixed interval. */
async function reloadProductEventually(page) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
      await page.locator('.zw-page[data-page=today]').waitFor({ timeout: 8000 });
      await settleHostOverlays(page);
      return;
    } catch {
      await page.waitForTimeout(1000);
    }
  }
  throw new Error('the product surface did not return after restoring the profile patch');
}

/** Reload until the native-only surface is really booted. The same watcher
 *  settling applies when the product rows are disabled. */
async function reloadNativeEventually(page) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
      await page.locator('[class*="_sidebarCol"]').waitFor({ timeout: 8000 });
      await settleHostOverlays(page);
      if (await page.locator('.zw-sidebar').count() === 0) return;
    } catch { /* previous graph still booting; retry */ }
    await page.waitForTimeout(1000);
  }
  throw new Error('the native surface did not return after disabling the product bundles');
}

/** 一页最小可用的 PDF，够 pdf.js 渲染出 canvas 与可选中文本层。 */
function minimalPdf(lines) {
  const content = lines.map((line, i) => `BT /F1 18 Tf 72 ${720 - i * 28} Td (${line}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * 整体停用「产品」时要关掉的那几行。
 *
 * 「产品 UI」= 有客户端半边的包（壳 + 共享原语 + 领域核心 + 各页面包），也就是
 * `CLIENT_PACKAGES`；再加上论文宿主半边（它承载 `/paper-reader` 与文献设置页）。
 *
 * ⚠️ 口径必须是「有客户端半边的包」，不能是「本仓所有包」：业务包（课堂/解析/出题/笔记/
 * 知识库/讲义/终审）不该被这段测试停掉，全停一遍会让恢复时同时重载十来个宿主插件，
 * 上游 `ui-cordis` 的清单读取会在这中间抢跑失败（`dynamicCordisRunner/inventory: Failed to fetch`），
 * 于是最后那条「没有浏览器报错」的断言红掉。也不要手写：手写的清单在加「插件」页时漏了一行，
 * 表现是下面「样式已撤回」的断言 60 秒后超时。从 `CLIENT_PACKAGES` 推导，两边都不会漏。
 * @returns 行 id（= 包名去掉 `dsh-` 前缀，与本仓每个 cordis.patch.yml 里 insert 的 id 一致）。
 */
function productRowIds() {
  const bundles = [...CLIENT_PACKAGES, ''@ggboy123/dsh-paper-reader''];
  return [...new Set(bundles.map(bundle => bundle === 'dsh-zju-shell-workbench' ? 'zw-shell' : bundle.replace(/^dsh-/, '')))].sort();
}

/** 往 profile 的文献库里放一篇真论文，供下面的抽屉端到端断言使用。 */
async function writeProbePaper(runtime) {
  const dir = path.join(runtime.profile, 'data', 'zw-paper', 'host-probe');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'probe-paper.pdf'), minimalPdf([
    'Attention Is All You Need',
    'The dominant sequence transduction models are based on',
    'complex recurrent or convolutional neural networks.',
    'We propose a new simple network architecture, the Transformer,',
    'based solely on attention mechanisms.',
  ]));
}

/** 「论文阅读」的核心链路，全部在真实宿主里走一遍：打开本地 PDF → 右侧抽屉展开 →
 *  发一个问题 → 回答流里只出现对话本身。 */
async function paperProbe(page, evidence, checks) {
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '论文', exact: true }).click();
  await page.locator('.zw-page[data-page=paper]').waitFor();
  await page.locator('.zwp-library-trigger').click();
  await page.locator('.zwp-library-pop').waitFor();
  await page.locator('.zwp-library-topic button', { hasText: 'probe-paper' }).first().click();

  // 左侧必须真的是 PDF（canvas 由 pdf.js 画出来，文本层可选中）。
  const reader = page.frameLocator('.zwp-frame');
  await reader.locator('.page canvas').first().waitFor({ timeout: 30000 });
  // 文本层比 canvas 晚一步（pdf.js 先画布后铺 span），所以要等它出现再数，
  // 否则这条断言会随机失败。
  await reader.locator('.textLayer span').first().waitFor({ timeout: 30000 });
  assert.ok(await reader.locator('.textLayer span').count() >= 3, 'the PDF text layer is selectable');

  // 抽屉默认收起，展开后必须占住正文右缘（不是浮在中间，也不是把正文压没）。
  assert.equal(await page.locator('.zwp-drawer.is-open').count(), 0);
  await page.locator('.zwp-bar-actions').getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.locator('.zwp-drawer.is-open').waitFor();
  // 抽屉在正文**右边**：它的左缘要贴上正文的右缘（探针实测 drawer.left=1048 =
  // main.right，drawer 一直延伸到视口右缘）。
  const box = await page.evaluate(() => {
    const drawer = document.querySelector('.zwp-drawer');
    const main = document.querySelector('.zwp-main');
    const d = drawer.getBoundingClientRect();
    const m = main.getBoundingClientRect();
    return {
      left: d.left,
      width: d.width,
      height: d.height,
      mainRight: m.right,
      mainWidth: m.width,
      viewport: innerWidth,
      hidden: drawer.getAttribute('aria-hidden'),
    };
  });
  assert.equal(box.hidden, 'false', 'the open drawer must not stay aria-hidden');
  assert.ok(box.width >= 300, `drawer width = ${box.width}`);
  assert.ok(Math.abs(box.left - box.mainRight) <= 2, `drawer left ${box.left} should sit on the reader edge ${box.mainRight}`);
  assert.ok(box.height >= 400, `drawer height = ${box.height}`);
  assert.ok(box.mainWidth > 300, `the reader keeps room to the left (width ${box.mainWidth})`);

  // 发一个问题：这里走的是上游宿主半边的 /api/ask，会真的建一个会话。
  const asked = page.waitForResponse(response => response.url().includes('/paper-reader/api/ask'), { timeout: 60000 });
  await page.locator('.zwp-drawer-compose textarea').fill('这篇论文的核心贡献是什么？');
  await page.locator('.zwp-drawer-compose').getByRole('button', { name: '发送', exact: true }).click();
  const answer = await asked;
  assert.equal(answer.status(), 200, `POST /paper-reader/api/ask → ${answer.status()}`);

  await page.locator('.zwp-bubble').first().waitFor({ timeout: 60000 });
  const bubbles = await page.locator('.zwp-bubble-text').allInnerTexts();
  const leaked = bubbles.filter(text => /<system-reminder>|Current runtime context|A skill is a reusable/.test(text));
  assert.deepEqual(leaked, [], 'workbench context must never be rendered as chat bubbles');
  assert.match(bubbles.join('\n'), /核心贡献/, 'the question itself is shown');
  // 折叠了几条要如实说，否则用户会以为助手一句话没说。
  assert.equal(await page.locator('.zwp-drawer-folded').count(), 1, 'folded context is reported to the user');
  // 用户气泡是纯文本：划选来的原文常带 `*`、反引号、`#`，按 Markdown 渲染会把原样文字画走样。
  // （助手气泡反过来必须走渲染器，这里没模型凭证拿不到助手回答，那条由 tests/paper.test.mjs 守。）
  assert.equal(
    await page.locator('.zwp-bubble.is-user [data-markdown-variant]').count(),
    0,
    'the user bubble must stay plain text',
  );

  // `/resume` 是命令不是提问：它必须被输入框拦下，而不是发给论文助手。
  const labeled = page.waitForResponse(response => response.url().includes('/zw-paper/api/sessions/labels'), { timeout: 60000 });
  await page.locator('.zwp-drawer-compose textarea').fill('/resume');
  await page.locator('.zwp-drawer-compose textarea').press('Enter');
  await page.locator('.zwp-resume').waitFor({ timeout: 15000 });
  assert.equal((await labeled).status(), 200, 'the session labels endpoint answers for this paper');
  // 标签里的「首句」必须是**用户自己问的那句**：上游把文献路径、选区、`用户的问题：`
  // 前缀都拼进了同一条消息，直接显示原文会把每行都撑满且看不出区别。
  await page.locator('.zwp-resume-row .zwp-resume-first', { hasText: '这篇论文的核心贡献是什么？' })
    .first().waitFor({ timeout: 15000 });
  assert.equal(await page.locator('.zwp-drawer-compose textarea').inputValue(), '', 'the command is consumed, not left in the box');
  assert.equal(await page.locator('.zwp-bubble.is-user', { hasText: '/resume' }).count(), 0, '/resume must never reach the model');
  const palette = await page.evaluate(() => {
    const box = document.querySelector('.zwp-resume');
    const list = document.querySelector('.zwp-resume-list');
    const rect = box.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.zwp-resume-row')];
    return {
      focused: box.contains(document.activeElement),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      scrollable: getComputedStyle(list).overflowY,
      codes: rows.map(row => row.querySelector('.zwp-resume-code')?.textContent ?? ''),
      firsts: rows.map(row => row.querySelector('.zwp-resume-first')?.textContent ?? ''),
    };
  });
  assert.ok(palette.focused, 'the palette takes focus so ↑↓/Enter/Delete hit it, not the textarea');
  assert.ok(palette.width > 200 && palette.width < 520, `palette width = ${palette.width} (fixed, fits the drawer)`);
  assert.ok(palette.height >= 240, `palette height = ${palette.height}`);
  assert.equal(palette.scrollable, 'auto', 'the palette list scrolls instead of growing');
  assert.ok(palette.codes.length >= 1, 'the session just created is listed');
  assert.ok(palette.codes.every(code => /^#[0-9a-z]{4}$/.test(code)), `session codes = ${palette.codes.join(',')}`);
  assert.ok(palette.firsts.every(text => text.length > 0), 'every row carries a label (first question / title / placeholder)');

  // ↑↓ 在面板上移动选中项，到边界绕回另一端。本次探针只发过一个问题，
  // 所以这里往往只有一行 —— 单行时绕回原位是正确的，不能当成失败。
  const activeAt = () => page.evaluate(() => [...document.querySelectorAll('.zwp-resume-row')].findIndex(row => row.classList.contains('is-active')));
  const wasAt = await activeAt();
  await page.locator('.zwp-resume').press('ArrowUp');
  const upAt = await activeAt();
  if (palette.codes.length > 1) {
    assert.notEqual(upAt, wasAt, 'ArrowUp moves the selection');
  } else {
    assert.equal(upAt, 0, 'a single-row list keeps its only row selected');
  }
  await page.locator('.zwp-resume').press('ArrowDown');
  assert.equal(await activeAt(), wasAt, 'ArrowDown moves it back');

  await page.screenshot({ path: path.join(evidence, 'paper-resume.png'), fullPage: true });
  await page.locator('.zwp-resume').press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.zwp-resume').length === 0, null, { timeout: 5000 });

  await page.screenshot({ path: path.join(evidence, 'paper-drawer.png'), fullPage: true });
  await page.locator('.zwp-drawer-toggle').click();
  assert.equal(await page.locator('.zwp-drawer.is-open').count(), 0, 'the drawer collapses again');
  checks.push('Paper page: local PDF renders, the AI drawer answers, injected context stays folded');
  checks.push('Paper page: /resume opens a fixed-size scrollable session palette with ↑↓ navigation');
}
/** A real loader package, generated only in the disposable test profile. */
async function writeNativePluginProbe(runtime) {
  const dir = path.join(runtime.profile, 'node_modules', 'zw-test-native-panel');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'zw-test-native-panel', private: true, type: 'module',
    exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
    dsh: { client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'] } },
  }));
  await writeFile(path.join(dir, 'index.js'), 'export function apply() {}\n');
  await writeFile(path.join(dir, 'client.js'), `window.__ModuleLoader__.load({ id: 'zw-test-native-panel', factory: require => {
    const React = require('react');
    return { inject: ['slots'], apply(ctx) {
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'test-import-session' },
        () => React.createElement('section', { 'data-test-native-panel': true }, '测试原生导入面板')));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'test-import-session', label: '导入会话' },
        () => React.createElement('span', { 'aria-hidden': true }, '↓')));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'test-native-overlay' },
        () => React.createElement('div', { 'data-test-native-overlay': true, style: { position: 'fixed', right: 0, bottom: 30 } }, '测试普通覆盖层')));
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'test-native-footer' },
        () => React.createElement('footer', { 'data-test-native-footer': true }, '测试原生页脚')));
    } };
  } });\n`);
}

await mkdir(evidence, { recursive: true });
let server;
let browser;
let hostLog = '';
let runtime;
const errors = [];
const checks = [];
// 先问 profile：它有什么，就验什么（见文件头 profileCapabilities 的说明）。
// 这一步必须早于任何 waitFor —— 否则会在一个不存在的 .zw-page 上白等 60 秒，
// 而超时信息完全指不出真正原因（测试对象被移除了）。
const CAPS = await profileCapabilities();
if (!CAPS.hasShell) {
  console.log('[adaptive] profile 没有外壳包（dsh-zju-shell-workbench），界面是原生 DSH；'
    + '跳过页面导航类断言，只验启动、无报错、插件不被跳过。');
}
try {
  let url = process.env.ZW_TEST_URL;
  if (!url && process.argv.includes('--running')) {
    url = (await readFile(path.join(root, 'host.log'), 'utf8')).match(/dsh web: (http:\/\/\S+)/)?.[1];
  }
  if (!url) {
    runtime = await initialize({ home: path.join(evidence, `host-${Date.now()}`) });
    await symlink(path.join(root, 'tests/fixtures/course-panel'), path.join(runtime.profile, 'node_modules', 'zw-test-course-panel'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeNativePluginProbe(runtime);
    // 抽屉那段断言需要一篇真实文献；宿主起来之前先放进文献库，页面加载时就能列出来。
    await writeProbePaper(runtime);
    server = runHost(runtime, ['--no-open', '--port', '0'], { pipe: true });
    url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Host startup timed out: ${hostLog.slice(-3000)}`)), 180000);
      const consume = data => {
        hostLog += data;
        const match = hostLog.match(/dsh web: (http:\/\/\S+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      };
      // 按 UTF-8 **整体**解码：逐块拼字符串会在汉字跨块时产生替换字符，污染启动日志。
      server.stdout.setEncoding('utf8');
      server.stderr.setEncoding('utf8');
      server.stdout.on('data', consume);
      server.stderr.on('data', consume);
      server.on('error', error => { clearTimeout(timeout); reject(error); });
      server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Host exited ${code}: ${hostLog.slice(-2000)}`)); });
    });
  }
  browser = await chromium.launch({ channel: process.env.ZW_BROWSER_CHANNEL ?? 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, locale: 'zh-CN', colorScheme: 'light' });
  // Model onboarding can arrive after remote readiness, including after a reload.
  // Acknowledge that host-owned prompt when it blocks any later user action.
  await page.addLocatorHandler(page.getByRole('button', { name: '稍后配置', exact: true }), async button => { await button.click(); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForProductSurface(page, CAPS, 60000);
  await settleHostOverlays(page);
  if (await page.locator('body').evaluate(body => body.hasAttribute('data-ds-dark-theme'))) {
    await page.getByRole('button', { name: '切换明暗', exact: true }).click();
    await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  }
  checks.push('Real host boot and initial Today selection');
  // 导轨上的页面数**从 RAIL_DEFAULT 推导**，不写死数字。
  // ⚠️ 导轨不再等于「NAV 里所有上侧栏的页」：默认固定在导轨上的是 RAIL_DEFAULT
  //    （学习动线），「插件」「反馈」默认收在末尾的「···」菜单里，
  //    由用户点图钉固定。数字是结论，依据在 RAIL_DEFAULT 里。
  // 没有外壳包时不存在这条导轨，跳过（否则会等到一个永远不出现的元素）。
  if (CAPS.hasShell) {
    assert.equal(await page.getByRole('navigation', { name: '主要页面' }).getByRole('button').count(), RAIL_DEFAULT.length + 1);
  }
  await page.screenshot({ path: path.join(evidence, 'today-light.png'), fullPage: true });
  if (process.argv.includes('--bridge-only') && CAPS.hasShell) {
    await page.keyboard.press('Control+k');
    await page.getByRole('textbox', { name: '搜索页面' }).fill('今天');
    await page.keyboard.press('Enter');
    await page.locator('.zw-page[data-page=today]').waitFor();
    checks.push('Product page search owns Ctrl+K only outside Ask');
  }
  // Focused layout lane avoids unrelated parser graph and model-backed PDF checks.
  // 整段都在验「页面能导航、插件页能打开」—— 前提是 profile 里有外壳包与页面包。
  // 瘦身到只有 source 后端包时，这一整段都无从谈起，直接跳过。
  if (!process.argv.includes('--bridge-only') && CAPS.hasShell) {
  for (const [label, id] of [['论文', 'paper'], ['学习', 'study']]) {
    await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: label, exact: true }).click();
    await page.locator(`.zw-page[data-page=${id}]`).waitFor();
  }
  // 「个人」页已删除：导轨最下方那格圆形头像**不是页面**，点它浮出账号面板
  // （登录 / 设置）。账号与数据的内容都在原生设置浮窗的「账号与数据」分区里，
  // 这里先确认头像只开面板、不跳页。
  await page.getByRole('button', { name: '账号', exact: true }).click();
  await page.locator('.zw-account-menu').waitFor();
  assert.equal(await page.locator('.zw-page[data-page=me]').count(), 0, 'the Personal page no longer exists');
  assert.deepEqual(await page.locator('.zw-account-menu .zw-rail-menu-open').allInnerTexts(), ['登录', '设置'], 'the account menu offers sign-in and settings only');
  await page.keyboard.press('Escape');
  checks.push('All product pages navigate through host layout; the account avatar opens a menu, not a page');
  // 「插件」也不在导轨上：它属于「···」菜单（默认不固定，要用了再钉）。
  // 所以这里走菜单，而不是直接找导航按钮。
  await page.locator('.zw-rail-more').click();
  await page.locator('.zw-rail-menu-open', { hasText: '插件' }).click();
  await page.locator('.zw-page[data-page=plugins]').waitFor();
  await page.locator('.zwpl-row').first().waitFor({ timeout: 60000 });
  const pluginRows = await page.locator('.zwpl-row').evaluateAll(list => list.map(row => ({
    name: row.querySelector('.zwpl-row-head strong')?.textContent,
    inner: row.querySelector('.zwpl-badge-inner') !== null,
  })));
  const parserRow = pluginRows.find(row => row.name === 'parser');
  assert.ok(parserRow?.inner === true, '解析包必须显示为「被 N 个包依赖」，而不是叶');
  assert.deepEqual(await page.locator('.zwpl-badge-wait').allInnerTexts(), [], '健康组合里不该有「等待依赖」');
  checks.push('The plugins page derives the dependency graph from the runtime, including host-plane hard edges');
  await page.screenshot({ path: path.join(evidence, 'plugins.png'), fullPage: true });
  // 「论文」页在真实宿主里必须真的渲染出来：导航能点开只证明外壳注册了插槽，
  // 不证明页面包激活了。这里等它自己的 DOM 出现，并确认空文献库走的是空态。
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '论文', exact: true }).click();
  await page.locator('.zw-page[data-page=paper]').waitFor();
  await page.locator('.zwp-landing').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.zw-content .zw-empty').count(), 1, 'an empty library shows the landing empty state');
  assert.equal(await page.locator('.zwp-frame').count(), 0, 'no reader frame is mounted before a paper is picked');
  await page.screenshot({ path: path.join(evidence, 'paper.png'), fullPage: true });
  checks.push('The paper page activates and renders its own empty state');
  // 上游宿主插件（锁版依赖）必须挂上了它的前缀路由；页面包自有的 /zw-paper 也必须活着。
  const paperStatus = await page.evaluate(async () => {
    const [own, upstream] = await Promise.all([
      fetch('/zw-paper/api/status').then(r => r.status).catch(() => 0),
      fetch('/paper-reader/api/library').then(r => r.status).catch(() => 0),
    ]);
    return { own, upstream };
  });
  assert.equal(paperStatus.own, 200, 'the compat layer serves /zw-paper/api/status');
  assert.equal(paperStatus.upstream, 200, 'the pinned upstream host half serves its own /paper-reader routes');
  checks.push('Both the compat layer and the pinned upstream plugin answer on their own route prefixes');
  // 右侧 AI 助手抽屉：打开后必须真的占住正文右缘、能提交问题，并且**不把工作台注入的
  // 上下文（AGENTS.md / 运行时策略 / 技能目录）当聊天气泡铺出来** —— 实测过：不滤的话
  // 技能目录一条就是 11 万字符。这里用真文献走完整链路（上游宿主半边会建会话）。
  // 需要我们自己起的宿主（文献由 writeProbePaper 放进去）；--running 模式下没有。
  if (runtime) await paperProbe(page, evidence, checks);
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '学习', exact: true }).click();
  await page.getByRole('button', { name: '登录智云课堂' }).waitFor();
  await page.getByRole('button', { name: '登录智云课堂' }).click();
  await page.getByRole('dialog', { name: '登录智云课堂' }).waitFor();
  await page.getByRole('region', { name: '智云课堂账号' }).waitFor();
  await page.getByLabel('浙大账号', { exact: true }).waitFor();
  // ⚠️ 必须关掉：`showModal()` 会把页面其余部分变成 inert，
  //    不关的话下面点侧栏会一直被对话框挡住。
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('dialog', { name: '登录智云课堂' }).waitFor({ state: 'hidden' });
  await page.getByRole('navigation', {name:'主要页面'}).getByRole('button',{name:'学习',exact:true}).click();
  await page.screenshot({ path: path.join(evidence, 'study.png'), fullPage: true });
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索页面' }).fill('今天');
  await page.keyboard.press('Enter');
  await page.locator('.zw-page[data-page=today]').waitFor();
  checks.push('Search dialog and keyboard navigation');
  await page.getByRole('button', { name: '切换明暗', exact: true }).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'));
  await page.screenshot({ path: path.join(evidence, 'today-dark.png'), fullPage: true });
  await page.getByRole('button', { name: '切换明暗', exact: true }).click();
  await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  checks.push('Native theme service switches light/dark');
  }
  // ── 以下整段依赖「产品外壳 + 页面包」：问一问 / 账号面板 / 设置分区 / 导轨 ──
  // profile 瘦身到只有 source 后端包时，这些元素在页面上**根本不存在**，
  // 硬跑只会得到一串与根因无关的超时。所以按 profile 能力整段跳过，
  // 而不是逐个断言加条件 —— 逐个加会让「这一层没有」和「这一层坏了」难以分辨。
  if (!CAPS.hasShell) {
    checks.push('profile 无外壳包：跳过问一问 / 账号面板 / 设置分区 / 导轨相关断言');
  } else {
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '问一问', exact: true }).click();
  const native = page.locator('.zw-workbench-native');
  await native.waitFor();
  const nativeSidebar = native.locator('[class*="_sidebarCol"]');
  const nativeMain = native.locator('[class*="_centerCol"]');
  await nativeSidebar.waitFor();
  await nativeMain.waitFor();
  assert.match(await nativeSidebar.innerText(), /工作区/, 'Ask retains the native workspace browser');
  for (const control of ['搜索会话', '视图选项', '添加工作区']) {
    assert.ok(await native.getByLabel(control, { exact: true }).count() > 0, `native workspace browser offers ${control}`);
  }
  assert.ok(await native.locator('[aria-label*="新建会话"]').count() > 0, 'native per-workspace New Session is retained');
  assert.equal(await page.locator('.zw-workbench-navigation [aria-label="添加工作区"]').count(), 0, 'outer navigation is independent of native workspaces');
  assert.equal(await page.locator('.zw-drawer').count(), 0, 'Ask does not recreate the workspace browser in a custom drawer');
  await page.waitForFunction(() => !document.body.innerText.includes('选择一个工作区开始'), undefined, { timeout: 30000 });
  assert.ok((await native.innerText()).includes(LEARNING_SPACE_TITLE), 'the fixed learning space is selected');
  const retained = await native.evaluateHandle(node => ({ root: node.firstElementChild, main: node.querySelector('[class*="_centerCol"]'), sidebar: node.querySelector('[class*="_sidebarCol"]') }));
  await page.screenshot({ path: path.join(evidence, 'ask.png'), fullPage: true });
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '今天', exact: true }).click();
  await page.locator('.zw-page[data-page=today]').waitFor();
  assert.equal(await native.isVisible(), false, 'Today hides the entire native UI');
  assert.equal(await native.getAttribute('hidden'), '', 'native UI is hidden rather than unmounted');
  assert.equal(await native.getAttribute('inert'), '', 'hidden native controls cannot receive focus');
  assert.equal(await nativeMain.isVisible(), false, 'native main does not leak onto Today');
  assert.equal(await nativeSidebar.isVisible(), false, 'native sidebar does not leak onto Today');
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '问一问', exact: true }).click();
  await native.waitFor();
  assert.ok(await native.evaluate((node, previous) => node.firstElementChild === previous.root && node.querySelector('[class*="_centerCol"]') === previous.main && node.querySelector('[class*="_sidebarCol"]') === previous.sidebar, retained), 'returning to Ask preserves native root, main and sidebar DOM identities');
  await retained.dispose();
  assert.equal(await page.locator('.zw-workbench-frame').getAttribute('data-workbench-page'), 'ask');
  await page.screenshot({ path: path.join(evidence, 'ask-sessions.png'), fullPage: true });
  checks.push('Ask retains native sidebar/workspaces and fixed learning space; outer navigation hides and restores the same native root/main');
  await page.getByRole('button', { name: '账号', exact: true }).click();
  await page.locator('.zw-account-menu .zw-rail-menu-open', { hasText: '设置' }).click();
  // 设置 = 宿主原生浮窗（与 DSH 一致）。「个人」页已删除，所以这里也顺带证明
  // 打开设置不会跳到任何产品页。
  const settingsDialog = page.locator('[role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]');
  await settingsDialog.waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.zw-page[data-page=me]').count(), 0, 'the Personal page no longer exists');
  // 新增的「账号与数据」分区必须在这里，且排在网络代理之前。
  const accountNav = settingsDialog.getByRole('button', { name: /账号与数据/ });
  await accountNav.waitFor({ timeout: 30000 });
  await accountNav.click();
  await settingsDialog.locator('.zw-account-data').waitFor({ timeout: 30000 });
  const sectionLabels = await settingsDialog.locator('nav button').allInnerTexts();
  assert.ok(sectionLabels.findIndex(label => label.includes('账号与数据')) < sectionLabels.findIndex(label => label.includes('网络代理')), `section order = ${JSON.stringify(sectionLabels)}`);
  checks.push('The account-and-data settings section exists and precedes network proxy');
  // 分区列表来自宿主 `settings.section`，插件的注册（论文阅读）必须出现在同一个浮窗里。
  const paperNav = settingsDialog.getByRole('button', { name: /论文阅读/ });
  await paperNav.waitFor({ timeout: 30000 });
  await paperNav.click();
  await settingsDialog.locator('.zwp-settings').waitFor({ timeout: 30000 });
  assert.ok(await settingsDialog.locator('.zwp-card').count() >= 2, '两个上游端点各一张卡');
  if (!process.argv.includes('--bridge-only')) assert.match(await settingsDialog.innerText(), /锁定/, '要显示锁定的上游版本');
  await page.screenshot({ path: path.join(evidence, 'settings.png'), fullPage: true });
  // 网络代理已从「个人」页改注册进原生设置分区：同一个浮窗里必须能打开它。
  const proxyNav = settingsDialog.getByRole('button', { name: /网络代理/ });
  await proxyNav.first().click();
  await settingsDialog.locator('.znp-switch').waitFor({ timeout: 30000 });
  checks.push('The net-proxy panel lives in the native settings modal as its own section');
  // Esc 关闭是宿主浮窗自己的行为，壳不另加一层。
  await page.keyboard.press('Escape');
  await settingsDialog.waitFor({ state: 'detached', timeout: 15000 });
  checks.push('Settings open as the host native modal, with plugin settings.section contributions inside it');
  if (await page.locator('body').evaluate(body => body.hasAttribute('data-ds-dark-theme'))) {
    await page.locator('.zw-sidebar-bottom').getByRole('button', { name: '切换明暗', exact: true }).click();
    await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  }
  await page.screenshot({ path: path.join(evidence, 'theme-light.png'), fullPage: true });
  await page.locator('.zw-sidebar-bottom').getByRole('button', { name: '切换明暗', exact: true }).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(evidence, 'theme-dark.png'), fullPage: true });
  await page.locator('.zw-sidebar-bottom').getByRole('button', { name: '切换明暗', exact: true }).click();
  // 宿主设置快捷键直接打开同一个浮窗，且不会把用户带到任何产品页。
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.keyboard.press('Control+Alt+Comma');
  await settingsDialog.waitFor({ timeout: 15000 });
  assert.equal(await page.locator('.zw-page[data-page=today]').count(), 1, 'the host settings shortcut opens the modal without navigating away');
  await page.setViewportSize({ width: 760, height: 900 });
  const models = settingsDialog.getByRole('button', { name: /AI 服务|模型/ }).first();
  if (await models.count() > 0) await models.click();
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'the settings modal fits a narrow window');
  await page.screenshot({ path: path.join(evidence, 'settings-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.keyboard.press('Escape');
  await settingsDialog.waitFor({ state: 'detached', timeout: 15000 });
  checks.push('Host settings shortcut opens the native modal without leaving the current page');
  // Every document load goes through the same onboarding handling: the host's
  // model step reappears per load whenever no model is configured.
  await reloadProduct(page);
  // ⚠️ 侧栏**不允许展开**（产品决定）：导轨只有图标，名字靠悬停浮出。
  //    所以这里不再有「收起/展开导航」按钮，改验「它一直是收起的、且悬停能读到名字」。
  await page.locator('.zw-sidebar.zw-collapsed').waitFor({ timeout: 10000 });
  const railWidth = await page.locator('.zw-sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width));
  assert.ok(railWidth <= 60, `导轨应保持收起的 56px，实测 ${railWidth}px`);
  await page.locator('.zw-rail-nav .zw-rail-item').first().hover();
  const tip = page.locator('.zw-rail-tip');
  await tip.waitFor({ timeout: 5000 });
  assert.ok((await tip.textContent()).trim().length > 0, '悬停必须浮出页面名字（导轨没有常驻文字）');
  checks.push('Rail-only navigation: always collapsed, names surface on hover');
  await page.screenshot({ path: path.join(evidence, 'navigation-collapsed.png'), fullPage: true });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'window must not overflow horizontally');
  await page.screenshot({ path: path.join(evidence, 'today-narrow.png'), fullPage: true });
  checks.push('Collapsed navigation and narrow window');
  } // end if (CAPS.hasShell)
  if (runtime && CAPS.hasShell) {
    const patch = path.join(runtime.profile, 'cordis.patch.yml');
    // Installing a row is an install: the file watcher applies the new layer
    // first, then the next document load carries the new entry in its boot graph.
    await writeFile(patch, '- insert:\n    - id: test-course-panel\n      name: zw-test-course-panel\n');
    await page.waitForTimeout(800);
    await reloadProduct(page);
    // 插件遮蔽的是「今天」页正文 —— 启动就落在今天，所以不用先点导航。
    // （原先遮蔽「我的课」；那个页面包并入「学习」之后已经没有 `zw.courses.content`
    //  这个插槽了。用例要证的东西没变：外部插件能顶掉产品内容，并靠服务跳转。）
    await page.locator('[data-test-course-provider]').waitFor({ timeout: 30000 });
    await clickAfterOnboarding(page, page.getByRole('button', { name: '去学习', exact: true }));
    await page.locator('.zw-page[data-page=study]').waitFor();
    await writeFile(patch, '- insert:\n    - id: test-native-panel\n      name: zw-test-native-panel\n');
    await page.waitForTimeout(800);
    await reloadProduct(page);
    const importAction = native.getByRole('button', { name: '导入会话', exact: true });
    const overlay = page.locator('[data-test-native-overlay]');
    const footer = page.locator('[data-test-native-footer]');
    await overlay.waitFor({ state: 'attached', timeout: 30000 });
    assert.equal(await importAction.isVisible(), false, 'native plugin action stays hidden on Today');
    assert.equal(await overlay.isVisible(), false, 'ordinary overlay stays hidden on Today');
    assert.equal(await footer.isVisible(), false, 'native footer stays hidden on Today');
    await clickAfterOnboarding(page, page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '问一问', exact: true }));
    await importAction.waitFor();
    await importAction.click();
    await native.locator('[data-test-native-panel]').waitFor();
    assert.equal(await page.locator('.zw-workbench-frame').getAttribute('data-workbench-page'), 'ask', 'native panel selection must not change the outer page');
    assert.ok(await overlay.isVisible());
    assert.ok(await footer.isVisible());
    assert.ok(await overlay.evaluate(node => node.closest('.zw-workbench-native') !== null), 'ordinary shell.overlay must not portal to body');
    assert.ok(await footer.evaluate(node => node.closest('.zw-workbench-native') !== null), 'native sidebar footer remains inside Ask');
    const bounds = await overlay.evaluate(node => ({ overlay: node.getBoundingClientRect().toJSON(), ask: node.closest('.zw-workbench-native').getBoundingClientRect().toJSON() }));
    assert.ok(bounds.overlay.left >= bounds.ask.left && bounds.overlay.right <= bounds.ask.right + 1, 'fixed native overlay is confined to Ask, not the outer rail');
    await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '今天', exact: true }).click();
    assert.equal(await overlay.isVisible(), false);
    assert.equal(await footer.isVisible(), false);
    await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '问一问', exact: true }).click();
    await native.locator('[data-test-native-panel]').waitFor();
    checks.push('External loader plugin opens a native main panel from 导入会话 without changing outer navigation; ordinary overlay and footer stay inside Ask');
    await writeFile(patch, '[]\n');
    await page.waitForTimeout(800);
    await reloadProduct(page);
    assert.equal(await page.locator('[data-test-native-panel], [data-test-native-overlay], [data-test-native-footer]').count(), 0, 'uninstalled native plugin leaves no content');
    assert.equal(await page.locator('[data-test-course-provider]').count(), 0, 'an uninstalled plugin must leave no rendered content');
    checks.push('Independent plugin shadows a product page and drives navigation through the product service');

    // Disabling the product bundle is a removal: the host sidebar and the
    // official theme come back, with no leftover styles or slot occupants.
    //
    // 「产品」= 本仓全部源包（壳 + 共享原语 + 领域核心 + 各页面包），要**一起**停：
    // 页面包在 dsh.client.external 里声明了原语包，只停一半会让模块表缺行（require 落空），
    // 而漏停任何一个包都会让它继续注册插槽/挂样式，下面两条断言就会在 60 秒后超时。
    //
    // 从客户端构建清单推导，包含独立的 root bridge，不手写遗漏新包。
    // 原生 ui-sidebar 本来就启用；停用产品不应再额外强制启用它。
    const productRows = [...productRowIds()].map(id => `- id: ${id}\n  disabled: true`);
    await writeFile(patch, productRows.join('\n') + '\n');
    await page.waitForTimeout(800);
    await reloadNativeEventually(page);
    await page.waitForFunction(() => !document.body.hasAttribute('data-zw'), undefined, { timeout: 60000 });
    assert.equal(await page.locator('style[data-zw-style]').count(), 0);
    assert.equal(await page.locator('.zw-sidebar').count(), 0);
    assert.equal(await page.locator('.zw-workbench-frame, style[data-zw-bridge]').count(), 0, 'unloading restores native root and removes bridge styles');
    await page.screenshot({ path: path.join(evidence, 'disabled-host-sidebar.png'), fullPage: true });
    await writeFile(patch, '[]\n');
    await page.waitForTimeout(800);
    await reloadProductEventually(page);
    assert.equal(await page.locator('style[data-zw-style]').count(), 1);
    checks.push('Disabling the product bundle retracts its styles and slots and restores the host sidebar');
  }
  assert.deepEqual(errors, [], 'No browser activation/render errors');
  if (runtime && !process.argv.includes('--bridge-only')) {
    // 这四个标记由**业务插件**打印。不在 profile 里的插件不会打印它们 ——
    // 所以按 profile 实际具备的能力决定断言，而不是无条件要求。
    // 无条件要求会把「这一层被主动裁掉了」误报成「宿主不兼容」。
    if (CAPS.hasClassroom) {
      assert.ok(hostLog.includes('ZW_CLASSROOM_HOST_READY'), 'Business plugin injected the real classroom service in this host');
      checks.push('Independent business plugin injects the classroom source from the product profile');
    }
    if (CAPS.hasParser) {
      assert.ok(hostLog.includes('ZW_PARSER_HOST_READY'), 'Business plugin injected the parser in this host');
      checks.push('Independent business plugin injects the parser backed by host LLM and attachments');
    }
    // 讲义装配（含习坎的全文润色）也必须在**真实宿主**里激活过：单测用的是假 ctx，
    // 而 `inject` 了一个不存在的服务只有在真宿主里才表现为永远 pending。
    if (CAPS.hasLecture) {
      assert.ok(hostLog.includes('ZW_LECTURE_HOST_READY'), 'Lecture assembler activated in this host');
      checks.push('Lecture assembler (incl. full-text polish) activates from the product profile');
    }
    if (CAPS.hasStore) {
      assert.ok(hostLog.includes('ZW_STORE_HOST_READY'), 'Quiz, notes and knowledge services activated from the product profile');
      checks.push('Quiz, notes and knowledge storage services activate from the product profile');
    }
    checks.push(`profile 能力：shell=${CAPS.hasShell} pages=${CAPS.pages.length}`);
  }
  const hostVersion = runtime?.version ?? lock.hostVersions.join(' / ');
  const report = JSON.stringify({ lane: process.argv.includes('--bridge-only') ? 'bridge-only' : 'full', checks, errors, hostVersion }, null, 2);
  await writeFile(path.join(evidence, 'host-report.json'), report);
  // 每个宿主版本各留一份：支持多个版本时，「哪一版过了」必须可查，不能被下次运行覆盖。
  await writeFile(path.join(evidence, `host-report-${hostVersion}.json`), report);
  await page.screenshot({ path: path.join(evidence, `today-${hostVersion}.png`), fullPage: true });
  console.log(checks.map(check => `PASS ${check}`).join('\n'));
} catch (error) {
  await writeFile(path.join(evidence, 'host-log.txt'), hostLog.replace(/token=[^\s]+/g, 'token=[redacted]'));
  await writeFile(path.join(evidence, 'host-errors.json'), JSON.stringify({ error: error.message, errors, checks }, null, 2));
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true });
      await writeFile(path.join(evidence, 'failure.txt'), await page.locator('body').innerText());
    }
  }
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 6000))]);
  }
}

