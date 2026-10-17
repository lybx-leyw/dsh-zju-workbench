import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { initialize, lock, root, runHost } from './profile.mjs';
import { CLIENT_PACKAGES } from './build.mjs';
import { LEARNING_SPACE_TITLE } from '../packages/dsh-zhiyun-study-core/src/learning-space.js';
import { NAV, RAIL_DEFAULT } from '../packages/dsh-zhiyun-shell/src/model.js';

const evidence = path.join(root, 'artifacts');

/** The host runs its own first-run steps — the developer-preview notice and the
 *  "add an API key" model step. They belong to host onboarding, not to this
 *  product, so acknowledge them the way a user would (继续 / 稍后配置) and then
 *  require a genuinely quiet page before touching it. Only a *visible* mask
 *  counts: the modal layer stays attached when nothing is open. */
async function settleHostOverlays(page) {
  const steps = [
    page.getByRole('button', { name: '继续', exact: true }),
    page.getByRole('button', { name: '稍后配置', exact: true }),
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

/** Load the document again and wait for the product page to mount. A row added
 *  to the profile joins the browser boot graph on the next document load: the
 *  host injects window.__DSH_BOOT__ per index.html request. */
async function reloadProduct(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settleHostOverlays(page);
  await page.locator('.zy-page[data-page=today]').waitFor({ timeout: 60000 });
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
  const bundles = [...CLIENT_PACKAGES, 'dsh-zhiyun-paper'];
  return [...new Set(bundles.map(bundle => bundle.replace(/^dsh-/, '')))].sort();
}

/** 往 profile 的文献库里放一篇真论文，供下面的抽屉端到端断言使用。 */
async function writeProbePaper(runtime) {
  const dir = path.join(runtime.profile, 'data', 'zhiyun-paper', 'host-probe');
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
  await page.locator('.zy-page[data-page=paper]').waitFor();
  await page.locator('.zp-library-trigger').click();
  await page.locator('.zp-library-pop').waitFor();
  await page.locator('.zp-library-topic button', { hasText: 'probe-paper' }).first().click();

  // 左侧必须真的是 PDF（canvas 由 pdf.js 画出来，文本层可选中）。
  const reader = page.frameLocator('.zp-frame');
  await reader.locator('.page canvas').first().waitFor({ timeout: 30000 });
  // 文本层比 canvas 晚一步（pdf.js 先画布后铺 span），所以要等它出现再数，
  // 否则这条断言会随机失败。
  await reader.locator('.textLayer span').first().waitFor({ timeout: 30000 });
  assert.ok(await reader.locator('.textLayer span').count() >= 3, 'the PDF text layer is selectable');

  // 抽屉默认收起，展开后必须占住正文右缘（不是浮在中间，也不是把正文压没）。
  assert.equal(await page.locator('.zp-drawer.is-open').count(), 0);
  await page.locator('.zp-bar-actions').getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.locator('.zp-drawer.is-open').waitFor();
  // 抽屉在正文**右边**：它的左缘要贴上正文的右缘（探针实测 drawer.left=1048 =
  // main.right，drawer 一直延伸到视口右缘）。
  const box = await page.evaluate(() => {
    const drawer = document.querySelector('.zp-drawer');
    const main = document.querySelector('.zp-main');
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
  await page.locator('.zp-drawer-compose textarea').fill('这篇论文的核心贡献是什么？');
  await page.locator('.zp-drawer-compose').getByRole('button', { name: '发送', exact: true }).click();
  const answer = await asked;
  assert.equal(answer.status(), 200, `POST /paper-reader/api/ask → ${answer.status()}`);

  await page.locator('.zp-bubble').first().waitFor({ timeout: 60000 });
  const bubbles = await page.locator('.zp-bubble-text').allInnerTexts();
  const leaked = bubbles.filter(text => /<system-reminder>|Current runtime context|A skill is a reusable/.test(text));
  assert.deepEqual(leaked, [], 'workbench context must never be rendered as chat bubbles');
  assert.match(bubbles.join('\n'), /核心贡献/, 'the question itself is shown');
  // 折叠了几条要如实说，否则用户会以为助手一句话没说。
  assert.equal(await page.locator('.zp-drawer-folded').count(), 1, 'folded context is reported to the user');
  // 用户气泡是纯文本：划选来的原文常带 `*`、反引号、`#`，按 Markdown 渲染会把原样文字画走样。
  // （助手气泡反过来必须走渲染器，这里没模型凭证拿不到助手回答，那条由 tests/paper.test.mjs 守。）
  assert.equal(
    await page.locator('.zp-bubble.is-user [data-markdown-variant]').count(),
    0,
    'the user bubble must stay plain text',
  );

  // `/resume` 是命令不是提问：它必须被输入框拦下，而不是发给论文助手。
  const labeled = page.waitForResponse(response => response.url().includes('/zhiyun-paper/api/sessions/labels'), { timeout: 60000 });
  await page.locator('.zp-drawer-compose textarea').fill('/resume');
  await page.locator('.zp-drawer-compose textarea').press('Enter');
  await page.locator('.zp-resume').waitFor({ timeout: 15000 });
  assert.equal((await labeled).status(), 200, 'the session labels endpoint answers for this paper');
  // 标签里的「首句」必须是**用户自己问的那句**：上游把文献路径、选区、`用户的问题：`
  // 前缀都拼进了同一条消息，直接显示原文会把每行都撑满且看不出区别。
  await page.locator('.zp-resume-row .zp-resume-first', { hasText: '这篇论文的核心贡献是什么？' })
    .first().waitFor({ timeout: 15000 });
  assert.equal(await page.locator('.zp-drawer-compose textarea').inputValue(), '', 'the command is consumed, not left in the box');
  assert.equal(await page.locator('.zp-bubble.is-user', { hasText: '/resume' }).count(), 0, '/resume must never reach the model');
  const palette = await page.evaluate(() => {
    const box = document.querySelector('.zp-resume');
    const list = document.querySelector('.zp-resume-list');
    const rect = box.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.zp-resume-row')];
    return {
      focused: box.contains(document.activeElement),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      scrollable: getComputedStyle(list).overflowY,
      codes: rows.map(row => row.querySelector('.zp-resume-code')?.textContent ?? ''),
      firsts: rows.map(row => row.querySelector('.zp-resume-first')?.textContent ?? ''),
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
  const activeAt = () => page.evaluate(() => [...document.querySelectorAll('.zp-resume-row')].findIndex(row => row.classList.contains('is-active')));
  const wasAt = await activeAt();
  await page.locator('.zp-resume').press('ArrowUp');
  const upAt = await activeAt();
  if (palette.codes.length > 1) {
    assert.notEqual(upAt, wasAt, 'ArrowUp moves the selection');
  } else {
    assert.equal(upAt, 0, 'a single-row list keeps its only row selected');
  }
  await page.locator('.zp-resume').press('ArrowDown');
  assert.equal(await activeAt(), wasAt, 'ArrowDown moves it back');

  await page.screenshot({ path: path.join(evidence, 'paper-resume.png'), fullPage: true });
  await page.locator('.zp-resume').press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.zp-resume').length === 0, null, { timeout: 5000 });

  await page.screenshot({ path: path.join(evidence, 'paper-drawer.png'), fullPage: true });
  await page.locator('.zp-drawer-toggle').click();
  assert.equal(await page.locator('.zp-drawer.is-open').count(), 0, 'the drawer collapses again');
  checks.push('Paper page: local PDF renders, the AI drawer answers, injected context stays folded');
  checks.push('Paper page: /resume opens a fixed-size scrollable session palette with ↑↓ navigation');
}
await mkdir(evidence, { recursive: true });
let server;
let browser;
let hostLog = '';
let runtime;
const errors = [];
const checks = [];
try {
  let url = process.env.ZHIYUN_TEST_URL;
  if (!url && process.argv.includes('--running')) {
    url = (await readFile(path.join(root, 'host.log'), 'utf8')).match(/dsh web: (http:\/\/\S+)/)?.[1];
  }
  if (!url) {
    runtime = await initialize({ home: path.join(evidence, `host-${Date.now()}`) });
    await symlink(path.join(root, 'tests/fixtures/course-panel'), path.join(runtime.profile, 'node_modules', 'zhiyun-test-course-panel'), process.platform === 'win32' ? 'junction' : 'dir');
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
  browser = await chromium.launch({ channel: process.env.ZHIYUN_BROWSER_CHANNEL ?? 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, locale: 'zh-CN', colorScheme: 'light' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.zy-page[data-page=today]').waitFor({ timeout: 60000 });
  await settleHostOverlays(page);
  if (await page.locator('body').evaluate(body => body.hasAttribute('data-ds-dark-theme'))) {
    await page.getByRole('button', { name: '切换明暗', exact: true }).click();
    await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  }
  checks.push('Real host boot and initial Today selection');
  // 导轨上的页面数**从 RAIL_DEFAULT 推导**，不写死数字。
  // ⚠️ 导轨不再等于「NAV 里所有上侧栏的页」：默认固定在导轨上的是 RAIL_DEFAULT
  //    （学习动线 + 个人），「插件」「反馈」默认收在末尾的「···」菜单里，
  //    由用户点图钉固定。数字是结论，依据在 RAIL_DEFAULT 里。
  assert.equal(await page.getByRole('navigation', { name: '主要页面' }).getByRole('button').count(), RAIL_DEFAULT.length + 1);
  await page.screenshot({ path: path.join(evidence, 'today-light.png'), fullPage: true });
  for (const [label, id] of [['论文', 'paper'], ['学习', 'study']]) {
    await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: label, exact: true }).click();
    await page.locator(`.zy-page[data-page=${id}]`).waitFor();
  }
  // 「个人」**不在导航里**：它是导轨最下方那一格圆形头像。点头像浮出**账号面板**，
  // 「设置」才进个人页 —— 登录也在同一层（见下面那段）。这里顺便把这条路径走全。
  await page.getByRole('button', { name: '账号', exact: true }).click();
  await page.locator('.zy-account-menu').waitFor();
  await page.locator('.zy-account-menu .zy-rail-menu-open', { hasText: '设置' }).click();
  await page.locator('.zy-page[data-page=me]').waitFor();
  checks.push('All product pages navigate through host layout');
  // 「插件」也不在导轨上：它属于「···」菜单（默认不固定，要用了再钉）。
  // 所以这里走菜单，而不是直接找导航按钮。
  await page.locator('.zy-rail-more').click();
  await page.locator('.zy-rail-menu-open', { hasText: '插件' }).click();
  await page.locator('.zy-page[data-page=plugins]').waitFor();
  await page.locator('.zpl-row').first().waitFor({ timeout: 60000 });
  const pluginRows = await page.locator('.zpl-row').evaluateAll(list => list.map(row => ({
    name: row.querySelector('.zpl-row-head strong')?.textContent,
    inner: row.querySelector('.zpl-badge-inner') !== null,
  })));
  const parserRow = pluginRows.find(row => row.name === 'parser');
  assert.ok(parserRow?.inner === true, '解析包必须显示为「被 N 个包依赖」，而不是叶');
  assert.deepEqual(await page.locator('.zpl-badge-wait').allInnerTexts(), [], '健康组合里不该有「等待依赖」');
  checks.push('The plugins page derives the dependency graph from the runtime, including host-plane hard edges');
  await page.screenshot({ path: path.join(evidence, 'plugins.png'), fullPage: true });
  // 「论文」页在真实宿主里必须真的渲染出来：导航能点开只证明外壳注册了插槽，
  // 不证明页面包激活了。这里等它自己的 DOM 出现，并确认空文献库走的是空态。
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '论文', exact: true }).click();
  await page.locator('.zy-page[data-page=paper]').waitFor();
  await page.locator('.zp-landing').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.zy-content .zy-empty').count(), 1, 'an empty library shows the landing empty state');
  assert.equal(await page.locator('.zp-frame').count(), 0, 'no reader frame is mounted before a paper is picked');
  await page.screenshot({ path: path.join(evidence, 'paper.png'), fullPage: true });
  checks.push('The paper page activates and renders its own empty state');
  // 上游宿主插件（锁版依赖）必须挂上了它的前缀路由；页面包自有的 /zhiyun-paper 也必须活着。
  const paperStatus = await page.evaluate(async () => {
    const [own, upstream] = await Promise.all([
      fetch('/zhiyun-paper/api/status').then(r => r.status).catch(() => 0),
      fetch('/paper-reader/api/library').then(r => r.status).catch(() => 0),
    ]);
    return { own, upstream };
  });
  assert.equal(paperStatus.own, 200, 'the compat layer serves /zhiyun-paper/api/status');
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
  await page.locator('.zy-page[data-page=today]').waitFor();
  checks.push('Search dialog and keyboard navigation');
  await page.getByRole('button', { name: '切换明暗', exact: true }).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'));
  await page.screenshot({ path: path.join(evidence, 'today-dark.png'), fullPage: true });
  await page.getByRole('button', { name: '切换明暗', exact: true }).click();
  await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  checks.push('Native theme service switches light/dark');
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '问一问', exact: true }).click();
  await page.locator('.zy-hero-brand').waitFor();
  checks.push('Native DSH conversation remains mounted with Zhiyun hero');
  // 「问一问」is bound to the workbench's own learning space: the composer comes up
  // ready instead of asking which directory to use, and that space is the one shown.
  await page.waitForFunction(() => !document.body.innerText.includes('选择一个工作区开始'), undefined, { timeout: 30000 });
  assert.ok((await page.locator('body').innerText()).includes(LEARNING_SPACE_TITLE), 'the fixed learning space is selected');
  await page.screenshot({ path: path.join(evidence, 'ask.png'), fullPage: true });
  checks.push('Ask binds the fixed learning space instead of asking to choose a workspace');
  // 会话管理在「问一问」的版面上：侧栏不再挂宿主的工作区浏览器（没有工作区切换）。
  assert.equal(await page.locator('[data-slot="sidebar.workspaces"]').count(), 0, 'the host workspace browser must not be mounted');
  const sidebarText = await page.locator('.zy-sidebar').innerText();
  assert.equal(sidebarText.includes('工作区'), false, 'the sidebar must not offer workspace switching');
  assert.equal(sidebarText.includes('会话记录'), false, 'the sidebar must not host the session list');
  await page.locator('.zy-topbar').waitFor();
  // 会话抽屉 = 对齐 app 的**左侧整高抽屉**：贴问一问面板左缘、整高、有遮罩、Esc/遮罩可关。
  const sidebarRight = await page.locator('.zy-sidebar').evaluate(node => Math.round(node.getBoundingClientRect().right));
  const viewport = page.viewportSize();
  await page.locator('.zy-topbar-menu').click();
  const drawer = page.locator('.zy-drawer');
  await drawer.waitFor();
  await page.waitForTimeout(400);
  const drawerBox = await drawer.boundingBox();
  assert.equal(await drawer.getAttribute('data-open'), 'true', 'the top-left hamburger opens the drawer');
  assert.ok(drawerBox.height >= viewport.height * 0.95, `the drawer must span the full height (${Math.round(drawerBox.height)} of ${viewport.height})`);
  assert.ok(Math.abs(drawerBox.x - sidebarRight) <= 2, `the drawer must start at the Ask panel's left edge (x=${Math.round(drawerBox.x)}, sidebar right=${sidebarRight})`);
  assert.ok(drawerBox.width >= 280, `the drawer must keep the Material width (${Math.round(drawerBox.width)}px)`);
  assert.equal(await page.locator('.zy-drawer-scrim[data-open=true]').count(), 1, 'an open drawer carries its scrim');
  // 当前会话必须**恰好**标记一行：0.2 把 `current` 从 session controller 移走了，
  // 早先这里读它，结果高亮永远不亮（也不再有「当前」这个概念可用）。
  assert.equal(await page.locator('.zy-drawer-row.is-current').count(), 1, 'exactly one row is the current session');
  assert.equal(await page.locator('.zy-drawer-head').count(), 1, 'the drawer carries its own header');
  await page.screenshot({ path: path.join(evidence, 'ask-sessions.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.zy-drawer-scrim[data-open=true]').count(), 0, 'Esc closes the drawer and its scrim');
  await page.locator('.zy-topbar-menu').click();
  await drawer.waitFor();
  await page.waitForTimeout(300);
  await page.locator('.zy-drawer-scrim').click({ position: { x: 500, y: 400 } });
  await drawer.waitFor({ state: 'hidden' });
  checks.push('Session management is a full-height left drawer attached to the Ask panel');
  await page.getByRole('button', { name: '账号', exact: true }).click();
  await page.locator('.zy-account-menu .zy-rail-menu-open', { hasText: '设置' }).click();
  const settings = page.locator('.zy-settings-group');
  await settings.first().waitFor();
  assert.ok(await settings.count() >= 2, 'host settings providers appear inside Personal');
  assert.equal(await page.locator('.zy-sidebar').getByRole('button', { name: '设置', exact: true }).isVisible(), false);
  // 「论文阅读」的设置集中在「个人 → 设置」里，靠注册 `settings.section`（id=paper-reader）
  // 长出分组。分组列表由宿主 `ctx.slots.entries('settings.section')` 决定，所以这里
  // 必须**点名**断言它存在 —— 上面那句 `>= 2` 只数宿主自己的分组，我们这条即使
  // 掉线也照样绿（这正是它一开始没被发现的原因）。
  const paperSettings = page.locator('[data-settings-section="paper-reader"]');
  assert.equal(await paperSettings.count(), 1, '论文阅读的设置分组必须出现在「个人」页');
  const paperIds = await settings.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-settings-section')));
  assert.ok(paperIds.includes('paper-reader'), `settings groups = ${JSON.stringify(paperIds)}`);
  // ⚠️ 用 `:scope > summary`：宿主某些设置分组内部还会渲染**嵌套**的 details，
  //    裸 `locator('summary')` 会同时命中子节点，触发 strict mode 冲突。
  await settings.first().locator(':scope > summary').click();
  assert.ok(await settings.first().locator(':scope > .zy-settings-body').isVisible());
  assert.equal(await page.locator('[role="dialog"]:visible').count(), 0, 'settings expand inline');
  // 「论文阅读」分组里必须真的渲染出兼容层的表单（两张端点卡 + 版本/就绪状态）。
  await paperSettings.locator(':scope > summary').click();
  await paperSettings.locator(':scope > .zy-settings-body').waitFor();
  assert.equal(await paperSettings.locator('.zp-settings').count(), 1, '兼容层设置表单必须渲染');
  assert.ok(await paperSettings.locator('.zp-card').count() >= 2, '两个上游端点各一张卡');
  assert.match(await paperSettings.locator(':scope > .zy-settings-body').innerText(), /锁定/, '要显示锁定的上游版本');
  await paperSettings.locator(':scope > summary').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(evidence, 'settings.png'), fullPage: true });
  for (const group of await settings.all()) {
    if (!await group.evaluate(node => node.open)) await group.locator(':scope > summary').click();
    assert.ok(await group.locator(':scope > .zy-settings-body').isVisible());
    assert.ok((await group.locator(':scope > .zy-settings-body').innerText()).trim().length > 0);
    await group.locator(':scope > summary').click();
  }
  await page.locator('.zy-scroll').evaluate(node => { node.scrollTop = 0; });
  if (await page.locator('body').evaluate(body => body.hasAttribute('data-ds-dark-theme'))) {
    await page.locator('.zy-sidebar-bottom').getByRole('button', { name: '切换明暗', exact: true }).click();
    await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  }
  await page.screenshot({ path: path.join(evidence, 'personal-light.png'), fullPage: true });
  await page.locator('.zy-sidebar-bottom').getByRole('button', { name: '切换明暗', exact: true }).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(evidence, 'personal-dark.png'), fullPage: true });
  await page.locator('.zy-sidebar-bottom').getByRole('button', { name: '切换明暗', exact: true }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.keyboard.press('Control+Alt+Comma');
  await page.locator('.zy-page[data-page=me]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-modal="true"]'));
  await page.setViewportSize({ width: 760, height: 900 });
  const models = page.locator('[data-settings-section="models"]');
  await models.locator(':scope > summary').click();
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('.zy-scroll').evaluate(node => node.scrollWidth > node.clientWidth), false, 'Personal forms fit a narrow column');
  await page.screenshot({ path: path.join(evidence, 'personal-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 980 });
  checks.push('Native settings providers expand inline inside Personal');
  // Every document load goes through the same onboarding handling: the host's
  // model step reappears per load whenever no model is configured.
  await reloadProduct(page);
  // ⚠️ 侧栏**不允许展开**（产品决定）：导轨只有图标，名字靠悬停浮出。
  //    所以这里不再有「收起/展开导航」按钮，改验「它一直是收起的、且悬停能读到名字」。
  await page.locator('.zy-sidebar.zy-collapsed').waitFor({ timeout: 10000 });
  const railWidth = await page.locator('.zy-sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width));
  assert.ok(railWidth <= 60, `导轨应保持收起的 56px，实测 ${railWidth}px`);
  await page.locator('.zy-rail-nav .zy-rail-item').first().hover();
  const tip = page.locator('.zy-rail-tip');
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
  if (runtime) {
    const patch = path.join(runtime.profile, 'cordis.patch.yml');
    // Installing a row is an install: the file watcher applies the new layer
    // first, then the next document load carries the new entry in its boot graph.
    await writeFile(patch, '- insert:\n    - id: test-course-panel\n      name: zhiyun-test-course-panel\n');
    await page.waitForTimeout(800);
    await reloadProduct(page);
    // 插件遮蔽的是「今天」页正文 —— 启动就落在今天，所以不用先点导航。
    // （原先遮蔽「我的课」；那个页面包并入「学习」之后已经没有 `zhiyun.courses.content`
    //  这个插槽了。用例要证的东西没变：外部插件能顶掉产品内容，并靠服务跳转。）
    await page.locator('[data-test-course-provider]').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '去学习', exact: true }).click();
    await page.locator('.zy-page[data-page=study]').waitFor();
    await writeFile(patch, '[]\n');
    await page.waitForTimeout(800);
    await reloadProduct(page);
    assert.equal(await page.locator('[data-test-course-provider]').count(), 0, 'an uninstalled plugin must leave no rendered content');
    checks.push('Independent plugin shadows a product page and drives navigation through the product service');

    // Disabling the product bundle is a removal: the host sidebar and the
    // official theme come back, with no leftover styles or slot occupants.
    //
    // 「产品」= 本仓全部源包（壳 + 共享原语 + 领域核心 + 各页面包），要**一起**停：
    // 页面包在 dsh.client.external 里声明了原语包，只停一半会让模块表缺行（require 落空），
    // 而漏停任何一个包都会让它继续注册插槽/挂样式，下面两条断言就会在 60 秒后超时。
    //
    // 这张清单从各包自己的 cordis.patch.yml 解析出来，**不手写**：手写的那份在加「插件」页时
    // 漏了一行，真机上就是超时失败。注意必须走 YAML 解析而不是正则抓第一个 `- id:` ——
    // 壳的 patch 先改上游 `ui-sidebar` 再用 `insert:` 插自己，正则抓不到 `zhiyun-shell`。
    const productRows = [...productRowIds()].map(id => `- id: ${id}\n  disabled: true`);
    await writeFile(patch, [...productRows, '- id: ui-sidebar\n  disabled: false\n'].join('\n') + '\n');
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settleHostOverlays(page);
    await page.waitForFunction(() => !document.body.hasAttribute('data-zhiyun'), undefined, { timeout: 60000 });
    assert.equal(await page.locator('style[data-zhiyun-style]').count(), 0);
    assert.equal(await page.locator('.zy-sidebar').count(), 0);
    await page.screenshot({ path: path.join(evidence, 'disabled-host-sidebar.png'), fullPage: true });
    await writeFile(patch, '[]\n');
    await page.waitForTimeout(800);
    await reloadProduct(page);
    assert.equal(await page.locator('style[data-zhiyun-style]').count(), 1);
    checks.push('Disabling the product bundle retracts its styles and slots and restores the host sidebar');
  }
  assert.deepEqual(errors, [], 'No browser activation/render errors');
  if (runtime) {
    assert.ok(hostLog.includes('ZHIYUN_CLASSROOM_HOST_READY'), 'Business plugin injected the real classroom service in this host');
    checks.push('Independent business plugin injects the classroom source from the product profile');
    assert.ok(hostLog.includes('ZHIYUN_PARSER_HOST_READY'), 'Business plugin injected the parser in this host');
    checks.push('Independent business plugin injects the parser backed by host LLM and attachments');
    // 讲义装配与无曰终审也必须在**真实宿主**里激活过：单测用的是假 ctx，
    // 而 `inject` 了一个不存在的服务只有在真宿主里才表现为永远 pending。
    assert.ok(hostLog.includes('ZHIYUN_LECTURE_HOST_READY'), 'Lecture assembler activated in this host');
    assert.ok(hostLog.includes('ZHIYUN_FINAL_PASS_HOST_READY'), 'Final-pass agent service activated on the host agent runtime');
    assert.ok(hostLog.includes('ZHIYUN_STORE_HOST_READY'), 'Quiz, notes and knowledge services activated from the product profile');
    checks.push('Lecture assembler and agent-runtime final pass activate from the product profile');
    checks.push('Quiz, notes and knowledge storage services activate from the product profile');
  }
  const hostVersion = runtime?.version ?? lock.hostVersions.join(' / ');
  const report = JSON.stringify({ checks, errors, hostVersion }, null, 2);
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
