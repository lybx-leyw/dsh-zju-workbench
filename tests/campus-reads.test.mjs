import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedRead } from '../packages/dsh-zhiyun-campus/src/reads.js';

test('concurrent consumers and local edits reuse one source read until expiry', async () => {
  let count = 0, at = 0;
  const read = sharedRead(async () => ({ rows: [++count] }), { now: () => at, ttlMs: 60 });
  assert.deepEqual(await Promise.all([read(), read(), read()]), [{rows:[1]}, {rows:[1]}, {rows:[1]}]);
  at = 59; await read(); assert.equal(count, 1);
  at = 60; await read(); assert.equal(count, 2);
});
test('credential changes and explicit invalidation bypass cached failures', async () => {
  let identity = 'one', count = 0;
  const read = sharedRead(async () => { count++; return {ok:false, error:{code:'AUTH_REJECTED'}}; }, {key: async () => identity});
  assert.equal((await read()).ok, false);
  await read(); assert.equal(count, 1);
  identity = 'two'; await read(); assert.equal(count, 2);
  read.invalidate(); await read(); assert.equal(count, 3);
});
test('a previous account response cannot replace the current account cache', async () => {
  let identity = 'one', finish;
  const read = sharedRead(() => identity === 'one' ? new Promise(resolve => { finish = resolve; }) : {account:'two'}, {key: async () => identity});
  const old = read(); await new Promise(resolve => setImmediate(resolve));
  identity = 'two'; assert.equal((await read()).account, 'two');
  finish({account:'one'}); await old;
  assert.equal((await read()).account, 'two');
});

test('consumers cannot mutate the cached source snapshot', async () => {
  const read = sharedRead(async () => ({rows:[{title:'original'}]}));
  const first = await read(); first.rows[0].title = 'changed';
  assert.equal((await read()).rows[0].title, 'original');
});
