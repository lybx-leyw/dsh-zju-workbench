/**
 * 引擎注册表契约。
 *
 * 这里钉的是「装了 lab 与没装 lab 的两个世界必须可区分」：
 * 未注册时目录与判据与改动前逐字一致；注册后追加；注销后回到原位。
 * 尤其那条 `undefined === undefined` 的漏洞 —— 它曾经让任意断点都被判成可恢复。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUIZ_ENGINES, BUILTIN_ENGINES, engineEntries, registerEngine, registeredEngines,
  engineVersion, engineLabel, isNativeEngine, canResumeEngine, planEngineQuestions,
  newEngineCheckpoint, engineComplete, isBuiltinEngine,
  selectableEngines, isSelectableEngine, DEFAULT_ENGINE,
} from '../packages/dsh-zhiyun-core-quiz/src/engines.js';
import {_resetEngineRegistry} from '../packages/dsh-zhiyun-core-quiz/src/engine-registry.js';

const fake = (extra = {}) => ({
  id: 'fake-lab', label: '假实验室', description: '测试用',
  checkpointVersion: 'fake-v1', native: true, source: 'course',
  createRun: () => ({generatePoints: async () => ({})}),
  ...extra,
});

test('未注册任何引擎时，目录与三个判据都与改动前逐字一致', () => {
  assert.deepEqual(engineEntries().map(x => x.id), ['r1', 'r3-v9', 'deeptutor-native']);
  // 能力目录三条全在（老断点要靠它查版本号），但只有 r1 与 DeepTutor 能新建批次。
  assert.deepEqual(selectableEngines().map(x => x.id), ['r1', 'deeptutor-native']);
  assert.equal(isSelectableEngine('r3-v9'), false);
  assert.equal(DEFAULT_ENGINE, 'deeptutor-native');
  assert.equal(engineEntries().length, QUIZ_ENGINES.length);
  assert.equal(BUILTIN_ENGINES, QUIZ_ENGINES);
  assert.deepEqual(QUIZ_ENGINES.map(x => x.label), ['r1（本地）', 'r3 v9（实验）', 'DeepTutor 直调']);
  // 内建引擎的版本号必须非空 —— 否则恢复判定会把它们一起判死。
  for (const engine of ['r1', 'r3-v9', 'deeptutor-native']) assert.ok(engineVersion(engine), engine);
  for (const engine of ['local', 'deeptutor']) assert.ok(engineVersion(engine), engine);
});

test('未知引擎的版本是 null 而不是 undefined，且断点因此恒不可恢复', () => {
  assert.equal(engineVersion('r4-lab'), null);
  assert.equal(engineVersion('invented'), null);
  assert.equal(engineVersion(undefined), null);
  // 这条直接钉住旧实现的漏洞：两侧都是 undefined 时 === 为真，任意断点可恢复。
  assert.equal(canResumeEngine({plan: {engine: 'invented'}, checkpoint: {version: undefined}}), false);
  assert.equal(canResumeEngine({plan: {engine: 'invented'}, checkpoint: {version: null}}), false);
  assert.equal(canResumeEngine({plan: {engine: 'invented'}, checkpoint: {version: 'anything'}}), false);
});

test('注册后目录追加、版本可查、可规划；注销后回到原位', () => {
  const before = engineEntries().length;
  const off = registerEngine(fake());
  try {
    assert.equal(engineEntries().length, before + 1);
    assert.equal(engineEntries().at(-1).id, 'fake-lab');
    assert.equal(engineVersion('fake-lab'), 'fake-v1');
    assert.equal(engineLabel('fake-lab'), '假实验室');
    assert.equal(isNativeEngine('fake-lab'), true);
    assert.equal(registeredEngines().length, 1);
    // 注册项不能出现在内建常量里 —— 否则“恰好三条”的断言在别的机器上会飘。
    assert.equal(QUIZ_ENGINES.some(x => x.id === 'fake-lab'), false);
    assert.equal(isBuiltinEngine('fake-lab'), false);
  } finally { off(); }
  assert.equal(engineEntries().length, before);
  assert.equal(engineVersion('fake-lab'), null);
});

test('注销函数幂等，重复注销不会误删后来注册的同名项', () => {
  const off = registerEngine(fake());
  off();
  const off2 = registerEngine(fake({checkpointVersion: 'fake-v2'}));
  try {
    off();
    assert.equal(engineVersion('fake-lab'), 'fake-v2', '旧注销函数不得删掉新注册项');
  } finally { off2(); }
});

test('注册项校验：缺字段、重复 id、覆盖内建都拒绝', () => {
  assert.throws(() => registerEngine(null), /必须为对象/);
  assert.throws(() => registerEngine(fake({id: ''})), /缺少 id/);
  assert.throws(() => registerEngine(fake({checkpointVersion: ''})), /checkpointVersion/);
  assert.throws(() => registerEngine(fake({createRun: undefined})), /createRun/);
  assert.throws(() => registerEngine(fake({label: ''})), /label/);
  // 内建引擎的断点格式归产品管，注册项不许覆盖。
  assert.throws(() => registerEngine(fake({id: 'r1'})), /内建引擎/);
  assert.throws(() => registerEngine(fake({id: 'r3-v9'})), /内建引擎/);
  const off = registerEngine(fake());
  try { assert.throws(() => registerEngine(fake()), /已注册/); } finally { off(); }
});

test('注册引擎参与恢复判定：只有版本与 kernel 都对上才可恢复', () => {
  const off = registerEngine(fake());
  try {
    assert.equal(canResumeEngine({plan: {engine: 'fake-lab'}, checkpoint: {version: 'fake-v1', engineState: {kernel: 'fake-lab'}}}), true);
    assert.equal(canResumeEngine({plan: {engine: 'fake-lab'}, checkpoint: {version: 'fake-v1', engineState: {kernel: '别的'}}}), false);
    assert.equal(canResumeEngine({plan: {engine: 'fake-lab'}, checkpoint: {version: 'fake-v0', engineState: {kernel: 'fake-lab'}}}), false);
  } finally { off(); }
});

test('planEngineQuestions 按注册表放行，注销后回到「出题引擎无效」', () => {
  const points = [{id: 'a', title: 'A', text: '文本', courseId: 'c', subId: 's'}];
  const input = {engine: 'fake-lab', count: 1, types: ['mcq'], source: 'course'};
  assert.throws(() => planEngineQuestions(points, input), {code: 'INPUT'});
  const off = registerEngine(fake());
  try {
    const plan = planEngineQuestions(points, input);
    assert.equal(plan.engine, 'fake-lab');
    const checkpoint = newEngineCheckpoint(plan);
    assert.equal(checkpoint.version, 'fake-v1');
    assert.deepEqual(checkpoint.engineState, {kernel: 'fake-lab', complete: false});
    assert.equal(canResumeEngine({plan, checkpoint}), true);
    assert.equal(engineComplete({plan, checkpoint}), false);
  } finally { off(); }
});

test('注册项声明的 source 决定能否用联网资料', () => {
  const points = [{id: 'a', title: 'A', text: '文本', courseId: 'c', subId: 's'}];
  const off = registerEngine(fake({id: 'web-lab', source: 'web', native: false}));
  try {
    // 声明 web 的引擎不该被「只许课内」拦住。
    assert.doesNotThrow(() => planEngineQuestions(points, {engine: 'web-lab', count: 1, types: ['mcq'], source: 'web'}));
  } finally { off(); }
});

test('每个用例结束后注册表为空，避免跨用例污染', () => {
  _resetEngineRegistry();
  assert.equal(registeredEngines().length, 0);
});
