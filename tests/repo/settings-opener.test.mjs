import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsOpener } from '../../archive/deprecated-packages/dsh-zhiyun-shell-workbench/src/settings-opener.js';

test('settings opener forwards to the native entry store and detaches safely', () => {
  const opener = createSettingsOpener();
  assert.equal(opener.open(), false, '没有原生设置项时不假装成功');

  const calls = [];
  const actions = { open: () => calls.push('open'), close: () => calls.push('close'), select: () => {}, openSection: () => {} };
  const detach = opener.attach(actions);
  assert.equal(opener.open(), true);
  assert.deepEqual(calls, ['open'], '只调用原生 open()，不复制设置实现');

  const replacement = { ...actions, open: () => calls.push('replacement') };
  const detachReplacement = opener.attach(replacement);
  opener.open();
  assert.deepEqual(calls, ['open', 'replacement']);

  // 旧绑定的清理不能摘掉后来的所有者。
  detach();
  opener.open();
  assert.deepEqual(calls, ['open', 'replacement', 'replacement']);

  detachReplacement();
  assert.equal(opener.open(), false, '卸载后不再有可用的原生设置入口');
});
