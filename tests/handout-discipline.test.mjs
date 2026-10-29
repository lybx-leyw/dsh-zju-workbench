/**
 * 领域包的纪律：**不碰文件系统**。
 *
 * 这条不是洁癖。原子写、Windows 上 rename 的瞬态重试、路径安全（`safePath` /
 * `resolveIn` 的越界断言）都已经在笔记库里解决过一遍；在这里再写一遍只会得到
 * 一份更脆的副本，而且两份实现迟早会分出「哪一份才是真的」。
 *
 * 用扫描源码来钉，而不是靠人记得：注释里出现 `node:fs` 是允许的（那是在解释
 * 为什么不用它），真正的判据是**有没有 import/require 它**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const srcDir = path.join(root, 'packages', 'dsh-zhiyun-core-handout', 'src');

const FORBIDDEN = [
  /^\s*import\s[^;]*['"]node:fs['"]/m,
  /^\s*import\s[^;]*['"]node:fs\/promises['"]/m,
  /\brequire\(\s*['"]node:fs['"]\s*\)/,
  /\brequire\(\s*['"]fs['"]\s*\)/,
  /^\s*import\s[^;]*['"]fs['"]/m,
];

test('本包 src 下没有任何文件系统 import', async () => {
  const files = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0, 'src 目录里应该有源码，否则这条测试是假的');
  const offenders = [];
  for (const name of files) {
    const source = await readFile(path.join(srcDir, name), 'utf8');
    for (const pattern of FORBIDDEN) {
      if (pattern.test(source)) offenders.push(`${name}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `这些文件碰了文件系统：${offenders.join('; ')}`);
});

test('本包不依赖 node:path 一类的落盘工具（布局只用相对路径表达）', async () => {
  const files = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
  const offenders = [];
  for (const name of files) {
    const source = await readFile(path.join(srcDir, name), 'utf8');
    if (/^\s*import\s[^;]*['"]node:path['"]/m.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `这些文件 import 了 node:path：${offenders.join(', ')}`);
});
