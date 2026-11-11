/**
 * 实验课平台数据源的行为测试。
 *
 * # 测什么
 *
 * 签名算法、JWT 解析、`openWeek` 解析、请求形态（form-urlencoded）、
 * token 失效重登、以及各只读接口的响应校验。
 *
 * 全部用假 `request` —— 平台在私网 IP 上，测试环境连不上。
 *
 * # 一个必须钉住的事实
 *
 * POST 的请求体必须是 `application/x-www-form-urlencoded`。用 JSON 会稳定拿到
 * `code:400`。我在真机实测时先试了 JSON，一直 400 —— 这条测试防的就是那个回归。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  API_BASE, APP_KEY, APP_SECRET, LAB_HOST, LabCourse, LabError,
  apiSign, jwtExpiresAt, parseOpenWeek,
} from '../packages/source/lab/src/lab.js';

/* ────────────────────────────── 签名 ── */

test('apiSign：按参数名排序拼 k+v，跳过空值与对象', () => {
  const timestamp = 1700000000000;
  const data = { b: '2', a: '1', empty: '', skip: undefined, obj: { x: 1 } };
  // 手工算一遍，与实现互相独立。
  const expected = createHash('md5')
    .update(`${APP_SECRET}/api/x` + 'a1' + 'b2' + `${timestamp} ${APP_SECRET}`)
    .digest('hex');
  assert.equal(apiSign('/api/x', timestamp, data), expected);
});

test('apiSign：参数顺序不影响结果（内部排序）', () => {
  const timestamp = 1700000000000;
  assert.equal(
    apiSign('/p', timestamp, { a: 1, b: 2 }),
    apiSign('/p', timestamp, { b: 2, a: 1 }),
  );
});

test('apiSign：路径参与签名', () => {
  const timestamp = 1700000000000;
  assert.notEqual(apiSign('/api/a', timestamp, { x: 1 }), apiSign('/api/b', timestamp, { x: 1 }));
});

test('apiSign：timestamp 参与签名', () => {
  assert.notEqual(apiSign('/p', 1, {}), apiSign('/p', 2, {}));
});

test('常量：主机与端口与平台一致', () => {
  assert.equal(LAB_HOST, '10.203.16.55');
  assert.equal(API_BASE, 'http://10.203.16.55:8098/lab-course');
  assert.equal(APP_KEY, 'eb8c68399de7483abb2d8abaea0d039f');
  assert.equal(APP_SECRET, '7cd476ab866b49d7a9788ad9f4789495');
});

/* ────────────────────────────── JWT ── */

/** 造一个 exp 为指定秒数的假 JWT。 */
function fakeJwt(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

test('jwtExpiresAt：秒转毫秒', () => {
  assert.equal(jwtExpiresAt(fakeJwt(1800000000)), 1800000000 * 1000);
});

test('jwtExpiresAt：解不开返回 undefined，不抛', () => {
  assert.equal(jwtExpiresAt('not-a-jwt'), undefined);
  assert.equal(jwtExpiresAt(''), undefined);
  assert.equal(jwtExpiresAt(undefined), undefined);
});

test('jwtExpiresAt：payload 没有 exp 时 undefined', () => {
  const header = Buffer.from('{}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
  assert.equal(jwtExpiresAt(`${header}.${payload}.s`), undefined);
});

/* ────────────────────────────── openWeek ── */

test('parseOpenWeek：JSON 数组字符串', () => {
  assert.deepEqual(parseOpenWeek('["1,2","3,4"]'), ['1,2', '3,4']);
  assert.deepEqual(parseOpenWeek('["5"]'), ['5']);
});

test('parseOpenWeek：已是数组时原样转字符串', () => {
  assert.deepEqual(parseOpenWeek(['1,2']), ['1,2']);
});

test('parseOpenWeek：坏输入返回空数组，不抛', () => {
  assert.deepEqual(parseOpenWeek('not json'), []);
  assert.deepEqual(parseOpenWeek(''), []);
  assert.deepEqual(parseOpenWeek(null), []);
  assert.deepEqual(parseOpenWeek(undefined), []);
  assert.deepEqual(parseOpenWeek('{"a":1}'), [], '对象不是数组');
});

/* ────────────────────────────── 客户端 ── */

/**
 * 造一个假平台。
 *
 * @param routes - `[match, reply]`，reply 可以是函数。
 * @returns `{ request, calls }`。
 */
function fakePlatform(routes) {
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: init.headers ?? {} });
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) return typeof reply === 'function' ? reply(String(url), init) : reply;
    }
    return { status: 404, text: '' };
  };
  return { request, calls };
}

/** 一个成功的平台响应。 */
const ok = (data) => ({ status: 200, text: JSON.stringify({ code: 200, message: 'OK', data }) });

/** 默认的登录响应。 */
const LOGIN_OK = ok({
  token: { access_token: fakeJwt(Math.floor(Date.now() / 1000) + 172800), token_type: 'bearer' },
  name: '测试学生',
  role: 1,
  roles: [{ id: 1, name: '学生' }],
});

