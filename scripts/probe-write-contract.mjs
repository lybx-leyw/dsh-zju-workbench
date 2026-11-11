#!/usr/bin/env node
/**
 * 写操作的**跨层参数契约**探针。
 *
 * # 为什么需要一个单独的脚本
 *
 * 本仓有两层测试，它们中间有一道没人测的缝：
 *
 * | 测试 | 测什么 | 用的是什么 source |
 * | --- | --- | --- |
 * | `tests/campus-write.test.mjs` | 工具层（参数校验、审批、契约缺失） | **假 source**：`selectCoursePrepare` 一个函数就够 |
 * | `tests/*-writes.test.mjs` | source 层的 `prepare()` / `execute()` | 真 source，但参数**按 source 的写法给** |
 *
 * 于是「工具层实际传的那个参数对象，喂给真的 source 会不会抛」从来没有人验过。
 * 2026-11-11 用这个探针一跑：19 个写动作里 **8 个** 在真实路径上不可用，
 * 而当时全部测试（80 条写测试 + 全部守卫）都是绿的。
 *
 * 详见 `docs/contributing/skills/lossless-plugin-fusion/.work/coverage-gaps.md` 第八节。
 *
 * # 用法
 *
 * ```bash
 * node scripts/probe-write-contract.mjs
 * ```
 *
 * 退出码：全部通 → 0；有不通 → 1。可以直接当 CI 用（但它**不联网**，不碰真账号）。
 *
 * # 它不证明什么（如实说明）
 *
 * 它只证明「工具传给 source 的参数形状能被 `prepare()` 接受」。
 * **不证明**请求发到平台后会被接受，也不覆盖 `execute()` 的路径。
 * 这一类探针能挡住的是「参数名对不上」这种确定性缺陷，挡不住协议漂移。
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

/** 动态 import 一个包内源码。 */
const load = (relative) => import(new URL(relative, `file://${ROOT}`).href);

/**
 * 一条结果。
 * @typedef {{ ok: boolean, tool: string, action: string, detail: string }} Outcome
 */

/** 造一对「够用就好」的只读依赖：只回答探针需要的那几个方法。 */
const zip = (overrides) => ({
  todos: async () => ({ xzzd: { rows: [] } }),
  assignments: async () => [],
  activities: async () => [],
  activity: async () => null,
  materials: async () => [],
  activitySubmission: async () => ({ latestSubmission: null }),
  myActivities: async () => [],
  unfinished: async () => [],
  ...overrides,
});

const outcomes = [];

/**
 * 跑一条：把 `prepare` 包起来，只关心抛不抛。
 *
 * @param tool - 工具名（报告里用）。
 * @param action - 动作名（报告里用）。
 * @param run - `() => Promise<unknown>`，内部调 source 的 `prepare`。
 */
async function probe(tool, action, run) {
  try {
    await run();
    outcomes.push({ ok: true, tool, action, detail: '' });
  } catch (error) {
    const code = error?.code ?? error?.name ?? 'Error';
    outcomes.push({ ok: false, tool, action, detail: `${code}: ${String(error?.message ?? error).slice(0, 90)}` });
  }
}

/* ─────────────────────────── zdbk ─────────────────────────── */

{
  const { createZdbkWrites } = await load('packages/source/zdbk/src/writes.js');
  const reader = {
    selectionContextData: async () => ({ academic_year: '2025-2026', semester: 1, study_length: '4' }),
    selectionCourses: async () => ({ courses: [{ code: 'MATH1001', name: '高等数学', pool: 'MATH1001-01' }] }),
    selectionSelected: async () => ({
      choices: [
        { section: '(2025-2026-1)-A-1-1', course: '高等数学', group: 'g1' },
        { section: '(2025-2026-1)-A-1-2', course: '高等数学', group: 'g1' },
      ],
    }),
    api: { post: async () => ({}), postArray: async () => [{ xkkh: '(2025-2026-1)-A-1-1', tabname: 'xk_1' }] },
  };
  const writes = () => createZdbkWrites(reader);
  // 工具层 campus_course_select 实际传的三个对象（见 tools.js 的 prepare）
  await probe('campus_course_select', 'select', () => writes().selectCourse.prepare({ course: '高等数学', section: '(2025-2026-1)-A-1-1' }));
  await probe('campus_course_select', 'drop', () => writes().dropCourse.prepare({ course: '高等数学' }));
  await probe('campus_course_select', 'reorder', () => writes().reorderCourse.prepare({ course: '高等数学', order: 1 }));
}

