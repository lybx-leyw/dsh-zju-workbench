/**
 * `study_search` 的**按课名定位**与**跨学期守卫**。
 *
 * # 这是用户抱怨的那个具体场景
 *
 * > 用户问的是「ta 的物理课」，AI 却去查上学期的物理课和其他非本学期物理课。
 *
 * 根因不是模型笨，是**工具给了它这个空间**：`study_search` 原先只收 `courseId`，
 * 模型手里只有课名，于是要么猜编号、要么把课名塞进 `query` ——
 * 后者的后果是搜到**所有学期**的同名课命中，而它不会意识到自己跨学期了。
 *
 * 现在：
 *
 *   - `course` 参数按课名定位；命中多门时**报 AMBIGUOUS_COURSE 并列候选**；
 *   - 报错文案只问**课名 / 学期名**，不问学期编号（用户记不住编号）；
 *   - 拿不到课程列表时**不静默降级**成全量搜索。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStudyMaterialTools } from '../../../packages/tool/classroom/src/tools.js';

/** 造一个最小 workbench：两条记录，分属不同学期的同名课。 */
function fixture({ records } = {}) {
  const data = records ?? [
    { accountId: 'u1', courseId: 'c-phys-autumn', subId: 's1', lecture: { generationVersion: 'architecture-v4', chapters: [{ title: '力学', topics: [{ title: '牛顿定律' }] }] }, blocks: [] },
    { accountId: 'u1', courseId: 'c-phys-spring', subId: 's1', lecture: { generationVersion: 'architecture-v4', chapters: [{ title: '电磁', topics: [{ title: '高斯定理' }] }] }, blocks: [] },
    { accountId: 'u1', courseId: 'c-math', subId: 's1', lecture: { generationVersion: 'architecture-v4', chapters: [{ title: '微积分', topics: [{ title: '极限' }] }] }, blocks: [] },
  ];
  return {
    closed: false,
    ready: Promise.resolve(),
    user: async () => ({ id: 'u1' }),
    knowledge: {
      listByAccount: async () => data,
      get: async ({ courseId, subId }) => data.find((r) => r.courseId === courseId && r.subId === subId),
    },
  };
}

/**
 * 造一个课名解析器：模拟 `index.js` 里那个 `resolveCourse`。
 *
 * 直接复用真实逻辑不现实（它要 classroom 服务），所以这里按同样的
 * 契约返回：`{kind:'one'}` / `{kind:'ambiguous'}` / `{kind:'missing'}` / `{kind:'unsupported'}`。
 */
function resolver(map) {
  return async (wanted, { term } = {}) => {
    const entry = map[wanted];
    if (!entry) return { kind: 'missing' };
    if (entry.unsupported) return { kind: 'unsupported' };
    if (entry.one) return { kind: 'one', courseId: entry.one };
    return { kind: 'ambiguous', candidates: entry.candidates };
  };
}

/** 跑 study_search。 */
function search(services, resolveCourse, args) {
  const tools = createStudyMaterialTools(services, { resolveCourse });
  return tools.find((item) => item.name === 'study_search').execute(args, {});
}

test('只给课名：能定位到唯一那门课', async () => {
  const services = fixture();
  const result = await search(services, resolver({ 高等数学: { one: 'c-math' } }), {
    query: '极限', course: '高等数学',
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].courseId, 'c-math');
  assert.match(result.items[0].title, /极限/);
});

test('课名跨学期：报 AMBIGUOUS_COURSE，并列候选，不猜', async () => {
  const services = fixture();
  const resolve = resolver({
    物理: {
      candidates: [
        { courseId: 'c-phys-autumn', title: '大学物理', term: '2024-2025 秋冬', teacher: '张三' },
        { courseId: 'c-phys-spring', title: '大学物理', term: '2025-2026 春夏', teacher: '张三' },
      ],
    },
  });

  await assert.rejects(
    () => search(services, resolve, { query: '牛顿', course: '物理' }),
    (error) => {
      assert.equal(error.code, 'AMBIGUOUS_COURSE');
      assert.equal(error.candidates.length, 2, '两个候选都要给出来');
      // 报错里必须带**学期名**，模型才有东西可问用户。
      assert.match(error.message, /2024-2025 秋冬/);
      assert.match(error.message, /2025-2026 春夏/);
      // 关键：要叫模型去问用户，且**不要自己挑**。
      assert.match(error.message, /问用户|哪一门/);
      assert.match(error.message, /不要自己挑|挑错/);
      return true;
    },
  );
});

