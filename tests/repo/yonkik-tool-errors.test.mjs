import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 模块在 import 时固定 YONKIK_HOME，所以整份文件共用一个记忆根。
const home = await mkdtemp(join(tmpdir(), 'yk-err-'));
process.env.YONKIK_HOME = home;
const { apply } = await import('../../packages/yonkik/yonkik-tool/src/index.js');
let tool;
apply({
  get: () => undefined,
  effect: (fn) => fn(),
  inject: (_deps, fn) => fn({ effect: (cb) => cb(), webServer: { register: () => () => {} } }),
  tools: { register: (def) => { tool = def; } },
});
after(() => rm(home, { recursive: true, force: true }));

test('put failures return structured errors instead of throwing', async () => {
  await mkdir(join(home, 'dir'), { recursive: true });
  const cases = [
    [[], /缺少脚本路径/],
    [['', 'x'], /缺少脚本路径/],
    [['d.mjs'], /缺少脚本内容/],
    [['../escape.mjs', 'x'], /路径越界/],
    [['.', 'x'], /路径不能是记忆根目录本身/],
    [['dir', 'x'], /写入失败：EISDIR/],
  ];
  for (const [args, pattern] of cases) {
    const result = await tool.execute({ script: 'put', args });
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.match(result.error ?? '', pattern);
    assert.match(result.result.error ?? '', pattern);
  }
});

test('put succeeds and reports the written path', async () => {
  const result = await tool.execute({ script: 'put', args: ['sites/demo/note.mjs', 'export const x = 1'] });
  assert.equal(result.ok, true);
  assert.equal(result.result.written, 'sites/demo/note.mjs');
});

test('run failures keep stderr and partial stdout', async () => {
  const missing = await tool.execute({ script: 'run', args: ['nope.mjs'] });
  assert.equal(missing.ok, false);
  assert.match(missing.result.stderr, /脚本不存在/);

  const empty = await tool.execute({ script: 'run', args: [] });
  assert.equal(empty.ok, false);
  assert.match(empty.result.stderr, /缺少脚本路径/);

  await writeFile(join(home, 'boom.mjs'), 'process.stdout.write("partial"); console.error("boom-stderr"); process.exit(3);\n');
  const boom = await tool.execute({ script: 'run', args: ['boom.mjs'] });
  assert.equal(boom.ok, false);
  assert.equal(boom.result.code, 3);
  assert.match(boom.result.stderr, /boom-stderr/);
  assert.equal(boom.result.stdout, 'partial');
});

test('run captures large output completely', async () => {
  await writeFile(join(home, 'big.mjs'), 'process.stdout.write("y".repeat(200000));\n');
  const result = await tool.execute({ script: 'run', args: ['big.mjs'] });
  assert.equal(result.ok, true, result.result.stderr);
  assert.equal(result.result.stdout.length, 200000);
});

test('unknown script name returns the available list', async () => {
  const result = await tool.execute({ script: 'nope', args: [] });
  assert.equal(result.ok, false);
  assert.match(result.result.stderr, /未知脚本 nope/);
  assert.match(result.result.stderr, /intake/);
});
