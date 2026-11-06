/**
 * 题目出处：从「模型回传的知识点 id」到「笔记 / PDF 里落在哪一节」的全链路。
 *
 * # 这份测试守的是什么
 *
 * 2026-10-31 真机事故：用户跨课程勾了多个知识点出题，导出的
 * `大学物理（乙）Ⅱ / 2026-10-08第6-8节 · 练习题` 里混着左偏堆、概率论、
 * 径向畸变、拉丁方设计。当时 12 道题**全部**被贴上物理的标签。
 *
 * 根因是三处串联，缺一处都复现不出来：
 *
 *   1. 上游不回出处 —— 产物只有 `topic`（模型自己写的一句话）；
 *   2. 运行时拿标题去猜 —— `points.find(p => p.title === topic) ?? point`，
 *      猜不中就落到**这一组的第一个知识点**，于是每道题都被盖上第一门课；
 *   3. 导出按名字分组 —— 错误标签一旦写进题库，导出会忠实地按它归类，
 *      看上去「按节次分好了」。
 *
 * 所以这里按这三处分别断言，并且**不依赖真实模型**：用假 tutor 直接喂
 * 「上游会返回什么」，用纯函数验「分组结果是什么」。
 *
 * # 判据
 *
 *   A. 跨课程混批：每题的 courseId/subId 与它回传的那个知识点一致
 *   B. 出处不可知：进【未分组】，不并进任何课程节次，也不丢题
 *   C. 同名不同 id：不合并（笔记与 PDF 两侧）
 *
 * 用法：node tests/quiz-source-provenance.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planEngineQuestions, newEngineCheckpoint } from '../packages/dsh-zhiyun-core-quiz/src/engines.js';
import { createNativeQuizRun, resolvePointById } from '../packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js';
import { splitByLesson, UNRESOLVED_LABEL } from '../packages/dsh-zhiyun-core-study/src/quiz-export.js';
import { buildQuizPdfOutline, UNRESOLVED_SECTION_LABEL } from '../packages/dsh-zhiyun-page-quiz/src/question-export-model.js';
import { parsePlan, splitTopicPoint } from '../packages/dsh-zhiyun-core-question/src/plan.js';
import { payloadToQaPair } from '../packages/dsh-zhiyun-core-question/src/quiz-payload.js';
import { toProductQuestions } from '../packages/dsh-zhiyun-core-question/src/product-questions.js';

/* ── 夹具 ─────────────────────────────────────────────────────────────── */

/** 一个知识点。`id` 是真实出处键（`课程:节次:版本:章:节` 形状）。 */
function point({ courseId, subId, courseTitle, lessonTitle, title, termName = '2026 秋', block = 1 }) {
  return {
    id: `${courseId}:${subId}:r:0:0`, courseId, subId, courseTitle, lessonTitle, termName,
    chapterTitle: '章', title, revision: 'r', blockIndexes: [block], page: block, atSec: block, text: '讲义原文',
  };
}

/** 三门不同课程、不同节次、知识点标题完全不同的点 —— 按标题猜必然失败。 */
const PHYS = point({ courseId: 'phys', subId: 's1', courseTitle: '大学物理（乙）Ⅱ', lessonTitle: '2026-10-08第6-8节', title: '电阻率与温度特性', block: 1 });
const CS = point({ courseId: 'cs', subId: 's9', courseTitle: '数据结构', lessonTitle: '2025-03-01第3-5节', title: '左偏堆', termName: '2026 春', block: 2 });
const PROB = point({ courseId: 'prob', subId: 's3', courseTitle: '概率论', lessonTitle: '2026-09-17第3-5节', title: '随机试验与样本空间', block: 3 });

/**
 * 假上游：`questions` 就是「模型返回了什么」。
 *
 * 走真实的 createNativeQuizRun 路径，所以被测的是产品代码，不是夹具自己的逻辑。
 */
