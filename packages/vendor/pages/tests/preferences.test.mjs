import test from 'node:test';
import assert from 'node:assert/strict';
import { createPagesState, normalizeConfig, RAIL_POSITIONS } from '../src/state.js';
import { createBrowserPreferences, decodePreferences, preferencesStorageKey } from '../src/preferences.js';

const config = normalizeConfig();
function memory() {
  const data = new Map();
  let writes = 0;
  return { data, get writes() { return writes; }, getItem: key => data.get(key) ?? null,
    setItem(key, value) { writes++; data.set(key, value); } };
}
function boot(storage, product = config) {
  const warnings = [];
  const preferences = createBrowserPreferences(product, { getStorage: () => storage, warn: (...args) => warnings.push(args) });
  return { preferences, pages: createPagesState(product, product.homePage, { preferences }), warnings };
}
const page = (pages, id) => pages.getSnapshot().pages.find(entry => entry.id === id);

test('configured width applies to fresh browser preferences without overriding saved user width', () => {
  const storage = memory(), product = normalizeConfig({ defaultRailWidth: 51 });
  const fresh = boot(storage, product);
  assert.equal(fresh.pages.getSnapshot().railWidth, 51);
  assert.equal(fresh.pages.getSnapshot().defaultRailWidth, 51);
  assert.equal(storage.writes, 0);
  fresh.pages.setRailWidth(80);
  assert.equal(boot(storage, product).pages.getSnapshot().railWidth, 80);
  assert.equal(boot(undefined, product).pages.getSnapshot().railWidth, 51);
});

test('four-edge rail position defaults, persists, and publishes immutable snapshots', () => {
  assert.deepEqual(RAIL_POSITIONS, ['left', 'top', 'bottom', 'right']);
  assert.equal(normalizeConfig().railPosition, 'left');
  const storage = memory(), product = normalizeConfig({ railPosition: 'right' });
  const app = boot(storage, product);
  assert.equal(app.preferences.getRailPosition(), undefined);
  assert.equal(app.pages.getSnapshot().railPosition, 'right');
  assert.equal(storage.writes, 0);
  let notifications = 0;
  app.pages.subscribe(() => notifications++);
  const initial = app.pages.getSnapshot();
  for (const position of RAIL_POSITIONS) {
    app.pages.setRailPosition(position);
    assert.equal(app.pages.getSnapshot().railPosition, position);
    assert.equal(boot(storage, product).pages.getSnapshot().railPosition, position);
    assert.equal(JSON.parse(storage.getItem(app.preferences.key)).railPosition, position);
  }
  assert.equal(initial.railPosition, 'right');
  assert.equal(notifications, 4);
  app.pages.setRailPosition('right');
  assert.equal(notifications, 4, 'unchanged position stores intent without publishing');
  assert.equal(storage.writes, 5);
  assert.equal(boot(storage, normalizeConfig({ railPosition: 'top' })).pages.getSnapshot().railPosition, 'right', 'stored position wins over changed product default');
});

test('invalid rail positions are rejected or discarded without losing config fallback', () => {
  for (const position of ['', 'middle', 'LEFT', 0, false, {}, [], null]) {
    if (position !== null) assert.throws(() => normalizeConfig({ railPosition: position }), /railPosition/);
    const storage = memory(), product = normalizeConfig({ railPosition: 'bottom' });
    storage.data.set(preferencesStorageKey(product), JSON.stringify({ version: 1, pages: {}, railPosition: position }));
    const app = boot(storage, product);
    assert.equal(app.preferences.getRailPosition(), undefined);
    assert.equal(app.pages.getSnapshot().railPosition, 'bottom');
    assert.equal(Object.hasOwn(decodePreferences({ version: 1, pages: {}, railPosition: position }), 'railPosition'), false);
    assert.throws(() => app.pages.setRailPosition(position), RangeError);
    assert.throws(() => app.preferences.setRailPosition(position), RangeError);
    assert.equal(storage.writes, 0);
    assert.equal(app.pages.getSnapshot().railPosition, 'bottom');
  }
  const app = createPagesState(normalizeConfig({ railPosition: 'top' }), 'home', { preferences: { getRailPosition: () => 'invalid' } });
  assert.equal(app.getSnapshot().railPosition, 'top');
});

test('registration defaults and runtime navigation do not write or revive pages', () => {
  const storage = memory(), app = boot(storage);
  app.pages.registerPage({ id: 'a', label: 'A', region: 'bottom', order: 7 });
  app.pages.selectPage('a');
  assert.equal(storage.writes, 0);
  const fresh = boot(storage);
  assert.deepEqual(fresh.pages.getSnapshot().pages, []);
  assert.equal(fresh.pages.getSnapshot().activePage, 'home');
});

test('region, order and promotion survive reload; labels and components never serialize', () => {
  const storage = memory(), a = boot(storage);
  a.pages.registerPage({ id: 'a', label: 'A', icon: () => null });
  a.pages.registerPage({ id: 'b', label: 'B', order: -10 });
  a.pages.setPageRegion('a', 'overflow');
  a.pages.setPageOrder('a', 6.5);
  let reload = boot(storage);
  reload.pages.registerPage({ id: 'a', label: 'New label', order: 99 });
  assert.equal(page(reload.pages, 'a').region, 'overflow');
  assert.equal(page(reload.pages, 'a').order, 6.5);
  a.pages.promotePage('a');
  reload = boot(storage);
  reload.pages.registerPage({ id: 'b', label: 'B', order: -10 });
  reload.pages.registerPage({ id: 'a', label: 'New label', order: 99 });
  assert.deepEqual(reload.pages.getSnapshot().pages.map(p => p.id), ['a', 'b']);
  assert.equal(page(reload.pages, 'a').region, 'top');
  assert.deepEqual(JSON.parse(storage.getItem(a.preferences.key)), { version: 1, pages: { a: { region: 'top', order: -11, pinned: false, pinOrder: 0 } } });
});

