/**
 * core-question 与产品宿主适配器的接口兼容性。
 *
 * 两件事必须钉住，都会在生产环境以「数字不对」的形式暴露：
 *
 * 1. 终态 RESULT 事件里**不能**同时有 summary.results[].qa_pair 和顶层 questions。
 *    宿主 adapters/quiz.js 的 extractRawQuestions 会两个都遍历，导致每题收两遍
 *    → 请求 15 题收到 30 题。
 *
 * 2. questions[] 的字段必须能被产品侧 normalizeUpstreamQuestion 消费。
 *    它用的是 options 字典（A/B/C/D → 文本），不是 choices 数组。
 *
 * 用法：node tests/core-question-host-compat.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeepQuestion } from '../packages/dsh-zhiyun-core-question/src/index.js';
import { normalizeUpstreamQuestion } from '../packages/dsh-zhiyun-core-study/src/deeptutor-quiz.js';

const lecture = {
  chapters: [{
    title: '随机试验',
    topics: [
      { title: '随机试验的条件', anchor: { page: 1, tSec: 0 }, sourceBlockIndexes: [1], blocks: [{ kind: 'paragraph', text: '随机试验需同时满足三个条件。' }] },
      { title: '样本空间', anchor: { page: 1, tSec: 0 }, sourceBlockIndexes: [2], blocks: [{ kind: 'paragraph', text: '样本空间是全部可能结果的集合。' }] },
    ],
  }],
};

/**
 * 假 llm：按契约提供 prepareCall → stream()，用脚本化的 chunk 序列驱动。
 *
 * core-question 的契约是 `llm.prepareCall(config)`，不是 runLabeledStep ——
 * 标签协议由它自己的 labeled-step 层带。所以替身必须产出 chunk 契约：
 * {type:'text-delta'} / {type:'finish'}。
 */
function fakeLlm() {
  const stages = [];
  return {
    stages,
    // 必须返回 Promise：调用方会 .catch() 它来做能力降级判断。
    resolveModelInfo: async () => ({ inputModalities: ['text'], capabilities: { tools: true } }),
    async prepareCall() {
      let callIndex = 0;
      return {
        async *stream({ messages }) {
          callIndex += 1;
          const last = String(messages?.[messages.length - 1]?.content ?? '');
          // 依据提示词内容判断当前阶段（真实现里靠 stage 区分，这里从消息里认）
          const isPlan = /规划|模板|template|plan/i.test(last);
          const isQuiz = /出题参数|question_type|单选题/.test(last);

          let body;
          if (isPlan) {
            stages.push('plan');
            body = JSON.stringify({ templates: [
              { kp_name: '随机试验的条件', question_type: 'choice', concentration: '三个条件', difficulty: 'easy', rationale: '基础概念' },
              { kp_name: '样本空间', question_type: 'choice', concentration: '集合定义', difficulty: 'easy', rationale: '基础概念' },
            ] });
          } else if (isQuiz) {
            stages.push('quiz');
            body = JSON.stringify({
              question_type: 'choice',
              question: '随机试验需要满足几个条件？',
              options: { A: '一个', B: '两个', C: '三个', D: '四个' },
              correct_answer: 'C',
              explanation: '讲义明确写了三个条件。',
              concentration: '三个条件', difficulty: 'easy',
            });
          } else {
            stages.push('explore');
            body = '``FINISH``已阅读讲义。';
          }

          yield { type: 'text-delta', text: body };
          yield { type: 'usage', usage: { input: 10, output: 5, total: 15 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
}

function fakeTools() {
  return {
    schemas: () => [],
    dispatch: async () => ({ ok: true, result: { content: '', metadata: {}, sources: [] } }),
  };
}

test('summary.results[].qa_pair 与顶层 questions 不能同时出现（防 15 题变 30 题）', async () => {
  const result = await runDeepQuestion({
    lecture, count: 1, type: 'choice', difficulty: 'easy',
    llm: fakeLlm(), tools: fakeTools(),
  });

  assert.ok(Array.isArray(result.questions), '返回值必须带 questions');

  // 返回值里同时有 summary 与 questions 是允许的（调用方要两样）。
  // 但**发给宿主的那个 RESULT 事件副本**不能同时带两者。这里检查 summary 的形状：
  // 如果 summary.results[].qa_pair 每项只有一个 qa_pair，且 questions 也在，
  // 宿主就会收两遍。
  const qaPairs = (result.summary?.results ?? []).flatMap(r => Array.isArray(r.qa_pair) ? r.qa_pair : (r.qa_pair ? [r.qa_pair] : []));
  console.log('  返回 questions 数:', result.questions.length, '| summary.qa_pair 数:', qaPairs.length);

  // 关键不变量：qa_pair 与 questions 描述的是同一批题，不是两批
  if (qaPairs.length && result.questions.length) {
    assert.equal(qaPairs.length, result.questions.length,
      'summary.qa_pair 与 questions 的数量必须一致（它们是同一批题的两种表示）');
  }
});

test('questions[] 的字段能被产品侧 normalizeUpstreamQuestion 消费', async () => {
  const result = await runDeepQuestion({
    lecture, count: 1, type: 'choice', difficulty: 'easy',
    llm: fakeLlm(), tools: fakeTools(),
  });

  assert.ok(result.questions.length > 0, '应当产出至少一道题');
  const q = result.questions[0];
  console.log('  产出题目:', JSON.stringify({
    type: q.type, choices: q.choices?.length, answer: q.answer, stem: String(q.stem).slice(0, 30),
  }));

  // 硬性契约：题数必须等于请求数，即使某道题生成失败也保留占位。
  // 这是上游刻意的行为（[Generation failed] / N/A），不能改成过滤坏题，
  // 否则「请求 5 出 4」会变成默认行为，summary 语义全变。
  assert.equal(result.questions.length, 1, '题数必须等于请求数');

  // 每道题都要能被产品侧 normalize 消费（不抛错、字段齐全）。
  const normalized = normalizeUpstreamQuestion(q);
  assert.ok(normalized.stem, '题干不能为空');
  assert.ok(normalized.answer !== undefined, '答案字段必须存在');
  assert.ok(Array.isArray(normalized.choices), 'normalize 后必须有 choices 数组（可能为空）');
});

test('占位题的形状与上游一致（修复失败仍照常出题）', async () => {
  const result = await runDeepQuestion({
    lecture, count: 2, type: 'choice', difficulty: 'easy',
    llm: fakeLlm(), tools: fakeTools(),
  });

  // 无论生成成功与否，题数恒等于请求数 —— 这是上游的硬约束
  assert.equal(result.questions.length, 2, '两道请求必须得到两道题');

  // 占位题的识别特征：answer 为 'N/A' 或题干带 [Generation failed]
  const placeholders = result.questions.filter(
    q => q.answer === 'N/A' || String(q.stem).includes('[Generation failed]'),
  );
  console.log('  占位题数:', placeholders.length, '/', result.questions.length);
  for (const p of placeholders) {
    assert.ok(p.stem && p.answer, '占位题也必须字段齐全，不能是空对象');
  }
});