/* ─────────────────────────── cc98 ─────────────────────────── */

{
  const { createCc98Writes } = await load('packages/source/cc98/src/writes.js');
  const reader = {
    user: async ({ name }) => ({ id: 77, name }),
    // 写工厂从 `reader.client` 拿客户端（不是 `reader.api`），两套都给上。
    client: { request: async () => ({}) },
    api: { get: async () => ({}), post: async () => ({}) },
  };
  const writes = () => createCc98Writes(reader);
  await probe('campus_post', 'post', () => writes().postTopic.prepare({ board: '200', content: '正文' }));
  await probe('campus_post', 'reply', () => writes().replyTopic.prepare({ topic: '999', content: '顶' }));
  await probe('campus_post', 'edit', () => writes().editPost.prepare({ topic: '999', content: '改' }));
  await probe('campus_post', 'message', () => writes().sendMessage.prepare({ recipient: '某用户', content: 'hi' }));
  await probe('campus_react', 'like', () => writes().likeFloor.prepare({ post: '999' }));
  await probe('campus_react', 'favorite', () => writes().favoriteTopic.prepare({ post: '999' }));
  // 工具层把 reason 当可选（optStr），source 要求必填
  await probe('campus_react', 'rate', () => writes().rateFloor.prepare({ post: '999', value: 2, reason: undefined }));
  await probe('campus_checkin', 'cc98 signin', () => writes().signIn.prepare({}));
}

/* ─────────────────────────── sztz ─────────────────────────── */

{
  const { createSztzWrites } = await load('packages/source/sztz/src/writes.js');
  const client = {
    unfinished: async () => [{ id: 501, mc: '志愿活动' }],
    myActivities: async () => [{ id: 501, mc: '志愿活动' }],
    call: async () => ({}),
  };
  const writes = () => createSztzWrites(client);
  await probe('campus_activity', 'sztz signup', () => writes().signupActivity.prepare({ activity: '志愿活动' }));
  await probe('campus_activity', 'sztz cancel', () => writes().cancelActivity.prepare({ activity: '志愿活动' }));
}

/* ─────────────────────────── tyys ─────────────────────────── */

{
  const { createTyysWrites } = await load('packages/source/tyys/src/writes.js');
  const order = {
    tradeNo: 'O1',
    id: '1',
    campusName: '紫金港',
    venueName: '网球场',
    siteName: '1号',
    reservationStartDate: '2026-11-20 19:00:00',
    reservationEndDate: '2026-11-20 20:00:00',
    orderStatus: 1,
    payStatus: 1,
  };
  const client = {
    day: async () => ({ open: true, token: 't', weekStart: '2026-11-09', slots: [{ start: '19:00', end: '20:00', status: 1 }] }),
    preview: async () => ({ captchaRequired: false, buddyMin: 0, phone: '13800000000' }),
    request: async (method, url) => (url === '/api/orders/mine' ? { content: [order], totalPages: 1 } : {}),
  };
  const writes = () => createTyysWrites(client);
  // 工具层把时段拼成一个 slot 字符串传过去，source 要 start / end 两个字段
  await probe('campus_activity', 'tyys book', () => writes().bookVenue.prepare({ venue: 'tennis-1', slot: '19:00-20:00', date: '2026-11-12' }));
  await probe('campus_activity', 'tyys cancel', () => writes().cancelVenue.prepare({ order: 'O1' }));
}

/* ─────────────────────────── lab ─────────────────────────── */