function nativeRun({ questions }) {
  let sequence = 0;
  const tutor = {
    resources: { attach: async () => ({ handleId: 'h', revision: 'rev' }), release: async () => {} },
    runs: {
      start: async request => { await request.modelDispatch(async () => ({})); return { runId: `run-${++sequence}` }; },
      async *events() { yield { stage: 'quizzing' }; },
      result: async () => ({ status: 'succeeded', questions, upstreamCommit: 'fixture' }),
    },
  };
  return createNativeQuizRun({
    tutor,
    resources: { fromLecture: input => input },
    pool: { snapshot: [{ provider: 'p', model: 'm', workers: 1 }], concurrency: 1, execute: async () => ({}), base: {} },
    scope: 'fixture',
    backend: 'deeptutor',
  });
}

/** 跑一批，收下写进题库的题。 */
async function runBatch({ points, count, questions }) {
  const plan = planEngineQuestions(points, {
    engine: 'deeptutor-native', count, types: ['shortAnswer'],
    strategies: [{ id: 'recall', weight: 1 }], mode: 'uniform', source: 'course',
  });
  const saved = [];
  await nativeRun({ questions }).generatePoints({
    plan, existingQuestions: [], checkpoint: newEngineCheckpoint(plan),
    onCheckpoint: async () => {}, onQuestion: async q => { saved.push(q); },
  });
  return saved;
}

const q = (stem, pointId) => ({ type: 'shortAnswer', stem, answer: '答案', explanation: '解析', topic: stem, pointId });

/* ── A. 跨课程混批：各归各位 ─────────────────────────────────────────── */

test('A1 每道题按回传的知识点 id 归到自己的课程与节次', async () => {
  const saved = await runBatch({
    points: [PHYS, CS, PROB], count: 3,
    // 投影 id：t1-1/t1-2/t1-3 依次对应 PHYS/CS/PROB
    questions: [q('左偏堆合并的瓶颈是什么？', 't1-2'), q('随机试验的三条件？', 't1-3'), q('欧姆定律的微分形式？', 't1-1')],
  });
  assert.equal(saved.length, 3, '三道题都要入库');

  const [cs, prob, phys] = saved;
  assert.equal(cs.courseId, 'cs'); assert.equal(cs.lessonTitle, '2025-03-01第3-5节');
  assert.equal(prob.courseId, 'prob'); assert.equal(prob.lessonTitle, '2026-09-17第3-5节');
  assert.equal(phys.courseId, 'phys'); assert.equal(phys.lessonTitle, '2026-10-08第6-8节');
  // 旧实现会把这三道**全部**记成 PHYS —— 那正是事故本身。
  assert.equal(new Set(saved.map(row => row.courseId)).size, 3, '三道题必须落在三门课下，不能全归第一门');
  assert.equal(new Set(saved.map(row => row.pointId)).size, 3, '出处必须是三个不同的知识点');
});

test('A2 学期也跟着各自的课程走，不被第一门课抹平', async () => {
  const saved = await runBatch({
    points: [PHYS, CS], count: 2,
    questions: [q('数据结构题', 't1-2'), q('物理题', 't1-1')],
  });
  assert.equal(saved[0].termName, '2026 春');
  assert.equal(saved[1].termName, '2026 秋');
});

test('A3 直接按真实知识点 id 回传也认（不只认投影 id）', async () => {
  const saved = await runBatch({
    points: [PHYS, CS], count: 1,
    questions: [q('左偏堆', CS.id)],
  });
  assert.equal(saved[0].courseId, 'cs', '真实 id 必须优先精确命中');
});

test('A4 解析器对认不出的 id 返回 null，而不是猜一个', () => {
  const points = [PHYS, CS];
  assert.equal(resolvePointById('t1-2', points), CS);
  assert.equal(resolvePointById(CS.id, points), CS);
  assert.equal(resolvePointById('t2-1', points), null, '不存在的章不能反解成某个点');
  assert.equal(resolvePointById('t1-99', points), null, '越界下标不能回绕');
  assert.equal(resolvePointById('', points), null);
  assert.equal(resolvePointById(null, points), null);
  assert.equal(resolvePointById('随便一个 id', points), null);
});

/* ── B. 出处不可知：进【未分组】 ─────────────────────────────────────── */