test('late registrations and unload/reload retain preferences without phantom entries', () => {
  const storage = memory(), a = boot(storage);
  const off = a.pages.registerPage({ id: 'late', label: 'Late' });
  a.pages.setPageRegion('late', 'bottom'); a.pages.setPageOrder('late', 9); off();
  const writes = storage.writes, reload = boot(storage);
  assert.equal(reload.pages.getSnapshot().pages.length, 0);
  const remove = reload.pages.registerPage({ id: 'late', label: 'Returned', order: -20 });
  assert.equal(page(reload.pages, 'late').region, 'bottom');
  assert.equal(page(reload.pages, 'late').order, 9);
  remove(); reload.pages.registerPage({ id: 'late', label: 'Again' });
  assert.equal(page(reload.pages, 'late').order, 9);
  assert.equal(storage.writes, writes);
});

test('explicit no-op arrangement stores intent but unknown-id actions do not', () => {
  const storage = memory(), a = boot(storage);
  a.pages.registerPage({ id: 'a', label: 'A' });
  assert.equal(a.pages.setPageRegion('a', 'top'), false);
  assert.equal(a.pages.setPageOrder('a', 0), false);
  assert.equal(a.pages.promotePage('a'), false);
  const writes = storage.writes;
  a.pages.setPageOrder('missing', 2); a.pages.setPageRegion('missing', 'bottom'); a.pages.promotePage('missing'); a.pages.setPagePinned('missing', true);
  assert.equal(storage.writes, writes);
  assert.deepEqual(a.preferences.getArrangement('a'), { region: 'top', order: 0 });
});

test('old documents retain valid arrangement and width but discard retired fields', () => {
  const storage = memory();
  storage.data.set(preferencesStorageKey(config), JSON.stringify({ version: 1, pages: { a: { region: 'overflow', order: 2, pinned: true, pinOrder: 1 } }, railWidth: 48, exportedSlots: ['sidebar.settings'] }));
  const app = boot(storage);
  assert.equal(app.warnings.length, 0);
  assert.equal(app.pages.getSnapshot().railWidth, 48);
  app.pages.registerPage({ id: 'a', label: 'A' });
  assert.equal(page(app.pages, 'a').pinned, true);
  app.pages.setRailWidth(40);
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(app.preferences.key)), 'exportedSlots'), false);
});

test('malformed or future documents are ignored without boot writes', () => {
  for (const raw of ['{', 'null', JSON.stringify({ version: 2, pages: {} }), JSON.stringify({ version: 1, pages: [] })]) {
    const storage = memory(); storage.data.set(preferencesStorageKey(config), raw);
    const app = boot(storage);
    assert.equal(app.warnings.length, 1);
    assert.deepEqual(app.preferences.getArrangement('a'), {});
    assert.equal(storage.writes, 0);
  }
});

test('untrusted fields and invalid arrangements cannot pollute objects or width', () => {
  const decoded = decodePreferences(JSON.parse('{"version":1,"railWidth":39,"pages":{"a":{"region":"bad","order":"3","icon":"bad"},"b":{"region":"bottom","order":4,"label":"ignore"},"__proto__":{"region":"top"}},"exportedSlots":["sidebar.settings"]}'));
  assert.equal(Object.hasOwn(decoded.pages, 'a'), false);
  assert.deepEqual(decoded.pages.b, { region: 'bottom', order: 4 });
  assert.deepEqual(decoded.pages.__proto__, { region: 'top' });
  assert.equal(Object.hasOwn(decoded, 'railWidth'), false);
  assert.equal({}.region, undefined);
  const special = decodePreferences({ version: 1, pages: { a: { order: Infinity }, b: { order: NaN } } });
  assert.deepEqual(Object.keys(special.pages), []);
  for (const width of [null, '48', 39, 97, 48.5, Infinity]) assert.equal(Object.hasOwn(decodePreferences({ version: 1, pages: {}, railWidth: width }), 'railWidth'), false);
});

test('storage denial warns while in-memory arrangement and width continue working', () => {
  for (const storage of [undefined, { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } }, { getItem() { return null; }, setItem() { throw Error('quota'); } }]) {
    const app = boot(storage);
    assert.doesNotThrow(() => {
      app.pages.registerPage({ id: 'a', label: 'A' });
      app.pages.setPageRegion('a', 'bottom'); app.pages.setRailWidth(48); app.pages.setRailPosition('top');
    });
    assert.equal(page(app.pages, 'a').region, 'bottom');
    assert.equal(app.pages.getSnapshot().railWidth, 48);
    assert.equal(app.pages.getSnapshot().railPosition, 'top');
    assert.ok(app.warnings.length >= 1);
  }
});

test('product identity isolates preferences and accessors return copies', () => {
  const storage = memory(), a = boot(storage);
  a.pages.registerPage({ id: 'a', label: 'A' }); a.pages.setPageRegion('a', 'bottom');
  const arrangement = a.preferences.getArrangement('a'); arrangement.region = 'overflow';
  assert.equal(a.preferences.getArrangement('a').region, 'bottom');
  for (const field of ['navigationSlot', 'pageSlot', 'classPrefix', 'homePage']) {
    const other = { ...config, [field]: config[field] + '-other' }, b = boot(storage, other);
    assert.notEqual(b.preferences.key, a.preferences.key);
    assert.deepEqual(b.preferences.getArrangement('a'), {});
  }
});
