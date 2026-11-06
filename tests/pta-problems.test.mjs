/**
 * 拼题A 的**看题**能力：题集详情、题目列表、题面原文、做题进度。
 *
 * 这四项原先只在 omni（TypeScript 移植岗）里有。移植时保留了两条口径：
 *
 *  - 题面原文是 **PTA 原始 Markdown**（含 LaTeX），支持分页读，不截断成摘要；
 *  - 全流程**只读** —— 不提交代码、不开始考试、不创建提交记录。
 *
 * 测试用假 transport，不联网。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PtaApi, ptaId, PTA_TYPE_LABELS, PTA_PROBLEM_TYPES,
} from '../packages/dsh-zhiyun-source-campus/src/pta.js';

const json = (value, status = 200) => ({
  status, headers: new Headers({ 'content-type': 'application/json' }), text: JSON.stringify(value),
});

/** 记录请求并按路径回包 —— 形状必须是 Transport.request 的 `{ status, headers, text }`。 */
function fakeTransport(routes) {
  const calls = [];
  return {
    calls,
    request: async (url, init) => {
      const target = String(url);
      calls.push({ url: target, method: init?.method ?? 'GET' });
      for (const [match, handler] of routes) {
        if (target.includes(match)) return handler(target);
      }
      return json({});
    },
  };
}

const PTA_COOKIE = ['PTASESSION=abc; Domain=.pintia.cn; Path=/', 'https://pintia.cn/'];

/* ────────────────────────────────────── id 校验 */

test('题集/题目 id 必须是数字串（挡住路径穿越与非数字）', () => {
  assert.equal(ptaId('123'), '123');
  assert.equal(ptaId(456), '456');
  assert.equal(ptaId(' 789 '), '789');
  for (const bad of ['', 'abc', '12/34', '../1', '1.5', null, undefined]) {
    assert.throws(() => ptaId(bad), (error) => {
      assert.equal(error.code, 'INVALID_ID', `bad=${bad}`);
      return true;
    });
  }
});

test('题型标签覆盖全部枚举，且没有遗漏', () => {
  for (const type of PTA_PROBLEM_TYPES) {
    assert.ok(PTA_TYPE_LABELS[type], `${type} 缺中文标签`);
  }
  assert.equal(Object.keys(PTA_TYPE_LABELS).length, PTA_PROBLEM_TYPES.length);
});

/* ────────────────────────────────────── 题集详情 */

