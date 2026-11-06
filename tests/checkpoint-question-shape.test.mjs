/**
 * 写进 checkpoint 的候选题必须带齐题库 schema 必需字段。
 *
 * # 锁住的事故（2026-10-31，真机 INVALID_RECORD）
 *
 * createNativeQuizRun 里 `accepted` 数组只加了 id/upstreamRunId/upstreamCommit
 * 三个字段，就被写进 engineState.batches（checkpoint 的一部分）。
 * 而 checkpoint 要过题库 schema，questions[i] 要求：
 *   courseId / subId / pointId / pointTitle / courseTitle / lessonTitle 都是非空字符串。
 *
 * 于是保存时报：
 *   questions.47.courseId: expected string, received undefined
 *   questions.47.subId:    ...
 * 整批被拒，界面上显示「题库格式无效」。
 *
 * 这些字段本来就能从 plan.tasks 的 point 拿到 —— 不是数据缺失，是没填。
 *
 * 用法：node tests/checkpoint-question-shape.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('.');
const load = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const RUNTIME = 'packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js';
const source = fs.readFileSync(path.resolve(RUNTIME), 'utf8');

/** 抽出 bankQuestion（它只依赖 randomUUID 与 pointIdentity）。 */
async function loadBankQuestion() {
  const start = source.indexOf('function bankQuestion(');
  assert.ok(start > 0, '找不到 bankQuestion');
  const end = source.indexOf('\nfunction ', start + 10);
  const body = source.slice(start, end > 0 ? end : undefined);
  const { pointIdentity } = await load('packages/dsh-zhiyun-core-quiz/src/concepts.js');
  const crypto = await import('node:crypto');
  return new Function('randomUUID', 'pointIdentity', `${body}; return bankQuestion;`)(crypto.randomUUID, pointIdentity);
}

const POINT = {
  id: 'kp:c1:s1:0:1',
  title: '概率论内容安排与随机现象引入',
  courseId: 'c1',
  subId: 's1',
  courseTitle: '概率论与数理统计',
  lessonTitle: '2026-09-17第3-5节',
  blockIndexes: [34, 35],
  page: 17,
  atSec: 1471,
  text: '讲义正文',
};

/** 题库 schema 对 questions[] 的必需字符串字段。 */
const REQUIRED_STRING_FIELDS = ['courseId', 'subId', 'pointId', 'pointTitle', 'courseTitle', 'lessonTitle'];

test('bankQuestion 产出带齐 schema 必需字段', async () => {
  const bankQuestion = await loadBankQuestion();
  const raw = {
    type: 'cloze', stem: '题干{{c1::答案}}', answer: '答案', explanation: '解析',
    choices: [], topic: '某个考点描述',
  };
  const q = bankQuestion(raw, { point: POINT, type: 'cloze', strategy: 'understand' }, {
    engine: 'deeptutor-native', mode: 'upstream-native', runId: 'r1', upstreamCommit: 'c1', resourceRevision: 'rev',
  });

  for (const f of REQUIRED_STRING_FIELDS) {
    assert.equal(typeof q[f], 'string', `${f} 必须是字符串，实际 ${typeof q[f]}`);
    assert.ok(q[f].length > 0, `${f} 不能为空`);
  }
  assert.equal(q.type, 'cloze');
  assert.equal(q.status, 'proposed');
  assert.deepEqual(q.attempts, []);
  assert.ok(Array.isArray(q.choices));
});

test('accepted 阶段就调用 bankQuestion（否则写进 checkpoint 的题缺字段）', () => {
  // 抓 accepted 数组的构造段
  const idx = source.indexOf('const accepted=[];');
  assert.ok(idx > 0, '找不到 accepted 构造段');
  const seg = source.slice(idx, idx + 1600);
  assert.match(seg, /bankQuestion\(/, 'accepted 里的题必须经过 bankQuestion 补齐归属字段');
  assert.match(seg, /courseId|pointIds|banked/, '应能看到归属字段的处理');
});

test('accepted 阶段不给 pointId 置 null（schema 要求非空字符串）', () => {
  const idx = source.indexOf('const accepted=[];');
  const seg = source.slice(idx, idx + 1600);
  assert.ok(
    !/pointId\s*=\s*null/.test(seg),
    'pointId 置 null 会让 schema 拒绝；应回退到本组 task.point 而不是清空',
  );
});

test('topic 与知识点标题不同时，保留为 topicHint 而不是覆盖 pointTitle', async () => {
  const bankQuestion = await loadBankQuestion();
  const q = bankQuestion(
    { type: 'cloze', stem: 'x{{c1::y}}', answer: 'y', explanation: 'e', choices: [], topic: '完全不同的考点描述' },
    { point: POINT, type: 'cloze', strategy: 'understand' },
    { engine: 'deeptutor-native', mode: 'upstream-native', runId: 'r', upstreamCommit: 'c', resourceRevision: 'rev' },
  );
  assert.equal(q.pointTitle, POINT.title, 'pointTitle 必须来自真实知识点');
  assert.notEqual(q.pointTitle, '完全不同的考点描述', '不能用上游 topic 覆盖知识点标题');
});
