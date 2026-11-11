import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesModule } from '../support/pinned-pages.mjs';
const { normalizeConfig, createPagesState, createPages } = await pagesModule('src/state.js').then(async state => ({
  ...state, ...(await pagesModule('src/pages-service.js')),
}));

test('configuration exposes only the supported page shell and storage identity fields', () => {
  assert.deepEqual(normalizeConfig({}), {
    homePage: 'home', managerPage: 'pages', pageSlot: 'page.content',
    classPrefix: 'dsh-pages', navigationSlot: 'page.navigation',
    defaultRailWidth: undefined, railActionSlot: 'page.rail-action', railPosition: 'left', railPlaceholderIcon: undefined,
    homeLabel: { en: 'DSH workbench', zh: 'DSH 工作台' },
    managerLabel: { en: 'Pages', zh: '页面管理' }, homeIcon: undefined, managerIcon: undefined,
  });
  const config = normalizeConfig({ homePage: 'ask', managerPage: 'manager', pageSlot: 'page.zhiyun.page',
    navigationSlot: 'page.zhiyun.navigation', classPrefix: 'zy-workbench', page: 'today',
    copyPagesPrototype: true, floatingPages: true, slotViews: ['main'] });
  assert.equal(config.homePage, 'ask');
  assert.equal(config.pageSlot, 'page.zhiyun.page');
  assert.equal(config.navigationSlot, 'page.zhiyun.navigation');
  assert.deepEqual(normalizeConfig(config), config);
  for (const retired of ['page', 'copyPagesPrototype', 'floatingPages', 'slotViews']) assert.equal(retired in config, false);
});

test('invalid supported configuration fails loud', () => {
  for (const [input, pattern] of [
    [{ homePage: '' }, /homePage.*non-empty/], [{ managerPage: '' }, /managerPage.*non-empty/],
    [{ classPrefix: '' }, /classPrefix.*non-empty/], [{ navigationSlot: '' }, /navigationSlot.*non-empty/],
    [{ pageSlot: 'main' }, /pageSlot.*page\./], [{ managerPage: 'home' }, /managerPage.*must differ/],
  ]) assert.throws(() => normalizeConfig(input), pattern);
});

test('page state publishes once per real change with stable prior snapshots', () => {
  const state = createPagesState(normalizeConfig({}));
  state.registerPage({ id: 'home', label: 'Home' });
  state.registerPage({ id: 'notes', label: 'Notes' });
  const initial = state.getSnapshot();
  assert.deepEqual(Object.keys(initial).sort(), ['activePage', 'defaultRailWidth', 'pages', 'railPlaceholderIcon', 'railPosition', 'railWidth']);
  assert.equal(state.getSnapshot(), initial);
  const seen = [];
  const off = state.subscribe(() => seen.push(state.getSnapshot()));
  state.selectPage('home'); state.setRailWidth(64);
  assert.equal(seen.length, 0);
  state.selectPage('notes'); state.selectPage('notes'); state.setRailWidth(72);
  assert.equal(seen.length, 2);
  assert.equal(initial.activePage, 'home');
  assert.equal(initial.railWidth, 64);
  assert.equal(seen[0].railWidth, 64);
  assert.throws(() => state.selectPage('missing'), /unknown page/);
  for (const width of [39, 97, 64.5, NaN]) assert.throws(() => state.setRailWidth(width), /integer/);
  off(); off(); state.selectPage('home');
  assert.equal(seen.length, 2);
});

test('formal service registers built-ins, starts at home and disposes its registrations', () => {
  const runtime = createPages({ homePage: 'ask', managerPage: 'manager', page: 'today' });
  assert.equal(runtime.service.getSnapshot().activePage, 'ask');
  assert.deepEqual(runtime.service.getSnapshot().pages.map(p => p.id), ['ask', 'manager']);
  runtime.service.selectPage('manager');
  runtime.dispose(); runtime.dispose();
  assert.deepEqual(runtime.service.getSnapshot().pages, []);
});
