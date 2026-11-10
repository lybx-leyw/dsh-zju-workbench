/**
 * 拼题A 写操作的测试。
 *
 * # 这个文件为什么存在
 *
 * 审计代理发现 `pta` 的写操作是**死链**：`writes.js` 的 `examOf()` 从
 * `client.problemSet()` 取 `exam`，而那个方法**从不返回** `exam` ——
 * 于是两个写动作**无条件**报「题集还没开始作答」，与用户是否真的开始过无关。
 *
 * 同一个审计还发现第二处：`deadline` 是 `{ iso, text }` **对象**，
 * 而代码用 `Date.parse(对象)` → 恒 `NaN` → **截止时间校验从未生效**。
 *
 * 两处都已修。这个文件钉住它们 —— 没有这组测试，同样的错还能再犯一次，
 * 因为「工具注册了、审批通了」的表象看不出请求从未发出。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPtaWrites, groupBatches } from '../packages/source/pta/src/writes.js';

/**
 * 造一个假 client。
 *
 * @param overrides - 覆盖默认的只读方法。
 * @returns 假 client（记录 `send`）。
 */
function fakeClient(overrides = {}) {
  const sent = [];
  const base = {
    async problemSet() {
      return {
        id: 'set-1',
        name: '第一章练习',
        problemTypes: [],
        progress: null,
        // ⚠️ 关键：`exam` 与 `serverTime` 由 `problemSet()` 返回（补上的字段）。
        exam: { id: 'exam-9', problemSetId: 'set-1', ended: false },
        serverTime: '2026-11-10T12:00:00Z',
        examStatus: 'started',
      };
    },
    async problem(_setId, problemId) {
      const types = { p1: 'MULTIPLE_CHOICE', p2: 'PROGRAMMING', p3: 'SUBJECTIVE', p4: 'MULTIPLE_CHOICE' };
      return {
        id: problemId,
        label: `小题 ${problemId}`,
        type: types[problemId] ?? 'MULTIPLE_CHOICE',
        // ⚠️ 关键：`deadline` 是对象，不是字符串。
        deadline: { iso: '2026-12-01T00:00:00Z', text: '2026-12-01 08:00' },
      };
    },
    async get() {
      return { submissions: [] };
    },
    async send(path, options) {
      sent.push({ path, method: options?.method, body: options?.body });
      return { ok: true };
    },
  };
  return { ...base, ...overrides, sent };
}

test('examOf 不再死链：problemSet 带 exam 时能继续', async () => {
  const client = fakeClient();
  const api = createPtaWrites(client);
  // 不抛「还没开始作答」，就说明拿到了 exam。
  const summary = await api.saveAnswer.prepare({ homework: 'set-1', problem: 'p1', answer: 'A' });
  assert.match(summary, /保存答案/);
  assert.equal(client.sent.length, 0, '**Prepare 阶段绝不能发写请求**');
});

test('examOf：真的没开始作答时才报错，且说清怎么做', async () => {
  const client = fakeClient({
    async problemSet() {
      return { id: 'set-1', name: 'x', exam: null, serverTime: null, examStatus: null };
    },
  });
  const api = createPtaWrites(client);
  await assert.rejects(
    () => api.saveAnswer.prepare({ homework: 'set-1', problem: 'p1', answer: 'A' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /还没有开始作答/);
      assert.match(error.message, /网页上点「开始」/, '要指导下一步');
      return true;
    },
  );
});

test('examOf：已结束的题集要拒', async () => {
  const client = fakeClient({
    async problemSet() {
      return { id: 'set-1', exam: { id: 'exam-9', ended: true }, serverTime: null };
    },
  });
  const api = createPtaWrites(client);
  await assert.rejects(
    () => api.saveAnswer.prepare({ homework: 'set-1', problem: 'p1', answer: 'A' }),
    (e) => e.code === 'INVALID_ARGUMENT',
  );
});

test('保存：走 exam-draft，body 带 detail 与 saveAt', async () => {
  const client = fakeClient();
  const api = createPtaWrites(client);
  await api.saveAnswer.prepare({ homework: 'set-1', problem: 'p1', answer: 'A' });
  await api.saveAnswer.execute();

  const [call] = client.sent;
  assert.equal(call.method, 'POST');
  assert.match(call.path, /^\/api\/problem-sets\/problems\/p1\/exam-draft$/);
  assert.ok(call.body.answer.detail, '要有 detail');
  assert.ok(call.body.answer.saveAt, '要有 saveAt');
});

test('保存：不支持草稿的题型要拒（客观题只能正式提交）', async () => {
  const client = fakeClient({
    async problem() {
      return { id: 'p9', label: '主观', type: 'SUBJECTIVE', deadline: { iso: null, text: null } };
    },
  });
  const api = createPtaWrites(client);
  await assert.rejects(
    () => api.saveAnswer.prepare({ homework: 'set-1', problem: 'p9', answer: 'x' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /不支持存草稿/);
      return true;
    },
  );
});