test('B1 没回传出处的题进【未分组】，不并进第一门课，也不丢题', async () => {
  const saved = await runBatch({
    points: [PHYS, CS], count: 2,
    questions: [q('左偏堆', 't1-2'), q('说不出出处的题', null)],
  });
  assert.equal(saved.length, 2, '出处未知不等于丢题');
  const orphan = saved.find(row => row.provenanceUnresolved === true);
  assert.ok(orphan, '必须显式标记出处未确认');
  assert.equal(orphan.courseTitle, UNRESOLVED_LABEL);
  assert.equal(orphan.lessonTitle, UNRESOLVED_LABEL);
  assert.ok(!orphan.pointId.startsWith('cs:') && !orphan.pointId.startsWith('phys:'),
    '绝不能落回任何一个真实知识点');
  assert.equal(orphan.provenance.unresolvedReason, 'no-point-id');
});

test('B2 回了但认不出的 id 也进【未分组】，并记下它报的是哪个 id', async () => {
  const saved = await runBatch({
    points: [PHYS], count: 1,
    questions: [q('编了个 id 的题', 't9-9')],
  });
  assert.equal(saved[0].provenanceUnresolved, true);
  assert.equal(saved[0].provenance.unresolvedReason, 'unknown-point-id');
  assert.equal(saved[0].provenance.reportedPointId, 't9-9', '要留下它报了什么，排查才有线索');
});

test('B3 未分组的题在笔记与 PDF 里都单独成桶', async () => {
  const saved = await runBatch({
    points: [PHYS, CS], count: 2,
    questions: [q('左偏堆', 't1-2'), q('说不出出处', null)],
  });

  const docs = splitByLesson({ questions: saved });
  assert.equal(docs.length, 2, '一节 + 一份未分组');
  const orphanDoc = docs.find(doc => doc.unresolved === true);
  assert.ok(orphanDoc, '笔记侧要有明确的未分组那份');
  assert.equal(orphanDoc.lessonTitle, UNRESOLVED_LABEL);
  assert.equal(orphanDoc.count, 1);
  assert.ok(docs.some(doc => !doc.unresolved && doc.count === 1), '已归组的那份照常');

  const outline = buildQuizPdfOutline(saved);
  assert.equal(outline.sections.length, 2);
  const orphanSection = outline.sections.find(section => section.unresolved === true);
  assert.ok(orphanSection, 'PDF 侧也要有未分组那一段');
  assert.equal(orphanSection.lessonTitle, UNRESOLVED_SECTION_LABEL);
});

test('B4 未分组那份不带 quiz- 前缀（它不是一个正常节次）', async () => {
  const saved = await runBatch({ points: [PHYS], count: 1, questions: [q('无出处', null)] });
  const doc = splitByLesson({ questions: saved })[0];
  assert.ok(!doc.lessonTitle.startsWith('quiz-'), `不该长得像节次名：${doc.lessonTitle}`);
  assert.equal(doc.termName, '', '未分组不写学期 —— 编一个等于假装知道它属于哪一学期');
});

/* ── C. 同名不同 id：不合并 ─────────────────────────────────────────── */

/** 两条「同名但不同节次」的题 —— 现实中不同学期都会有「第3-5节」。 */
const sameName = () => ([
  { id: 'x1', courseId: 'c1', subId: 's1', courseTitle: '同名课', lessonTitle: '第3-5节', termName: '2026 秋', pointTitle: '甲', stem: 's1', answer: 'a', status: 'accepted' },
  { id: 'x2', courseId: 'c1', subId: 's2', courseTitle: '同名课', lessonTitle: '第3-5节', termName: '2027 春', pointTitle: '乙', stem: 's2', answer: 'b', status: 'accepted' },
]);

test('C1 同名课程、同名节次但 subId 不同：笔记里是两份', () => {
  const docs = splitByLesson({ questions: sameName() });
  assert.equal(docs.length, 2, '按名字分组会合并成一份 —— 那是错的');
  assert.deepEqual(docs.map(doc => doc.count), [1, 1]);
  assert.deepEqual(docs.map(doc => doc.termName).sort(), ['2026 秋', '2027 春']);
});

