import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { initialize, lock, root, runHost } from './profile.mjs';
import { LEARNING_SPACE_TITLE } from '../packages/dsh-zhiyun-study-core/src/learning-space.js';

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

  await page.screenshot({ path: path.join(evidence, 'paper-drawer.png'), fullPage: true });
  await page.locator('.zp-drawer-toggle').click();
  assert.equal(await page.locator('.zp-drawer.is-open').count(), 0, 'the drawer collapses again');
  checks.push('Paper page: local PDF renders, the AI drawer answers, injected context stays folded');
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
  assert.equal(await page.getByRole('navigation', { name: '主要页面' }).getByRole('button').count(), 6);
  await page.screenshot({ path: path.join(evidence, 'today-light.png'), fullPage: true });
  for (const [label, id] of [['我的课', 'courses'], ['论文', 'paper'], ['学习', 'study'], ['个人', 'me']]) {
    await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: label, exact: true }).click();
    await page.locator(`.zy-page[data-page=${id}]`).waitFor();
  }
  checks.push('All product pages navigate through host layout');
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
  await page.getByRole('button', { name: '前往个人面板登录' }).waitFor();
  await page.getByRole('button', { name: '前往个人面板登录' }).click();
  await page.getByRole('region', { name: '智云课堂账号' }).waitFor();
  await page.getByLabel('浙大账号', { exact: true }).waitFor();
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
  await page.getByRole('button', { name: '个人', exact: true }).click();
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
    await page.locator('.zy-page-header').getByRole('button', { name: '切换明暗', exact: true }).click();
    await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  }
  await page.screenshot({ path: path.join(evidence, 'personal-light.png'), fullPage: true });
  await page.locator('.zy-page-header').getByRole('button', { name: '切换明暗', exact: true }).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(evidence, 'personal-dark.png'), fullPage: true });
  await page.locator('.zy-page-header').getByRole('button', { name: '切换明暗', exact: true }).click();
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
  await page.getByRole('button', { name: '收起导航', exact: true }).click();
  await page.locator('.zy-collapsed').waitFor();
  await page.screenshot({ path: path.join(evidence, 'navigation-collapsed.png'), fullPage: true });
  await page.getByRole('button', { name: '展开导航', exact: true }).click();
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
    await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的课', exact: true }).click();
    await page.locator('[data-test-course-provider]').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '返回今天', exact: true }).click();
    await page.locator('.zy-page[data-page=today]').waitFor();
    await writeFile(patch, '[]\n');
    await page.waitForTimeout(800);
    await reloadProduct(page);
    assert.equal(await page.locator('[data-test-course-provider]').count(), 0, 'an uninstalled plugin must leave no rendered content');
    checks.push('Independent plugin contributes course content and drives navigation through the product service');

    // Disabling the product bundle is a removal: the host sidebar and the
    // official theme come back, with no leftover styles or slot occupants.
    // 拆包后「产品」= 壳 + 共享原语 + 领域核心 + 四个页面包，要一起停 —— 页面包在
    // dsh.client.external 里声明了原语包，只停一半会让模块表缺行（require 落空）。
    await writeFile(patch, '- id: zhiyun-shell\n  disabled: true\n- id: zhiyun-ui-primitives\n  disabled: true\n- id: zhiyun-study-core\n  disabled: true\n- id: zhiyun-page-today\n  disabled: true\n- id: zhiyun-page-courses\n  disabled: true\n- id: zhiyun-page-study\n  disabled: true\n- id: zhiyun-page-me\n  disabled: true\n- id: zhiyun-page-paper\n  disabled: true\n- id: zhiyun-paper\n  disabled: true\n- id: ui-sidebar\n  disabled: false\n');
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
