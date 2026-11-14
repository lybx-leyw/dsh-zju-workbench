/**
 * 窄屏工效学取证：对着一台正在运行的实例，量一遍窄屏与宽屏的视觉一致性。
 *
 * 用法：node scripts/narrow-audit.mjs "<带 token 的地址>" [before|after] [--out <目录>]
 *
 * 输出：`artifacts/narrow-ergonomics/<tag>/` 下的截图与 `measurements.json`。
 * 读数口径见 `docs/narrow-css-overrides.md`；那一页的每张表都直接对应
 * measurements.json 里的一个字段。
 *
 * # 为什么要单独一个脚本
 *
 * `scripts/shots.mjs` 只抓「今天 / 问一问 / 设置」三张图，不看窄屏。窄屏的两类
 * 问题它都看不见：
 *
 *   1. **几何**：主内容被压成 0 宽、两栏并排挤爆屏、浮层把正文盖死 —— 这类
 *      只有量 rect 才可靠，肉眼看图容易漏掉「差 20px」这种；
 *   2. **命中区**：桌面上 26px 的图标格，手指点不准。可见图形完全不变得靠
 *      `elementFromPoint` 逐像素外扩才量得出来。
 *
 * # 场景是固定的，不靠调用方挑
 *
 * 六个视口 × 固定页面顺序。加视口就改 `VIEWPORTS`，别在调用处传 —— 那样两次
 * 取证会跑在不同场景上，"改前 / 改后"就不可比了。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { root } from './profile.mjs';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  throw new Error('用法：node scripts/narrow-audit.mjs "<带 token 的地址>" [before|after] [--out <目录>]');
}
const tag = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'current';
const outFlag = process.argv.indexOf('--out');
const out = outFlag > 0
  ? path.resolve(process.argv[outFlag + 1])
  : path.join(root, 'artifacts', 'narrow-ergonomics', tag);
await mkdir(out, { recursive: true });

/**
 * 固定的取证场景。每项：`[文件名前缀, 视口, Playwright 上下文选项]`。
 *
 * 横屏（844×390）单列一项：它不是「更宽的竖屏」，而是 iOS 锁竖屏之外唯一会遇到的
 * 窄高场景 —— 导轨在 390 高下装不下十项，正是靠这一档才量得出来。
 */
const VIEWPORTS = [
  ['390', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }],
  ['390-dark', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, colorScheme: 'dark' }],
  ['844x390', { width: 844, height: 390 }, { isMobile: true, hasTouch: true }],
  ['360', { width: 360, height: 640 }, { isMobile: true, hasTouch: true }],
  ['1440', { width: 1440, height: 900 }, {}],
];

/** 首启引导 / 弹层遮罩：按用户的做法逐条处理掉，再确认产品面真的出现了。 */
async function ready(page) {
  await page.waitForTimeout(3000);
  for (let i = 0; i < 60; i += 1) {
    const close = page.getByRole('button', { name: '关闭', exact: true });
    if (await close.count() && await close.first().isVisible().catch(() => false)) {
      await close.first().click({ timeout: 2000 }).catch(() => {});
    }
    for (const name of ['继续', '稍后配置']) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.count() && await button.first().isVisible().catch(() => false)) {
        await button.first().click({ timeout: 2000 }).catch(() => {});
      }
    }
    const rail = await page.locator('[data-dsh-pages-rail]').count();
    const mask = await page.locator('[class*="_mask_"]').first().isVisible().catch(() => false);
    if (rail > 0 && !mask) { await page.waitForTimeout(800); return; }
    await page.waitForTimeout(500);
  }
}

async function clearMask(page) {
  for (let i = 0; i < 12; i += 1) {
    if (!await page.locator('[class*="_mask_"]').first().isVisible().catch(() => false)) return;
    await page.keyboard.press('Escape').catch(() => {});
    const close = page.getByRole('button', { name: '关闭', exact: true });
    if (await close.count() && await close.first().isVisible().catch(() => false)) {
      await close.first().click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(400);
  }
}

/** 用 JS 直接点导轨按钮（绕开首启遮罩偶发的 pointer 拦截；React 的 onClick 照样触发）。 */
async function clickLabel(page, label) {
  return page.evaluate(text => {
    const nav = document.querySelector('[data-dsh-pages-rail]');
    const button = [...(nav?.querySelectorAll('button') ?? [])]
      .find(item => item.getAttribute('aria-label') === text);
    if (!button) return false;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, label);
}

/**
 * 命中区探针：从按钮中心向四个方向逐像素外扩。
 *
 * 为什么不用 `getBoundingClientRect`：命中区常常是透明 `::after` 撑开的，rect
 * 只给可见图形。而 WCAG 2.5.8 判的是**可点范围** —— 唯一可靠的量法是问
 * `elementFromPoint`「这个像素点算谁的」。
 */
function hitProbe(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cx = Math.round(r.x + r.width / 2);
  const cy = Math.round(r.y + r.height / 2);
  const owns = (x, y) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit)); };
  /**
   * 中心点都不属于它 —— 说明这一格被别的东西盖住了（首启引导的遮罩、还没关掉的弹层），
   * 或者根本不在视口里。这时量出来只会是 1×1，**那是噪声不是读数**：
   * 照着它写「命中区退化到 1px」会是一个凭空捏造的结论。所以返回 null。
   */
  if (!owns(cx, cy)) return { glyph: [Math.round(r.width), Math.round(r.height)], hit: null, covered: true };
  const grow = (dx, dy) => {
    let n = 0;
    while (n < 40) {
      const x = cx + dx * (n + 1);
      const y = cy + dy * (n + 1);
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) break;
      if (!owns(x, y)) break;
      n += 1;
    }
    return n;
  };
  return {
    glyph: [Math.round(r.width), Math.round(r.height)],
    hit: [grow(-1, 0) + grow(1, 0) + 1, grow(0, -1) + grow(0, 1) + 1],
  };
}

