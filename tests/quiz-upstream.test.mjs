/**
 * 上游候选生成引擎契约的测试。
 *
 * 这一层的价值全在**失败的样子**上：上游不可用时要说出是哪一层不可用、
 * 上游返回了不认识的题型时不许静默吞掉、进度不许编造。所以下面的用例
 * 大多是在钉「坏情况下它怎么反应」，而不是「好情况下它返回什么」。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkCandidate, createUpstreamQuizEngine } from '../packages/dsh-zhiyun-core-quiz/src/upstream.js';

// ── 词表与语义 ────────────────────────────────────────────────────────────────

test('checkCandidate：本包词表内的四种题型都接受', () => {
  for (const type of ['cloze', 'mcq', 'trueFalse', 'shortAnswer']) {
    const verdict = checkCandidate({ type, stem: '题干', answer: type === 'trueFalse' ? true : 'A' });
    assert.equal(verdict.ok, true, `${type} 应该被接受：${JSON.stringify(verdict)}`);
  }
});

test('checkCandidate：上游 concept 映射过来的 trueFalse 通过，但 answer 必须是布尔语义', () => {
  // 上游 concept 的正确答案被规范成 "true"/"false"（不是"正确"/"错误"）
  for (const answer of [true, false, 'true', 'false', '正确', '错误']) {
    assert.equal(checkCandidate({ type: 'trueFalse', stem: 'x', answer }).ok, true, `answer=${answer}`);
  }
  // 判断题带了选项 → 说明上游那道题不是判断题，映射错了
  const bad = checkCandidate({ type: 'trueFalse', stem: 'x', answer: 'A' });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /判断题/);
});

test('checkCandidate：不认识的题型被拒且 reason 里带上游原值', () => {
  // 上游主流水线有 choice/fill_in_blank/short_answer/written/coding，
  // 适配器如果原样透传（没映射），这里必须拦住 —— 用错质检判据比不判更糟。
  for (const rawType of ['choice', 'fill_in_blank', 'written', 'coding', 'concept']) {
    const verdict = checkCandidate({ type: rawType, stem: 'x', answer: 'A', rawType });
    assert.equal(verdict.ok, false, `${rawType} 不应直接通过`);
    assert.match(verdict.reason, new RegExp(rawType));
  }
});

test('checkCandidate：缺题干 / 非对象 / 缺 type 都拒绝', () => {
  assert.equal(checkCandidate(null).ok, false);
  assert.equal(checkCandidate({ type: 'mcq' }).ok, false);
  assert.equal(checkCandidate({ stem: 'x' }).ok, false);
  assert.equal(checkCandidate({ type: 'mcq', stem: '   ' }).ok, false);
});

// ── 引擎构造 ──────────────────────────────────────────────────────────────────

test('createUpstreamQuizEngine：没有 tutor 时抛 CONFIG 并说清缺什么', () => {
  assert.throws(
    () => createUpstreamQuizEngine({}),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /zhiyunDeepTutor/);
      assert.match(error.message, /dsh-zhiyun-host-deeptutor/);
      // 关键：要明确说本包自己的路径不受影响，否则用户会以为整个出题坏了
      assert.match(error.message, /不该阻止本包自己的出题路径/);
      return true;
    },
  );
});

test('createUpstreamQuizEngine：concurrency 如实声明为 1（上游是串行的）', () => {
  const engine = createUpstreamQuizEngine({
    tutor: { runs: { start: async () => ({ runId: 'r1' }) } },
  });
  assert.equal(engine.concurrency, 1);
});

// ── 能力五态阻断 ──────────────────────────────────────────────────────────────

function tutorWithCapability(entry, runOverrides = {}) {
  const calls = { start: [], cancel: [] };
  return {
    calls,
    tutor: {
      capabilities: async () => [entry],
      runs: {
        start: async (request) => {
          calls.start.push(request);
          return { runId: 'run-1' };
        },
        events: async function* () {},
        result: async () => ({ questions: [] }),
        cancel: async (runId) => { calls.cancel.push(runId); return true; },
        ...runOverrides,
      },
    },
  };
}

test('generate：能力五态里任一 false 都在启动前拦住，并指出是哪一层', async () => {
  for (const layer of ['upstream', 'depsAvailable', 'configured', 'exposed']) {
    const { tutor, calls } = tutorWithCapability({
      name: 'deep_question',
      upstream: true,
      depsAvailable: true,
      configured: true,
      exposed: true,
      [layer]: false,
      reason: `${layer} 不通`,
    });
    const engine = createUpstreamQuizEngine({ tutor });
    await assert.rejects(engine.generate({}), (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, new RegExp(layer));
      assert.match(error.message, /deep_question/);
      return true;
    });
    // 关键：能力不可用时**一次 run 都不该起**（起来就要花模型钱）
    assert.equal(calls.start.length, 0, `${layer} 不可用时不该启动 run`);
  }
});

test('generate：上游没有这个能力时明确说没有，而不是空结果', async () => {
  const { tutor } = tutorWithCapability({ name: 'chat', upstream: true });
  const engine = createUpstreamQuizEngine({ tutor, capability: 'deep_question' });
  await assert.rejects(engine.generate({}), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /没有名为 deep_question 的能力/);
    return true;
  });
});

test('generate：verified 为 false 不阻断（它是"确实跑通过"，不是能用的前提）', async () => {
  const { tutor, calls } = tutorWithCapability({
    name: 'deep_question',
    upstream: true,
    depsAvailable: true,
    configured: true,
    exposed: true,
    verified: false,
  });
  const engine = createUpstreamQuizEngine({ tutor });
  const outcome = await engine.generate({});
  assert.equal(calls.start.length, 1);
  assert.deepEqual(outcome.questions, []);
});

// ── 结果归一与诊断 ────────────────────────────────────────────────────────────

test('generate：认识的候选进 questions，不认识的进 rejected 且带原因（不静默丢）', async () => {
  const { tutor } = tutorWithCapability(
    { name: 'deep_question', upstream: true, depsAvailable: true, configured: true, exposed: true },
    {
      result: async () => ({
        questions: [
          { type: 'mcq', stem: '选择题', answer: 'A' },
          { type: 'trueFalse', stem: '判断题', answer: 'true' },
          { type: 'fill_in_blank', stem: '上游原样没映射', answer: 'x', rawType: 'fill_in_blank' },
        ],
        usage: { inputTokens: 10, outputTokens: 20 },
        fingerprint: 'fp-1',
        resourceRevision: 'sha256:' + 'a'.repeat(64),
      }),
    },
  );
  const engine = createUpstreamQuizEngine({ tutor });
  const outcome = await engine.generate({});

  assert.equal(outcome.questions.length, 2);
  assert.equal(outcome.rejected.length, 1, '不认识的题型必须被记下来，不能悄悄少一道题');
  assert.match(outcome.rejected[0].reason, /fill_in_blank/);
  // 归因字段原样带回
  assert.deepEqual(outcome.usage, { inputTokens: 10, outputTokens: 20 });
  assert.equal(outcome.fingerprint, 'fp-1');
  assert.equal(outcome.runId, 'run-1');
});

test('generate：进度只转上游真实事件，缺 counts 时不编 done/total', async () => {
  const { tutor } = tutorWithCapability(
    { name: 'deep_question', upstream: true, depsAvailable: true, configured: true, exposed: true },
    {
      events: async function* () {
        yield { kind: 'stage', stage: 'exploring' };
        yield { kind: 'progress', stage: 'quiz', counts: { done: 3, total: 8 } };
        yield { kind: 'content', text: '不该变成进度' };
      },
    },
  );
  const engine = createUpstreamQuizEngine({ tutor });
  const seen = [];
  await engine.generate({ onProgress: (p) => seen.push(p) });

  assert.equal(seen.length, 2, 'content 类事件不该被当成进度');
  // 没有 counts 时 done/total 必须是 null，不能填 0 假装在动
  assert.deepEqual(
    { phase: seen[0].phase, done: seen[0].done, total: seen[0].total },
    { phase: 'exploring', done: null, total: null },
  );
  assert.deepEqual(
    { phase: seen[1].phase, done: seen[1].done, total: seen[1].total },
    { phase: 'quiz', done: 3, total: 8 },
  );
  assert.equal(seen[0].source, 'upstream');
});

test('generate：上游没给 runId 时抛 UPSTREAM，不返回一个追不到的壳', async () => {
  const { tutor } = tutorWithCapability(
    { name: 'deep_question', upstream: true, depsAvailable: true, configured: true, exposed: true },
    { start: async () => ({}) },
  );
  const engine = createUpstreamQuizEngine({ tutor });
  await assert.rejects(engine.generate({}), (error) => {
    assert.equal(error.code, 'UPSTREAM');
    assert.match(error.message, /runId/);
    return true;
  });
});

test('generate：信号在启动前就已 abort → 一次 run 都不起（不花冤枉钱）', async () => {
  const { tutor, calls } = tutorWithCapability(
    { name: 'deep_question', upstream: true, depsAvailable: true, configured: true, exposed: true },
  );
  const engine = createUpstreamQuizEngine({ tutor });
  const controller = new AbortController();
  controller.abort();
  const pending = engine.generate({ signal: controller.signal });
  await assert.rejects(pending);
  assert.deepEqual(calls.start, [], '用户已经走了，不该再起一次会花钱的 run');
});

test('generate：跑到一半取消 → 尽力取消上游 run', async () => {
  const { tutor, calls } = tutorWithCapability(
    { name: 'deep_question', upstream: true, depsAvailable: true, configured: true, exposed: true },
    {
      events: async function* () {
        // 模拟一个长时间不结束的上游：取消必须能让这里停下
        await new Promise((resolve) => setTimeout(resolve, 200));
        yield { kind: 'stage', stage: 'quiz' };
      },
    },
  );
  const engine = createUpstreamQuizEngine({ tutor });
  const controller = new AbortController();
  const pending = engine.generate({ signal: controller.signal });

  // 等 run 真的起来了再取消 —— 这样才测到「取消在飞的 run」，而不是「启动前就拦掉了」
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.start.length, 1, 'run 应该已经起来了');
  controller.abort();

  await assert.rejects(pending);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls.cancel, ['run-1'], '用户取消之后必须告诉上游停下（否则白花钱）');
});

test('dispose：幂等，并取消在飞的 run', async () => {
  const { tutor, calls } = tutorWithCapability(
    { name: 'deep_question', upstream: true, depsAvailable: true, configured: true, exposed: true },
    {
      events: async function* () {
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
    },
  );
  const engine = createUpstreamQuizEngine({ tutor });
  void engine.generate({});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(engine.active, 1);

  await engine.dispose();
  await engine.dispose(); // 第二次不该抛
  assert.equal(engine.closed, true);
  assert.deepEqual(calls.cancel, ['run-1']);
  await assert.rejects(engine.generate({}), (error) => error.code === 'DISPOSED');
});

test('资源句柄与运行选项原样交给上游（资源版本要能回溯到终稿）', async () => {
  const handle = { handleId: 'h1', resourceId: 'res-1', revision: 'sha256:' + 'b'.repeat(64) };
  const { tutor, calls } = tutorWithCapability(
    { name: 'deep_question', upstream: true, depsAvailable: true, configured: true, exposed: true },
    { result: async () => ({ questions: [], resourceRevision: handle.revision }) },
  );
  const engine = createUpstreamQuizEngine({
    tutor,
    resourceHandle: handle,
    options: { options: { count: 5 }, scope: { accountId: 'a1' } },
  });
  const outcome = await engine.generate({});

  assert.deepEqual(calls.start[0].resourceHandles, [handle]);
  assert.equal(calls.start[0].capability, 'deep_question');
  assert.deepEqual(calls.start[0].options.options, { count: 5 });
  assert.deepEqual(calls.start[0].scope, { accountId: 'a1' });
  assert.equal(outcome.resourceRevision, handle.revision);
});
