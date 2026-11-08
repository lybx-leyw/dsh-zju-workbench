import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/**
 * Browser-level behavior of the parallel shell.
 *
 * Fixtures model only what the component actually consumes: the framework page
 * hook, the injected page actions, and a keyed content slot. Settings are absent
 * from this component by design, so this test asserts the shell does not rebuild
 * them rather than simulating a settings surface it no longer has.
 */
async function loadShell() {
  const result = await build({
    stdin: {
      contents: `
        import React, { useSyncExternalStore } from 'react';
        import { createRoot } from 'react-dom/client';
        import { installPageShell } from './src/page-shell.jsx';
        import { Context } from '@deepseek-ai/cordis';
        let Component, injected, dictionary;
        const ctx = new Context();
        ctx.locale = {
          resolveText: label => typeof label === 'string' ? label : label.en,
          register(ns, dict) { return ctx.effect(() => { dictionary = dict.en; return () => { dictionary = undefined; }; }); },
        };
        ctx.slots = {
          inject(name, fn) { return ctx.effect(() => fn()); },
          register(options, component) {
            return ctx.effect(() => { Component = component; injected = options.inject(); return () => { Component = undefined; }; });
          },
        };
        const dispose = installPageShell(ctx);
        const root = createRoot(document.getElementById('copy'));
        const useSource = source => selector => selector(useSyncExternalStore(source.subscribe, source.getSnapshot));
        const mount = () => root.render(<Component
          homePage={injected.homePage} managerPage={injected.managerPage} pageSlot={injected.pageSlot}
          usePages={useSource(injected.hooks.pages)}
          selectPage={injected.selectPage} setPageRegion={injected.setPageRegion} setPagePinned={injected.setPagePinned} setRailWidth={injected.setRailWidth} setRailPosition={injected.setRailPosition}
          setPageOrder={injected.setPageOrder} promotePage={injected.promotePage}
          resolveLabel={injected.resolveLabel}
          host={injected.host}
          renderSlot={(name, props, options) => {
             if (name === 'page.rail-action') return props.pageId === 'action-page' ? <PageAction {...props}/> : options.fallback;
             window.slotRequest = { name, props, options }; return <p>Page body: {options.entryKey}</p>;
           }}
          t={key => dictionary[key]}/>);
        function PageAction({pageId, railPosition}) {
          React.useEffect(() => {
            window.actionMounts = (window.actionMounts || 0) + 1;
            return () => { window.actionCleanups = (window.actionCleanups || 0) + 1; };
          }, []);
          return <button data-action-position={railPosition} onClick={() => {window.actionClicked = pageId;}}>Page operation</button>;
        }
        window.setPlaceholder = enabled => ctx.pages.setRailPlaceholderIcon(enabled ? () => <svg data-product-icon=""/> : undefined);
        window.mount = mount;
        window.unmount = () => root.render(null);
        window.disposeShell = () => dispose();
        window.addPage = spec => ctx.pages.registerPage(spec);
        window.addIconPage = () => ctx.pages.registerPage({ id: 'custom-icon', label: 'Custom icon', icon: () => <svg data-custom-icon="" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg> });
        window.setWidth = width => ctx.pages.setRailWidth(width);
        window.setPosition = position => ctx.pages.setRailPosition(position);
        window.pick = id => ctx.pages.selectPage(id);
        window.park = id => ctx.pages.setPageRegion(id, 'overflow');
        window.snapshot = () => ctx.pages.getSnapshot().pages.map(page => ({ id: page.id, region: page.region }));
        mount();`,
      resolveDir: process.cwd(), loader: 'jsx',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser',
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!String(error).includes("Executable doesn't exist")) throw error;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  }
  return { text: result.outputFiles[0].text, browser };
}

test('four rail edges reserve the correct space, anchor menus inward, and persist the chosen edge', async () => {
  const { text, browser } = await loadShell();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://pages.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}#root{width:100%;height:100vh}</style><div id="root"><div id="copy"></div></div>' }));
    await page.goto('http://pages.test/');
    await page.addScriptTag({ content: text });
    await page.evaluate(() => {
      window.addPage({ id: 'notes', label: 'Notes', glyph: 'N', region: 'overflow' });
      window.setWidth(51);
      window.pick('pages');
    });
    const nav = page.getByRole('navigation', { name: 'Pages' });
    const position = page.getByRole('combobox', { name: 'Navigation position', exact: true });
    for (const edge of ['left', 'top', 'bottom', 'right', 'left']) {
      await position.selectOption(edge);
      await page.waitForFunction(edge => document.querySelector('[data-dsh-pages-shell]').dataset.railPosition === edge, edge);
      const horizontal = edge === 'top' || edge === 'bottom';
      const geometry = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
        return { rail: rect(document.querySelector('[data-dsh-pages-rail]')), content: rect(document.querySelector('[data-dsh-pages-content]').parentElement), padding: ['left','top','bottom','right'].map(side => parseFloat(getComputedStyle(document.getElementById('root')).getPropertyValue('padding-' + side))) };
      });
      assert.equal(horizontal ? geometry.rail.height : geometry.rail.width, 51);
      assert.equal(geometry.rail.x, edge === 'right' ? 1049 : 0);
      assert.equal(geometry.rail.y, edge === 'bottom' ? 709 : 0);
      assert.equal(geometry.content.x, edge === 'left' ? 51 : 0);
      assert.equal(geometry.content.y, edge === 'top' ? 51 : 0);
      assert.equal(geometry.content.width, horizontal ? 1100 : 1049);
      assert.equal(geometry.content.height, horizontal ? 709 : 760);
      assert.deepEqual(geometry.padding, ['left','top','bottom','right'].map(side => side === edge ? 51 : 0));
      await page.getByRole('slider', { name: horizontal ? 'Navigation height' : 'Navigation width', exact: true }).waitFor();
      await nav.getByRole('button', { name: 'More pages' }).click();
      const menu = page.getByRole('menu', { name: 'More pages' });
      await menu.waitFor();
      const box = await menu.boundingBox();
      const rail = geometry.rail;
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1100 && box.y + box.height <= 760);
      if (edge === 'left') assert.ok(box.x >= rail.right);
      if (edge === 'right') assert.ok(box.x + box.width <= rail.x);
      if (edge === 'top') assert.ok(box.y >= rail.bottom);
      if (edge === 'bottom') assert.ok(box.y + box.height <= rail.y);
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
    }
    // Horizontal overflow stays scrollable; menus remain usable on a small viewport.
    await page.setViewportSize({ width: 320, height: 480 });
    await position.selectOption('bottom');
    await page.getByRole('slider', { name: 'Navigation height', exact: true }).press('End');
    await page.evaluate(() => {
      for (let i = 0; i < 12; i++) window.addPage({ id: 'extra-' + i, label: 'Extra ' + i, glyph: 'E' });
    });
    await nav.getByRole('button', { name: 'More pages' }).click();
    const smallBox = await page.getByRole('menu', { name: 'More pages' }).boundingBox();
    assert.ok(smallBox.x >= 0 && smallBox.y >= 0 && smallBox.x + smallBox.width <= 320 && smallBox.y + smallBox.height <= 384);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.addScriptTag({ content: text });
    await page.waitForFunction(() => document.querySelector('[data-dsh-pages-shell]')?.dataset.railPosition === 'bottom');
    assert.equal((await nav.boundingBox()).height, 96);
    assert.equal(await page.locator('[data-dsh-pages-shell]').getAttribute('data-active-page'), 'home');
    await nav.getByRole('button', { name: 'Pages', exact: true }).click();
    assert.equal(await position.inputValue(), 'bottom');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('current-page rail action owns events and cleans up on navigation with icon and P/ fallbacks', async () => {
  const { text, browser } = await loadShell();
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"><div id="copy"></div></div>');
    await page.addScriptTag({ content: text });
    const seat = page.locator('[data-dsh-pages-rail-action]');
    await seat.getByText('P /', { exact: true }).waitFor();
    await page.evaluate(() => window.setPlaceholder(true));
    await seat.locator('[data-product-icon]').waitFor();
    await page.evaluate(() => {
      window.addPage({ id: 'action-page', label: 'Action page', glyph: 'A' });
      window.pick('action-page');
    });
    await seat.getByRole('button', { name: 'Page operation' }).click();
    assert.equal(await page.evaluate(() => window.actionClicked), 'action-page');
    assert.equal(await seat.locator('[data-product-icon]').count(), 0);
    await page.evaluate(() => window.setPosition('top'));
    await page.waitForFunction(() => document.querySelector('[data-action-position]')?.dataset.actionPosition === 'top');
    assert.equal(await page.evaluate(() => window.actionMounts), 1, 'moving the rail does not remount page-owned actions');
    await page.evaluate(() => window.pick('home'));
    await seat.locator('[data-product-icon]').waitFor();
    assert.equal(await page.evaluate(() => window.actionCleanups), 1);
    await page.evaluate(() => window.setPlaceholder(false));
    await seat.getByText('P /', { exact: true }).waitFor();
  } finally { await browser.close(); }
});

