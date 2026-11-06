/**
 * 出题实验室的引擎适配层。
 *
 * 用 r4 仓库自带的合成 fixture 模型（显式模型替身，不联网、不读命令），
 * 验证三件在实现时真踩过的事：
 *
 * 1. r4 只回调整份检查点、从不逐题回调 —— 适配层必须补发 `onQuestion`；
 * 2. 补发就必须能去重，否则一次恢复会把同一批题重复入库；
 * 3. r4 的检查点形状（explorations / requests）与产品的（tasks / questions）不同，
 *    直接上交会让产品进度永久为 0。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {model, graph} from '../packages/dsh-zhiyun-quiz-lab/src/kernel/fixture.mjs';
import {
  LAB_ENGINE, CHECKPOINT_VERSION, createLabRun, toR4Config, patchCheckpoint,
  recordQuestion, toBankQuestion, resolveGraph, coveredPoints,
} from '../packages/dsh-zhiyun-quiz-lab/src/engine.js';
import {canResumeLab, resumeRefusal, LAB_CHECKPOINT_VERSION} from '../packages/dsh-zhiyun-quiz-lab/src/checkpoint.js';
import {apply, name as labName, inject} from '../packages/dsh-zhiyun-quiz-lab/src/index.js';
import {engineEntries, engineVersion, registerEngine, engineComplete, newEngineCheckpoint} from '../packages/dsh-zhiyun-core-quiz/src/engines.js';
import {knowledgePoints} from '../packages/dsh-zhiyun-core-quiz/src/knowledge-points.js';

const point = id => ({id, title: id, text: `知识点${id}`, courseId: 'c', subId: 's', courseTitle: 'C', lessonTitle: 'S', blockIndexes: [0], page: 1, atSec: 0});
const plan = (count = 1) => ({count, types: ['mcq'], strategies: [{id: 'understand'}], mode: 'practice', tasks: [{point: point('a'), count, type: 'mcq', strategy: 'understand'}]});

test('引擎标识与检查点版本是 lab 私有，不进产品内核的证书表', () => {
  assert.equal(LAB_ENGINE.id, 'r4-lab');
  assert.equal(LAB_CHECKPOINT_VERSION, CHECKPOINT_VERSION);
  // 版本号必须带 lab 前缀：它和内核内部的 `r4-demand-v3` 是两层不同的东西。
  assert.match(CHECKPOINT_VERSION, /^point-quiz-r4-lab-/);
});

test('toR4Config 把产品 plan 映射成 r4 参数，并拒绝空知识点', () => {
  const config = toR4Config({plan: plan(2), graph: graph(), runId: 'r1'});
  assert.deepEqual(config.pointIds, ['a']);
  assert.equal(config.count, 2);
  assert.deepEqual(config.types, ['mcq']);
  assert.deepEqual(config.strategies, ['understand']);
  assert.equal(config.requestId, 'r1', 'requestId 必须来自 runId，否则恢复会换一份计划');
  assert.equal(config.compositeCount, 0, '产品侧没有综合题来源，默认 0 而不是猜一个数');
  assert.equal(config.purpose, 'practice');
  assert.equal(config.state.version, undefined);
  assert.throws(() => toR4Config({plan: {count: 1, tasks: []}, graph: graph(), runId: 'x'}), /至少一个知识点/);
});

test('patchCheckpoint 只碰 engineState.lab，产品字段原样保留', () => {
  const base = {version: 'old', tasks: [{questionIds: ['k']}], questions: {k: {id: 'k'}}, rectify: {state: 'running'}};
  const next = patchCheckpoint(base, {explorations: {}});
  assert.equal(next.version, CHECKPOINT_VERSION);
  assert.deepEqual(next.tasks, base.tasks);
  assert.deepEqual(next.questions, base.questions);
  assert.deepEqual(next.rectify, base.rectify);
  assert.deepEqual(next.engineState, {kernel: 'r4-lab', lab: {explorations: {}}});
  // 不修改入参
  assert.equal(base.version, 'old');
  assert.equal(base.engineState, undefined);
});

test('recordQuestion 写满任务位次，并让进度可被产品读出', () => {
  const checkpoint = {tasks: [{questionIds: [], plannedCount: 2, state: 'pending'}], questions: {}};
  const one = recordQuestion(checkpoint, {id: 'q1'});
  assert.deepEqual(one.tasks[0].questionIds, ['q1']);
  assert.equal(one.questions.q1.id, 'q1');
  assert.equal(one.tasks[0].state, 'completed');
  const two = recordQuestion(one, {id: 'q2'});
  assert.deepEqual(two.tasks[0].questionIds, ['q1', 'q2']);
  // 重复记同一道题不会撑大 questionIds —— 这正是恢复去重所依赖的性质。
  const again = recordQuestion(two, {id: 'q2'});
  assert.deepEqual(again.tasks[0].questionIds, ['q1', 'q2']);
});

test('toBankQuestion 无注入时给出最小形状并标注 lab-minimal', () => {
  const question = {id: 'q1', type: 'mcq', stem: '题干', answer: 'A', choices: [{label: 'A', text: '甲'}], familyId: 'f', coveredNodeIds: ['a']};
  const banked = toBankQuestion(question, {plan: plan()}, {});
  assert.equal(banked.provenance.engine, 'r4-lab');
  assert.equal(banked.provenance.normalizer, 'lab-minimal');
  assert.equal(banked.pointId, 'a');
  assert.deepEqual(banked.coveredPointIds, ['a']);
  assert.equal(banked.reviewState, 'ready');
});

test('toBankQuestion 有注入时走产品唯一的规整入口，不自造第二份形状', () => {
  const calls = [];
  const hosts = {bankQuestion: (raw, task, prov) => {calls.push({task, prov}); return {...raw, pointKey: 'k', banked: true};}};
  const question = {id: 'q1', type: 'mcq', coveredNodeIds: ['a']};
  const banked = toBankQuestion(question, {plan: plan()}, hosts);
  assert.equal(banked.banked, true);
  assert.equal(banked.pointKey, 'k');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prov.engine, 'r4-lab');
});

test('一批跑通：逐题补发 onQuestion，且写进产品进度', async () => {
  const fake = model();
  const run = createLabRun({pool: {call: fake.call, concurrency: 2, snapshot: []}, concurrency: 2});
  const emitted = [];
  const result = await run.generatePoints({
    plan: plan(1), graph: graph(), runId: 'batch-1', checkpoint: undefined,
    onCheckpoint: async () => {}, onQuestion: async q => emitted.push(q),
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].provenance.engine, 'r4-lab');
  assert.equal(result.admitted, 1);
  assert.deepEqual(result.problems, []);
  // 产品形状：进度来自 tasks[].questionIds，不是 r4 的 explorations。
  assert.equal(result.checkpoint.tasks.reduce((n, t) => n + t.questionIds.length, 0), 1);
  assert.equal(Object.keys(result.checkpoint.questions).length, 1);
  assert.equal(result.checkpoint.engineState.kernel, 'r4-lab');
  assert.equal(canResumeLab(result.checkpoint), true);
});

test('恢复同一批次：不新增模型调用，也不重复发题', async () => {
  const fake = model();
  const run = createLabRun({pool: {call: fake.call, concurrency: 2, snapshot: []}, concurrency: 2});
  const input = {plan: plan(1), graph: graph(), runId: 'batch-resume', checkpoint: undefined, onCheckpoint: async () => {}, onQuestion: async () => {}};
  const first = await run.generatePoints(input);
  const callsAfterFirst = fake.calls.length;
  const emitted = [];
  const again = await run.generatePoints({...input, checkpoint: first.checkpoint, onQuestion: async q => emitted.push(q)});
  assert.equal(fake.calls.length, callsAfterFirst, '恢复必须完全命中缓存');
  assert.deepEqual(emitted, [], '恢复不得重复入库同一道题');
  assert.equal(again.admitted, 0);
});

test('dispose 之后拒绝继续出题', async () => {
  const fake = model();
  const run = createLabRun({pool: {call: fake.call, concurrency: 2, snapshot: []}});
  run.dispose();
  await assert.rejects(run.generatePoints({plan: plan(), graph: graph(), runId: 'z', checkpoint: undefined, onCheckpoint: async () => {}, onQuestion: async () => {}}), /已释放/);
});

test('没有 pool 也没有 call 时早失败，而不是在第一次调用时才炸', async () => {
  const run = createLabRun({});
  await assert.rejects(run.generatePoints({plan: plan(), graph: graph(), runId: 'z', checkpoint: undefined, onCheckpoint: async () => {}, onQuestion: async () => {}}), /需要 worker 池/);
});

test('checkpoint 版本不符时拒绝恢复并说明为什么', () => {
  assert.equal(canResumeLab({version: 'old', engineState: {kernel: 'r4-lab', lab: {}}}), false);
  assert.match(resumeRefusal({version: 'old', engineState: {kernel: 'r4-lab'}}), /不能续跑/);
  assert.equal(canResumeLab({version: CHECKPOINT_VERSION, engineState: {kernel: '别的', lab: {}}}), false);
  assert.match(resumeRefusal({version: CHECKPOINT_VERSION, engineState: {kernel: '别的'}}), /不是 r4 lab 产生/);
  assert.equal(canResumeLab({version: CHECKPOINT_VERSION, engineState: {kernel: 'r4-lab', lab: {}}}), true);
  assert.equal(resumeRefusal({version: CHECKPOINT_VERSION, engineState: {kernel: 'r4-lab', lab: {}}}), null);
});

test('lab 的 apply 注册引擎，返回的注销函数把它摘掉', () => {
  const registered = [];
  const ctx = {zhiyunQuiz: {engines: {register: entry => {registered.push(entry); return registerEngine(entry);}}}};
  assert.equal(labName, 'zhiyun-quiz-lab');
  assert.deepEqual(inject, ['zhiyunQuiz']);
  const off = apply(ctx);
  try {
    assert.equal(engineVersion('r4-lab'), CHECKPOINT_VERSION);
    assert.ok(engineEntries().some(row => row.id === 'r4-lab'));
    assert.equal(typeof registered[0].createRun, 'function');
    // 目录里不能泄漏工厂：createRun 只在注册表内部可用，不上目录。
    const row = engineEntries().find(r => r.id === 'r4-lab');
    assert.equal(row.createRun, undefined);
  } finally { off(); }
  assert.equal(engineVersion('r4-lab'), null);
  assert.equal(engineEntries().some(row => row.id === 'r4-lab'), false);
});

test('core-quiz 没有暴露注册表时，apply 明确报错而不是静默不挂', () => {
  assert.throws(() => apply({zhiyunQuiz: {}}), /没有暴露引擎注册表/);
});

// ── 以下三条钉的是「测试形状必须等于产品形状」这个教训 ──
// 产品 launch() 只在 engine==='r3-v9' 时算 plan.sourceGraph，而 generatePoints 的入参
// 里没有 graph。上面那批用例全部自己塞了 graph，所以三条真实故障都躲过了测试。

/** 造一条能过 graphFromRecord 的宿主记录（结构与 knowledgePoints 的预期一致）。 */
const record = (titles = ['a']) => ({
  courseId: 'c', subId: 's',
  blocks: titles.map((title, index) => ({index, page: 1, text: `知识点${title}的定义与边界`, tag: {role: '主线'}})),
  lecture: {generationVersion: 'architecture-v4', revision: 'r1', chapters: [{topics: titles.map(title => ({title, blocks: [{type: 'text', text: `知识点${title}的定义与边界`}]}))}]},
  tree: {title: '根', children: titles.map((title, index) => ({kind: 'leaf', title, blocks: [{index}]}))},
});

