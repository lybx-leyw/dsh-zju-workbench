/**
 * 研究生教务网数据源（`source/yjsy`）的行为测试。
 *
 * # 为什么测解析而不测网络
 *
 * 这个包的价值全在**把上游的怪形状翻译成人能用的形状**：周次要换算成小学期的
 * 第几周、连着的节次要并成一次课、第 14 节的下课时间要改成 22:05。
 * 这些都是纯函数，用假响应就能测死；真网络一次请求就能验证「能不能登录」，
 * 而那是 CAS 的事，不是本包的。
 *
 * 所以这里**全部用假 request**，不联网、不需要账号。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOST, ENTRIES, Yjsy, YjsyError, isGraduateId, weeksText, resolveTerm, timetable, openYjsy,
} from '../../../packages/source/yjsy/src/yjsy.js';

/** 造一个假的 request：按路径尾巴匹配响应。 */
function fakeRequest(routes) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) {
        return typeof reply === 'function' ? reply(String(url)) : reply;
      }
    }
    return { status: 404, text: '' };
  };
  return { request, calls };
}

/** 一个成功的接口响应。 */
const ok = (result) => ({ status: 200, text: JSON.stringify({ success: true, code: 200, message: 'ok', result }) });

test('学号首位决定先试哪个入口', () => {
  assert.equal(isGraduateId('1234567890'), true, '博士');
  assert.equal(isGraduateId('2234567890'), true, '硕士');
  assert.equal(isGraduateId('3234567890'), false, '本科');
  assert.equal(isGraduateId(''), false);
  assert.equal(isGraduateId(undefined), false);
});

test('周次并成区间', () => {
  assert.equal(weeksText([1, 2, 3, 5, 7]), '第1-3,5,7周');
  assert.equal(weeksText([1, 2]), '第1-2周');
  assert.equal(weeksText([4]), '第4周');
  assert.equal(weeksText([]), '');
});