test('the rail navigates pages, opens the manager, and never rebuilds settings', async () => {
  const { text, browser } = await loadShell();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    // The shell pads the mount container it is rendered into.
    await page.setContent('<div id="root"><div id="copy"></div></div>');
    await page.addScriptTag({ content: text });

    const nav = page.getByRole('navigation', { name: 'Pages' });
    await nav.waitFor();
    const home = nav.getByRole('button', { name: 'DSH workbench' });
    const manager = nav.getByRole('button', { name: 'Pages', exact: true });
    assert.equal(await home.getAttribute('aria-current'), 'page');
    // A settings entry would be a dead end: settings are the native panel's.
    assert.equal(await nav.getByRole('button', { name: 'Settings' }).count(), 0);
    assert.equal(await page.getByRole('checkbox').count(), 0, 'the shell renders no settings controls');

    assert.equal(await page.locator('#root').evaluate(node => getComputedStyle(node).paddingLeft), '64px');

    await page.evaluate(() => { window.addIconPage(); window.addPage({ id: 'recycled-probe', label: 'Recycled probe', region: 'overflow' }); });
    await manager.click();
    await page.getByRole('heading', { name: 'Page manager' }).waitFor();
    const width = page.getByRole('slider', { name: 'Navigation width' });
    await width.fill('48');
    assert.equal(await nav.evaluate(node => node.getBoundingClientRect().width), 48);
    assert.equal(await page.locator('#root').evaluate(node => getComputedStyle(node).paddingLeft), '48px');
    // The content region starts where the rail ends. It is addressed by its own
    // marker, not by "some section with an id": the shell no longer wraps page
    // content in a headed section of its own.
    assert.equal(await page.locator('[data-dsh-pages-content]').evaluate(node => Math.round(node.getBoundingClientRect().left)), 48);
    for (const pixels of [40, 64, 96]) {
      await width.fill(String(pixels));
      assert.equal(await nav.evaluate(node => node.getBoundingClientRect().width), pixels);
      assert.equal(await nav.evaluate(node => node.scrollWidth <= node.clientWidth), true);
      const iconWidths = await nav.locator('[data-dsh-pages-rail-icon]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
      assert.ok(iconWidths.length >= 2, 'declared icons (home plus a plugin icon) use rail scaling');
      for (const actual of iconWidths) assert.ok(Math.abs(actual - 23 * pixels / 64) < 0.01);
      const customWidth = await nav.locator('[data-custom-icon]').evaluate(node => node.getBoundingClientRect().width);
      assert.ok(Math.abs(customWidth - 24 * pixels / 64) < 0.01, 'fixed-size plugin icons scale too');
      const geometry = await nav.evaluate(rail => {
        const style = getComputedStyle(rail);
        const box = rail.getBoundingClientRect();
        const contentCenter = box.left + (box.width - parseFloat(style.borderRightWidth)) / 2;
        return {
          gap: parseFloat(style.rowGap), padding: parseFloat(style.paddingTop),
          buttons: [...rail.querySelectorAll('button')].map(button => {
            const b = button.getBoundingClientRect();
            // Not every page declares an icon, and the shell no longer invents a
            // default one — skip those buttons when checking centering.
            const icon = button.querySelector('[data-dsh-pages-rail-icon]');
            if (icon === null) return null;
            const i = icon.getBoundingClientRect();
            return { width: b.width, height: b.height, railOffset: b.x + b.width / 2 - contentCenter,
              iconX: i.x + i.width / 2 - (b.x + b.width / 2),
              iconY: i.y + i.height / 2 - (b.y + b.height / 2) };
          }).filter(Boolean),
        };
      });
      assert.ok(Math.abs(geometry.gap - 8 * pixels / 64) < 0.01);
      assert.ok(Math.abs(geometry.padding - 16 * pixels / 64) < 0.01);
      for (const button of geometry.buttons) {
        assert.ok(Math.abs(button.width - 46 * pixels / 64) < 0.01);
        assert.ok(Math.abs(button.height - button.width) < 0.01, 'rail targets remain square');
        for (const offset of [button.railOffset, button.iconX, button.iconY]) assert.ok(Math.abs(offset) < 0.05, 'icons and buttons are centered');
      }
    }
    await page.getByRole('button', { name: 'Reset size' }).click();
    assert.equal(await nav.evaluate(node => node.getBoundingClientRect().width), 64);
    assert.equal(await manager.getAttribute('aria-current'), 'page');
    assert.equal(await home.getAttribute('aria-current'), null);
    assert.equal(await page.locator('#root').evaluate(node => getComputedStyle(node).paddingLeft), '64px');

    // Returning to the home page is a rail action now: the shell deliberately
    // renders no "back to workbench" button inside the page area — that is the
    // page's own UI, not the shell's.
    assert.equal(await page.getByRole('button', { name: 'Back to workbench' }).count(), 0,
      'the shell must not impose a back button on page content');
    await home.click();
    await page.getByRole('heading', { name: 'Page manager' }).waitFor({ state: 'detached' });
    assert.equal(await home.getAttribute('aria-current'), 'page');

    await page.evaluate(() => window.addPage({ id: 'notes', label: { en: 'Notes' }, glyph: 'N', order: 10 }));
    const notes = nav.getByRole('button', { name: 'Notes' });
    await notes.waitFor();
    await notes.click();
    await page.getByText('Page body: notes', { exact: true }).waitFor();
    // 页面内容槽现在附带宿主面 `host`（页面访问宿主 UI 的唯一入口）。
    //
    // ⚠️ 不能在 `page.evaluate` 外部断言 `host` 的方法：Playwright 把返回值
    // **JSON 序列化**，类实例的方法全部丢失（只有数据字段过去），于是
    // `typeof host.rightbarOpen === 'function'` 会假失败。
    // 正确的做法是**在页面内**调用，只把结果带回来。
    const probe = await page.evaluate(() => {
      const request = window.slotRequest;
      const host = request?.props?.host;
      if (host === null || host === undefined) return { ok: false, reason: '页面没拿到 host' };
      const methods = ['rightbarOpen', 'openRightbar', 'closeRightbar', 'rightbarRect', 'frameTracks', 'toggleSidebar', 'colorScheme'];
      return {
        ok: true,
        slotName: request.name,
        entryKey: request.options?.entryKey,
        missing: methods.filter(name => typeof host[name] !== 'function'),
        // 真实调用一次，确认不是空壳
        rightbarOpen: host.rightbarOpen(),
        scheme: host.colorScheme(),
        tracks: Array.isArray(host.frameTracks()),
        rectIsNullOrObject: host.rightbarRect() === null || typeof host.rightbarRect() === 'object',
      };
    });

    assert.equal(probe.ok, true, probe.reason ?? '');
    assert.equal(probe.slotName, 'page.content');
    assert.equal(probe.entryKey, 'notes');
    assert.deepEqual(probe.missing, [], `host 缺方法：${probe.missing?.join(', ')}`);
    assert.equal(typeof probe.rightbarOpen, 'boolean', 'rightbarOpen() 应返回布尔');
    assert.ok(['dark', 'light'].includes(probe.scheme), 'colorScheme() 应返回 dark/light');
    assert.equal(probe.tracks, true, 'frameTracks() 应返回数组');
    assert.equal(probe.rectIsNullOrObject, true, 'rightbarRect() 应返回 DOMRect 或 null');

    // Escape belongs to the page (editors, dialogs). The shell only closes its
    // own popovers, so the page stays open here; going home is a rail action.
    await page.keyboard.press('Escape');
    await page.getByText('Page body: notes', { exact: true }).waitFor();
    await home.click();
    await page.getByText('Page body: notes', { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await home.getAttribute('aria-current'), 'page');

    await page.evaluate(() => window.unmount());
    await nav.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#root').evaluate(node => getComputedStyle(node).paddingLeft), '0px',
      'rail spacing reverses when the shell unmounts');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('manager recycles pages and pinning appends a top-tail shortcut without changing membership', async () => {
  const { text, browser } = await loadShell();
  try {
    const view = await browser.newPage({ viewport: { width: 1200, height: 820 } });
    await view.setContent('<div id="root"><div id="copy"></div></div>');
    await view.addScriptTag({ content: text });
    const nav = view.getByRole('navigation', { name: 'Pages' });
    await nav.waitFor();
    // A page in the recycle group is registered and reachable, but not on the rail.
    await view.evaluate(() => window.addPage({ id: 'notes', label: { en: 'Notes' }, glyph: 'N', order: 10 }),);
    assert.equal(await nav.locator('[data-dsh-pages-more]').count(), 0);
    await nav.getByRole('button', { name: 'Pages', exact: true }).click();
    await view.getByRole('combobox', { name: 'Group Notes', exact: true }).selectOption('overflow');
    await view.getByRole('region', { name: 'Recycle group', exact: true }).getByRole('listitem', { name: 'Notes', exact: true }).waitFor();
    // Leave the manager through the rail: the shell renders no in-page back button.
    await nav.getByRole('button', { name: 'DSH workbench', exact: true }).click();
    await nav.getByRole('button', { name: 'Notes' }).waitFor({ state: 'detached' });
    const more = nav.getByRole('button', { name: 'More pages' });
    await more.waitFor();
    await more.click();
    const panel = view.getByRole('menu', { name: 'More pages' });
    await panel.waitFor();
    const item = panel.getByRole('menuitem', { name: 'Notes' });
    await item.waitFor();
    await panel.getByRole('button', { name: 'Pin to top group Notes' }).click();
    await panel.getByRole('button', { name: 'Unpin Notes' }).waitFor();
    const pages = await view.evaluate(() => window.snapshot());
    assert.deepEqual(pages.map(page => page.id).sort(), ['home', 'notes', 'pages'], 'pinning registers no new page');
    assert.equal(pages.find(page => page.id === 'notes').region, 'overflow');
    assert.deepEqual(await nav.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['DSH workbench', 'More pages', 'Notes', 'Pages']);
    assert.equal(await item.count(), 1, 'the candidate remains in the menu');
    await panel.getByRole('button', { name: 'Unpin Notes' }).click();
    await nav.getByRole('button', { name: 'Notes' }).waitFor({ state: 'detached' });
    assert.equal(await more.count(), 1);
    await item.click();
    await view.getByText('Page body: notes', { exact: true }).waitFor();
  } finally {
    await browser.close();
  }
});

test('the manager can recycle itself and remains reachable through more', async () => {
  const { text, browser } = await loadShell();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
    await page.setContent('<div id="root"><div id="copy"></div></div>');
    await page.addScriptTag({ content: text });
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await nav.waitFor();
    await page.evaluate(() => window.addPage({ id: 'notes', label: { en: 'Notes' }, glyph: 'N', order: 10 }));
    await nav.getByRole('button', { name: 'Pages' }).click();
    await page.getByRole('heading', { name: 'Page manager' }).waitFor();
    await page.getByRole('switch', { name: 'Hide Pages', exact: true }).click();
    await nav.getByRole('button', { name: 'Pages', exact: true }).waitFor({ state: 'detached' });
    // The manager is gone from the rail, so leave through a page it still offers:
    // the shell renders no in-page back button to click.
    await nav.getByRole('button', { name: 'DSH workbench', exact: true }).click();
    await nav.getByRole('button', { name: 'More pages' }).click();
    await page.getByRole('menuitem', { name: 'Pages', exact: true }).click();
    await page.getByRole('heading', { name: 'Page manager' }).waitFor();
    await page.getByRole('switch', { name: 'Hide Notes' }).click();
    await nav.getByRole('button', { name: 'Notes' }).waitFor({ state: 'detached' });
    await page.getByRole('switch', { name: 'Show Notes' }).click();
    await nav.getByRole('button', { name: 'Notes' }).waitFor();
    await page.evaluate(() => window.disposeShell());
    await nav.waitFor({ state: 'detached' });
  } finally {
    await browser.close();
  }
});
