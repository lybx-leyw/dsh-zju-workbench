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

const BANK = read('packages/dsh-zhiyun-core-study/src/question-bank.js');
const RUNTIME = read('packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js');

test('currentNotePath 有学期时是三层，无学期时是两层', async () => {
  const { currentNotePath } = await load('packages/dsh-zhiyun-core-handout/src/version.js');
  assert.equal(
    currentNotePath({ courseTitle: '概率论', lessonTitle: '第一节', termName: '2026 秋' }),
    '2026 秋/概率论/第一节',
  );
  assert.equal(
    currentNotePath({ courseTitle: '概率论', lessonTitle: '第一节', termName: '' }),
    '概率论/第一节',
  );
});

test('catalog 会提取 course.termName', () => {
  assert.match(BANK, /courseTerms\s*=\s*new Map\(courses\.map\(course=>\[String\(course\.id\),course\.termName/,
    '不提取 termName，题目生成时就存不下来');
});

test('catalog 产出的 point 带 termName', () => {
  const idx = BANK.indexOf('termName:courseTerms.get(record.courseId)');
  assert.ok(idx > 0, 'point 上要带 termName，否则 bankQuestion 取不到');
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
  const { splitByLesson } = await load('packages/dsh-zhiyun-core-study/src/quiz-export.js');
  const docs = splitByLesson({
    questions: [
      { courseTitle: '甲课', lessonTitle: '第一节', termName: '2026 秋', pointTitle: 'p', stem: 'x', answer: 'y' },
      { courseTitle: '乙课', lessonTitle: '第二节', termName: '2027 春', pointTitle: 'p', stem: 'x', answer: 'y' },
    ],
  });
  assert.equal(docs.length, 2);
  const terms = docs.map(d => d.termName).sort();
  assert.deepEqual(terms, ['2026 秋', '2027 春'], '不同学期的课不能共用同一个 termName');
});

test('调用方传入的 termName 作为兜底（题目完全没有时才用）', async () => {
  const { splitByLesson } = await load('packages/dsh-zhiyun-core-study/src/quiz-export.js');
  const docs = splitByLesson({
    questions: [{ courseTitle: '甲课', lessonTitle: '第一节', pointTitle: 'p', stem: 'x', answer: 'y' }],
    termName: '2026 秋',
  });
  assert.equal(docs[0].termName, '2026 秋', '题目没有时用调用方的');
});

test('题目自带 termName 时优先于调用方', async () => {
  const { splitByLesson } = await load('packages/dsh-zhiyun-core-study/src/quiz-export.js');
  const docs = splitByLesson({
    questions: [{ courseTitle: '甲课', lessonTitle: '第一节', termName: '题目自带', pointTitle: 'p', stem: 'x', answer: 'y' }],
    termName: '调用方给的',
  });
  assert.equal(docs[0].termName, '题目自带', '题目自带更可信');
});