test('产品不传 graph 时用 hosts.records 现建图谱，不炸成 undefined.root', async () => {
  const host = record(['a']);
  const fake = model();
  const run = createLabRun({pool: {call: fake.call, concurrency: 2, snapshot: []}, records: [host]});
  const points = knowledgePoints(host);
  const emitted = [];
  const result = await run.generatePoints({
    plan: {count: 1, types: ['mcq'], strategies: [{id: 'understand'}], mode: 'practice',
      tasks: [{point: points[0], count: 1, type: 'mcq', strategy: 'understand'}]},
    runId: 'no-graph', onCheckpoint: async () => {}, onQuestion: async q => emitted.push(q),
  });
  assert.equal(result.admitted, 1);
  assert.equal(emitted.length, 1);
  // 归属点必须还是那个知识点，而不是被翻成图谱节点 id。
  assert.equal(emitted[0].pointId, points[0].id);
});

test('三条图谱来源按 input.graph → hosts.graph → records 依次回退，都没有则明确早失败', async () => {
  const point = id => ({id, title: `知识点${id}`, text: 'x', courseId: 'c', subId: 's'});
  const makePlan = () => ({count: 1, types: ['mcq'], strategies: [{id: 'understand'}], mode: 'practice',
    tasks: [{point: point('a'), count: 1, type: 'mcq', strategy: 'understand'}]});
  const base = () => ({pool: {call: model().call, concurrency: 2, snapshot: []}});
  for (const [label, hosts, extra] of [
    ['input.graph', base(), {graph: graph()}],
    ['hosts.graph', {...base(), graph: graph()}, {}],
  ]) {
    const run = createLabRun(hosts);
    const result = await run.generatePoints({...extra, plan: makePlan(), runId: label, onCheckpoint: async () => {}, onQuestion: async () => {}});
    assert.equal(result.admitted, 1, label);
  }
  // 一处图谱来源都没有：必须是可读的 SOURCE_TREE，而不是 Cannot read properties of undefined。
  await assert.rejects(
    createLabRun(base()).generatePoints({plan: makePlan(), runId: 'none', onCheckpoint: async () => {}, onQuestion: async () => {}}),
    {code: 'SOURCE_TREE'},
  );
});