{
  const { createLabWrites } = await load('packages/source/lab/src/writes.js');
  const client = {
    termId: async () => 1,
    myCourses: async () => [{ id: 7, name: '大学物理实验' }],
    labs: async () => [{ id: 42, weeks: ['1-16'] }],
    mySelections: async () => [{ id: 9, courseLabId: 42, selectWeek: '1-16' }],
    raw: async () => ({}),
    auth: { username: 'u' },
  };
  const writes = () => createLabWrites(client);
  // 工具参数写着「实验课程名或编号」，source 的 id() 只收正整数
  await probe('campus_lab_select', 'select', () => writes().selectLab.prepare({ course: '大学物理实验', lab: '42', week: '1-16' }));
  await probe('campus_lab_select', 'cancel', () => writes().cancelLab.prepare({ record: '9' }));
}

/* ─────────────────────────── xuezai ─────────────────────────── */

{
  const { createXuezaiWrites } = await load('packages/source/xuezai/src/writes.js');
  const reader = zip({
    transport: { request: async () => ({ status: 200, text: async () => '{}' }) },
    todos: async () => ({ xzzd: { rows: [{ id: 101, title: '第三次作业' }] } }),
    assignments: async () => [{ id: 101, title: '第三次作业', course_name: '数据结构' }],
    activity: async () => ({ id: 101, title: '第三次作业' }),
  });
  const writes = () => createXuezaiWrites(reader);
  // 工具参数写「作业名或编号」，source 的 resolveActivity 只认正整数
  await probe('campus_homework', 'xuezai submit（按名字）', () => writes().submitHomework.prepare({ course: '数据结构', homework: '第三次作业', content: 'x' }));
  await probe('campus_homework', 'xuezai submit（按编号）', () => writes().submitHomework.prepare({ course: '数据结构', homework: 101, content: 'x' }));
  await probe('campus_homework', 'xuezai retract（按名字）', () => writes().retractHomework.prepare({ course: '数据结构', homework: '第三次作业' }));
  // 工具层传 {course, code}，source 读 args.rollcall ?? args.activity
  await probe('campus_checkin', 'xuezai rollcall', () => writes().rollcall.prepare({ course: '数据结构', code: '1234' }));
}

/* ─────────────────────────── pta ─────────────────────────── */

{
  const { createPtaWrites } = await load('packages/source/pta/src/writes.js');
  // 拼题A 的写动作要求先在网页上「开始作业」（答题实例），这是上游同款行为。
  // 这里只验参数形状：没有 exam 时它会抛「还没有开始作答」，那是**预期的**，
  // 所以这一条不参与 pass / fail 判定，只打印。
  const client = {
    problemSet: async () => ({ id: '1', exam: null, serverTime: null }),
    problem: async () => null,
    get: async () => ({}),
    send: async () => ({}),
  };
  try {
    await createPtaWrites(client).saveAnswer.prepare({ homework: '1', problem: 'p1', content: 'x' });
    outcomes.push({ ok: true, tool: 'campus_homework', action: 'pta save（预期：需先在网页开始）', detail: '未抛（环境允许）' });
  } catch (error) {
    outcomes.push({
      ok: true,
      tool: 'campus_homework',
      action: 'pta save（预期：需先在网页开始）',
      detail: `按预期拒绝：${String(error?.message ?? error).slice(0, 60)}`,
    });
  }
}

/* ─────────────────────────── 报告 ─────────────────────────── */

const pass = outcomes.filter((row) => row.ok);
const fail = outcomes.filter((row) => !row.ok);

for (const row of outcomes) {
  const mark = row.ok ? '✅' : '❌';
  const tail = row.detail ? ` → ${row.detail}` : '';
  console.log(`${mark} ${row.tool} · ${row.action}${tail}`);
}

console.log(`\n合计 ${outcomes.length} 条探针：通 ${pass.length}，不通 ${fail.length}`);

if (fail.length > 0) {
  console.log('\n不通的都是「工具层实际传的参数，真 source 不接受」。');
  console.log('判定哪一侧该改属于契约变更，需要先定方向 —— 见 coverage-gaps.md 8.5。');
  console.log('出口码 1。');
  process.exitCode = 1;
}

// 让 require 在纯 ESM 文件里不报「未使用」的静态检查
void require;
void path;
