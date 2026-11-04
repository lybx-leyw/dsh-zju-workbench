import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { pagesModule, pagesFile } from './support/pinned-pages.mjs';
const { normalizeConfig } = await pagesModule('src/state.js');
const { createBrowserPreferences, preferencesStorageKey } = await pagesModule('src/preferences.js');

const root = fileURLToPath(new URL('../', import.meta.url));

test('browser preferences tolerate invalid or unavailable storage and preserve storage identity', () => {
  const config = normalizeConfig({});
  assert.equal(preferencesStorageKey(config), preferencesStorageKey(normalizeConfig({ homeLabel: 'Renamed' })));
  assert.notEqual(preferencesStorageKey(config), preferencesStorageKey(normalizeConfig({ classPrefix: 'other' })));
  for (const getStorage of [() => { throw Error('denied'); }, () => ({ getItem: () => '{bad', setItem() { throw Error('denied'); } })]) {
    const warnings = [];
    const preferences = createBrowserPreferences(config, { getStorage, warn: (...args) => warnings.push(args) });
    preferences.setArrangement('notes', { region: 'bottom', order: 12 });
    assert.deepEqual(preferences.getArrangement('notes'), { region: 'bottom', order: 12 });
    assert.ok(warnings.length);
  }
});

test('real browser reload restores arrangement, pinning and width but not live registrations or active page', async t => {
  let browser;
  for (const options of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { browser = await chromium.launch({ headless: true, ...options }); break; } catch { /* try installed browser */ }
  }
  assert.ok(browser, 'a Chromium browser is required for persistence integration');
  t.after(() => browser.close());
  const bundle = await build({ stdin: { resolveDir: root, loader: 'jsx', contents: `
    import { createPages } from ${JSON.stringify(pagesFile('src/pages-service.js').replaceAll('\\', '/'))};
    const runtime = createPages();
    const service = runtime.service;
    service.registerPage({id:'alpha',label:'Alpha'});
    window.api = {
      snapshot:()=>({activePage:service.getSnapshot().activePage,railWidth:service.getSnapshot().railWidth,
        pages:service.getSnapshot().pages.map(({id,region,order,pinned,pinOrder})=>({id,region,order,pinned:Boolean(pinned),pinOrder:pinOrder??0}))}),
      arrange(){ service.setPageRegion('alpha','overflow'); service.setPagePinned('alpha',true);
        service.setPageOrder('alpha',42); service.setRailWidth(80); service.selectPage('alpha'); },
      late:()=>service.registerPage({id:'late',label:'Late'}),
      arrangeLate(){service.setPageRegion('late','bottom');service.setPageOrder('late',81);},
      dispose:()=>runtime.dispose()
    };
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://pages.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><script>${bundle.outputFiles[0].text}</script>` }));
  await page.goto('http://pages.test/');
  await page.evaluate(() => { window.api.arrange(); window.api.late(); window.api.arrangeLate(); });
  const before = await page.evaluate(() => window.api.snapshot());
  await page.evaluate(() => window.api.dispose());
  await page.reload();
  const restored = await page.evaluate(() => window.api.snapshot());
  assert.equal(restored.activePage, 'home', 'active UI selection is not a stored preference');
  assert.equal(restored.railWidth, 80);
  assert.deepEqual(restored.pages, before.pages.filter(item => item.id !== 'late'));
  await page.evaluate(() => window.api.late());
  assert.deepEqual((await page.evaluate(() => window.api.snapshot())).pages, before.pages, 'late registrations receive saved preferences');
  const documents = await page.evaluate(() => Object.values(localStorage).map(JSON.parse));
  assert.equal(documents.length, 1);
  assert.deepEqual(Object.keys(documents[0]).sort(), ['pages', 'railWidth', 'version']);
  assert.deepEqual(Object.keys(documents[0].pages.alpha).sort(), ['order', 'pinOrder', 'pinned', 'region']);
  assert.deepEqual(errors, []);
});
