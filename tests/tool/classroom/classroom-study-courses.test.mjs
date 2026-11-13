/**
 * `study_courses` 与 `matchCourses` 的测试。
 *
 * # 这份测试守的是什么
 *
 * 用户的原始抱怨是「AI 找不到某门课，跑很久」。根因有两层：
 *
 *   1. **没有入口索引** —— `study_catalog` 只列已整理的课，未整理的课不存在；
 *   2. **只按编号查** —— AI 手里只有课名，没法定位。
 *
 * 所以这里要钉住三件事：
 *
 * | # | 断言 | 为什么 |
 * | --- | --- | --- |
 * | 1 | 未整理的课也出现在结果里，且 `state` 如实 | 否则「看不到」还是会发生 |
 * | 2 | 课名能定位到课程 | 用户不会背 courseId |
 * | 3 | 同名课跨学期**不猜**，返回多个候选 | 猜错就是问牛答马 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStudyCoursesTools, indexRecords, matchCourses } from '../../../packages/tool/classroom/src/study-courses.js';

/** 造一套假服务：classroom 给课程与节次，study 给知识库记录。 */
function fixture({ courses = [], lessons = {}, records = [] } = {}) {
  return {
    zwStudy: {
      ready: Promise.resolve(),
      user: async () => ({ id: 'u1' }),
      knowledge: { listByAccount: async () => records },
    },
    zwClassroom: {
      listCourses: async () => ({ items: courses }),
      listLessons: async (courseId) => ({ items: lessons[courseId] ?? [] }),
    },
  };
}

/** 取工具并跑一次。 */
async function run(services, args = {}) {
  const [tool] = createStudyCoursesTools(services);
  return tool.run(args, {});
}

/* ────────────────────────── indexRecords ────────────────────────── */

test('indexRecords：有讲义标 wiki，只有块标 raw，都没有就不出现', () => {
  const index = indexRecords([
    { courseId: 'c1', subId: 's1', lecture: { title: '第一讲' }, blocks: [{}, {}] },
    { courseId: 'c1', subId: 's2', lecture: null, blocks: [{}] },
    { courseId: 'c1', subId: 's3', lecture: null, blocks: [] },
  ]);
  const c1 = index.get('c1');
  assert.equal(c1.get('s1').state, 'wiki');
  assert.equal(c1.get('s1').title, '第一讲', '有讲义时要带标题，模型才知道里面是什么');
  assert.equal(c1.get('s2').state, 'raw');
  assert.equal(c1.get('s3').state, 'none');
});

test('indexRecords：坏记录跳过，不污染索引', () => {
  const index = indexRecords([
    null,
    { courseId: '', subId: 's1' },
    { courseId: 'c1', subId: '' },
    { courseId: 'c1', subId: 's1', lecture: null, blocks: [] },
  ]);
  assert.equal(index.size, 1);
  assert.equal(index.get('c1').size, 1);
});

/* ────────────────────────── matchCourses ────────────────────────── */

test('matchCourses：完全同名优先于片段命中', () => {
  const courses = [
    { id: '1', title: '大学物理（荣誉）', termName: '2025-2026 秋冬' },
    { id: '2', title: '大学物理', termName: '2025-2026 春夏' },
  ];
  const hits = matchCourses(courses, '大学物理');
  assert.equal(hits.length, 1, '有完全同名时不该把「荣誉班」也算进来');
  assert.equal(hits[0].id, '2');
});

test('matchCourses：片段命中返回全部候选，且名字短的在前', () => {
  const courses = [
    { id: '1', title: '大学物理（荣誉）', termName: '2025-2026 秋冬' },
    { id: '2', title: '大学物理实验', termName: '2025-2026 春夏' },
    { id: '3', title: '高等数学', termName: '2025-2026 秋冬' },
  ];
  const hits = matchCourses(courses, '物理');
  assert.equal(hits.length, 2, '两门都含「物理」，都要给出来');
  assert.equal(hits[0].id, '2', '名字短的排前面 —— 更贴近用户说法');
});

test('matchCourses：空查询、无命中都返回空数组（不抛）', () => {
  assert.deepEqual(matchCourses([{ id: '1', title: '物理' }], ''), []);
  assert.deepEqual(matchCourses([{ id: '1', title: '物理' }], '   '), []);
  assert.deepEqual(matchCourses([{ id: '1', title: '物理' }], '化学'), []);
  assert.deepEqual(matchCourses(null, '物理'), []);
});

/* ────────────────────── study_courses 主行为 ────────────────────── */