test('歧义时不返回任何结果 —— 半截结果最危险', async () => {
  // 如果它「先返回一部分、顺便报错」，模型很可能拿那部分继续答。
  const services = fixture();
  const resolve = resolver({
    物理: { candidates: [{ courseId: 'c-phys-autumn', title: '大学物理', term: 'A' }, { courseId: 'c-phys-spring', title: '大学物理', term: 'B' }] },
  });
  let returned = null;
  try {
    returned = await search(services, resolve, { query: '牛顿', course: '物理' });
  } catch { /* 预期抛错 */ }
  assert.equal(returned, null, '歧义时不能既抛错又给结果');
});

test('课名不存在：报 COURSE_NOT_FOUND 并指向 study_courses', async () => {
  const services = fixture();
  await assert.rejects(
    () => search(services, resolver({}), { query: '极限', course: '量子力学' }),
    (error) => {
      assert.equal(error.code, 'COURSE_NOT_FOUND');
      assert.match(error.message, /study_courses/, '要指向能查课程列表的那个工具');
      return true;
    },
  );
});

test('拿不到课程列表时不静默降级 —— 那正是会答错学期的那条路', async () => {
  const services = fixture();
  await assert.rejects(
    () => search(services, resolver({ 物理: { unsupported: true } }), { query: '牛顿', course: '物理' }),
    (error) => {
      assert.equal(error.code, 'COURSE_LOOKUP_UNAVAILABLE');
      assert.match(error.message, /courseId/);
      return true;
    },
  );
});

test('给了 courseId 就不再解析课名（显式优先）', async () => {
  const services = fixture();
  let called = 0;
  const resolve = async () => { called += 1; return { kind: 'missing' }; };
  const result = await search(services, resolve, { query: '极限', courseId: 'c-math' });
  assert.equal(called, 0, 'courseId 是显式的，不该再去查课名');
  assert.equal(result.total, 1);
  assert.equal(result.items[0].courseId, 'c-math');
});

test('不给 course 也不给 courseId：搜全部记录（旧行为保留）', async () => {
  // 这不是新路径，但必须仍然能用 —— 否则「在我的所有讲义里找 XX」会失效。
  const services = fixture();
  const result = await search(services, resolver({}), { query: '牛顿' });
  assert.ok(result.total >= 1);
});

test('course 参数在工具 schema 里，且描述说明了为什么要填', () => {
  const tools = createStudyMaterialTools(fixture(), {});
  const tool = tools.find((item) => item.name === 'study_search');
  assert.ok(tool.parameters.properties.course, 'course 参数必须存在');
  assert.ok(tool.parameters.properties.term, 'term 参数必须存在，用来在歧义时收窄');
  assert.match(tool.parameters.properties.course.description, /课名/);
  assert.match(tool.description, /AMBIGUOUS_COURSE|问用户|哪一门/);
});

test('study_catalog 的描述要指出它看不到未整理的课', () => {
  const tools = createStudyMaterialTools(fixture(), {});
  const tool = tools.find((item) => item.name === 'study_catalog');
  assert.match(tool.description, /study_courses/, '要指向能看全部课程的那个工具');
  assert.match(tool.description, /原始素材|raw_/, '要说清原始素材在别的工具里');
});

test('study_read 的描述要说清它读的是 wiki 不是原始素材', () => {
  const tools = createStudyMaterialTools(fixture(), {});
  const tool = tools.find((item) => item.name === 'study_read');
  assert.match(tool.description, /wiki|整理/);
  assert.match(tool.description, /raw_transcript|原始/);
});
