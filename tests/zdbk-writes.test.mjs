/**
 * 教务网选课写操作的测试。
 *
 * # 这个包最难的地方
 *
 * 选课表单要六个字段，其中三个只能从服务端响应里拿（`xn`/`xq`/`tabname`/`xkzys`）。
 * 所以 Prepare 必须真的跑查询链 —— 这组测试主要钉住「Prepare 有没有正确地把
 * 这些字段凑齐」，以及「凑不齐时有没有如实报错而不是发一个残缺表单」。
 *
 * # 一处特别要守的
 *
 * **补考选课不属于常规志愿**。放它过去会被服务端拒，而报错只说「参数错误」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createZdbkWrites } from '../packages/source/zdbk/src/writes.js';

/** 造一个假 reader：只读查询都返回固定值。 */
function fakeReader(overrides = {}) {
  const posts = [];
  const base = {
    api: {
      async post(path, options) {
        posts.push({ path, form: options?.form });
        return { code: 0 };
      },
      async postArray() {
        return [
          {
            kcdm: 'MATH1001', xkkh: '2026-2027-1-MATH1001-A01', kcmc: '高等数学',
            tabname: 'zzxkghb', jxbly: '1', rs: '30/60',
          },
          {
            kcdm: 'MATH1001', xkkh: '2026-2027-1-MATH1001-A02', kcmc: '高等数学',
            tabname: 'zzxkghb', jxbly: '1', rs: '10/60',
          },
          {
            kcdm: 'MATH1001', xkkh: '2026-2027-1-MATH1001-BK', kcmc: '高等数学（补考）',
            tabname: 'jxrwbview', jxbly: '2', rs: '5/30',
          },
        ];
      },
    },
    async selectionContextData() {
      return { academic_year: '2026-2027', semester: 1, grade: '2024', max_choices: 30, study_length: 4 };
    },
    async selectionSelected() {
      return { choices: [] };
    },
    async selectionCourses() {
      // 默认夹具里只有一门「高等数学」，pool 由本方法解析出来。
      return { courses: [{ name: '高等数学', code: 'MATH1001', pool: 'MATH1001' }] };
    },
  };
  return { ...base, overrides, posts };
}

/** 只统计写请求。 */
const writesOf = (reader) => reader.posts ?? [];

test('两段式：Prepare 只查询，Execute 才 POST', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);

  const summary = await api.selectCourse.prepare({
    course: 'MATH1001', pool: 'MATH1001', category: 'xk_1', section: '2026-2027-1-MATH1001-A01',
  });
  assert.match(summary, /选课：高等数学/);
  assert.match(summary, /2026-2027 学年第 1 学期/);

  await api.selectCourse.execute();
  assert.equal(reader.posts.length, 1, 'Execute 才发');
});

test('selectCourse：表单六个字段全都凑齐', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  await api.selectCourse.prepare({
    course: 'MATH1001', pool: 'MATH1001', category: 'xk_1', section: '2026-2027-1-MATH1001-A01',
  });
  await api.selectCourse.execute();

  const { form } = reader.posts[0];
  assert.equal(form.xn, '2026-2027', '学年来自选课首页');
  assert.equal(form.xq, '1');
  assert.equal(form.nj, '2024');
  assert.equal(form.xkkh, '2026-2027-1-MATH1001-A01');
  assert.equal(form.tabname, 'zzxkghb', 'tabname 只能从教学班行拿');
  assert.equal(form.xkzys, '30', '志愿数上限来自选课首页');
});

test('selectCourse：没有 Prepare 就 Execute 要报 NEED_PREPARE', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  await assert.rejects(() => api.selectCourse.execute(), (error) => {
    assert.equal(error.code, 'NEED_PREPARE');
    return true;
  });
  assert.equal(reader.posts.length, 0);
});

