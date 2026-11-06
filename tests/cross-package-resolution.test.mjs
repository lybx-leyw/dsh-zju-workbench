/**
 * 跨包路径解析必须与 process.cwd() 无关。
 *
 * 这是一次真实事故的回归测试（2026-10-31）：
 * 适配层用 `path.join(process.cwd(), 'packages/...')` 拼路径，命令行下 cwd 是仓库根
 * 所以能跑；desktop 进程的 cwd 是 `.runtime/home/workspace`，拼出来的路径根本不存在，
 * 报 `Cannot find module .../workspace/packages/dsh-zhiyun-core-question/src/index.js`。
 *
 * 症状极具迷惑性：单元测试全绿、命令行验证通过、只有真机挂 ——
 * 因为所有验证都在仓库根跑，没人站在 desktop 的 cwd 上看过。
 *
 * 所以这条测试**故意在别的目录下**跑一次加载。
 *
 * 用法：node tests/cross-package-resolution.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('.');
const BACKEND = path.join(ROOT, 'packages/dsh-zhiyun-core-study/src/core-question-backend.js');

test('适配层的跨包 import 不依赖 process.cwd()', () => {
  // 造一个「像 desktop 那样」的 cwd：不在仓库根，且没有 packages/ 子树
  const foreign = path.join(ROOT, '.verify-scratch', 'foreign-cwd');
  fs.mkdirSync(foreign, { recursive: true });

  // 在子进程里，把 cwd 切到那个目录，再让适配层真的去加载四个包。
  // 用子进程是因为 cwd 是进程级状态，改不回来会影响同进程其它测试。
  const script = `
    const url = ${JSON.stringify(pathToFileURL(BACKEND).href)};
    const { createCoreQuestionBackend } = await import(url);
    const b = createCoreQuestionBackend({ pool: null, llmService: null });
    b.__setHostResources({ attach: async () => ({ handleId: 'h', revision: 'r' }), release: async () => {} });
    b.rememberBundle('h', { lecture: { chapters: [{ title: 't', topics: [{ title: 'p', blocks: [{ kind: 'paragraph', text: 'm' }] }] }] } });
    // start() 内部会动态 import 四个包 —— 这一步就是曾经崩掉的地方。
    // 只要它不抛 ERR_MODULE_NOT_FOUND，说明解析与 cwd 无关。
    await b.runs.start({ capability: 'deep_question', resourceHandles: ['h'], options: { config: { num_questions: 1, question_types: ['choice'] } }, input: {} });
    console.log('LOADED');
  `;

  let output;
  try {
    output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: foreign,
      encoding: 'utf8',
      timeout: 60_000,
    });
  } catch (error) {
    const stderr = String(error.stderr ?? '');
    // 区分两类失败：
    //   ERR_MODULE_NOT_FOUND → 就是本次要防的路径 bug
    //   其它（比如模型 401）→ 说明包已加载成功，只是没有凭证，测试目的已达成
    assert.ok(
      !stderr.includes('ERR_MODULE_NOT_FOUND'),
      `在非仓库根的 cwd 下加载失败（这正是要防的回归）：\n${stderr.slice(0, 500)}`,
    );
    output = String(error.stdout ?? '');
  }

  assert.match(output, /LOADED/, '适配层应当能在任意 cwd 下完成四个跨包 import');
});

test('适配层源码里不再出现基于 cwd 的路径拼接', () => {
  const source = fs.readFileSync(BACKEND, 'utf8');
  // 允许出现 process.cwd() 做日志/诊断，但不允许用它拼 import 路径。
  const badLines = source.split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter(({ line }) => /process\.cwd\(\)/.test(line) && /(import|load|join|resolve)/.test(line));
  assert.deepEqual(
    badLines.map(r => `L${r.no}: ${r.line}`),
    [],
    '这些行用 cwd 拼了路径，desktop 下会失效',
  );
});
