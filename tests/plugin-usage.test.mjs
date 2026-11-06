/**
 * 「吃灰」判定的测试。
 *
 * 能力提取自雷达候选 `dsh-radar-knowledge-graph`（见 `usage.js` 顶部说明为什么要提）。
 * 这些是纯函数，不碰 localStorage、不碰 DOM。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLedger, recordUse, staleness, summarize, STALE_DAYS,
} from '../packages/dsh-zhiyun-page-plugins/src/usage.js';

const DAY = 24 * 60 * 60 * 1000;

test('recordUse：同名不同 kind 分开计数', () => {
  const ledger = createLedger();
  recordUse(ledger, { kind: 'plugin', name: 'x' });
  recordUse(ledger, { kind: 'tool', name: 'x' });
  assert.equal(ledger.items.size, 2);
  assert.equal(ledger.items.get('plugin:x').count, 1);
  assert.equal(ledger.items.get('tool:x').count, 1);
});

test('recordUse：重复调用累加，lastUsed 取最后一次', () => {
  const ledger = createLedger();
  recordUse(ledger, { kind: 'tool', name: 'search', at: 1000 });
  recordUse(ledger, { kind: 'tool', name: 'search', at: 2000 });
  const item = ledger.items.get('tool:search');
  assert.equal(item.count, 2);
  assert.equal(item.lastUsed, 2000);
});

test('recordUse：缺 name 或 kind 时不产生脏节点', () => {
  const ledger = createLedger();
  assert.equal(recordUse(ledger, { kind: 'tool' }), false);
  assert.equal(recordUse(ledger, { name: 'x' }), false);
  assert.equal(recordUse(ledger, {}), false);
  assert.equal(ledger.items.size, 0);
});

test('staleness：count=0 是 never，不是 stale', () => {
  assert.equal(staleness({ count: 0, lastUsed: null }), 'never');
});

test('staleness：超过阈值是 stale，阈值内是 active', () => {
  const now = 100 * DAY;
  assert.equal(staleness({ count: 1, lastUsed: now - 31 * DAY }, { now }), 'stale');
  assert.equal(staleness({ count: 1, lastUsed: now - 1 * DAY }, { now }), 'active');
  // 边界：正好 30 天不算 stale（严格大于）。
  assert.equal(staleness({ count: 1, lastUsed: now - STALE_DAYS * DAY }, { now }), 'active');
});

test('staleness：有计数但没时间戳 → stale，不谎报 active', () => {
  assert.equal(staleness({ count: 3, lastUsed: null }), 'stale');
});

test('summarize：安装清单里没有账本记录的，补成 never', () => {
  const ledger = createLedger();
  recordUse(ledger, { kind: 'plugin', name: 'used', at: Date.now() });
  const rows = summarize(ledger, { known: ['plugin:used', 'plugin:never-used'] });
  const never = rows.find((r) => r.name === 'never-used');
  assert.equal(never.state, 'never');
  assert.equal(never.count, 0);
});

test('summarize：排序把 never 放最前，然后 stale，然后 active', () => {
  const now = 100 * DAY;
  const ledger = createLedger();
  recordUse(ledger, { kind: 'tool', name: 'active', at: now });
  recordUse(ledger, { kind: 'tool', name: 'old', at: now - 90 * DAY });
  const rows = summarize(ledger, { now, known: ['tool:brandnew'] });
  assert.deepEqual(rows.map((r) => r.state), ['never', 'stale', 'active']);
});

test('summarize：key 里带冒号的名字不被截断', () => {
  const ledger = createLedger();
  recordUse(ledger, { kind: 'tool', name: 'a:b:c' });
  const [row] = summarize(ledger);
  assert.equal(row.name, 'a:b:c');
  assert.equal(row.kind, 'tool');
});

test('空账本 + 空清单：返回空数组而不是抛错', () => {
  assert.deepEqual(summarize(createLedger()), []);
});