test('题集详情：给出题型分布与我的进度', async () => {
  const transport = fakeTransport([
    ['/exam-problems', () => json({ problemSet: { name: '第三章作业', description: '本周题集' } })],
    ['/problem-summaries', () => json({
      summaries: {
        PROGRAMMING: { total: 3, totalScore: 60 },
        MULTIPLE_CHOICE: { total: 5, totalScore: 40 },
      },
    })],
    ['/exam-problem-status', () => json({
      problemStatus: [
        { id: '1', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
        { id: '2', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
        { id: '3', problemSubmissionStatus: 'PROBLEM_WRONG_ANSWER' },
        { id: '4', problemSubmissionStatus: 'PROBLEM_NO_SUBMISSION' },
      ],
    })],
  ]);

  const out = await new PtaApi(transport).problemSet('100');
  assert.equal(out.name, '第三章作业');
  assert.equal(out.description, '本周题集');
  assert.deepEqual(out.problemTypes.map((t) => t.type), ['PROGRAMMING', 'MULTIPLE_CHOICE']);
  assert.equal(out.problemTypes[0].label, '编程题');
  assert.equal(out.problemTypes[0].total, 3);
  assert.deepEqual(out.progress, {
    total: 4,
    accepted: 2,
    byStatus: {
      PROBLEM_ACCEPTED: 2,
      PROBLEM_WRONG_ANSWER: 1,
      PROBLEM_NO_SUBMISSION: 1,
    },
  });
});

test('题集详情：进度拿不到时不算失败（题集仍可读）', async () => {
  const transport = fakeTransport([
    ['/exam-problems', () => json({ problemSet: { name: '匿名可读' } })],
    ['/problem-summaries', () => json({ summaries: { PROGRAMMING: { total: 1 } } })],
    ['/exam-problem-status', () => ({ status: 403, headers: new Headers(), text: '{}' })],
  ]);
  const out = await new PtaApi(transport).problemSet('100');
  assert.equal(out.name, '匿名可读');
  assert.equal(out.progress, null, '拿不到进度就是 null，不是 0');
});

/* ────────────────────────────────────── 题目列表 */

test('题目列表：带上我的提交状态，翻页信息正确', async () => {
  const transport = fakeTransport([
    ['/exam-problem-list', () => json({
      total: 60,
      problemSetProblems: [
        { id: '11', label: 'A', title: '第一题', score: 20, acceptCount: 5, submitCount: 9, deadline: '2026-10-30T15:59:00+08:00' },
        { id: '12', label: 'B', title: '第二题', score: 20 },
      ],
    })],
    ['/exam-problem-status', () => json({
      problemStatus: [
        { id: '11', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
        { id: '12', problemSubmissionStatus: 'PROBLEM_NO_SUBMISSION' },
      ],
    })],
  ]);

  const out = await new PtaApi(transport).problems('100', { problemType: 'PROGRAMMING', limit: 50 });
  assert.equal(out.problemType, 'PROGRAMMING');
  assert.equal(out.typeLabel, '编程题');
  assert.equal(out.total, 60);
  assert.equal(out.nextPage, 2, '60 > 50 还有下一页');

  assert.equal(out.problems[0].myStatus, 'PROBLEM_ACCEPTED');
  assert.equal(out.problems[1].myStatus, 'PROBLEM_NO_SUBMISSION');
  assert.equal(out.problems[0].deadline.iso, '2026-10-30T07:59:00.000Z', '时间要归一成 UTC');
});

test('题目列表：不指定题型时按 summaries 挑第一个可用题型', async () => {
  let listUrl = null;
  const transport = fakeTransport([
    ['/problem-summaries', () => json({ summaries: { FILL_IN_THE_BLANK: { total: 2 } } })],
    ['/exam-problem-list', (url) => { listUrl = url; return json({ problemSetProblems: [] }); }],
    ['/exam-problem-status', () => json({ problemStatus: [] })],
  ]);

  const out = await new PtaApi(transport).problems('100');
  assert.equal(out.problemType, 'FILL_IN_THE_BLANK');
  assert.ok(listUrl.includes('problem_type=FILL_IN_THE_BLANK'), `实际 ${listUrl}`);
});

test('题目列表：一个题型都没有时返回空结构，不抛错', async () => {
  const transport = fakeTransport([
    ['/problem-summaries', () => json({ summaries: {} })],
  ]);
  const out = await new PtaApi(transport).problems('100');
  assert.equal(out.problemType, null);
  assert.deepEqual(out.problems, []);
  assert.equal(out.nextPage, null);
});

test('题目列表：拿不到提交状态时 myStatus 为 null（不当成未做）', async () => {
  const transport = fakeTransport([
    ['/exam-problem-list', () => json({
      total: 1,
      problemSetProblems: [{ id: '11', title: '匿名题' }],
    })],
    ['/exam-problem-status', () => ({ status: 403, headers: new Headers(), text: '{}' })],
  ]);
  const out = await new PtaApi(transport).problems('100', { problemType: 'PROGRAMMING' });
  assert.equal(out.problems[0].myStatus, null);
});

/* ────────────────────────────────────── 题面详情 */

test('题面：返回原始 Markdown，并按 offset/maxCharacters 分页', async () => {
  const content = 'A'.repeat(100);
  const transport = fakeTransport([
    ['/exam-problems/11', () => json({
      problemSetProblem: {
        label: 'A', title: '第一题', type: 'PROGRAMMING', score: 20,
        author: '出题人', organization: { name: '浙江大学' },
        content,
        problemConfig: { programmingProblemConfig: { timeLimit: 400, memoryLimit: 65536, codeSizeLimit: 16 } },
        compiler: 'GCC',
        deadline: '2026-10-30T15:59:00+08:00',
      },
      organization: { name: '浙江大学' },
    })],
  ]);

  const api = new PtaApi(transport);
  const head = await api.problem('100', '11', { maxCharacters: 40 });
  assert.equal(head.content.length, 40);
  assert.equal(head.totalCharacters, 100);
  assert.equal(head.nextOffset, 40);
  assert.equal(head.timeLimitMs, 400);
  assert.equal(head.memoryLimitKb, 65536);
  assert.equal(head.typeLabel, '编程题');
  assert.match(head.url, /problemSetProblemId=11/, '要给出可跳转的网页地址');

  const tail = await api.problem('100', '11', { offset: 40 });
  assert.equal(tail.content.length, 60);
  assert.equal(tail.nextOffset, null);
  assert.equal(head.content + tail.content, content, '分页拼接必须等于原文');
});

test('题面：缺 problemSetProblem 时如实报结构异常', async () => {
  const transport = fakeTransport([['/exam-problems/11', () => json({})]]);
  await assert.rejects(() => new PtaApi(transport).problem('100', '11'), (error) => {
    assert.equal(error.code, 'API_SHAPE');
    return true;
  });
});

/* ────────────────────────────────────── 进度 */

test('进度：按状态分组统计', async () => {
  const transport = fakeTransport([
    ['/exam-problem-status', () => json({
      problemStatus: [
        { id: '1', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
        { id: '2', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
        { id: '3', problemSubmissionStatus: 'PROBLEM_WRONG_ANSWER' },
      ],
    })],
  ]);
  const out = await new PtaApi(transport).progress('100');
  assert.equal(out.total, 3);
  assert.equal(out.accepted, 2);
  assert.equal(out.byStatus.PROBLEM_WRONG_ANSWER, 1);
});

test('进度：响应里没有 problemStatus 时返回 null', async () => {
  const transport = fakeTransport([['/exam-problem-status', () => json({})]]);
  assert.equal(await new PtaApi(transport).progress('100'), null);
});

/* ────────────────────────────────────── 只读边界 */

test('看题全程只发 GET，不出现任何写操作', async () => {
  const transport = fakeTransport([
    ['/exam-problems', () => json({ problemSet: { name: 'x' } })],
    ['/problem-summaries', () => json({ summaries: {} })],
    ['/exam-problem-status', () => json({ problemStatus: [] })],
    ['/exam-problem-list', () => json({ problemSetProblems: [] })],
  ]);
  const api = new PtaApi(transport);
  await api.problemSet('100');
  await api.problems('100', { problemType: 'PROGRAMMING' });
  await api.progress('100');

  assert.ok(transport.calls.length > 0);
  for (const call of transport.calls) {
    assert.equal(call.method, 'GET', `出现了非 GET 请求：${call.method} ${call.url}`);
  }
});

test('看题的 id 校验在发请求之前就拦住非法输入', async () => {
  const transport = fakeTransport([]);
  const api = new PtaApi(transport);
  await assert.rejects(() => api.problem('../etc', '11'), (e) => e.code === 'INVALID_ID');
  await assert.rejects(() => api.problems('abc'), (e) => e.code === 'INVALID_ID');
  assert.equal(transport.calls.length, 0, '非法 id 不该打到网络');
});
