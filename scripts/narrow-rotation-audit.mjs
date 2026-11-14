#!/usr/bin/env node
/**
 * 旋转与安全区取证：横屏刘海、四面安全区、搜索框键盘提示。
 *
 * 用法：node scripts/narrow-rotation-audit.mjs "<带 token 的地址>"
 *
 * # 为什么单独一支脚本
 *
 * `narrow-audit.mjs` 管几何、`narrow-touch-audit.mjs` 管触摸属性，这一支管
 * **屏幕的物理形状**：刘海在哪一边、`env()` 到底把内容推开了没有、手机键盘上
 * 那个回车键写的是什么。
 *
 * # `env()` 在 headless 里恒为 0 —— 所以量的是机制
 *
 * 没有真刘海时 `env(safe-area-inset-*)` 一律取 0，直接量「安全区生效了没有」
 * 永远得到「没生效」。这里改成：另注入一条同形状的规则、把安全区固定成一个
 * 真实设备的值，看内容是否真的被推开。量的是**这条机制成立**，不是伪造读数。
 *
 * 所以输出里 `*Mechanism` 那几项是「注入前后的位移」，不是设备实测值。
 */
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  throw new Error('用法：node scripts/narrow-rotation-audit.mjs "<带 token 的地址>"');
}

/** 处理首启引导，等到导轨真的出现。 */
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

/** 按 aria-label 点导轨按钮（绕开遮罩偶发的 pointer 拦截）。 */
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

const results = {};
const browser = await chromium.launch({ headless: true });

// ── 横屏：刘海在左边 ─────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, locale: 'zh-CN', isMobile: true, hasTouch: true });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await clearMask(page);

  results.landscape = await page.evaluate(() => {
    const rail = document.querySelector('[data-dsh-pages-rail]');
    const railBox = rail.getBoundingClientRect();
    const first = [...rail.querySelectorAll('button')][1].getBoundingClientRect();
    const cs = getComputedStyle(rail);
    return {
      railX: Math.round(railBox.x),
      firstButtonX: Math.round(first.x),
      padding: cs.padding,
      // 安全区四条边各自被多少条规则用到（左/右为 0 就是横屏刘海没处理）
      safeAreaSides: (() => {
        const sides = { left: 0, right: 0, top: 0, bottom: 0 };
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = [...sheet.cssRules]; } catch { continue; }
          const walk = (list) => {
            for (const rule of list) {
              if (rule.cssRules && rule.cssRules.length) { walk([...rule.cssRules]); continue; }
              const text = rule.cssText ?? '';
              if (!text.includes('safe-area-inset')) continue;
              for (const side of ['left', 'right', 'top', 'bottom']) {
                if (text.includes(`safe-area-inset-${side}`)) sides[side] += 1;
              }
            }
          };
          walk(rules);
        }
        return sides;
      })(),
    };
  });

  /**
   * 左刘海机制。iPhone 横屏的刘海约占左侧 47px —— 用真实值的量级，不随手编一个。
   *
   * 期望：第一个按钮被推开约 (47 − 6.375) 的一半 —— 内边距从 6.375 变成 47，
   * 按钮起点跟着右移同样的距离。若规则没生效，位移会是 0。
   */
  results.notchMechanism = await page.evaluate(() => {
    const rail = document.querySelector('[data-dsh-pages-rail]');
    const firstX = () => Math.round([...rail.querySelectorAll('button')][1].getBoundingClientRect().x);
    const before = firstX();
    const style = document.createElement('style');
    style.textContent = '[data-dsh-pages-rail]{padding-left:max(6.375px, 47px) !important}';
    document.head.append(style);
    const after = firstX();
    style.remove();
    return { simulatedNotch: 47, before, after, shifted: after - before };
  });

  // ── 搜索框的键盘提示 ──────────────────────────────────────────
  for (const [label, id] of [['论文', 'paper'], ['笔记', 'notes'], ['文档', 'docs']]) {
    if (!await clickLabel(page, label)) continue;
    await page.waitForTimeout(1300);
    await clearMask(page);
    results[`${id}Inputs`] = await page.evaluate(() => [...document.querySelectorAll('.zw-page input')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({
        type: el.type,
        enterkeyhint: el.getAttribute('enterkeyhint'),
        autocapitalize: el.getAttribute('autocapitalize'),
        autocorrect: el.getAttribute('autocorrect'),
        spellcheck: el.getAttribute('spellcheck'),
        fontSize: getComputedStyle(el).fontSize,
      })));
  }

  // ── 旋转来回：状态是否还自洽 ───────────────────────────────────
  const snapshot = async () => page.evaluate(() => {
    const rail = document.querySelector('[data-dsh-pages-rail]');
    return {
      width: innerWidth,
      railOverflow: rail ? rail.scrollHeight - rail.clientHeight : null,
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
    };
  });
  results.rotation = { portrait: await snapshot() };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(900);
  results.rotation.portraitAfterLandscape = await snapshot();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(900);
  results.rotation.landscapeAgain = await snapshot();

  await page.close();
}

// ── 桌面：必须完全不受影响 ─────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  results.desktop = await page.evaluate(() => {
    const rail = document.querySelector('[data-dsh-pages-rail]');
    return {
      padding: getComputedStyle(rail).padding,
      railOverflow: rail.scrollHeight - rail.clientHeight,
    };
  });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 1));
