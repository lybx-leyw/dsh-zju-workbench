import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createWorkbenchState, adaptNativeRoot } from '../packages/dsh-zhiyun-shell-bridge/src/state.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function registry(initial = []) {
  let entries = initial;
  const listeners = new Set();
  return {
    entries(name) { assert.equal(name, 'root'); return entries; },
    subscribe(name, listener) {
      assert.equal(name, 'root'); listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(next) { entries = next; for (const fn of [...listeners]) fn(); },
    get listenerCount() { return listeners.size; },
  };
}

test('bridge snapshots are stable, immutable across updates, and idempotent for React subscriptions', () => {
  const state = createWorkbenchState();
  const initial = state.getSnapshot();
  assert.deepEqual(initial, { activePage: 'today', navigationHost: null, pageHost: null });
  assert.equal(state.getSnapshot(), initial);
  const seen = [];
  const off = state.subscribe(() => seen.push(state.getSnapshot()));
  state.selectPage('today'); state.attachNavigation(null); state.attachPage(null);
  assert.equal(seen.length, 0);
  const navigation = {}, page = {};
  state.attachNavigation(navigation);
  state.attachNavigation(navigation);
  state.attachPage(page);
  state.attachPage(page);
  state.selectPage('ask'); state.selectPage('ask');
  assert.equal(seen.length, 3, 'one publication per actual change');
  assert.equal(seen[0].navigationHost, navigation);
  assert.equal(seen[0].pageHost, null, 'old snapshots must not be mutated');
  assert.equal(seen[1].pageHost, page);
  assert.equal(seen[1].activePage, 'today');
  assert.equal(state.getSnapshot(), seen[2]);
  assert.deepEqual(initial, { activePage: 'today', navigationHost: null, pageHost: null });
  state.attachNavigation(null); state.attachPage(null);
  assert.equal(state.getSnapshot().navigationHost, null);
  assert.equal(state.getSnapshot().pageHost, null);
  off(); off();
  state.selectPage('study');
  assert.equal(seen.length, 5, 'unsubscribe is safe and stops notifications');
});

test('root adapter preserves entry ownership/declarations and restores roots on replacement and unload', () => {
  const slots = registry();
  let wraps = 0;
  const dispose = adaptNativeRoot(slots, native => { wraps++; return { native }; });
  const native = () => null;
  const entry = { component: native, owner: {}, children: { 'shell.main': {} }, store: {}, inject: () => ({}) };
  const declarations = { ...entry };
  slots.replace([entry]);
  assert.equal(entry.component.native, native);
  for (const key of ['owner', 'children', 'store', 'inject']) assert.equal(entry[key], declarations[key]);
  const wrapped = entry.component;
  slots.replace([entry]);
  assert.equal(entry.component, wrapped);
  assert.equal(wraps, 1);
  const second = { component: () => null };
  const secondNative = second.component;
  slots.replace([second]);
  assert.equal(entry.component, native);
  assert.equal(second.component.native, secondNative);
  slots.replace([]);
  assert.equal(second.component, secondNative, 'removing the root restores detached entries too');
  slots.replace([second]);
  dispose();
  assert.equal(second.component, secondNative);
  assert.equal(slots.listenerCount, 0);
  const later = { component: () => null };
  const laterNative = later.component;
  slots.replace([later]);
  assert.equal(later.component, laterNative, 'disposed adapters never touch future roots');
});

test('adapter cleanup never overwrites a later owner of the component', () => {
  const entry = { component: () => null };
  const slots = registry([entry]);
  const dispose = adaptNativeRoot(slots, native => ({ native }));
  const replacement = () => 'another plugin';
  entry.component = replacement;
  slots.replace([entry]);
  assert.equal(entry.component, replacement);
  slots.replace([]);
  assert.equal(entry.component, replacement);
  dispose();
  assert.equal(entry.component, replacement);
});