/** 量一整页：几何、可见性、交互目标尺寸。 */
function measurePage(label) {
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const b = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  };
  const cs = (el, props) => (el ? Object.fromEntries(props.map((p) => [p, getComputedStyle(el)[p]])) : null);
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0.01 && r.right > 0 && r.x < innerWidth;
  };
  const pageEl = q('.zw-page');
  const rail = q('[data-dsh-pages-rail]');
  const whale = q('[data-zju-rail-collapse]');
  const settingsArea = q('.hHd-Xa_settingsArea');
  const docsNav = q('.zwd-nav');

  // 交互目标：导轨 / 页面内按钮 / 目录 / 分区 tab
  const targets = [];
  for (const el of all('[data-dsh-pages-rail] button, .zw-page button, .zwd-nav button, .zwd-sections button')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    targets.push({
      label: (el.getAttribute('aria-label') || el.title || el.innerText || '').trim().slice(0, 16),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }

  return {
    label,
    viewport: { w: innerWidth, h: innerHeight },
    pageId: pageEl?.getAttribute('data-page') ?? null,
    rail: b(rail),
    railScroll: rail ? { scrollH: rail.scrollHeight, clientH: rail.clientHeight } : null,
    whale: whale ? { box: b(whale), label: whale.getAttribute('aria-label') } : null,
    settings: {
      area: b(settingsArea),
      visible: visible(settingsArea),
      insideViewport: settingsArea ? b(settingsArea).x >= 0 && b(settingsArea).right <= innerWidth : null,
    },
    docs: docsNav ? {
      present: true,
      visible: visible(docsNav),
      box: b(docsNav),
      position: cs(docsNav, ['position']).position,
      whaleLabel: whale?.getAttribute('aria-label') ?? null,
    } : { present: false, whaleLabel: whale?.getAttribute('aria-label') ?? null },
    targets: { count: targets.length, small: targets.filter((t) => t.w < 36 || t.h < 36) },
    overflowX: document.documentElement.scrollWidth - innerWidth,
  };
}

const results = {};

async function measure(page, label, extra = {}) {
  const data = await page.evaluate(measurePage, label);
  results[label] = { ...data, ...extra };
  return data;
}

async function capture(name, viewport, contextOptions) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport, locale: 'zh-CN', ...contextOptions });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await clearMask(page);

  await page.screenshot({ path: path.join(out, `${name}-home.png`) });
  // 导轨命中区：先确认没有遮罩压在导轨上，否则探针会把「被盖住」当成「很小」。
  await clearMask(page);
  await page.waitForTimeout(300);
  await measure(page, `${name}-home`, {
    hit: { whale: await page.evaluate(hitProbe, '[data-zju-rail-collapse]'), railItem: await page.evaluate(hitProbe, '[data-dsh-pages-rail] button[aria-label="DSH 工作台"]') },
  });

  // 侧栏抽屉：原生「打开侧边栏」。
  const toggled = await page.evaluate(() => {
    const button = document.querySelector('[data-sidebar-toggle]') || document.querySelector('[data-sidebar-opener]');
    if (!button) return false;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(out, `${name}-drawer-open.png`) });
  await measure(page, `${name}-drawer-open`, { toggled });
  await page.evaluate(() => {
    const button = document.querySelector('[data-sidebar-toggle]') || document.querySelector('[data-sidebar-opener]');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(1200);

  // 文档页：目录开关是「按钮与可见性是否自洽」的判据。
  if (await clickLabel(page, '文档')) {
    await page.waitForFunction(() => document.querySelector('.zw-page')?.getAttribute('data-page') === 'docs', undefined, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await clearMask(page);
    await page.screenshot({ path: path.join(out, `${name}-docs.png`) });
    await measure(page, `${name}-docs`);
    await page.evaluate(() => document.querySelector('[data-zju-rail-collapse]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `${name}-docs-whale.png`) });
    await measure(page, `${name}-docs-whale`);
  }

  // 笔记 / 论文：两页的手机排布与工具栏命中区。
  for (const [label, id] of [['笔记', 'notes'], ['论文', 'paper']]) {
    if (!await clickLabel(page, label)) continue;
    await page.waitForFunction(pid => document.querySelector('.zw-page')?.getAttribute('data-page') === pid, id, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1400);
    await clearMask(page);
    // 两页的面板是数据驱动的，可能比页面本体晚到一拍。量命中区之前先等它出现，
    // 否则 selector 命中不到、读数是 null —— 那会被误读成「没有这个按钮」。
    await page.locator(id === 'notes' ? '.zws-nt-topbar button' : '.zwp-tree-head button').first()
      .waitFor({ timeout: 8000 }).catch(() => {});
    await page.screenshot({ path: path.join(out, `${name}-${id}.png`) });
    await measure(page, `${name}-${id}`, {
      hit: {
        topbar: await page.evaluate(hitProbe, id === 'notes' ? '.zws-nt-topbar button' : '.zwp-tree-head button'),
        paneHead: await page.evaluate(hitProbe, id === 'notes' ? '.zws-nt-explorer-head button' : '.zwp-tree-head button'),
      },
    });
  }

  await browser.close();
}

for (const [name, viewport, options] of VIEWPORTS) {
  await capture(name, viewport, options);
}

await writeFile(path.join(out, 'measurements.json'), JSON.stringify(results, null, 1));
console.log(`[narrow-audit] ${Object.keys(results).length} 个场景 → ${path.relative(root, out)}/measurements.json`);