test('C2 同名课程、同名节次但 subId 不同：PDF 里是两段', () => {
  const outline = buildQuizPdfOutline(sameName());
  assert.equal(outline.sections.length, 2);
  assert.equal(outline.total, 2);
  // 题号仍然全文连续：分两段不代表重新编号
  assert.deepEqual(outline.items.map(item => item.number), [1, 2]);
});

test('C3 同名节次但 courseId 不同：也不合并', () => {
  const rows = [
    { id: 'y1', courseId: 'c1', subId: 's1', courseTitle: '甲课', lessonTitle: '第一节', pointTitle: 'p', stem: 'a', answer: 'a', status: 'accepted' },
    { id: 'y2', courseId: 'c2', subId: 's1', courseTitle: '乙课', lessonTitle: '第一节', pointTitle: 'p', stem: 'b', answer: 'b', status: 'accepted' },
  ];
  assert.equal(splitByLesson({ questions: rows }).length, 2);
  assert.equal(buildQuizPdfOutline(rows).sections.length, 2);
});

test('C4 同 id 的题仍然合并（分组没有变得过细）', () => {
  const rows = sameName().map(row => ({ ...row, id: row.id + '-k' }));
  const sameSection = [rows[0], { ...rows[0], id: 'x1-2', stem: 's1-2' }, rows[1]];
  assert.equal(splitByLesson({ questions: sameSection }).length, 2, '同一节的题必须仍然合并');
});

/* ── D. 出处从上游一路带到产品题 ─────────────────────────────────────── */

test('D1 plan 的 [pid=…] 前缀被剥出成 pointId，topic 只留正文', () => {
  assert.deepEqual(splitTopicPoint('[pid=t1-2] 左偏堆的合并瓶颈'), { pointId: 't1-2', topic: '左偏堆的合并瓶颈' });
  assert.deepEqual(splitTopicPoint('没写前缀'), { pointId: null, topic: '没写前缀' });
  // 前缀后面空着 = 没写清，整段仍当 topic，但出处为 null
  assert.deepEqual(splitTopicPoint('[pid=t1-2]'), { pointId: null, topic: '[pid=t1-2]' });
});

test('D2 parsePlan 保留 pointId，且去重按剥掉前缀后的正文', () => {
  const plan = parsePlan(JSON.stringify({
    templates: [
      { topic: '[pid=t1-2] 甲角度', question_type: 'choice', difficulty: 'easy' },
      { topic: '[pid=t1-9] 甲角度', question_type: 'choice', difficulty: 'easy' },
      { topic: '[pid=t1-1] 乙角度', question_type: 'choice', difficulty: 'easy' },
    ],
  }), { requested: 5 });
  assert.equal(plan.templates.length, 2, '同一个角度只留一条，即使 pid 不同');
  assert.deepEqual(plan.templates.map(t => t.pointId), ['t1-2', 't1-1']);
  assert.deepEqual(plan.templates.map(t => t.topic), ['甲角度', '乙角度']);
});

test('D3 pointId 从 template 一路带到产品题（不经过模型的自由发挥）', () => {
  const template = { question_id: 'q_1', topic: '甲角度', pointId: 't1-2', question_type: 'choice', difficulty: 'easy' };
  const pair = payloadToQaPair(template, { question: '题面', correct_answer: 'A', explanation: '解析' });
  assert.equal(pair.pointId, 't1-2');
  const [product] = toProductQuestions([pair]);
  assert.equal(product.pointId, 't1-2', '产品题对象上必须带得出处');
});

test('D4 template 没有 pointId 时，产品题上如实是 null（不是 undefined 冒充有值）', () => {
  const template = { question_id: 'q_1', topic: '甲', pointId: null, question_type: 'choice', difficulty: 'easy' };
  const [product] = toProductQuestions([payloadToQaPair(template, { question: 'q', correct_answer: 'A' })]);
  assert.equal(product.pointId, null);
});