test('shell only registers product surfaces, not replacements for native sidebar/main/header', async () => {
  const source = await readFile(path.join(root, 'packages/dsh-zhiyun-shell-workbench/src/client.jsx'), 'utf8');
  const injections = [...source.matchAll(/ctx\.slots\.inject\(['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(injections.includes('zhiyun.shell.navigation'));
  assert.ok(injections.includes('zhiyun.shell.page'));
  assert.deepEqual(injections.filter(name => /^(root|sidebar|main|conversation\.header\.leading|shell\.overlay)$/.test(name)), []);
  assert.doesNotMatch(source, /ctx\.layout\.selectPanel\(/, 'outer navigation must not take native plugin panel selection');
});

// Exercise the actual hooks, refs and portals, not a string or React mock.
// Bundling happens only when the lead runs this test; no generated fixture is saved.
test('real React frame keeps native state mounted and routes product portals outside native DOM', async t => {
  const { chromium } = await import('playwright');
  let browser;
  for (const options of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { browser = await chromium.launch({ headless: true, ...options }); break; } catch { /* try installed browser */ }
  }
  if (!browser) return t.skip('No installed Chromium browser available for React integration');
  t.after(() => browser.close());
  const { build } = await import('esbuild');
  const result = await build({
    stdin: {
      resolveDir: root, loader: 'jsx', contents: `
        import React, { useEffect, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { apply } from './packages/dsh-zhiyun-shell-bridge/src/client.jsx';
        let mounts = 0, unmounts = 0, service, outlet;
        const cleanups = [], listeners = new Set(), registrations = [];
        function Native({ label }) {
          const [count, setCount] = useState(0);
          useEffect(() => { mounts++; return () => unmounts++; }, []);
          return <section data-native><header>{label}</header><aside>native sidebar</aside>
            <main><button id="native-count" onClick={() => setCount(n => n + 1)}>{count}</button></main>
            {outlet && React.createElement(outlet, { workbench: service, renderSlot })}
          </section>;
        }
        function renderSlot(name, props, options) {
          if (name === 'zhiyun.shell.navigation') return <nav id="product-nav">{props.activePage}</nav>;
          if (name === 'zhiyun.shell.page') return <article id="product-page">{options.entryKey}</article>;
          throw new Error('Unexpected slot: ' + name);
        }
        const entry = { component: Native, owner: {}, children: {}, store: {} };
        function source(initial) {
          let value = initial;
          const listeners = new Set();
          return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
            set(next) { value = next; for (const fn of listeners) fn(); }, count: () => listeners.size };
        }
        const panelInfo = source({ activePanelId: null });
        const selection = source({});
        const ctx = {
          effect(fn) { const off = fn(); if (typeof off === 'function') cleanups.push(off); },
          reflect: { provide(name, value) { service = value; return () => {}; } },
          layout: { panelInfo },
          uiWorkspace: { selection },
          slots: {
            entries(name) { if (name !== 'root') throw new Error(name); return [entry]; },
            subscribe(name, fn) { listeners.add(fn); return () => listeners.delete(fn); },
            inject(name, fn) { if (name !== 'shell.overlay') throw new Error(name); fn(); },
            register(spec, component) { registrations.push(spec); outlet = component; return () => {}; },
          },
        };
        apply(ctx);
        const reactRoot = createRoot(document.getElementById('app'));
        reactRoot.render(React.createElement(entry.component, { label: 'native header' }));
        window.bridgeTest = {
          select: id => service.selectPage(id),
          panel: value => panelInfo.set(value),
          session: sessionId => selection.set({ sessionId }),
          inspect: () => ({ mounts, unmounts, registrations, active: service.getSnapshot().activePage }),
          dispose() { reactRoot.unmount(); for (const off of cleanups.reverse()) off(); return entry.component === Native && panelInfo.count() === 0 && selection.count() === 0; },
        };
      `,
    }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'text' }, logLevel: 'silent',
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.waitForSelector('#product-page');
  assert.equal(await page.locator('#product-page').textContent(), 'today');
  assert.equal(await page.locator('[data-native] #product-page').count(), 0);
  assert.equal(await page.locator('[data-native] #product-nav').count(), 0);
  assert.equal(await page.locator('.zy-workbench-native').getAttribute('hidden'), '');
  assert.equal(await page.locator('.zy-workbench-native').getAttribute('inert'), '');
  // Boot-time restores happen before any user gesture in this document.
  await page.evaluate(() => { window.bridgeTest.panel({ activePanelId: 'restored-at-boot' }); window.bridgeTest.session('initial'); });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#product-nav').textContent(), 'today', 'boot-time native restore and session hydration do not steal product navigation');
  await page.evaluate(() => window.bridgeTest.select('today'));
  await page.evaluate(() => window.bridgeTest.select('ask'));
  await page.waitForSelector('#native-count', { state: 'visible' });
  await page.click('#native-count');
  assert.equal(await page.locator('#native-count').textContent(), '1');
  assert.equal(await page.locator('#product-page').count(), 0);
  await page.evaluate(() => window.bridgeTest.select('study'));
  await page.waitForSelector('#product-page');
  assert.equal(await page.locator('#product-page').textContent(), 'study');
  await page.evaluate(() => window.bridgeTest.select('ask'));
  await page.waitForSelector('#native-count', { state: 'visible' });
  assert.equal(await page.locator('#native-count').textContent(), '1', 'native local state survives outer navigation');
  await page.evaluate(() => window.bridgeTest.select('study'));
  await page.evaluate(() => window.bridgeTest.panel({ activePanelId: 'import-session' }));
  await page.waitForSelector('#native-count', { state: 'visible' });
  assert.equal(await page.locator('#product-nav').textContent(), 'ask', 'user-initiated native panel navigation reveals ask');
  await page.evaluate(() => { window.bridgeTest.select('study'); window.bridgeTest.session('another'); });
  await page.waitForSelector('#native-count', { state: 'visible' });
  assert.equal(await page.locator('#product-nav').textContent(), 'ask', 'native session switching reveals ask');
  const state = await page.evaluate(() => window.bridgeTest.inspect());
  assert.equal(state.mounts, 1);
  assert.equal(state.unmounts, 0);
  assert.deepEqual(state.registrations.map(entry => entry.name), ['shell.overlay']);
  assert.deepEqual(Object.keys(state.registrations[0].children).sort(), ['zhiyun.shell.navigation', 'zhiyun.shell.page']);
  assert.equal(await page.evaluate(() => window.bridgeTest.dispose()), true);
  assert.equal(await page.locator('style[data-zhiyun-bridge]').count(), 0);
  assert.deepEqual(errors, []);
});
