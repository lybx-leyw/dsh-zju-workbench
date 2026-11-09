/**
 * 题库导出的笔记路径必须与讲义导出一致（含学期层）。
 *
 * # 锁住的问题（真机截图）
 *
 * 笔记库里同一门课出现了两个文件夹：
 *
 *   2026-2027 秋冬/概率论与数理统计/2026-09-17第3-5节   ← 讲义导出
 *   概率论与数理统计/2026-09-17第3-5节                  ← 题库导出
 *
 * 根因：笔记库目录是「学期 / 课程 / 节次」（见 core-handout 的 currentNotePath），
 * 讲义导出（handout-export）传了 `course.termName`，而题库导出没传 ——
 * 少了第一层，同一门课于是落在两个不同位置。
 *
 * # 修法分三处
 *
 *   1. `catalog()` 提取 course.termName（题目生成时能存下来）
 *   2. `bankQuestion()` 把它存进题目（新题自带）
 *   3. `bank-export` 对老题做一次回查兜底（那批题生成时还没有这个字段）
 *
 * 只修其中一处都不够：只修 1 → 老题仍然缺；只修 3 → 离线时仍然缺。
 *
 * 用法：node tests/export-path-parity.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('.');
const load = rel => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = p => fs.readFileSync(path.resolve(p), 'utf8');

const BANK = read('packages/core/study/src/question-bank.js');
const RUNTIME = read('packages/core/study/src/quiz-engine-runtime.js');
// 知识点是在 `core/quiz` 里产出的（`study` 只是调用方）。termName 从记录到 point
// 的那一步就在这里，所以断言要读这个文件。
const POINTS = read('packages/core/quiz/src/knowledge-points.js');

test('currentNotePath 有学期时是三层，无学期时是两层', async () => {
  const { currentNotePath } = await load('packages/core/handout/src/version.js');
  assert.equal(
    currentNotePath({ courseTitle: '概率论', lessonTitle: '第一节', termName: '2026 秋' }),
    '2026 秋/概率论/第一节',
  );
  assert.equal(
    currentNotePath({ courseTitle: '概率论', lessonTitle: '第一节', termName: '' }),
    '概率论/第一节',
  );
});

test('生成时把 course.termName 带进知识点（离线也拿得到学期）', () => {
  // ⚠️ 这条断言**换过对象**。它原先盯的是 `question-bank.js` 里的 `courseTerms` 变量，
  // 那个变量在 5b63f60a 的性能重构里被整个删掉了 —— 当时删的理由是
  // 「本地记录里本来就有 termName」，但那句话是错的：`knowledge` 的 record schema
  // 里没有这个字段。于是生成出来的题目 termName 恒为空，只剩导出时回查兜底，
  // 课堂接口不可达时题库就会落进比讲义少一层的目录。
  //
  // 现在契约是：`workbench.start()` 收下 `labels.termName` → 存进记录 →
  // `knowledgePoints()` 带到每个 point → `quiz-engine-runtime` 存进题目。
  // 所以断言要盯 `knowledge-points.js`，而且要用真实调用验证，不能只搜字符串。
  assert.match(POINTS, /termName:\s*record\.termName/,
    'knowledgePoints 必须把 record.termName 带到 point 上');
});

test('knowledgePoints 真的会把 termName 传出来（不是只写在源码里）', async () => {
  const { knowledgePoints } = await import('../packages/core/quiz/src/knowledge-points.js');
  // ⚠️ fixture 的形状要照 `knowledgePoints()` **真正读的**字段来写：
  //    它读 `record.lecture.chapters`（且 `generationVersion === 'architecture-v4'`）
  //    或 `record.semanticPlan`，**不读 `knowledgeTree`** —— 那是解析的输出，不是输入。
  //    第一版我写成 `knowledgeTree`，结果产出 0 个 point，
  //    而 `a[0]?.termName` 只会静默得到 `undefined`，看起来像通过。
  //    另外 topic 必须带 `sourceBlockIndexes`（或 `from`/`to`），否则匹配不到任何 block。
  const record = {
    courseId: 'c-1', subId: 's-1', courseTitle: '甲课', lessonTitle: '第一节',
    termName: '2026 秋', revision: 'r1',
    lecture: {
      generationVersion: 'architecture-v4',
      revision: 'r1',
      chapters: [{ title: '章', topics: [{ title: '点', text: '正文内容足够长', sourceBlockIndexes: [0] }] }],
    },
    blocks: [{ index: 0, text: '正文内容足够长', tag: { role: '主线' } }],
  };
  const points = knowledgePoints(record);
  assert.ok(points.length > 0, '这个 fixture 应当至少产出一个知识点');
  assert.equal(points[0].termName, '2026 秋', 'point 上要带 termName，否则题目存不下来');

  // 反向对照：记录上没有 termName 时不该凭空造一个
  const { termName: _drop, ...withoutTerm } = record;
  assert.equal(knowledgePoints(withoutTerm)[0].termName, '', '缺 termName 时留空，不要编');
});

test('bankQuestion 把 termName 存进题目', () => {
  assert.match(RUNTIME, /termName:p\.termName\?\?''/, '生成时记下来，导出才不用回查');
});

test('导出时对老题回查学期（那批题没有 termName）', () => {
  const idx = BANK.indexOf("if (method==='bank-export')");
  const body = BANK.slice(idx, BANK.indexOf("if (method==='bank-", idx + 10));
  assert.match(body, /needTerm/, '要先判断有没有缺的');
  assert.match(body, /listCourses/, '缺了才回查');
  assert.match(body, /termByCourse/, '回查结果按 courseId 索引');
});

test('回查失败不阻塞导出（拿不到就少一层，不编造学期）', () => {
  const idx = BANK.indexOf("if (method==='bank-export')");
  const body = BANK.slice(idx, BANK.indexOf("if (method==='bank-", idx + 10));
  assert.match(body, /catch\s*\{[^}]*不阻塞导出|catch\s*\{\s*\/\*/, '要有 try/catch 兜底');
  assert.match(body, /String\(q\.termName \?\? ''\)\.trim\(\) \|\| termByCourse/, '题目自带优先，回查其次');
});