test('提交：走 exam-submissions，路径用 exam.id 而不是题集 id', async () => {
  const client = fakeClient();
  const api = createPtaWrites(client);
  await api.submitAnswer.prepare({ homework: 'set-1', problem: 'p1', answer: 'A' });
  await api.submitAnswer.execute();

  const [call] = client.sent;
  assert.match(call.path, /^\/api\/exams\/exam-9\/exam-submissions$/,
    '必须用答题实例 id，用题集 id 会 404');
  assert.equal(call.body.details.length, 1);
});

test('截止时间校验真的生效：过期的小题要拒（这条以前恒 NaN 所以从没生效）', async () => {
  const client = fakeClient({
    async problem() {
      return {
        id: 'p1',
        label: '过期题',
        type: 'MULTIPLE_CHOICE',
        // 截止时间早于 serverTime（2026-11-10T12:00:00Z）
        deadline: { iso: '2026-11-01T00:00:00Z', text: '2026-11-01 08:00' },
      };
    },
  });
  const api = createPtaWrites(client);
  await assert.rejects(
    () => api.saveAnswer.prepare({ homework: 'set-1', problem: 'p1', answer: 'A' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /超过截止时间/);
      return true;
    },
  );
  assert.equal(client.sent.length, 0, '过期就不许发');
});

test('截止时间校验：没有 deadline 的长期练习集不该被误拒', async () => {
  const client = fakeClient({
    async problem() {
      return { id: 'p1', label: '长期开放', type: 'MULTIPLE_CHOICE', deadline: { iso: null, text: null } };
    },
  });
  const api = createPtaWrites(client);
  const summary = await api.saveAnswer.prepare({ homework: 'set-1', problem: 'p1', answer: 'A' });
  assert.match(summary, /保存答案/, '没有截止时间 ≠ 过期');
});

test('提交多题：任一题不合法都在首个写请求之前报出', async () => {
  let asked = 0;
  const client = fakeClient({
    async problem(_setId, problemId) {
      asked += 1;
      if (problemId === 'bad') return { id: 'bad', type: 'MULTIPLE_CHOICE', deadline: { iso: '2026-11-01T00:00:00Z' } };
      return { id: problemId, type: 'MULTIPLE_CHOICE', deadline: { iso: null } };
    },
  });
  const api = createPtaWrites(client);
  await assert.rejects(
      // 两题都给答案，让「截止」成为唯一可能的失败原因 ——
      // 否则第一题会先因缺答案报错，测不到想测的那条。
      () => api.submitAnswer.prepare({ homework: 'set-1', problems: ['p1', 'bad'], answer: 'A' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /超过截止时间/);
      return true;
    },
  );
  assert.equal(client.sent.length, 0, '**一个写请求都不许发**');
  assert.ok(asked >= 2, '要逐题查过才知道哪一题不合法');
});

test('groupBatches：聚类题型合并成一批，非聚类一题一批', () => {
  const prepared = [
    { problemId: 'p1', type: 'MULTIPLE_CHOICE', detail: { a: 1 } },
    { problemId: 'p4', type: 'MULTIPLE_CHOICE', detail: { a: 2 } },
    { problemId: 'p2', type: 'PROGRAMMING', detail: { b: 1 } },
  ];
  const batches = groupBatches(prepared, 'submit');
  assert.equal(batches.length, 2, '两个选择题合一批 + 编程题一批');

  const choice = batches.find((b) => b.type === 'MULTIPLE_CHOICE');
  assert.equal(choice.details.length, 2, '同题型的两题在同一批');
  assert.equal(choice.problemId, undefined, '聚类题型不带 problemId');

  const code = batches.find((b) => b.type === 'PROGRAMMING');
  assert.equal(code.details.length, 1);
  assert.equal(code.problemId, 'p2', '非聚类题型每批指向单题');
});

test('groupBatches：save 模式下只有非聚类题型走草稿', () => {
  const batches = groupBatches([
    { problemId: 'p1', type: 'MULTIPLE_CHOICE', detail: {} },
    { problemId: 'p2', type: 'PROGRAMMING', detail: {} },
  ], 'save');
  assert.equal(batches.find((b) => b.type === 'MULTIPLE_CHOICE').draft, false, '聚类题型一律正式提交');
  assert.equal(batches.find((b) => b.type === 'PROGRAMMING').draft, true, '编程题走草稿');
});

test('并发 Prepare 被拒（防止 A 批准 B 执行）', async () => {
  const client = fakeClient();
  const api = createPtaWrites(client);
  await api.saveAnswer.prepare({ homework: 'set-1', problem: 'p1', answer: 'A' });
  await assert.rejects(
    () => api.saveAnswer.prepare({ homework: 'set-1', problem: 'p2', answer: 'B' }),
    (error) => {
      assert.equal(error.code, 'WRITE_BUSY');
      return true;
    },
  );
});

test('没 Prepare 直接 Execute 报 NEED_PREPARE', async () => {
  const client = fakeClient();
  const api = createPtaWrites(client);
  await assert.rejects(() => api.saveAnswer.execute(), (e) => e.code === 'NEED_PREPARE');
  assert.equal(client.sent.length, 0);
});