test('resolveTerm：不给参数时问系统现在是哪个学年学期', async () => {
  const { request } = fakeRequest([
    ['queryByDm', ok({ dqxn: '2026', dqxq: '12' })],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  const term = await resolveTerm(client);
  assert.equal(term.year, '2026-2027');
  assert.equal(term.semester, '秋冬');
  assert.equal(term.xn, '2026');
  assert.equal(term.xq, '12');
  assert.deepEqual(term.halves, ['13', '14'], '秋冬的两个小学期是 13 秋、14 冬');
});

test('resolveTerm：给小学期时只查那一个', async () => {
  const { request } = fakeRequest([]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  const term = await resolveTerm(client, { year: '2026-2027', term: '冬' });
  assert.equal(term.semester, '秋冬', '冬属于秋冬大学期');
  assert.deepEqual(term.halves, ['14'], '只查冬');
});

test('resolveTerm：学年格式不对时抛 CONFIG', async () => {
  const { request } = fakeRequest([]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  await assert.rejects(() => resolveTerm(client, { year: '2026' }), (e) => {
    assert.equal(e.code, 'CONFIG');
    return true;
  });
});

test('resolveTerm：学期名不认识时抛 CONFIG', async () => {
  const { request } = fakeRequest([]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  await assert.rejects(() => resolveTerm(client, { year: '2026-2027', term: '秋冬季' }), { code: 'CONFIG' });
});

test('会话失效（401/510）标记 expired 并抛 AUTH_EXPIRED', async () => {
  const { request } = fakeRequest([
    ['queryByDm', { status: 200, text: JSON.stringify({ success: false, code: 510, message: '登录失效' }) }],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  await assert.rejects(() => client.get('system/sysApp/queryByDm', { dm: 'py_xsxk' }), { code: 'AUTH_EXPIRED' });
  assert.equal(client.expired, true, '要打标记，调用方据此重换 token');
});

test('响应不是 JSON 时抛 SHAPE，并带路径', async () => {
  const { request } = fakeRequest([['x', { status: 200, text: '<html>' }]]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  await assert.rejects(() => client.get('x'), (e) => {
    assert.equal(e.code, 'SHAPE');
    assert.equal(e.details.path, 'x');
    return true;
  });
});

test('业务失败抛 REJECTED，带上游 code', async () => {
  const { request } = fakeRequest([
    ['x', { status: 200, text: JSON.stringify({ success: false, code: 500, message: '无效的用户信息' }) }],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  await assert.rejects(() => client.get('x'), (e) => {
    assert.equal(e.code, 'REJECTED');
    assert.equal(e.details.code, 500);
    assert.match(e.message, /无效的用户信息/);
    return true;
  });
});

test('token 放在 X-Access-Token 头里', async () => {
  const { request, calls } = fakeRequest([['queryByDm', ok({ dqxn: '2026', dqxq: '11' })]]);
  const client = new Yjsy({ request, entry: 'graduate', token: 'TOKEN-123' });
  await client.get('system/sysApp/queryByDm', { dm: 'py_xsxk' });
  assert.equal(calls[0].headers['X-Access-Token'], 'TOKEN-123');
});

/* ────────────────────────────── 课表解析 ── */

/** 一份最小教学日历：第 1 周从 2026-09-14（周一）起，共 16 周。 */
const CALENDAR = {
  kssj: '2026-09-14 00:00:00',
  jssj: '2027-01-03 00:00:00',
  pkzcs: 16,
  sysJxrlSjdList: [
    { jc: 1, kssj: '800', jssj: '845' },
    { jc: 2, kssj: '850', jssj: '935' },
    { jc: 3, kssj: '1000', jssj: '1045' },
    { jc: 14, kssj: '2100', jssj: '2145' },
  ],
};

/** 一份最小课表：周一第 1-2 节一门课，第 1-3 周。 */
const KB = {
  kcbMap: {
    1: {
      1: { pyKcbjSjddVOList: [{ kcbjId: 'A1', kcmc: '高等数学', bjbh: '01', zc: '1,2,3', xm: '张老师', xqmc: '紫金港', jxl: '东1', cdmc: 'A101', pkxq: '13' }] },
      2: { pyKcbjSjddVOList: [{ kcbjId: 'A1', kcmc: '高等数学', bjbh: '01', zc: '1,2,3', xm: '张老师', xqmc: '紫金港', jxl: '东1', cdmc: 'A101', pkxq: '13' }] },
    },
  },
  sjddList: [{ kcmc: '专题研讨', bjbh: '02', pkxq: '13', kkxyMc: '数学学院', zjjsXm: '李老师', bz: '时间地点另行通知' }],
};

test('课表：连着的节次并成一次课，给出起止时间与每次课的日期', async () => {
  const { request } = fakeRequest([
    ['queryByDm', ok({ dqxn: '2026', dqxq: '12' })],
    ['getJxrlByXnxq', ok(CALENDAR)],
    ['queryXskbByLoginUser', ok(KB)],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  const table = await timetable(client);

  assert.equal(table.count, 1);
  const course = table.courses[0];
  assert.equal(course.name, '高等数学');
  assert.equal(course.meetings.length, 1, '周一第 1、2 节要并成一次课');

  const meeting = course.meetings[0];
  assert.equal(meeting.weekday, 1);
  assert.deepEqual(meeting.periods, [1, 2]);
  assert.equal(meeting.startTime, '08:00');
  assert.equal(meeting.endTime, '09:35', '第 2 节的下课时间');
  assert.equal(meeting.location, '紫金港东1A101');
  assert.equal(meeting.weeks, '第1-3周');
  // 第 1 周周一 = 2026-09-14，往后每周一天。
  assert.deepEqual(meeting.dates, ['2026-09-14', '2026-09-21', '2026-09-28']);
});

test('课表：时间另定的课进 unscheduled，不混进 courses', async () => {
  // 秋冬是两个小学期（13 秋、14 冬），各自一次请求。假响应按小学期区分，
  // 让「只有秋学期有这门课」成为明确的输入 —— 否则同一个假响应会被读两遍，
  // 测出来的重复是夹具造成的，不是实现造成的。
  const { request } = fakeRequest([
    ['queryByDm', ok({ dqxn: '2026', dqxq: '12' })],
    ['getJxrlByXnxq', ok(CALENDAR)],
    ['pkxq=13', ok(KB)],
    ['pkxq=14', ok({ kcbMap: {}, sjddList: [] })],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  const table = await timetable(client);

  assert.equal(table.unscheduled.length, 1);
  assert.equal(table.unscheduled[0].name, '专题研讨');
  assert.equal(table.unscheduled[0].note, '时间地点另行通知');
  assert.equal(table.unscheduled[0].term, '秋');
});

test('课表：第 14 节的下课时间强制成 22:05（官方页面的口径）', async () => {
  const with14 = {
    kcbMap: { 3: { 14: { pyKcbjSjddVOList: [{ kcbjId: 'B1', kcmc: '晚课', zc: '1', pkxq: '13' }] } } },
  };
  const { request } = fakeRequest([
    ['queryByDm', ok({ dqxn: '2026', dqxq: '12' })],
    ['getJxrlByXnxq', ok(CALENDAR)],
    ['queryXskbByLoginUser', ok(with14)],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  const table = await timetable(client);

  const meeting = table.courses[0].meetings[0];
  assert.equal(meeting.startTime, '21:00');
  assert.equal(meeting.endTime, '22:05', '第 14 节不照接口的 21:45，官方页面写 22:05');
});

test('课表：冬学期的周次接着秋学期数，要换算成冬学期第几周', async () => {
  // xdxjKszc = 9 表示冬学期从第 9 周起；接口给的 zc 按大学期从 1 数。
  const calendar = { ...CALENDAR, xdxjKszc: 9 };
  const winter = {
    kcbMap: { 2: { 1: { pyKcbjSjddVOList: [{ kcbjId: 'W1', kcmc: '冬课', zc: '9,10', pkxq: '14' }] } } },
  };
  const { request } = fakeRequest([
    ['queryByDm', ok({ dqxn: '2026', dqxq: '12' })],
    ['getJxrlByXnxq', ok(calendar)],
    ['queryXskbByLoginUser', (url) => (url.includes('pkxq=14') ? ok(winter) : ok({}))],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  const table = await timetable(client);

  const course = table.courses[0];
  assert.equal(course.term, '冬');
  assert.equal(course.meetings[0].weeks, '第1-2周', '大学期第 9-10 周 = 冬学期第 1-2 周');
});

test('课表：没有教学日历时报错，不返回半截数据', async () => {
  const { request } = fakeRequest([
    ['queryByDm', ok({ dqxn: '2026', dqxq: '12' })],
    ['getJxrlByXnxq', ok({ kssj: null })],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  await assert.rejects(() => timetable(client), (e) => {
    assert.equal(e.code, 'SHAPE');
    assert.match(e.message, /教学日历/);
    return true;
  });
});

test('课表：星期或节次不合法时报错，不静默跳过', async () => {
  const bad = { kcbMap: { 9: { 1: { pyKcbjSjddVOList: [] } } } };
  const { request } = fakeRequest([
    ['queryByDm', ok({ dqxn: '2026', dqxq: '12' })],
    ['getJxrlByXnxq', ok(CALENDAR)],
    ['queryXskbByLoginUser', ok(bad)],
  ]);
  const client = new Yjsy({ request, entry: 'graduate', token: 't' });
  await assert.rejects(() => timetable(client), { code: 'SHAPE' });
});

/* ────────────────────────────── 登录入口 ── */

test('openYjsy：没有 acquireToken 时抛 CONFIG（登录不归数据源管）', async () => {
  await assert.rejects(() => openYjsy({}), (e) => {
    assert.equal(e.code, 'CONFIG');
    assert.match(e.message, /acquireToken/);
    return true;
  });
});

test('openYjsy：研究生先走研究生入口', async () => {
  const tried = [];
  const client = await openYjsy({
    username: '2234567890',
    request: async () => ({ status: 200, text: '{}' }),
    acquireToken: async (entry) => { tried.push(entry); return 'tok'; },
  });
  assert.deepEqual(tried, ['graduate']);
  assert.equal(client.entry, 'graduate');
});

test('openYjsy：本科生先走本科生入口', async () => {
  const tried = [];
  await openYjsy({
    username: '3234567890',
    request: async () => ({ status: 200, text: '{}' }),
    acquireToken: async (entry) => { tried.push(entry); return 'tok'; },
  });
  assert.deepEqual(tried, ['undergraduate']);
});

test('openYjsy：第一个入口失败时试另一个（本科生走研究生入口会拿到 500）', async () => {
  const tried = [];
  const client = await openYjsy({
    username: '3234567890',
    request: async () => ({ status: 200, text: '{}' }),
    acquireToken: async (entry) => {
      tried.push(entry);
      if (entry === 'undergraduate') throw new Error('无效的用户信息');
      return 'tok-from-graduate';
    },
  });
  assert.deepEqual(tried, ['undergraduate', 'graduate']);
  assert.equal(client.entry, 'graduate');
});

test('openYjsy：两边都失败时把各自的原因都带上', async () => {
  await assert.rejects(
    () => openYjsy({
      username: '1234567890',
      request: async () => ({ status: 200, text: '{}' }),
      acquireToken: async (entry) => { throw new Error(`${entry} 不行`); },
    }),
    (e) => {
      assert.equal(e.code, 'REJECTED');
      assert.match(e.message, /研究生入口：graduate 不行/);
      assert.match(e.message, /本科生入口：undergraduate 不行/);
      return true;
    },
  );
});
