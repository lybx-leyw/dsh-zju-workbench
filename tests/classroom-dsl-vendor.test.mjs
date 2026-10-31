/**
 * `dsh-zhiyun-classroom-dsl` 的 vendor 冒烟测试。
 *
 * 判据来自 `docs/architecture/classroom-port.md` 第 7 节风险登记最后一条：
 * 「760k 行搬运产生『看起来像』的漂移 → 每个包必须带上游 fixture 的对照测试，
 * 无对照不算完」。这里就是 dsl 那一格的最小对照。
 *
 * **fixture 的来源**：上游 `ref/OpenMAIC/packages/@openmaic/dsl/` 下没有
 * `__fixtures__/` 目录（`find` 只找到 `dist/schema/*.json` 三个 JSON Schema），
 * 上游的「自带语料」写在 `test/validate.test.ts` 里，是内联在 `it()` 中的对象。
 * 下面每个常量都逐字抄自那个文件并标注行号；改动它们之前先看上游。
 *
 * 断言只碰**公开导出**：直接 import 本包的 `src/index.js`，证明 re-export 链
 * （`src/index.js` → `vendor/dsl/index.js`）通、且行为与上游一致。
 * 正反两向都测 —— 只有正向的话，一个「永远返回 { valid: true }」的实现也能全绿。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateStage,
  validateScene,
  validateAction,
  validateInteractiveContent,
  validatePBLContent,
  validateRuntimeSession,
} from '../packages/dsh-zhiyun-classroom-dsl/src/index.js';

/** 上游 `test/validate.test.ts:12` 的同一个助手：失败时只取路径。 */
function errors(result) {
  return result.valid ? [] : result.errors.map((e) => e.path);
}

/**
 * 上游的断言一律是「包含这条路径」（`expect(...).toContain(path)`），
 * 因为一条坏数据常常连带报出好几条。这里保持同一语义，不擅自收紧。
 */
function assertHasPath(result, expected) {
  const paths = errors(result);
  assert.ok(
    paths.includes(expected),
    `期望报出 ${expected}，实际报出 ${JSON.stringify(paths)}`,
  );
}

// ── 逐字抄自上游 test/validate.test.ts ────────────────────────────────────────

/** :35-42 —— 一张最小合法的 slide 场景。 */
const SLIDE_SCENE = {
  id: 'sc1',
  stageId: 'st1',
  type: 'slide',
  title: 'Intro',
  order: 0,
  content: { type: 'slide', canvas: { id: 'c' } },
};

/** :16 —— 一个最小合法的 stage。 */
const STAGE = { id: 's', name: 'n', createdAt: 1, updatedAt: 2 };

/** :158-167 —— 一个最小合法的 runtime session（带 DSL 版本戳）。 */
const RUNTIME_SESSION = {
  id: 's1',
  kind: 'chat',
  stageId: 'stage1',
  learnerKey: 'anon:device-1',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  // Required: sessions are born stamped, the runtime line has no unversioned epoch.
  runtimeDslVersion: '0.1.0',
};

// ── 正向：fixture 必须过 ──────────────────────────────────────────────────────

test('vendored validator 接受上游的最小 stage fixture', () => {
  assert.deepEqual(validateStage(STAGE), { valid: true });
});

test('vendored validator 接受上游的最小 slide 场景 fixture', () => {
  assert.deepEqual(validateScene(SLIDE_SCENE), { valid: true });
});

test('vendored validator 接受上游 fixture 派生出的四种 content kind', () => {
  // :48-53 的 it.each 表，逐条展开。
  const cases = [
    ['slide', { type: 'slide', canvas: { id: 'c' } }],
    ['quiz', { type: 'quiz', questions: [] }],
    ['interactive', { type: 'interactive', html: '<!doctype html><p>Hello</p>' }],
    ['pbl', { type: 'pbl', projectConfig: { projectInfo: { title: 'Legacy' } } }],
  ];
  for (const [type, content] of cases) {
    assert.deepEqual(validateScene({ ...SLIDE_SCENE, type, content }), { valid: true }, type);
  }
});

test('vendored validator 接受上游的独立 content fixture（不经 scene 信封）', () => {
  // :128-145
  assert.deepEqual(validateInteractiveContent({ type: 'interactive', html: '<div/>' }), {
    valid: true,
  });
  assert.deepEqual(
    validateInteractiveContent({ type: 'interactive', url: 'https://example.com' }),
    { valid: true },
  );
  assert.deepEqual(validatePBLContent({ type: 'pbl', projectConfig: { legacy: true } }), {
    valid: true,
  });
});

test('vendored validator 接受上游的 action fixture', () => {
  // :149
  assert.deepEqual(validateAction({ id: 'a', type: 'spotlight', elementId: 'e' }), {
    valid: true,
  });
});

test('vendored validator 接受上游的 runtime session fixture', () => {
  assert.deepEqual(validateRuntimeSession(RUNTIME_SESSION), { valid: true });
});

// ── 反向：同一批 fixture 改坏，必须报出上游声明的那条路径 ────────────────────

test('缺字段的 stage 报出上游声明的三条路径', () => {
  // :19-23
  const result = validateStage({ id: 's' });
  assert.equal(result.valid, false);
  for (const path of ['/name', '/createdAt', '/updatedAt']) assertHasPath(result, path);
});

test('非对象不是合法的 stage / session', () => {
  // :24-27 / :199-202
  assert.equal(validateStage(null).valid, false);
  assert.equal(validateStage('x').valid, false);
  assert.equal(validateRuntimeSession(null).valid, false);
});

test('未知 content kind 与 type/content 不一致都指向 /content/type', () => {
  // :58-69
  assertHasPath(validateScene({ ...SLIDE_SCENE, content: { type: 'bogus' } }), '/content/type');
  assertHasPath(
    validateScene({
      ...SLIDE_SCENE,
      type: 'quiz',
      content: { type: 'slide', canvas: { id: 'c' } },
    }),
    '/content/type',
  );
});

test('嵌套 action 出错时指向坏的那一条的 type', () => {
  // :107-115
  const result = validateScene({
    ...SLIDE_SCENE,
    actions: [
      { id: 'a', type: 'speech', text: 'hi' },
      { id: 'b', type: 'nope' },
    ],
  });
  assertHasPath(result, '/actions/1/type');
});

test('action 缺变体必填项 / 字段类型错 / 缺 id 都被抓出来', () => {
  // :151-176
  assertHasPath(validateAction({ id: 'a', type: 'spotlight' }), '/elementId');
  assertHasPath(validateAction({ id: 'a', type: 'discussion' }), '/topic');
  assertHasPath(validateAction({ id: 'a', type: 'spotlight', elementId: 123 }), '/elementId');
  assertHasPath(validateAction({ type: 'laser', elementId: 'e' }), '/id');
});

test('去掉版本戳的 session 只在 /runtimeDslVersion 报一次', () => {
  // :181-193
  const { runtimeDslVersion: _v, ...unstamped } = RUNTIME_SESSION;
  const result = validateRuntimeSession(unstamped);
  assert.equal(result.valid, false);
  const stampErrors = result.errors.filter((e) => e.path === '/runtimeDslVersion');
  assert.equal(stampErrors.length, 1);
  assert.match(stampErrors[0].message, /missing/);
});
