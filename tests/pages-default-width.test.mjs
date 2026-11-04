import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pagesModule } from './support/pinned-pages.mjs';
const { createPages } = await pagesModule('src/pages-service.js');

const source = await readFile(new URL('../packages/client/pages-default/src/client.jsx', import.meta.url), 'utf8');
const defaults = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('client defaults update reset target even when a user has saved 80px', () => {
  const { service: pages, dispose } = createPages();
  try {
    pages.setRailWidth(80);
    const before = pages.getSnapshot();
    defaults.applyDefaultRailWidth(pages, { getItem: () => '{"railWidth":80}' });
    assert.equal(pages.getSnapshot().railWidth, 80);
    assert.equal(pages.getSnapshot().defaultRailWidth, 51);
    assert.equal(before.defaultRailWidth, 64);
    pages.setRailWidth(pages.getSnapshot().defaultRailWidth);
    assert.equal(pages.getSnapshot().railWidth, 51);
  } finally { dispose(); }
});

test('fresh client starts at 51 and disposing defaults restores only the default', () => {
  const { service: pages, dispose } = createPages();
  let cleanup;
  try {
    defaults.apply({ inject(keys, callback) { callback({ pages, effect(fn) { cleanup = fn(); } }); } });
    assert.equal(pages.getSnapshot().railWidth, 51);
    assert.equal(pages.getSnapshot().defaultRailWidth, 51);
    pages.setRailWidth(80);
    cleanup();
    assert.equal(pages.getSnapshot().railWidth, 80);
    assert.equal(pages.getSnapshot().defaultRailWidth, 64);
    assert.throws(() => pages.setDefaultRailWidth(0), RangeError);
  } finally { dispose(); }
});
