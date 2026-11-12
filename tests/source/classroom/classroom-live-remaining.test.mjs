/**
 * `live start` / `live stop` 的**入参与生命周期**测试。
 *
 * # 这一份补的是什么缺口
 *
 * 审计把 `live start/stop` 记为「直播链路未验证」。逐条拆开之后，那个「未验证」
 * 其实是**三件不同的事**：
 *
 *   1. **入参算不出来** —— `liveStart({courseId,subId,startsAt,endsAt})` 要四个值，
 *      而调用方手上只有「现在」。以前没有方法把「今天还值得采的课次」列出来，
 *      只能拿回放口径的课表硬凑，凑错的表现是「任务建起来了但一直是 waiting」。
 *      → 本轮补 `LiveSource.remaining()`，这个文件测它。
 *   2. **协议帧没被真机验证** —— 那要一台校园网内的机器，离线做不到。已有
 *      `classroom-live-protocol.test.mjs` 按上游记录的形状测帧层，**并在文件头
 *      写明未验证**；这里不重复。
 *   3. **生命周期**（建立会话 / 停 / 不删已收文字）—— 已有
 *      `classroom-readonly-gaps.test.mjs` 的 `liveStart…liveStop` 一条覆盖。
 *
 * 所以本文件只补第 1 件，不假装补上了第 2 件。
 *
 * 全离线：`transport.json` 是假身，`now` 是注入的固定时刻。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LiveSource } from '../../../packages/source/classroom/src/live.js';
// 宽限常量只有一处定义（`live-caption.js`）：本文件直接读它，而不是抄一个 5 分钟 ——
// 抄一份会让「改了这边、那边没改」的漂移在测试里看不出来。
import { LESSON_GRACE_MS } from '../../../packages/source/classroom/src/live-caption.js';

/* ────────────────────────────────── 夹具 */

/** 一天的三段时段 + 每个时段的课。时段用 HH:MM，与上游 `class_begin_time` 同形。 */
const DAY = '2026-11-12';

function fakeTransport({ quantums, courses, calls = [] } = {}) {
  return {
    json: async (url) => {
      const target = new URL(url);
      calls.push(target);
      const quantumId = target.searchParams.get('quantum_id');
      if (quantumId === '0') return { code: '0', list: quantums() };
      const rows = courses()[quantumId];
      if (!rows) return { code: '0', list: [] };
      return { code: '0', list: [{ id: Number(quantumId), list: rows }] };
    },
  };
}

const standardQuantums = () => [
  { id: 11, name: '上午一', class_begin_time: '08:00', class_end_time: '09:00' },
  { id: 12, name: '上午二', class_begin_time: '10:00', class_end_time: '12:00' },
  { id: 13, name: '下午', class_begin_time: '14:00', class_end_time: '15:30' },
];

/** 北京时间的某个时刻（用 `+08:00` 写字面量，不受机器时区影响）。 */
const at = (clock) => new Date(`${DAY}T${clock}+08:00`);

/* ══════════════════════════════════ remaining ══════════════════════════════════ */

test('remaining 只筛「已散场」与「非直播」：还没开课的照样留（采集循环会等到开讲）', async () => {
  const courses = () => ({
    11: [
      { course_id: 7, sub_id: 70, title: '数据结构', status_label: '直播中', room_name: '东1-101' },
      // 非直播（录播 / 已结束）：不可能有实时字幕。
      { course_id: 9, sub_id: 90, title: '编译原理', status_label: '已结束' },
    ],
    12: [{ course_id: 8, sub_id: 80, title: '操作系统', status_label: '直播中' }],
    13: [{ course_id: 10, sub_id: 100, title: '计算机网络', status_label: '直播中' }],
  });
  const calls = [];
  const live = new LiveSource({ transport: fakeTransport({ quantums: standardQuantums, courses, calls }) });

  // 11:00：上午一已散场（09:00 + 5 分钟宽限也过了），上午二进行中，下午还没到。
  const out = await live.remaining(DAY, { now: at('11:00') });
  // ⚠️ 下午那节**要留着**：上游 `live-task.ts:135` 的判据是
  // `endsAt + 300000 > Date.now()`，还没开始的课也在内 —— 采集循环先等到
  // `startsAt - 5 分钟` 才开始取地址（`live-caption.js` 的 `LESSON_LEAD_MS`）。
  // 提前筛掉会让「上午点了开始、下午的课就永远采不到」。
  assert.deepEqual(out.items.map((row) => row.subId), ['80', '100'], '按开课时间排序');
  assert.equal(out.meta.excluded, 2, '筛掉 2 条（1 条非直播 + 1 条已散场）');
  assert.equal(out.meta.date, DAY);
  assert.equal(out.meta.complete, true);
  // 时间窗换算成绝对毫秒，采集循环直接用。
  assert.equal(out.items[0].startsAt, Date.parse(`${DAY}T10:00:00+08:00`));
  assert.equal(out.items[0].endsAt, Date.parse(`${DAY}T12:00:00+08:00`));
  assert.equal(out.items[0].secondsLeft, 3600 + LESSON_GRACE_MS / 1000, '到 12:00 还剩 3600 秒 + 宽限');
  // 三个时段各发过一次课表请求（+1 次时段表）。
  assert.equal(calls.filter((url) => url.searchParams.get('quantum_id') === '0').length, 1);
});