test('出满一批后 engineState.complete 与 phase 都被写对，否则产品永远显示未完成', async () => {
  const off = registerEngine({...LAB_ENGINE, createRun: () => ({})});
  try {
    const host = record(['a']), points = knowledgePoints(host);
    const plan = {count: 1, types: ['mcq'], strategies: [{id: 'understand'}], mode: 'practice',
      tasks: [{point: points[0], count: 1, type: 'mcq', strategy: 'understand'}], engine: 'r4-lab'};
    const run = createLabRun({pool: {call: model().call, concurrency: 2, snapshot: []}, records: [host]});
    const result = await run.generatePoints({plan, checkpoint: newEngineCheckpoint(plan), runId: 'complete',
      onCheckpoint: async () => {}, onQuestion: async () => {}});
    assert.equal(result.checkpoint.engineState.complete, true);
    assert.equal(result.checkpoint.phase, 'completed');
    // 产品就是靠这两个字段判定收尾的（question-bank.js 的 stored.state 那一行）。
    assert.equal(engineComplete({plan, checkpoint: result.checkpoint}), true);
    // actualTask 供 view() 覆盖任务行显示名，缺了它综合题会显示成第一个点。
    assert.equal(result.checkpoint.tasks[0].actualTask.pointId, points[0].id);
  } finally { off(); }
});

test('题目归属用图谱把节点 id 翻回知识点 id，不再恒判给第一个任务', async () => {
  const host = record(['a', 'b']), points = knowledgePoints(host);
  const resolved = resolveGraph({records: [host], points});
  const nodes = [];
  const walk = node => node.children.length ? node.children.forEach(walk) : nodes.push([node.id, node.point.id]);
  walk(resolved.root);
  // 只覆盖 b 的题必须归到 b，而不是因为「等于第一个任务」被归到 a。
  assert.deepEqual(coveredPoints({coveredNodeIds: [nodes[1][0]]}, resolved), [points[1].id]);
  // 综合题同时在两个节点上，两个点都要列出。
  assert.deepEqual(coveredPoints({coveredNodeIds: [nodes[0][0], nodes[1][0]]}, resolved), [points[0].id, points[1].id]);
  const banked = toBankQuestion({id: 'q2', type: 'mcq', coveredNodeIds: [nodes[1][0]]},
    {plan: {tasks: points.map((point, i) => ({point, count: 1, type: 'mcq', strategy: 'understand'}))}}, {}, resolved);
  assert.equal(banked.pointId, points[1].id);
});
