/**
 * 视觉抽查：对着正在运行的实例抓几张关键状态的图，用来判断版面/字体问题。
 *
 * 用法：node scripts/shots.mjs "http://127.0.0.1:3082/?token=..."
 * 输出到 artifacts/shots/。
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { root } from './profile.mjs';

const url = process.argv[2];
if (!url) throw new Error('用法：node scripts/shots.mjs "<带 token 的地址>"');
const out = path.join(root, 'artifacts', 'shots');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.ZW_BROWSER_CHANNEL ?? 'msedge', headless: true });
const consoleErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, locale: 'zh-CN' });
  page.on('console', message => { if (message.type() === 'error' || message.text().startsWith('[zhiyun')) consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.zw-page[data-page=today]').waitFor({ timeout: 60000 });
  for (const label of ['继续', '稍后配置']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.isVisible().catch(() => false)) await button.click();
  }
  await page.screenshot({ path: path.join(out, 'today.png'), fullPage: true });
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '问一问', exact: true }).click();
  // 问一问 = 完整原生 DSH 工作区（原生侧栏、工作区浏览器、设置都在里面）。
  await page.locator('.zw-workbench-native [class*="_sidebarCol"]').waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(out, 'ask.png'), fullPage: true });
  console.log('布局：' + await page.evaluate(() => {
    const native = document.querySelector('.zw-workbench-native');
    const sidebar = native?.querySelector('[class*="_sidebarCol"]');
    return `外层页=${document.querySelector('.zw-workbench-frame')?.getAttribute('data-workbench-page')} ｜ 原生侧栏=${sidebar ? Math.round(sidebar.getBoundingClientRect().width) + 'px' : '缺失'} ｜ 导航栏右缘=${Math.round(document.querySelector('.zw-workbench-navigation').getBoundingClientRect().right)}`;
  }));
  // 外层导航切换时原生工作区隐藏但不卸载（返回后状态还在）。
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '今天', exact: true }).click();
  await page.locator('.zw-page[data-page=today]').waitFor();
  await page.screenshot({ path: path.join(out, 'today-after-ask.png'), fullPage: true });
  console.log('原生工作区在离开问一问后：' + await page.evaluate(() => {
    const node = document.querySelector('.zw-workbench-native');
    return node === null ? '已卸载' : (node.hasAttribute('hidden') ? '已隐藏（保留挂载）' : '仍可见');
  }));
  for (const [label, pageId] of [['学习', 'study']]) {
    await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: label, exact: true }).click();
    await page.locator(`.zw-page[data-page=${pageId}]`).waitFor();
  }
  // 「个人」页已删除：头像 → 账号面板 → 设置，拍的是宿主原生设置浮窗。
  await page.getByRole('button', { name: '账号', exact: true }).click();
  await page.locator('.zw-account-menu .zw-rail-menu-open', { hasText: '设置' }).click();
  const settingsModal = page.locator('[role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]');
  await settingsModal.waitFor();
  await page.screenshot({ path: path.join(out, 'settings.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await settingsModal.waitFor({ state: 'detached' });
  // 题库页从未进过视觉验收：脚本原本只拍 today/ask/settings，而这一页恰好是被反馈
  // 「丑且不友好」的地方，没有图也没有读数，问题只能等用户来报。这里补三档
  // 宽度（1440/1100/900）的整页图，并在 1440 那档把「出题设置一屏读完」的几何
  // 读成一行一字段的读数，回归时直接比数字，不靠肉眼。
  const quizEntry = page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '题库', exact: true });
  const quizReady = await (async () => {
    if (!(await quizEntry.isVisible().catch(() => false))) return false;
    try {
      await quizEntry.click();
      await page.locator('.zw-page[data-page=quiz]').waitFor({ timeout: 30000 });
      return true;
    } catch (error) {
      console.log('题库页没打开，跳过 quiz 截图：' + error.message);
      return false;
    }
  })();
  if (quizReady) {
    for (const [width, file] of [[1440, 'quiz-1440'], [1100, 'quiz-1100'], [900, 'quiz-900']]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, file + '.png'), fullPage: true });
      if (width !== 1440) continue;
      const quiz = await page.evaluate(() => {
        const pageBox = document.querySelector('.zws-qz-page');
        const setupBox = document.querySelector('.zws-qz-setup')?.getBoundingClientRect();
        const footBox = document.querySelector('.zws-qz-setup-foot')?.getBoundingClientRect();
        return {
          pageScrollHeight: pageBox ? Math.round(pageBox.scrollHeight) : -1,
          pageClientHeight: pageBox ? Math.round(pageBox.clientHeight) : -1,
          setupHeight: setupBox ? Math.round(setupBox.height) : -1,
          setupFootBottom: footBox ? Math.round(footBox.bottom) : -1,
          docScrollHeight: Math.round(document.documentElement.scrollHeight),
          winInnerHeight: Math.round(window.innerHeight),
          pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
        };
      });
      quiz.genEmptyShown = await page.locator('.zws-qz-gen-empty').isVisible().catch(() => false);
      console.log('题库读数(page-scrollHeight)=' + quiz.pageScrollHeight);
      console.log('题库读数(page-clientHeight)=' + quiz.pageClientHeight);
      console.log('题库读数(setup-height)=' + quiz.setupHeight);
      console.log('题库读数(setup-foot-bottom)=' + quiz.setupFootBottom);
      console.log('题库读数(doc-scrollHeight)=' + quiz.docScrollHeight);
      console.log('题库读数(win-innerHeight)=' + quiz.winInnerHeight);
      console.log('题库读数(页面纵向滚动)=' + (quiz.pageScrolls ? '有' : '无'));
      console.log('题库读数(空态卡渲染)=' + (quiz.genEmptyShown ? '有' : '无'));
    }
  }
  await page.setViewportSize({ width: 760, height: 900 });
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '问一问', exact: true }).click();
  await page.locator('.zw-workbench-native [class*="_sidebarCol"]').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'ask-narrow.png'), fullPage: true });
  console.log(`截图已写入 ${out}`);
  if (consoleErrors.length) console.log(`浏览器报错 ${consoleErrors.length} 条：\n  ${consoleErrors.slice(0, 6).join('\n  ')}`);
} finally {
  await browser.close();
}

