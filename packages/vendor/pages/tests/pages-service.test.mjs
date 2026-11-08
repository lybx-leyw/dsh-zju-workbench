import test from 'node:test';
import assert from 'node:assert/strict';
import { createPages } from '../src/pages-service.js';
import { createBrowserPreferences } from '../src/preferences.js';

test('recycle pins append in action order, toggle independently and persist', () => {
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const boot = () => createPages({}, { preferences: createBrowserPreferences({}, { getStorage: () => storage }) });
  const first = boot();
  assert.equal(first.service.getSnapshot().railWidth, 64);
  first.service.setRailWidth(48);
  first.service.setPageRegion('pages', 'overflow');
  for (const invalid of [39, 97, NaN, Infinity, 48.5, '48']) assert.throws(() => first.service.setRailWidth(invalid), /navigation width/);
  for (const id of ['a', 'b']) first.service.registerPage({ id, label: id, region: 'overflow' });
  first.service.setPagePinned('b', true);
  first.service.setPagePinned('a', true);
  const pins = service => service.getSnapshot().pages.filter(p => p.region === 'overflow' && p.pinned).sort((a,b) => a.pinOrder-b.pinOrder).map(p => p.id);
  assert.deepEqual(pins(first.service), ['b', 'a']);
  const second = boot();
  assert.equal(second.service.getSnapshot().railWidth, 48);
  assert.equal(second.service.getSnapshot().pages.find(page => page.id === 'pages').region, 'overflow');
  for (const id of ['a', 'b']) second.service.registerPage({ id, label: id });
  assert.deepEqual(pins(second.service), ['b', 'a']);
  second.service.setPagePinned('b', false);
  assert.equal(second.service.getSnapshot().pages.find(p => p.id === 'b').region, 'overflow');
  second.service.setPagePinned('b', true);
  assert.deepEqual(pins(second.service), ['a', 'b']);
  second.service.setPageRegion('a', 'bottom');
  assert.deepEqual(pins(second.service), ['b']);
  first.dispose(); second.dispose();
});

test('parallel pages contain only home and the manager, with no rebuilt settings page', () => {
  const { service, dispose } = createPages({ preferences: null });
  assert.equal(service.getSnapshot().activePage, 'home');
  // Settings are the native panel's; a page here would be a fake that cannot
  // render third-party settings.section contributions.
  assert.deepEqual(service.getSnapshot().pages.map(page => page.id), ['home', 'pages']);
  assert.equal(service.config.managerPage, 'pages');
  assert.throws(() => service.selectPage('missing'), /unknown page/);
  assert.throws(() => service.selectPage('settings'), /unknown page/);
  service.selectPage('pages');
  assert.equal(service.getSnapshot().activePage, 'pages');
  dispose(); dispose();
  assert.deepEqual(service.getSnapshot().pages, []);
});

test('page manager supports recycling like every other page', () => {
  const { service, dispose } = createPages();
  service.setPageRegion('pages', 'overflow');
  assert.equal(service.getSnapshot().pages.find(page => page.id === 'pages').region, 'overflow');
  service.setPageRegion('pages', 'top');
  assert.equal(service.getSnapshot().pages.find(page => page.id === 'pages').region, 'top');
  service.selectPage('pages');
  assert.equal(service.getSnapshot().activePage, 'pages');
  dispose();
});

test('third-party page metadata can be ordered, selected and removed without native mutation', () => {
  const { service, dispose } = createPages({ homePage: 'native', pageSlot: 'page.product.content' });
  let updates = 0;
  const off = service.subscribe(() => { updates++; });
  const remove = service.registerPage({ id: 'notes', label: { en: 'Notes', zh: '笔记' }, glyph: 'N', order: 20 });
  service.selectPage('notes');
  service.setPageRegion('notes', 'bottom');
  service.promotePage('notes');
  assert.equal(service.getSnapshot().pages[0].id, 'notes');
  remove(); remove();
  assert.equal(service.getSnapshot().activePage, 'native');
  assert.equal(service.config.pageSlot, 'page.product.content');
  assert.ok(updates >= 4);
  off(); dispose();
});