test('selectCourse：补考选课要拒（不属于常规志愿）', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.selectCourse.prepare({
      course: 'MATH1001', pool: 'MATH1001', category: 'xk_1', section: '2026-2027-1-MATH1001-BK',
    }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /补考/);
      return true;
    },
  );
  assert.equal(reader.posts.length, 0, '不许发出去');
});

test('selectCourse：教学班不存在要拒并指出用哪个方法查', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.selectCourse.prepare({
      course: 'MATH1001', pool: 'MATH1001', category: 'xk_1', section: '不存在的班',
    }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /selectionSections/);
      return true;
    },
  );
});

test('selectCourse：已经在志愿里时说明要讲清', async () => {
  const reader = fakeReader();
  reader.selectionSelected = async () => ({
    choices: [{ section: '2026-2027-1-MATH1001-A01', course: '高等数学' }],
  });
  const api = createZdbkWrites(reader);
  const summary = await api.selectCourse.prepare({
    course: 'MATH1001', pool: 'MATH1001', category: 'xk_1', section: '2026-2027-1-MATH1001-A01',
  });
  assert.match(summary, /已经选过/);
});

test('selectCourse：只给课程名时自己解析 pool（不再要求 pool / category）', async () => {
  // ⚠️ 这条在接审计时改过。旧契约要求调用方给 pool + category，但那两个是
  // **正方内部概念**（只能从课程列表查询拿到），让模型填等于让它猜 ——
  // 上一版的工具只传了 { course, section }，于是三个写动作全部在 prepare 被拒。
  //
  // 现在的契约：只给课程名或课程号，source 自己去课程列表里找 pool。
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  const summary = await api.selectCourse.prepare({ course: '高等数学', section: '2026-2027-1-MATH1001-A01' });
  assert.match(summary, /选课：高等数学/);
});

test('selectCourse：缺 course 要拒', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  await assert.rejects(() => api.selectCourse.prepare({ section: 'X' }), (e) => e.code === 'INVALID_ARGUMENT');
  assert.equal(reader.posts.length, 0);
});

test('selectCourse：同名多门课不许猜，要列出候选', async () => {
  const reader = fakeReader();
  reader.selectionCourses = async () => ({
    courses: [
      { name: '高等数学', code: 'MATH1001', pool: 'P1' },
      { name: '高等数学', code: 'MATH1002', pool: 'P2' },
    ],
  });
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.selectCourse.prepare({ course: '高等数学', section: 'X' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /匹配到 2 门课/, '要说清匹配到几门');
      assert.match(error.message, /MATH1001/, '要列候选');
      return true;
    },
  );
  assert.equal(reader.posts.length, 0, '猜错等于替用户选了别的课');
});

test('selectCourse：课程不存在时指出用哪个方法查', async () => {
  const reader = fakeReader();
  reader.selectionCourses = async () => ({ courses: [] });
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.selectCourse.prepare({ course: '不存在的课', section: 'X' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /selectionCourses/, '要指导下一步');
      return true;
    },
  );
});

test('selectCourse：缺 section 要拒', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.selectCourse.prepare({ course: 'MATH1001', pool: 'MATH1001', category: 'xk_1' }),
    (e) => e.code === 'INVALID_ARGUMENT',
  );
});

test('dropCourse：教学班要在志愿里，退选走 drop 端点', async () => {
  const reader = fakeReader();
  reader.selectionSelected = async () => ({
    choices: [{ section: '2026-2027-1-MATH1001-A01', course: '高等数学' }],
  });
  const api = createZdbkWrites(reader);

  const summary = await api.dropCourse.prepare({ section: '2026-2027-1-MATH1001-A01' });
  assert.match(summary, /退课/);

  await api.dropCourse.execute();
  const { form } = reader.posts[0];
  assert.equal(form.xkkh, '2026-2027-1-MATH1001-A01');
});

test('dropCourse：不在志愿里要拒', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.dropCourse.prepare({ section: '没有这个班' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /selectionSelected/);
      return true;
    },
  );
  assert.equal(reader.posts.length, 0);
});

