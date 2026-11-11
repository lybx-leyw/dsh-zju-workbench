import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISOLATED_GROUPS, ISOLATED_PREFIXES, isIsolated, ownPackageDirs } from '../../scripts/workspace-packages.mjs';

/**
 * `packages/vendor/` 的豁免契约。
 *
 * # 为什么需要这条守卫
 *
 * `vendor` 放的是**会改对方代码的上游副本**。它们不参与本仓装配，靠的是
 * `isIsolated()` 这个位置判定。一旦有人：
 *
 *   - 把本仓自己的包放进 `vendor/`（以为只是「分个组」）；
 *   - 或者把 `vendor` 从 `ISOLATED_GROUPS` 里删掉；
 *
 * 后果都是静默的：那些包突然开始被 profile / build / CSS 检查当成产品包，
 * 而报错的地方与真正的原因相距很远（比如「CSS 层叠顺序冲突」指向一个
 * 我们根本没写过的上游文件）。
 */

const root = fileURLToPath(new URL('../..', import.meta.url));

test('isIsolated 认 vendor 这个分组目录', () => {
  assert.ok(ISOLATED_GROUPS.includes('vendor'), 'vendor 必须在隔离分组里');
  assert.equal(isIsolated('vendor'), true);
  // 平铺前缀的旧机制仍然有效
  for (const prefix of ISOLATED_PREFIXES) assert.equal(isIsolated(`${prefix}x`), true);
  // 本仓自己的分组不该被隔离
  for (const group of ['core', 'source', 'client', 'page']) assert.equal(isIsolated(group), false);
});

test('ownPackageDirs 不返回 packages/vendor 下的任何包', async () => {
  const dirs = await ownPackageDirs(path.join(root, 'packages'));
  const vendorMarker = path.join('packages', 'vendor');
  const leaked = dirs.filter(dir => dir.replaceAll('\\', '/').includes(vendorMarker.replaceAll('\\', '/')));
  assert.deepEqual(leaked, [], `以下 vendor 包被当成本仓产品包了：\n${leaked.join('\n')}`);
});

test('vendor 目录里的包必须带 PATCHES.md', () => {
  // `PATCHES.md` 记录「我们偏离上游多少」。缺了它，那些人就不知道
  // 这个目录里的代码改过、也就不会在升级上游时检查自己的改动。
  const vendorRoot = path.join(root, 'packages', 'vendor');
  if (!existsSync(vendorRoot)) return;

  const missing = [];
  for (const entry of readdirSync(vendorRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(vendorRoot, entry.name);
    if (!existsSync(path.join(dir, 'package.json'))) continue;   // 不是包，跳过
    if (!existsSync(path.join(dir, 'PATCHES.md'))) missing.push(entry.name);
  }
  assert.deepEqual(missing, [],
    `以下 vendor 包缺 PATCHES.md（无法判断改动量，升级时会踩雷）：\n${missing.join('\n')}`);
});

test('vendor 目录里有说明文档，且说明了豁免范围', () => {
  const readme = path.join(root, 'packages', 'vendor', 'README.md');
  assert.ok(existsSync(readme), 'packages/vendor/README.md 必须存在');
  const text = readFileSync(readme, 'utf8');
  assert.match(text, /PATCHES\.md/, '说明里要提到 PATCHES.md 的约定');
  assert.match(text, /isIsolated|ISOLATED_GROUPS/, '说明里要指出豁免是由哪段代码判定的');
});