test('remaining 按 status_label 判直播，与时间窗是两条独立判据', async () => {
  // 这条把两个判据**分开**验证：如果只靠时间窗（`endSec + grace > second`）就能
  // 筛干净，那 `live` 那一句删掉也没人发现 —— 事实上它必须自己挡住：
  // 一节**还在时段内**但状态不是「直播」的课（例如「调课」「已取消」），
  // 起采集是纯粹的浪费，而且 `liveStatus` 会显示一条永远 waiting 的任务。
  const courses = () => ({
    11: [
      { course_id: 7, sub_id: 70, title: '数据结构', status_label: '直播中' },
      // 时间窗内、但状态说明它不是直播 —— 必须被 live 判据挡掉。
      { course_id: 8, sub_id: 80, title: '已取消的课', status_label: '已取消' },
      { course_id: 9, sub_id: 90, title: '调课', status_label: '调课' },
      // 状态字段缺失也不能被当成直播。
      { course_id: 10, sub_id: 100, title: '状态缺失' },
    ],
  });
  const live = new LiveSource({ transport: fakeTransport({ quantums: standardQuantums, courses }) });
  const out = await live.remaining(DAY, { now: at('08:10') });
  assert.deepEqual(out.items.map((row) => row.subId), ['70'], '只有 status_label 含「直播」的才是直播课');
  assert.equal(out.meta.excluded, 3, '三条都在时间窗内，只能是被 live 判据筛掉的');
});

test('remaining 尊重课后 5 分钟宽限：刚下课还能起，过了一分半就没有', async () => {
  const courses = () => ({
    11: [{ course_id: 7, sub_id: 70, title: '数据结构', status_label: '直播中' }],
  });
  const live = new LiveSource({ transport: fakeTransport({ quantums: standardQuantums, courses }) });

  // 09:03 —— 下课 3 分钟，老师可能还在讲。
  const grace = await live.remaining(DAY, { now: at('09:03') });
  assert.deepEqual(grace.items.map((row) => row.subId), ['70'], '宽限期内仍算可采');
  assert.equal(grace.items[0].secondsLeft, 2 * 60, '还剩 2 分钟宽限');

  // 09:06 —— 超过 5 分钟宽限。
  const gone = await live.remaining(DAY, { now: at('09:06') });
  assert.deepEqual(gone.items, []);
  assert.equal(gone.meta.excluded, 1);
});

test('remaining 缺时间窗的课次仍然返回，但 startsAt/endsAt 是 null 而不是编一个', async () => {
  // 时段表偶尔给不出 begin/end（上游字段漂移）。凭空补「现在 + 2 小时」会让
  // 采集在课后继续听，比报 null 更糟 —— 由调用方自己决定怎么兜。
  const quantums = () => [{ id: 11, name: '未知时段' }];
  const courses = () => ({ 11: [{ course_id: 7, sub_id: 70, title: '数据结构', status_label: '直播中' }] });
  const live = new LiveSource({ transport: fakeTransport({ quantums, courses }) });

  const out = await live.remaining(DAY, { now: at('11:00') });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].startsAt, null);
  assert.equal(out.items[0].endsAt, null);
  assert.equal(out.items[0].secondsLeft, null);
  assert.equal(out.meta.excluded, 0, '缺时间窗不等于已散场');
});