test('登录：POST 表单体（不是 JSON）—— 这是真机踩过的坑', async () => {
  const { request, calls } = fakePlatform([['/api/login', LOGIN_OK]]);
  const client = new LabCourse({ request, credentials: async () => ({ username: 'u', password: 'p' }) });
  await client.login();

  const login = calls.find((call) => call.url.includes('/api/login'));
  assert.equal(login.method, 'POST');
  assert.equal(login.headers['Content-Type'], 'application/x-www-form-urlencoded', 'JSON 会稳定 400');
  assert.match(login.body, /app_key=/);
  assert.match(login.body, /sign=/);
  assert.match(login.body, /username=u/);
});

test('登录：多角色时切到学生角色并换发 token', async () => {
  const studentToken = fakeJwt(Math.floor(Date.now() / 1000) + 172800);
  const { request, calls } = fakePlatform([
    ['/api/login', ok({
      token: { access_token: fakeJwt(Math.floor(Date.now() / 1000) + 172800), token_type: 'bearer' },
      name: '老师', role: 2, roles: [{ id: 2, name: '教师' }, { id: 1, name: '学生' }],
    })],
    ['/api/change_role', ok({ token: { access_token: studentToken, token_type: 'bearer' }, role: 1 })],
  ]);
  const client = new LabCourse({ request, credentials: async () => ({ username: 'u', password: 'p' }) });
  const auth = await client.login();

  assert.equal(auth.role, 1, '要切到学生角色');
  assert.equal(auth.token, studentToken, '要用换发后的 token');
  assert.ok(calls.some((call) => call.url.includes('/api/change_role')));
});

test('登录：没有凭据时抛 CREDENTIALS，文案说清去哪配', async () => {
  const { request } = fakePlatform([]);
  const client = new LabCourse({ request, credentials: async () => ({}) });
  await assert.rejects(() => client.login(), (error) => {
    assert.equal(error.code, 'CREDENTIALS');
    assert.match(error.message, /学号/);
    return true;
  });
});

test('token 失效（401）：重登一次后重放，且只重放一次', async () => {
  let attempts = 0;
  const { request, calls } = fakePlatform([
    ['/api/login', LOGIN_OK],
    ['/api/terms', () => {
      attempts += 1;
      return attempts === 1
        ? { status: 200, text: JSON.stringify({ code: 401, message: '无权限' }) }
        : ok({ content: [{ id: 1, name: '2026 秋冬', currentTerm: 1 }] });
    }],
  ]);
  const client = new LabCourse({ request, credentials: async () => ({ username: 'u', password: 'p' }) });
  const terms = await client.terms();

  assert.equal(terms.length, 1);
  assert.equal(attempts, 2, '失败一次后重放一次');
  assert.equal(calls.filter((call) => call.url.includes('/api/login')).length, 2, '要重新登录');
});

test('token 失效且重登后仍失败：抛 AUTH_EXPIRED，不无限重试', async () => {
  let attempts = 0;
  const { request } = fakePlatform([
    ['/api/login', LOGIN_OK],
    ['/api/terms', () => { attempts += 1; return { status: 200, text: JSON.stringify({ code: 408, message: 'token 失效' }) }; }],
  ]);
  const client = new LabCourse({ request, credentials: async () => ({ username: 'u', password: 'p' }) });

  await assert.rejects(() => client.terms(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    return true;
  });
  assert.equal(attempts, 2, '最多两次（原始 + 重放）');
});

test('响应不是 JSON 时抛 SHAPE，并带路径', async () => {
  const { request } = fakePlatform([['/api/login', LOGIN_OK], ['/api/terms', { status: 200, text: '<html>' }]]);
  const client = new LabCourse({ request, credentials: async () => ({ username: 'u', password: 'p' }) });
  await assert.rejects(() => client.terms(), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.equal(error.details.path, '/api/terms');
    return true;
  });
});

test('平台拒绝时抛 REJECTED，带上游 code 与 message', async () => {
  const { request } = fakePlatform([
    ['/api/login', LOGIN_OK],
    ['/api/terms', { status: 200, text: JSON.stringify({ code: 500, message: '系统繁忙' }) }],
  ]);
  const client = new LabCourse({ request, credentials: async () => ({ username: 'u', password: 'p' }) });
  await assert.rejects(() => client.terms(), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /系统繁忙/);
    assert.equal(error.details.code, 500);
    return true;
  });
});

test('带签名的 GET 请求把参数放进 query', async () => {
  const { request, calls } = fakePlatform([
    ['/api/login', LOGIN_OK],
    ['/api/courses/uid', ok([])],
  ]);
  const client = new LabCourse({ request, credentials: async () => ({ username: 'u', password: 'p' }) });
  await client.myCourses(7);

  const read = calls.find((call) => call.url.includes('/api/courses/uid'));
  assert.equal(read.method, 'GET');
  assert.match(read.url, /termId=7/);
  assert.match(read.url, /uid=u/);
  assert.match(read.url, /sign=/);
});

