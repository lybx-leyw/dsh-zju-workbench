/**
 * `scripts/radar-inject-audit.mjs` 的判定层单测。
 *
 * 只测纯函数 `audit()`：联网取元数据那部分不进单测（CI 不该依赖 npm registry 的可用性）。
 * 这套判定的价值在于**区分四种情况**，每一条都钉一个用例：
 *
 *   1. inject 全部有 peer 背书 → OK
 *   2. inject 有未声明 → INJECT_UNDECLARED（这是要拦住的那种）
 *   3. 没有 dsh 元数据的普通库 → N/A（不适用，不该计进失败）
 *   4. 无前缀写法（locale / slots）→ 不判定，只记录
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../scripts/radar-inject-audit.mjs';

const D = '@deepseek-ai/';

test('inject 全部被 peer 覆盖 → OK', () => {
  const row = audit({
    name: 'p', version: '1.0.0', applicable: true, hasPatch: true,
    inject: [`${D}dsh-client-locale`, `${D}dsh-client-runtime`],
    peerDependencies: { [`${D}dsh-client-locale`]: '*', [`${D}dsh-client-runtime`]: '*' },
  });
  assert.equal(row.verdict, 'OK');
  assert.equal(row.undeclared.length, 0);
});

test('inject 里有一条没进 peer → INJECT_UNDECLARED，且只报缺的那条', () => {
  const row = audit({
    name: 'p', version: '1.0.0', applicable: true, hasPatch: true,
    inject: [`${D}dsh-client-locale`, `${D}dsh-client-ui-slots`],
    peerDependencies: { [`${D}dsh-client-locale`]: '*' },
  });
  assert.equal(row.verdict, 'INJECT_UNDECLARED');
  assert.deepEqual(row.undeclared, [`${D}dsh-client-ui-slots`]);
  assert.equal(row.injectCount, 2);
  assert.equal(row.peerCount, 1);
});

test('完全没有 peerDependencies 且 inject 非空 → 全部未声明', () => {
  const row = audit({
    name: 'p', version: '1.0.0', applicable: true, hasPatch: true,
    inject: [`${D}a`, `${D}b`, `${D}c`],
    peerDependencies: {},
  });
  assert.equal(row.verdict, 'INJECT_UNDECLARED');
  assert.equal(row.undeclared.length, 3);
});

test('普通 npm 库（无 dsh 元数据）→ N/A，不算失败', () => {
  const row = audit({ name: 'zod', version: '4.6.5', applicable: false, inject: [], peerDependencies: {} });
  assert.equal(row.verdict, 'N/A');
});

test('无前缀写法不参与判定，只单独记录', () => {
  const row = audit({
    name: 'p', version: '1.0.0', applicable: true, hasPatch: true,
    inject: ['locale', 'slots', `${D}dsh-client-locale`],
    peerDependencies: { [`${D}dsh-client-locale`]: '*' },
  });
  assert.equal(row.verdict, 'OK', '无前缀条目不产生 INJECT_UNDECLARED');
  assert.deepEqual(row.unscoped, ['locale', 'slots']);
  assert.equal(row.undeclared.length, 0);
});

test('inject 为空但 peer 很多 → OK（不反向要求 peer 必须被 inject）', () => {
  const row = audit({
    name: 'p', version: '1.0.0', applicable: true, hasPatch: true,
    inject: [],
    peerDependencies: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`${D}x${i}`, '*'])),
  });
  assert.equal(row.verdict, 'OK');
  assert.equal(row.peerCount, 24);
});