test('remaining 按 course 挑课：精确优先、唯一包含次之、多义时报候选', async () => {
  const courses = () => ({
    11: [
      { course_id: 7, sub_id: 70, title: '数据结构', status_label: '直播中' },
      { course_id: 8, sub_id: 80, title: '数据结构（甲）', status_label: '直播中' },
      { course_id: 9, sub_id: 90, title: '操作系统', status_label: '直播中' },
    ],
  });
  const live = new LiveSource({ transport: fakeTransport({ quantums: standardQuantums, courses }) });

  const exact = await live.remaining(DAY, { now: at('08:10'), course: '数据结构' });
  assert.deepEqual(exact.items.map((row) => row.subId), ['70'], '精确同名优先，不被「（甲）」抢走');

  const byId = await live.remaining(DAY, { now: at('08:10'), course: '9' });
  assert.deepEqual(byId.items.map((row) => row.title), ['操作系统']);

  await assert.rejects(
    live.remaining(DAY, { now: at('08:10'), course: '数据' }),
    (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /对应多门课/);
      assert.equal(error.details.candidates.length, 2);
      return true;
    },
  );

  await assert.rejects(
    live.remaining(DAY, { now: at('08:10'), course: '不存在的课' }),
    (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /没有这门课的直播/);
      assert.ok(error.details.candidates.length >= 1, '要给出今天有哪些课可选');
      return true;
    },
  );
});

test('remaining 在非今天时按整天判断，不拿当前秒数乱筛', async () => {
  // 查明天：`now` 是今天 11:00，但目标是明天 —— 明天所有课都还没上，不能因为
  // 「今天是 11 点」就把明天 08:00 的课当成已散场筛掉。
  const courses = () => ({
    11: [{ course_id: 7, sub_id: 70, title: '数据结构', status_label: '直播中' }],
  });
  const live = new LiveSource({ transport: fakeTransport({ quantums: standardQuantums, courses }) });
  const out = await live.remaining('2026-11-13', { now: at('11:00') });
  assert.equal(out.meta.date, '2026-11-13');
  assert.equal(out.items.length, 1, '别的日子的课不该被今天的钟点筛掉');
});

test('remaining 对无效日期与无效 now 立刻报错', async () => {
  const live = new LiveSource({ transport: fakeTransport({ quantums: standardQuantums, courses: () => ({}) }) });
  await assert.rejects(live.remaining('2026-02-31', { now: at('11:00') }), /日期不存在/);
  await assert.rejects(live.remaining(DAY, { now: new Date('nope') }), /有效日期/);
});

test('remaining 如实传递 partial 元信息：单时段失败不当成「今天没课」', async () => {
  // 一个时段抛错、其余正常：整批要成功但标 complete:false，并带上失败时段数。
  const transport = {
    json: async (url) => {
      const target = new URL(url);
      const quantumId = target.searchParams.get('quantum_id');
      if (quantumId === '0') return { code: '0', list: standardQuantums() };
      if (quantumId === '12') throw new Error('网关超时');
      return { code: '0', list: [{ id: Number(quantumId), list: [
        { course_id: 7, sub_id: 70, title: `时段${quantumId}`, status_label: '直播中' },
      ] }] };
    },
  };
  const live = new LiveSource({ transport });
  const out = await live.remaining(DAY, { now: at('08:10') });
  assert.equal(out.meta.complete, false);
  assert.equal(out.meta.reason, 'partial-quantum');
  assert.equal(out.meta.failedQuantums, 1);
  assert.ok(out.items.length >= 1, '成功的时段仍要给出结果');
});

test('remaining 给出的每一项都够 liveStart 直接吃（四个入参齐全）', async () => {
  const courses = () => ({
    11: [{ course_id: 7, sub_id: 70, title: '数据结构', status_label: '直播中', room_name: '东1-101' }],
  });
  const live = new LiveSource({ transport: fakeTransport({ quantums: standardQuantums, courses }) });
  const [row] = (await live.remaining(DAY, { now: at('08:10') })).items;
  // 这条钉的是「两段能对上」：字段名不同就会在 liveStart 里变成 API_SHAPE。
  const payload = {
    courseId: row.courseId,
    subId: row.subId,
    title: row.title,
    room: row.roomName,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
  for (const [key, value] of Object.entries(payload)) {
    assert.notEqual(value, undefined, `liveStart 需要 ${key}，remaining 必须给出来`);
  }
  assert.ok(row.endsAt > row.startsAt, '窗口必须正立，否则 liveStart 会直接拒绝');
});