test('带 token 的请求有 Authorization 头', async () => {
  const { request, calls } = fakePlatform([['/api/login', LOGIN_OK], ['/api/terms', ok({ content: [] })]]);
  const client = new LabCourse({ request, credentials: async () => ({ username: 'u', password: 'p' }) });
  await client.terms().catch(() => {});
  const read = calls.find((call) => call.url.includes('/api/terms'));
  assert.match(String(read.headers.Authorization), /^bearer /);
});

/* ────────────────────────────── 只读接口 ── */

/** 造一个已登录的客户端。 */
async function loggedIn(routes) {
  const platform = fakePlatform([['/api/login', LOGIN_OK], ...routes]);
  const client = new LabCourse({ request: platform.request, credentials: async () => ({ username: 'u', password: 'p' }) });
  await client.login();
  return { client, ...platform };
}

test('currentTerm：只认唯一的 currentTerm===1', async () => {
  const { client } = await loggedIn([['/api/terms', ok({ content: [
    { id: 1, name: '旧' }, { id: 2, name: '当前', currentTerm: 1 },
  ] })]]);
  assert.equal((await client.currentTerm()).id, 2);
});

test('currentTerm：标记不唯一时抛 CONFIG（不按顺序猜）', async () => {
  const { client } = await loggedIn([['/api/terms', ok({ content: [
    { id: 1, name: 'a', currentTerm: 1 }, { id: 2, name: 'b', currentTerm: 1 },
  ] })]]);
  await assert.rejects(() => client.currentTerm(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /不唯一/);
    return true;
  });
});

test('terms：content 不是数组时抛 SHAPE', async () => {
  const { client } = await loggedIn([['/api/terms', ok({})]]);
  await assert.rejects(() => client.terms(), { code: 'SHAPE' });
});

test('myCourses：不是数组时抛 SHAPE（不视为没有课程）', async () => {
  const { client } = await loggedIn([['/api/courses/uid', ok({ content: [] })]]);
  await assert.rejects(() => client.myCourses(1), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /不能视为没有课程/);
    return true;
  });
});

test('labs：openWeek 解析成 weeks', async () => {
  const { client } = await loggedIn([['/course/labs', ok([
    { id: 11, courseId: 1, termId: 1, labName: '实验一', contain: 30, counts: 12, openWeek: '["1,2","3,4"]' },
  ])]]);
  const labs = await client.labs(1);
  assert.deepEqual(labs[0].weeks, ['1,2', '3,4']);
});

test('weekStatus：数值异常时整份作废（不带着 NaN 判断余量）', async () => {
  const { client } = await loggedIn([['/labs/status', ok({ '11_1,2': 'abc' })]]);
  await assert.rejects(() => client.weekStatus(1), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /不能据此判断余量/);
    return true;
  });
});

test('weekStatus：正常时转成数字', async () => {
  const { client } = await loggedIn([['/labs/status', ok({ '11_1,2': '12', '12_3': 5 })]]);
  assert.deepEqual(await client.weekStatus(1), { '11_1,2': 12, '12_3': 5 });
});

test('mySelections：缺 content 时抛 SHAPE（不能据此确认选课结果）', async () => {
  const { client } = await loggedIn([['/api/course/lab/students', ok({})]]);
  await assert.rejects(() => client.mySelections(1), { code: 'SHAPE' });
});

test('openStatus：可按学期过滤', async () => {
  const { client } = await loggedIn([['/open_status', ok({
    openstatus: [{ id: 1, termId: 1 }, { id: 2, termId: 2 }], timestamp: 1700000000000,
  })]]);
  assert.equal((await client.openStatus()).length, 2);
  assert.equal((await client.openStatus(2)).length, 1);
  assert.equal((await client.openStatus(2))[0].id, 2);
});

test('notices：正文转纯文本，剥标签', async () => {
  const { client } = await loggedIn([['/api/notices/student', ok([
    { id: 1, title: '通知', content: '<p>正文<b>加粗</b></p>', gmtCreate: 1700000000000 },
  ])]]);
  const notices = await client.notices();
  assert.equal(notices[0].text, '正文 加粗');
  assert.equal(notices[0].title, '通知');
});

test('myInfo：剥掉 password 字段', async () => {
  const { client } = await loggedIn([['/students', ok({ id: 1, name: '张三', password: 'HASH' })]]);
  const info = await client.myInfo();
  assert.equal(info.name, '张三');
  assert.equal('password' in info, false, '平台里的 password 是哈希，不该外传');
});

test('myTimetable：缺 dates 时查日期表；查不到给 null', async () => {
  const { client } = await loggedIn([
    ['/api/courses/uid', ok([{ id: 1 }])],
    ['/lab/students/full', ok({ content: [
      { id: 11, course_id: 1, select_week: '1,2', dates: '', times: '10:00', course_name: '大物实验', lab_name: '实验一', address: '东1,', teacher_name: '王老师' },
    ] })],
    ['/api/courseLabTimes/date', ok({ '11_1,2': '2026-09-14\n2026-09-21' })],
  ]);
  const rows = await client.myTimetable(1);
  assert.equal(rows.length, 2, '两个日期展开成两次课');
  assert.deepEqual(rows.map((row) => row.date), ['2026-09-14', '2026-09-21']);
  assert.equal(rows[0].room, '东1', '地址末尾的逗号要去掉');
});
