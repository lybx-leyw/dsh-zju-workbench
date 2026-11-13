#!/usr/bin/env node
/**
 * 触摸工效学取证：量「手指在玻璃上操作」才会暴露的那几件事。
 *
 * 用法：node scripts/narrow-touch-audit.mjs "<带 token 的地址>"
 *
 * 为什么不能只读源码：这一轮查的东西**全都要看浏览器实际应用了什么** ——
 * 跨包覆盖、特异性胜负、被 `!important` 压掉、第三方插件的兜底规则，任何一条
 * 都可能让源码里写着的规则实际不生效。所以探针读运行时的 `document.styleSheets`
 * 与 `getComputedStyle`，不读文件。
 *
 * # 量哪几项，以及为什么是它们
 *
 * 对**自有规则**与**宿主规则**做一次属性普查，按触摸相关的属性逐个数。两边的
 * 差值就是缺口所在（详见 `docs/narrow-touch-ergonomics-round2.md`）：
 *
 *   `:active`                    触屏没有 hover，它是唯一反馈
 *   `-webkit-tap-highlight-color` 不关掉就闪一层不属于产品色板的系统蓝
 *   `overscroll-behavior`        内层滚到底会把余量传给外层
 *   `safe-area-inset-*`          viewport 写了 `viewport-fit=cover`，必须自己让开
 *   `env()` 机制                  headless 里恒为 0，要另注入固定值证明机制成立
 *   输入框字号                    < 16px 会让 iOS 聚焦时把整页放大且不恢复
 *
 * 场景固定（三个视口 × 固定页面顺序），两次运行才可比。
 */
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  throw new Error('用法：node scripts/narrow-touch-audit.mjs "<带 token 的地址>"');
}

/** 与 `scripts/narrow-audit.mjs` 同一套唤醒步骤：先把首启引导处理掉。 */
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
 * 属性普查：自有规则 vs 宿主规则。
 *
 * 「自有」按选择器是否带 `body[data-zw]` 前缀区分 —— 本仓每个页面包都挂这个
 * 前缀（主题变量就定义在它上面），宿主不会用。这是个近似判据，但它不需要
 * 维护一张包名清单，也不会因为新增包而失效。
 */
function census() {
  const own = [];
  const host = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = [...sheet.cssRules]; } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules && rule.cssRules.length) { walk([...rule.cssRules]); continue; }
        if (!rule.selectorText) continue;
        (rule.selectorText.includes('body[data-zw]') ? own : host).push({ sel: rule.selectorText, css: rule.style.cssText });
      }
    };
    walk(rules);
  }
  const count = (list, needle) => list.filter(rule => rule.css.includes(needle)).length;
  const summarize = (list) => ({
    total: list.length,
    active: list.filter(rule => rule.sel.includes(':active')).length,
    hover: list.filter(rule => rule.sel.includes(':hover')).length,
    tapHighlight: count(list, 'tap-highlight'),
    touchAction: count(list, 'touch-action'),
    overscroll: count(list, 'overscroll'),
    safeArea: count(list, 'safe-area'),
    textSizeAdjust: count(list, 'text-size-adjust'),
  });
  return { own: summarize(own), host: summarize(host) };
}

/** 页面级：导轨几何、点按反馈、滚动链、输入框字号。 */
function pageProbe() {
  const rail = document.querySelector('[data-dsh-pages-rail]');
  const buttons = rail ? [...rail.querySelectorAll('button')] : [];
  const last = buttons.length ? buttons[buttons.length - 1].getBoundingClientRect() : null;
  const railCs = rail ? getComputedStyle(rail) : null;
  const navButton = buttons[1] ?? null;
  const whale = document.querySelector('[data-zju-rail-collapse]');
  const scrollers = ['.zw-scroll', '.zwd-nav', '.zws-nt-explorer', '.zws-nt-main']
    .map((sel) => {
      const el = document.querySelector(sel);
      return el ? { sel, overscrollY: getComputedStyle(el).overscrollBehaviorY } : null;
    })
    .filter(Boolean);
  return {
    viewport: { w: innerWidth, h: innerHeight },
    rail: railCs ? {
      padTop: railCs.paddingTop,
      padBottom: railCs.paddingBottom,
      gap: railCs.gap,
      overflow: rail.scrollHeight - rail.clientHeight,
      lastLabel: buttons.length ? buttons[buttons.length - 1].getAttribute('aria-label') : null,
      lastBottom: last ? Math.round(last.bottom) : null,
      overscroll: railCs.overscrollBehaviorY,
    } : null,
    tapHighlight: {
      nav: navButton ? getComputedStyle(navButton).webkitTapHighlightColor : null,
      whale: whale ? getComputedStyle(whale).webkitTapHighlightColor : null,
    },
    scrollers,
    inputs: [...document.querySelectorAll('.zw-page input, .zw-page textarea, .zw-page select')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({ type: el.type || el.tagName.toLowerCase(), fs: getComputedStyle(el).fontSize })),
  };
}

const results = { census: null, pages: {} };

const browser = await chromium.launch({ headless: true });

// 触屏档：390 竖屏 + 844×390 横屏
for (const [tag, viewport] of [['390', { width: 390, height: 844 }], ['844x390', { width: 844, height: 390 }]]) {
  const page = await browser.newPage({ viewport, locale: 'zh-CN', isMobile: true, hasTouch: true });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await clearMask(page);
  if (results.census === null) results.census = await page.evaluate(census);
  for (const [label, id] of [['笔记', 'notes'], ['论文', 'paper'], ['文档', 'docs']]) {
    if (!await clickLabel(page, label)) continue;
    await page.waitForTimeout(1300);
    await clearMask(page);
    results.pages[`${tag}-${id}`] = await page.evaluate(pageProbe);
  }
  await page.close();
}

// 鼠标档：桌面不能受影响
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await clearMask(page);
  if (!await clickLabel(page, '笔记')) { /* 没装笔记页也不该让整轮失败 */ }
  await page.waitForTimeout(1300);
  await clearMask(page);
  results.pages['1440-notes'] = await page.evaluate(pageProbe);
  await page.close();
}

/**
 * `env(safe-area-inset-*)` 机制验证。
 *
 * headless Chromium 里 `env()` 恒为 0，所以「安全区有没有生效」在默认环境下永远
 * 量不出来。这里另注入一条**同形状**的规则、把安全区固定成 34px（iPhone home
 * indicator 的高度），看导轨底部是否真的被抬起来 —— 量的不是那个数，是那条机制。
 */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  results.safeAreaMechanism = await page.evaluate(() => {
    const rail = document.querySelector('[data-dsh-pages-rail]');
    if (!rail) return null;
    const lastBottom = () => {
      const buttons = [...rail.querySelectorAll('button')];
      return Math.round(buttons[buttons.length - 1].getBoundingClientRect().bottom);
    };
    const before = { padBottom: getComputedStyle(rail).paddingBottom, lastBottom: lastBottom() };
    const style = document.createElement('style');
    style.textContent = '[data-dsh-pages-rail]{padding-bottom:max(12.75px, 34px) !important}';
    document.head.append(style);
    const after = { padBottom: getComputedStyle(rail).paddingBottom, lastBottom: lastBottom() };
    style.remove();
    return { simulatedInset: 34, before, after, lifted: before.lastBottom - after.lastBottom };
  });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 1));