test('splitByLesson 按题目自己的 termName 分组（一次导出可能跨学期）', async () => {
  const { splitByLesson } = await load('packages/core/study/src/quiz-export.js');
  const docs = splitByLesson({
    questions: [
      { courseTitle: '甲课', courseId: 'c-甲', subId: 's-1', lessonTitle: '第一节', termName: '2026 秋', pointTitle: 'p', stem: 'x', answer: 'y' },
      { courseTitle: '乙课', courseId: 'c-乙', subId: 's-2', lessonTitle: '第二节', termName: '2027 春', pointTitle: 'p', stem: 'x', answer: 'y' },
    ],
  });
  assert.equal(docs.length, 2);
  const terms = docs.map(d => d.termName).sort();
  assert.deepEqual(terms, ['2026 秋', '2027 春'], '不同学期的课不能共用同一个 termName');
});

test('调用方传入的 termName 作为兜底（题目完全没有时才用）', async () => {
  const { splitByLesson } = await load('packages/core/study/src/quiz-export.js');
  const docs = splitByLesson({
    questions: [{ courseTitle: '甲课', courseId: 'c-甲', subId: 's-1', lessonTitle: '第一节', pointTitle: 'p', stem: 'x', answer: 'y' }],
    termName: '2026 秋',
  });
  assert.equal(docs[0].termName, '2026 秋', '题目没有时用调用方的');
});

test('题目自带 termName 时优先于调用方', async () => {
  const { splitByLesson } = await load('packages/core/study/src/quiz-export.js');
  const docs = splitByLesson({
    questions: [{ courseTitle: '甲课', courseId: 'c-甲', subId: 's-1', lessonTitle: '第一节', termName: '题目自带', pointTitle: 'p', stem: 'x', answer: 'y' }],
    termName: '调用方给的',
  });
  assert.equal(docs[0].termName, '题目自带', '题目自带更可信');
});
