import test from 'node:test';
import assert from 'node:assert/strict';
import { FOCUS_STORAGE_KEY as TODAY_KEY, writeFocus } from '../packages/dsh-zhiyun-page-today/src/focus.js';
import { FOCUS_STORAGE_KEY, clearFocus, focusDecision, focusElementId, readFocus } from '../packages/dsh-zhiyun-page-planning/src/focus.js';

function memory() {
  const data = new Map();
  return {
    setItem(key, value) { data.set(key, String(value)); },
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    removeItem(key) { data.delete(key); },
  };
}

test('today and planning share one focus note', () => {
  assert.equal(TODAY_KEY, FOCUS_STORAGE_KEY);
  const storage = memory();
  assert.equal(writeFocus(storage, 'local:p-1-ab', 1_000), true);
  assert.deepEqual(JSON.parse(storage.getItem(FOCUS_STORAGE_KEY)), { key: 'local:p-1-ab', at: 1_000 });
  assert.deepEqual(readFocus(storage, 1_000), { key: 'local:p-1-ab', at: 1_000 });
  assert.equal(focusElementId('local:p-1-ab'), 'zpg-due-local:p-1-ab');
  assert.equal(focusElementId('xzzd:12'), 'zpg-due-xzzd:12');
  assert.equal(writeFocus(storage, 'relay:9', 1_000), false);
  assert.equal(readFocus(storage, 1_000 + 2 * 60 * 1000 + 1), null);
  assert.equal(storage.getItem(FOCUS_STORAGE_KEY), null);
});

test('a missing row waits for the list, then drops without an error', () => {
  const pending = { key: 'pta:9', at: 50 };
  assert.equal(focusDecision({ pending, loading: true, loadedAt: 0, hasElement: false }), 'wait');
  assert.equal(focusDecision({ pending, loading: false, loadedAt: 0, hasElement: false }), 'wait');
  assert.equal(focusDecision({ pending, loading: false, loadedAt: 80, hasElement: false }), 'drop');
  assert.equal(focusDecision({ pending, loading: false, loadedAt: 80, hasElement: true }), 'scroll');
  assert.equal(focusDecision({ pending: null, loading: false, loadedAt: 80, hasElement: false }), 'idle');
  const storage = memory();
  writeFocus(storage, 'pta:9', 50);
  clearFocus(storage);
  assert.equal(readFocus(storage, 50), null);
});