test('未整理的课也会列出来，state 为 none —— 这是「看不到」的根治', async () => {
  const services = fixture({
    courses: [
      { id: 'c1', title: '大学物理', termName: '2025-2026 春夏', teacher: '张三' },
      { id: 'c2', title: '高等数学', termName: '2025-2026 春夏', teacher: '李四' },
    ],
    lessons: {
      c1: [{ subId: 's1' }, { subId: 's2' }],
      c2: [{ subId: 's1' }],
    },
    // 只有 c1/s1 整理过；c1/s2 与 c2/s1 什么都没有
    records: [{ courseId: 'c1', subId: 's1', lecture: { title: '第一讲' }, blocks: [{}] }],
  });
  const result = await run(services);

  assert.equal(result.items.length, 2, '两门课都要在，哪怕只有一门整理过');
  const physics = result.items.find((item) => item.courseId === 'c1');
  const math = result.items.find((item) => item.courseId === 'c2');

  assert.equal(physics.counts.wiki, 1);
  assert.equal(physics.counts.none, 1, 'c1 的第二节没整理，要如实标 none');
  assert.equal(math.counts.none, 1, '完全没整理过的课也要列出来');
  assert.equal(math.counts.wiki, 0);
});

test('按课名筛选：只返回命中的课', async () => {
  const services = fixture({
    courses: [
      { id: 'c1', title: '大学物理', termName: '2025-2026 春夏' },
      { id: 'c2', title: '高等数学', termName: '2025-2026 春夏' },
    ],
  });
  const result = await run(services, { course: '物理' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, '大学物理');
});

test('同名课跨学期：两门都在结果里，各自带学期 —— 让模型去问用户', async () => {
  const services = fixture({
    courses: [
      { id: 'c1', title: '大学物理', termName: '2024-2025 秋冬' },
      { id: 'c2', title: '大学物理', termName: '2025-2026 春夏' },
    ],
  });
  const result = await run(services, { course: '大学物理' });
  assert.equal(result.items.length, 2, '跨学期的同名课不能被合成一条');
  assert.deepEqual(
    result.items.map((item) => item.term).sort(),
    ['2024-2025 秋冬', '2025-2026 春夏'],
    '每条都要带学期，模型才有东西可问',
  );
});

test('按学期筛选：只留该学期', async () => {
  const services = fixture({
    courses: [
      { id: 'c1', title: '大学物理', termName: '2024-2025 秋冬' },
      { id: 'c2', title: '大学物理', termName: '2025-2026 春夏' },
    ],
  });
  const result = await run(services, { course: '大学物理', term: '2025-2026' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].courseId, 'c2');
});

test('资料库里有但平台已不列的节次要保留 —— 否则整理过的课会消失', async () => {
  const services = fixture({
    courses: [{ id: 'c1', title: '大学物理', termName: '2025-2026 春夏' }],
    lessons: { c1: [{ subId: 's1' }] },
    // s9 在资料库里，但平台列表里没有（已下架）
    records: [{ courseId: 'c1', subId: 's9', lecture: { title: '已下架的那节' }, blocks: [] }],
  });
  const result = await run(services);
  const left = result.items[0].lessons.map((item) => item.subId);
  assert.ok(left.includes('s1'), '平台列出的节次要在');
  assert.ok(left.includes('s9'), '资料库独有、平台已不列的节次也要在，否则整理成果看起来丢了');
});

test('includeLessons=false 时只给统计，不拉节次', async () => {
  let called = 0;
  const services = fixture({
    courses: [{ id: 'c1', title: '大学物理', termName: '2025-2026 春夏' }],
    records: [{ courseId: 'c1', subId: 's1', lecture: { title: 'A' }, blocks: [] }],
  });
  services.zwClassroom.listLessons = async () => { called += 1; return { items: [] }; };
  const result = await run(services, { includeLessons: false });
  assert.equal(called, 0, '不要为了统计去拉全部节次');
  assert.equal(result.items[0].counts.wiki, 1);
  assert.equal(result.items[0].lessons, undefined);
});

test('参数白名单：拒绝账号与文件路径', async () => {
  const services = fixture({ courses: [] });
  const [tool] = createStudyCoursesTools(services);
  for (const bad of [{ accountId: 'x' }, { path: '/etc/passwd' }, { dir: 'D:\\' }]) {
    await assert.rejects(() => tool.run(bad, {}), (error) => error.code === 'INPUT');
  }
});

test('limit 生效，且 total 报真实总数', async () => {
  const courses = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `课程${i}`, termName: 'T' }));
  const services = fixture({ courses });
  const result = await run(services, { limit: 2 });
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 5);
  assert.equal(result.truncated, true);
});

test('guidance 说清 wiki / raw / none 的区别，且提示先问用户', async () => {
  const services = fixture({ courses: [] });
  const result = await run(services);
  assert.match(result.guidance, /wiki/);
  assert.match(result.guidance, /raw/);
  assert.match(result.guidance, /none/);
  assert.match(result.guidance, /问用户|哪一门/, '同名课时要提示去问用户');
});