test('reorderCourse：把目标移到第 N 位，提交整组顺序', async () => {
  const reader = fakeReader();
  reader.selectionSelected = async () => ({
    choices: [
      { section: 'A', course: '高等数学', group: 'MATH1001' },
      { section: 'B', course: '高等数学', group: 'MATH1001' },
      { section: 'C', course: '高等数学', group: 'MATH1001' },
    ],
  });
  const api = createZdbkWrites(reader);

  const summary = await api.reorderCourse.prepare({ section: 'C', order: 1 });
  assert.match(summary, /移到第 1 位/);
  assert.match(summary, /共 3 个志愿/);

  await api.reorderCourse.execute();
  const { form } = reader.posts[0];
  // C 提到第 1 位，A、B 依次后移
  assert.equal(form.xkkhs, 'C,A,B');
  assert.equal(form.zypxs, '1,2,3', '序号要与班号一一对应');
});

test('reorderCourse：只有一个志愿时没有可调次序', async () => {
  const reader = fakeReader();
  reader.selectionSelected = async () => ({
    choices: [{ section: 'A', course: '高等数学', group: 'MATH1001' }],
  });
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.reorderCourse.prepare({ section: 'A', order: 1 }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /只有 1 个志愿/);
      return true;
    },
  );
});

test('reorderCourse：序号超过组内志愿数要拒', async () => {
  const reader = fakeReader();
  reader.selectionSelected = async () => ({
    choices: [
      { section: 'A', course: '高等数学', group: 'MATH1001' },
      { section: 'B', course: '高等数学', group: 'MATH1001' },
    ],
  });
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.reorderCourse.prepare({ section: 'A', order: 5 }),
    (e) => e.code === 'INVALID_ARGUMENT',
  );
});

test('reorderCourse：order 必须是正整数', async () => {
  const reader = fakeReader();
  reader.selectionSelected = async () => ({
    choices: [
      { section: 'A', course: '高等数学', group: 'G' },
      { section: 'B', course: '高等数学', group: 'G' },
    ],
  });
  const api = createZdbkWrites(reader);
  for (const bad of [0, -1, 1.5, 'abc']) {
    await assert.rejects(() => api.reorderCourse.prepare({ section: 'A', order: bad }), (e) => e.code === 'INVALID_ARGUMENT');
  }
});

test('并发 Prepare 被拒（防止 A 批准 B 执行）', async () => {
  const reader = fakeReader();
  const api = createZdbkWrites(reader);
  const args = { course: 'MATH1001', pool: 'MATH1001', category: 'xk_1', section: '2026-2027-1-MATH1001-A01' };
  await api.selectCourse.prepare(args);
  await assert.rejects(() => api.selectCourse.prepare(args), (error) => {
    assert.equal(error.code, 'WRITE_BUSY');
    return true;
  });
});

test('selectCourse：教学班缺 tabname 时要拒，不发残缺表单', async () => {
  // 这条是补的：之前那组夹具的每条都有 tabname，所以「校验 tabname」那一行
  // 删掉也不会红 —— 但它正是防止「数据源与站点漂移后发出一个必然失败的表单」
  // 的唯一一道闸。夹具里故意留一条没有 tabname 的。
  const reader = fakeReader();
  reader.api.postArray = async () => [
    { kcdm: 'MATH1001', xkkh: 'NO-TABNAME', kcmc: '高等数学', jxbly: '1', rs: '1/10' },
  ];
  const api = createZdbkWrites(reader);
  await assert.rejects(
    () => api.selectCourse.prepare({ course: 'MATH1001', pool: 'MATH1001', category: 'xk_1', section: 'NO-TABNAME' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /tabname/);
      return true;
    },
  );
  assert.equal(reader.posts.length, 0, '残缺表单不许发出去');
});
