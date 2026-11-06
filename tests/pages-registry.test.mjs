/**
 * Page registration lifetime.
 *
 * The point of `registerPage` is that a page behaves like every other Cordis
 * contribution: it is an effect, and disposing it removes the page and its
 * navigation entry. These tests pin that, plus the edges that are easy to get
 * wrong — ordering, reserved ids, double dispose, and a late disposer racing a
 * newer registration of the same id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesModule } from './support/pinned-pages.mjs';
const { createPagesState, normalizeConfig } = await pagesModule('src/state.js');

const config = normalizeConfig({});

function pages() {
  return createPagesState(config, 'home');
}

test('a registered page appears in the snapshot', () => {
  const state = pages();
  assert.deepEqual(state.getSnapshot().pages, []);

  const dispose = state.registerPage({ id: 'notes', label: 'Notes', glyph: 'N', order: 10 });
  const snapshot = state.getSnapshot();
  assert.equal(snapshot.pages.length, 1);
  assert.equal(snapshot.pages[0].id, 'notes');
  assert.equal(snapshot.pages[0].label, 'Notes');
  assert.equal(snapshot.pages[0].glyph, 'N');

  dispose();
});

test('disposing removes the page — this is the Cordis unwind property', () => {
  const state = pages();
  const dispose = state.registerPage({ id: 'notes', label: 'Notes' });
  assert.equal(state.getSnapshot().pages.length, 1);

  dispose();
  assert.deepEqual(state.getSnapshot().pages, [], '撤销后页面必须从快照里消失');
});

test('the snapshot identity changes on register and on dispose, so React re-renders', () => {
  const state = pages();
  const before = state.getSnapshot();
  const dispose = state.registerPage({ id: 'notes', label: 'Notes' });
  const during = state.getSnapshot();
  assert.notEqual(during, before, 'register 必须换快照引用');
  assert.notEqual(during.pages, before.pages, 'pages 数组也必须是新引用');

  dispose();
  const after = state.getSnapshot();
  assert.notEqual(after, during, 'dispose 必须换快照引用');
  assert.notEqual(after.pages, during.pages);
});

test('subscribers are notified on register and on dispose', () => {
  const state = pages();
  let calls = 0;
  const off = state.subscribe(() => { calls += 1; });

  const dispose = state.registerPage({ id: 'notes', label: 'Notes' });
  assert.equal(calls, 1, 'register 通知一次');

  dispose();
  assert.equal(calls, 2, 'dispose 通知一次');

  off();
});

test('pages are ordered by order, then by registration sequence — never by id', () => {
  const state = pages();
  // 同 order：注册早的在前。id 是字母序反过来的，专门用来证明排序不看 id。
  const a = state.registerPage({ id: 'b-page', label: 'B', order: 20 });
  const b = state.registerPage({ id: 'a-page', label: 'A', order: 20 });
  const c = state.registerPage({ id: 'first', label: 'F', order: 5 });

  assert.deepEqual(
    state.getSnapshot().pages.map((p) => p.id),
    ['first', 'b-page', 'a-page'],
    '同 order 必须按注册先后，而不是 id 字典序',
  );

  a(); b(); c();
});

test('registration sequence is stable across re-registration', () => {
  const state = pages();
  const first = state.registerPage({ id: 'one', label: 'One' });
  const second = state.registerPage({ id: 'two', label: 'Two' });
  assert.deepEqual(state.getSnapshot().pages.map((p) => p.id), ['one', 'two']);

  // 撤销 one 再重新注册：它会拿到新的序号，排到 two 之后。
  first();
  const again = state.registerPage({ id: 'one', label: 'One again' });
  assert.deepEqual(state.getSnapshot().pages.map((p) => p.id), ['two', 'one']);

  again(); second();
});

test('region defaults to top and rejects unknown values', () => {
  const state = pages();
  const a = state.registerPage({ id: 'plain', label: 'P' });
  assert.equal(state.getSnapshot().pages[0].region, 'top');

  assert.throws(() => state.registerPage({ id: 'bad', label: 'B', region: 'sidebar' }), /region/);
  a();
});

test('there are no reserved ids — built-in pages are ordinary registrations', () => {
  const state = pages();
  // 内置页由本插件自己通过 registerPage 注册，因此不存在"保留 id"这回事。
  const workbench = state.registerPage({ id: config.homePage, label: 'DSH', glyph: '◆', order: -1000 });
  const manager = state.registerPage({ id: config.managerPage, label: 'Manager', glyph: '▣', order: -999 });
  assert.deepEqual(state.getSnapshot().pages.map((p) => p.id), [config.homePage, config.managerPage]);
  // 撤销语义与普通页完全一致。
  workbench();
  manager();
  assert.deepEqual(state.getSnapshot().pages, []);
});

test('invalid specs fail loud', () => {
  const state = pages();
  assert.throws(() => state.registerPage(null), /spec object/);
  assert.throws(() => state.registerPage({ label: 'x' }), /id/);
  assert.throws(() => state.registerPage({ id: 'x' }), /label/);
});

test('duplicate ids are rejected while the first is live', () => {
  const state = pages();
  const dispose = state.registerPage({ id: 'notes', label: 'Notes' });
  assert.throws(() => state.registerPage({ id: 'notes', label: 'Again' }), /already registered/);
  dispose();
});

test('disposing twice is a no-op', () => {
  const state = pages();
  const dispose = state.registerPage({ id: 'notes', label: 'Notes' });
  dispose();
  let calls = 0;
  state.subscribe(() => { calls += 1; });
  dispose();
  assert.equal(calls, 0, '第二次 dispose 不应再通知');
});

test('a late disposer does not remove a newer registration of the same id', () => {
  const state = pages();
  const first = state.registerPage({ id: 'notes', label: 'First' });
  first();
  const second = state.registerPage({ id: 'notes', label: 'Second' });

  // 模拟：旧 disposer 迟到再跑一次
  first();
  assert.equal(state.getSnapshot().pages.length, 1, '新注册必须仍在');
  assert.equal(state.getSnapshot().pages[0].label, 'Second');

  second();
});

test('disposing the active page falls back to the workbench', () => {
  const state = pages();
  const dispose = state.registerPage({ id: 'notes', label: 'Notes' });
  state.selectPage('notes');
  assert.equal(state.getSnapshot().activePage, 'notes');

  dispose();
  assert.equal(
    state.getSnapshot().activePage,
    config.homePage,
    '当前页被撤销后不能停在一个不存在的页面上',
  );
});

test('disposing a non-active page keeps the current selection', () => {
  const state = pages();
  const notes = state.registerPage({ id: 'notes', label: 'Notes' });
  const other = state.registerPage({ id: 'other', label: 'Other' });
  state.selectPage('other');

  notes();
  assert.equal(state.getSnapshot().activePage, 'other');

  other();
});

test('the snapshot pages array is frozen, so consumers cannot mutate the registry', () => {
  const state = pages();
  const dispose = state.registerPage({ id: 'notes', label: 'Notes' });
  const snapshot = state.getSnapshot();
  assert.equal(Object.isFrozen(snapshot.pages), true);
  assert.equal(Object.isFrozen(snapshot.pages[0]), true);
  dispose();
});

test('setPageRegion moves a page between groups', () => {
  const state = pages();
  const a = state.registerPage({ id: 'a', label: 'A' });
  assert.equal(state.getSnapshot().pages[0].region, 'top');

  assert.equal(state.setPageRegion('a', 'bottom'), true);
  assert.equal(state.getSnapshot().pages[0].region, 'bottom');
  assert.equal(state.setPageRegion('a', 'bottom'), false, '同区域是 no-op');
  assert.throws(() => state.setPageRegion('a', 'nope'), /region/);
  assert.equal(state.setPageRegion('missing', 'top'), false);

  a();
});

test('setPageOrder reorders within a region', () => {
  const state = pages();
  const a = state.registerPage({ id: 'a', label: 'A', order: 10 });
  const b = state.registerPage({ id: 'b', label: 'B', order: 20 });
  assert.deepEqual(state.getSnapshot().pages.map((p) => p.id), ['a', 'b']);

  state.setPageOrder('b', 5);
  assert.deepEqual(state.getSnapshot().pages.map((p) => p.id), ['b', 'a']);
  assert.throws(() => state.setPageOrder('a', Number.NaN), /finite/);

  a(); b();
});

test('promotePage moves a page to the very top of the top group', () => {
  const state = pages();
  const a = state.registerPage({ id: 'a', label: 'A', order: 1 });
  const b = state.registerPage({ id: 'b', label: 'B', order: 2 });
  const c = state.registerPage({ id: 'c', label: 'C', order: 3 });
  assert.deepEqual(state.getSnapshot().pages.map((p) => p.id), ['a', 'b', 'c']);

  // 动作：直接把 c 提到最顶。
  assert.equal(state.promotePage('c'), true);
  assert.deepEqual(state.getSnapshot().pages.map((p) => p.id), ['c', 'a', 'b']);

  // 已经在顶端：无事可做，返回 false。
  assert.equal(state.promotePage('c'), false);

  a(); b(); c();
});

test('promotePage pulls a page out of another group', () => {
  const state = pages();
  const hidden = state.registerPage({ id: 'ghost', label: 'Ghost', region: 'overflow' });
  const top = state.registerPage({ id: 'top1', label: 'Top', order: 5 });

  state.promotePage('ghost');
  const snapshot = state.getSnapshot();
  assert.equal(snapshot.pages[0].id, 'ghost', '提到最顶');
  assert.equal(snapshot.pages[0].region, 'top', '"到顶部"隐含"进顶部组"');

  hidden(); top();
});

test('pinning appends a shortcut without changing recycle membership or registering another page', () => {
  const state = pages();
  const dispose = state.registerPage({ id: 'parked', label: 'Parked', region: 'overflow', order: 20 });
  assert.equal(state.setPagePinned('parked', true), true);
  assert.equal(state.setPagePinned('parked', true), false);
  let entry = state.getSnapshot().pages[0];
  assert.equal(entry.region, 'overflow');
  assert.equal(entry.order, 20);
  assert.equal(entry.pinned, true);
  assert.equal(state.getSnapshot().pages.length, 1);
  state.promotePage('parked');
  entry = state.getSnapshot().pages[0];
  assert.equal(entry.region, 'top');
  assert.equal(entry.pinned, false);
  assert.equal(state.setPagePinned('parked', true), false, 'only recycled pages can have a shortcut');
  assert.equal(state.setPagePinned('missing', true), false);
  dispose();
});

test('promotePage ignores unknown ids', () => {
  const state = pages();
  assert.equal(state.promotePage('nope'), false);
});