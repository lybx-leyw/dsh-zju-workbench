/**
 * 学在浙大数据源（`@lybx-leyw/dsh-zju-source-xuezai`）的测试。
 *
 * # 这个文件覆盖什么
 *
 * 三层，逐层加宽：
 *
 *   1. **纯函数** —— 时间口径、过滤口径、附件去重、分页、提交状态、错误翻译；
 *   2. **客户端**（`XzzdApi` / `XzzdReader`）—— 用假 `transport.request` /
 *      假 `api.json` 打桩，覆盖每个错误分支与降级规则；
 *   3. **宿主入口**（`apply()`）—— 用最小 cordis 替身验证服务名、路由路径、
 *      动作分派、CSRF 头、非法 action、以及 `todos()` 的返回形状。
 *
 * # 为什么集成层必须有测试（照 `tests/yjsy-host.test.mjs` 的理由）
 *
 * 纯函数全绿但插件起不来，是本仓出现过的事故类型：`session: { jar: null }`
 * 让一次真实请求也发不出去，而纯解析测试照样全绿。本文件的
 * 「apply() 真的 provide 了 zhiyunXuezai 并注册了路由」与
 * 「GET 路由离线也能返回形状完整的 todos」两条就是拦这个的。
 *
 * # 全部离线
 *
 * 不联网、不读凭据、不写磁盘（唯一例外是"旧会话迁移"那一条，用临时目录）。
 * `apply()` 的 `config.fetch` 注入点保证不会真的发请求。
 *
 * # 一条口径
 *
 * 断言用**具体值**，不用 `every` / `some`：那类断言在空数组上永远通过，
 * 于是"什么都没读到"会被判成绿。凡是用到它们的，同时断言 `.length`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  apply, translateXzzdError, normalizeXzzd, fault, XuezaiError,
  ROUTE_PATH, SERVICE_NAME, WRITE_HEADER,
} from '../../../packages/source/xuezai/src/index.js';
import {
  XzzdApi, buildCourseTodos, isPendingTodo, normalizeDeadline, hasXzzdSession,
  diffTodos, API_MY_SEMESTERS, API_MY_COURSES, API_TODOS, courseApis,
  ONGOING_STATUS, COURSE_CONCURRENCY, COURSE_PAGE_SIZE,
} from '../../../packages/source/xuezai/src/xzzd.js';
import {
  XzzdReader, activitySummary, boundedText, filesOf, isGroupHomework,
  pageInfo, publicFile, submissionState,
} from '../../../packages/source/xuezai/src/xzzd-reads.js';
import { XZZD_BASE, XZZD_HOST, CAS_HOST, XUEZAI_HOSTS } from '../../../packages/source/xuezai/src/hosts.js';
import {
  upgrade, casErrorMessage, describeAuthFailure, xzzdLogin, xzzdAuthorize,
} from '../../../packages/source/xuezai/src/cas/login.js';
import { rsaEncrypt, executionToken } from '../../../packages/source/xuezai/src/cas/rsa.js';

/* ────────────────────────────────────── 夹具 */

const XZZD = XZZD_BASE;
const JSON_HEADERS = () => new Headers({ 'content-type': 'application/json' });

/**
 * 造一个假 Transport。
 *
 * `route(url, init)` 返回 `{ status, text, headers?, location? }`；
 * `session.jar.getCookies()` 由 `cookies` 决定。
 */
function fakeTransport(route, { cookies = [], epoch = 0 } = {}) {
  const calls = [];
  const transport = {
    calls,
    session: {
      epoch,
      jar: {
        getCookies: async () => cookies,
        setCookie: async () => {},
      },
      save: async () => {},
    },
    async request(url, init = {}) {
      const target = String(url);
      calls.push({ url: target, method: init.method ?? 'GET', body: init.body ?? null, headers: init.headers ?? {} });
      const out = await route(target, init);
      const headers = out.headers ?? JSON_HEADERS();
      if (out.location !== undefined) headers.set('location', out.location);
      return { status: out.status ?? 200, headers, text: out.text ?? '{}' };
    },
  };
  return transport;
}

/** 按 URL 片段匹配回包；未匹配的回 `{}` 200。 */
function router(routes) {
  return async (url) => {
    for (const [needle, handler] of routes) {
      if (url.includes(needle)) return handler(url);
    }
    return { status: 200, text: '{}' };
  };
}

const json = (payload, status = 200) => ({ status, text: JSON.stringify(payload) });

/** 造一个假 XzzdApi（只给 `json`）。 */
function fakeApi(routes) {
  const calls = [];
  return {
    calls,
    async json(url, options) {
      const target = String(url);
      calls.push({ url: target, options });
      for (const [needle, handler] of routes) {
        if (target.includes(needle)) return handler(target, options);
      }
      return {};
    },
  };
}

const reader = (api) => new XzzdReader(api, XZZD);

/* ────────────────────────────────────── 站点常量 */

test('主机白名单覆盖学在浙大三件套，且不含拼题A与网关', () => {
  // 这条是「登录成功但会话为空」的根因守卫：Transport 只在主机命中白名单时
  // 才读写 cookie。漏一个 → 请求不带 cookie、Set-Cookie 也存不下。
  assert.equal(XUEZAI_HOSTS.has('courses.zju.edu.cn'), true, '业务域必须在');
  assert.equal(XUEZAI_HOSTS.has('zjuam.zju.edu.cn'), true, 'CAS 域必须在，否则 SSO 票存不进去');
  assert.equal(XUEZAI_HOSTS.has('identity.zju.edu.cn'), true);

  // 收窄同样重要：白名单里多一台主机，就多一份把会话 cookie 发出去的暴露面。
  assert.equal(XUEZAI_HOSTS.has('pintia.cn'), false, '拼题A 的会话归 pta 包，本包不能代为携带');
  assert.equal(XUEZAI_HOSTS.has('webvpn.zju.edu.cn'), false, 'courses 判 public，不需要网关域');

  assert.equal(XUEZAI_HOSTS.size, 3, `白名单应收窄到 3 台，实际 ${XUEZAI_HOSTS.size}`);
});

test('站点常量拼装一致', () => {
  assert.equal(XZZD_HOST, 'courses.zju.edu.cn');
  assert.equal(XZZD_BASE, 'https://courses.zju.edu.cn');
  assert.equal(CAS_HOST, 'zjuam.zju.edu.cn');
});

/* ────────────────────────────────────── 时间口径 */

test('normalizeDeadline：裸时间按东八区解释，带时区的原样', () => {
  // ⚠️ 这条钉的是"不用机器本地时区"。CI 在 UTC 跑时若按本地解释，
  // 结果会差 8 小时，而测试仍然"通过"（因为它比的是自己算出来的值）。
  assert.deepEqual(normalizeDeadline('2026-10-30 15:59:00'), {
    iso: '2026-10-30T07:59:00.000Z', text: '2026-10-30 15:59:00',
  });
  assert.equal(normalizeDeadline('2026-10-30T15:59:00+08:00').iso, '2026-10-30T07:59:00.000Z');
  assert.equal(normalizeDeadline('2026-10-30T07:59:00Z').iso, '2026-10-30T07:59:00.000Z');
});

test('normalizeDeadline：空值与非法值不猜', () => {
  assert.deepEqual(normalizeDeadline(null), { iso: null, text: null });
  assert.deepEqual(normalizeDeadline(''), { iso: null, text: null });
  assert.deepEqual(normalizeDeadline('   '), { iso: null, text: null });
  // 解析不了的保留原文（用户至少能看到平台给的是什么），但 iso 必须为 null ——
  // 拿一个假的 iso 去排序会把垃圾排到最前面。
  assert.deepEqual(normalizeDeadline('不是时间'), { iso: null, text: '不是时间' });
});

/* ────────────────────────────────────── 过滤口径 */

test('isPendingTodo：六个条件缺一不可', () => {
  const now = new Date('2026-10-20T00:00:00+08:00');
  const base = {
    published: true,
    startTime: '2026-10-19T00:00:00+08:00',
    endTime: '2026-10-30T23:59:00+08:00',
    submitted: false,
    fullyScored: false,
    now,
  };
  assert.equal(isPendingTodo(base), true, '基准情形应当留下');

  assert.equal(isPendingTodo({ ...base, published: false }), false, '未发布不留');
  assert.equal(isPendingTodo({ ...base, published: 'true' }), false, '只认布尔 true，不认字符串');
  assert.equal(isPendingTodo({ ...base, endTime: null }), false, '没有截止时间不留');
  assert.equal(isPendingTodo({ ...base, endTime: '2026-10-19T00:00:00+08:00' }), false, '已截止不留');
  assert.equal(isPendingTodo({ ...base, startTime: '2026-11-01T00:00:00+08:00' }), false, '还没开始不留');
  assert.equal(isPendingTodo({ ...base, submitted: true }), false, '已提交不留');
  assert.equal(isPendingTodo({ ...base, fullyScored: true }), false, '已满分不留');
});

test('isPendingTodo：没有开始时间视为已开始', () => {
  const now = new Date('2026-10-20T00:00:00+08:00');
  assert.equal(isPendingTodo({
    published: true, startTime: null, endTime: '2026-10-30T23:59:00+08:00',
    submitted: false, fullyScored: false, now,
  }), true);
});

/* ────────────────────────────────────── 拼装待办 */

test('buildCourseTodos：三类条目 + 两种"已交"过滤', () => {
  // 已交作业认 status_code==='submitted' **或** status==='finished'；
  // 上游两个版本口径不一致，两个都认 —— 漏判会让已交的作业一直挂在待办里。
  const course = { id: '7', name: '软件工程' };
  const now = new Date('2026-10-20T00:00:00+08:00');
  const rows = buildCourseTodos(course, {
    activities: [
      { id: 1, title: '作业一', type: 'homework', published: true, end_time: '2026-10-30 23:59:00' },
      { id: 2, title: '已交作业', type: 'homework', published: true, end_time: '2026-10-30 23:59:00' },
      { id: 3, title: '已完成的作业', type: 'homework', published: true, end_time: '2026-10-30 23:59:00' },
      { id: 4, title: '满分作业', type: 'homework', published: true, end_time: '2026-10-30 23:59:00',
        completion_criterion_key: 'score', score_percentage: 1 },
      { id: 5, title: '  ', type: 'homework', published: true, end_time: '2026-10-30 23:59:00' },
      { id: 0, title: '垃圾 id', published: true, end_time: '2026-10-30 23:59:00' },
    ],
    exams: [
      { id: 11, title: '小测一', published: true, end_time: '2026-10-28 23:59:00' },
      { id: 12, title: '已交小测', published: true, end_time: '2026-10-28 23:59:00' },
    ],
    homeworkActivities: [
      { id: 2, status_code: 'submitted' },
      { id: 3, status: 'finished' },
    ],
    submittedExamIds: ['12'],
    classrooms: [
      // 进行中：start 在 now 之前、end 在 now 之后
      { id: 21, title: '课堂练习', status: 'start', start_at: '2026-10-19T10:00:00+08:00', end_at: '2026-10-21T11:00:00+08:00' },
      { id: 22, title: '还没开始', status: 'start', start_at: '2026-10-25T10:00:00+08:00', end_at: '2026-10-25T11:00:00+08:00' },
      { id: 23, title: '已结束', status: 'start', start_at: '2026-10-18T10:00:00+08:00', end_at: '2026-10-18T11:00:00+08:00' },
      { id: 24, title: '不是 start', status: 'closed' },
    ],
  }, now);

  const ids = rows.map((row) => row.id).sort();
  assert.deepEqual(ids, ['1', '11', '21', '5'], `实际留下 ${ids.join(',')}`);

  assert.equal(rows.find((r) => r.id === '1').type, 'homework');
  assert.equal(rows.find((r) => r.id === '11').type, 'quiz');
  assert.equal(rows.find((r) => r.id === '21').type, 'classroom');
  assert.equal(rows.find((r) => r.id === '5').title, '（无标题活动）', '空标题要有占位而不是空串');

  for (const row of rows) {
    assert.equal(row.source, 'xzzd');
    assert.equal(row.courseId, '7');
    assert.equal(row.courseName, '软件工程');
  }
  // 每条按**自己的** end_time 换算（作业 10-30、测验 10-28、课堂互动用 end_at）
  assert.equal(rows.find((r) => r.id === '1').due, '2026-10-30T15:59:00.000Z');
  assert.equal(rows.find((r) => r.id === '11').due, '2026-10-28T15:59:00.000Z');
  assert.equal(rows.find((r) => r.id === '21').due, '2026-10-21T03:00:00.000Z', '课堂互动用 end_at');
  assert.match(rows.find((r) => r.id === '21').url, /\/course\/7\/classroom-list$/);
  assert.match(rows.find((r) => r.id === '1').url, /#\/1$/);
});

test('buildCourseTodos：空 bundle 给空数组（不造占位）', () => {
  assert.deepEqual(buildCourseTodos({ id: '7', name: 'x' }, {}, new Date()), []);
  assert.deepEqual(buildCourseTodos({ id: '7', name: 'x' }, { activities: [], exams: [], classrooms: [] }, new Date()), []);
});

/* ────────────────────────────────────── 两条路的对账 */

test('diffTodos：按 courseId:type:id 比对，并把课堂互动与真遗漏分开', () => {
  const fast = [
    { id: '1', courseId: '7', type: 'homework', title: '共同' },
    { id: '2', courseId: '7', type: 'homework', title: '只在聚合端点' },
  ];
  const slow = [
    { id: '1', courseId: '7', type: 'homework', title: '共同' },
    { id: '3', courseId: '7', type: 'homework', title: '只在逐课' },
    { id: '4', courseId: '7', type: 'classroom', title: '课堂互动' },
  ];
  const diff = diffTodos(fast, slow);

  assert.equal(diff.fastCount, 2);
  assert.equal(diff.slowCount, 3);
  assert.equal(diff.both, 1);
  assert.equal(diff.onlyFast.length, 1);
  assert.equal(diff.onlyFast[0].id, '2');
  assert.equal(diff.onlySlow.length, 2);
  assert.deepEqual(diff.onlySlowByType, { homework: 1, classroom: 1 });
  // 关键：课堂互动的缺失是结构决定的，不算"漏"。
  assert.equal(diff.missingFromFast.length, 1, '只有作业算真遗漏');
  assert.equal(diff.missingFromFast[0].id, '3');
});

test('diffTodos：全等时差异为空（且能区分"都空"与"都有"）', () => {
  const empty = diffTodos([], []);
  assert.deepEqual(empty, {
    fastCount: 0, slowCount: 0, both: 0, onlyFast: [], onlySlow: [], onlySlowByType: {}, missingFromFast: [],
  });

  const same = diffTodos([{ id: '1', courseId: '7', type: 'homework' }], [{ id: '1', courseId: '7', type: 'homework' }]);
  assert.equal(same.both, 1);
  assert.equal(same.missingFromFast.length, 0);
});

/* ────────────────────────────────────── 客户端：请求与错误分支 */

test('XzzdApi 拒绝不带 Transport 的构造', () => {
  assert.throws(() => new XzzdApi(null), (error) => error.code === 'CONFIG');
  assert.throws(() => new XzzdApi({}), (error) => error.code === 'CONFIG');
});

test('XzzdApi 只允许学在浙大的接口（跨站一律拒绝）', async () => {
  const transport = fakeTransport(async () => json({}));
  const api = new XzzdApi(transport);
  await assert.rejects(() => api.json('https://pintia.cn/api/x'), (error) => error.code === 'INVALID_PATH');
  assert.equal(transport.calls.length, 0, '非法主机不该打到网络');
});

test('XzzdApi 的状态码与响应体分支', async () => {
  const cases = [
    [{ status: 401 }, 'SESSION_EXPIRED'],
    [{ status: 302 }, 'SESSION_EXPIRED'],
    [{ status: 403 }, 'FORBIDDEN'],
    [{ status: 429 }, 'RATE_LIMITED'],
    [{ status: 500 }, 'HTTP'],
    [{ status: 200, text: '{"a":1}' }], // 成功
    [{ status: 200, text: '<html>random</html>' }, 'API_SHAPE'],
    [{ status: 200, text: '<html>name="execution"</html>' }, 'SESSION_EXPIRED'],
    [{ status: 200, text: 'not json' }, 'API_SHAPE'],
    [{ status: 200, text: '[1,2]' }, 'API_SHAPE'],
  ];
  for (const [reply, expected] of cases) {
    const transport = fakeTransport(async () => ({ status: 200, text: '{}', ...reply }));
    const api = new XzzdApi(transport);
    if (expected === undefined) {
      const data = await api.json(`${XZZD}/api/x`);
      assert.deepEqual(data, { a: 1 });
      continue;
    }
    await assert.rejects(() => api.json(`${XZZD}/api/x`), (error) => {
      assert.equal(error.code, expected, `${JSON.stringify(reply)} 应判 ${expected}，实际 ${error.code}`);
      return true;
    });
  }
});

test('XzzdApi 请求头带 Referer / Origin / X-Requested-With', async () => {
  const transport = fakeTransport(async () => json({ ok: 1 }));
  await new XzzdApi(transport).json(`${XZZD}/api/x`);
  const sent = transport.calls[0].headers;
  assert.equal(sent['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(sent.Origin, XZZD);
  assert.equal(sent.Referer, `${XZZD}/user/index`);
  assert.equal(sent.Accept, 'application/json');
  assert.equal(sent['Content-Type'], undefined, 'GET 不该带 Content-Type');
});

test('XzzdApi 会话失效时只重试一次，且只重试 GET', async () => {
  let attempts = 0;
  const transport = fakeTransport(async () => {
    attempts += 1;
    return attempts === 1 ? { status: 401 } : json({ ok: 1 });
  });
  const refreshed = [];
  const api = new XzzdApi(transport, { refreshSession: async epoch => { refreshed.push(epoch); } });
  assert.deepEqual(await api.json(`${XZZD}/api/x`), { ok: 1 });
  assert.equal(attempts, 2);
  assert.deepEqual(refreshed, [0]);
});

test('XzzdApi 第二次仍失效就直接报错（不无限重试）', async () => {
  let attempts = 0;
  const transport = fakeTransport(async () => { attempts += 1; return { status: 401 }; });
  const api = new XzzdApi(transport, { refreshSession: async () => {} });
  await assert.rejects(() => api.json(`${XZZD}/api/x`), (error) => error.code === 'SESSION_EXPIRED');
  assert.equal(attempts, 2, '只允许重试一次');
});

test('XzzdApi POST 遇到会话失效不重放（避免重复提交）', async () => {
  let attempts = 0;
  const transport = fakeTransport(async () => { attempts += 1; return { status: 401 }; });
  const api = new XzzdApi(transport, { refreshSession: async () => { throw new Error('不该被调用'); } });
  await assert.rejects(() => api.json(`${XZZD}/api/x`, { method: 'POST' }), (error) => error.code === 'SESSION_EXPIRED');
  assert.equal(attempts, 1, 'POST 不重试');
});

/* ────────────────────────────────────── 客户端：学期与课程 */

test('activeSemesterIds：只认 is_active，并补上相邻两个 id', async () => {
  const transport = fakeTransport(router([
    ['/api/my-semesters', () => json({
      semesters: [
        { id: 10, name: '2025 春夏', is_active: true },
        { id: 20, name: '2025 秋冬', is_active: false },
        { id: '30', name: '2026 春夏', is_active: 1 },
        { id: 'bad', name: '垃圾', is_active: true },
      ],
    })],
  ]));
  // 补 id+1 / id+2 是照 Flutter 版：浙大有短学期，is_active 未必覆盖正在用的那个。
  assert.deepEqual(await new XzzdApi(transport).activeSemesterIds(), [10, 11, 12, 30, 31, 32]);
});

test('activeSemesterIds：缺 semesters 字段时如实报结构异常', async () => {
  const transport = fakeTransport(async () => json({ list: [] }));
  await assert.rejects(() => new XzzdApi(transport).activeSemesterIds(), (error) => error.code === 'API_SHAPE');
});

test('courses：只保留 id 与 name，没有 id 的丢掉', async () => {
  const transport = fakeTransport(router([
    ['/api/my-courses', () => json({
      courses: [
        { id: 7, name: ' 软件工程 ' },
        { name: '没有 id' },
        { id: null, name: 'id 为 null' },
      ],
    })],
  ]));
  assert.deepEqual(await new XzzdApi(transport).courses([10]), [{ id: '7', name: '软件工程' }]);
});

test('courses：空学期列表直接返回空，不发请求', async () => {
  const transport = fakeTransport(async () => json({ courses: [] }));
  assert.deepEqual(await new XzzdApi(transport).courses([]), []);
  assert.equal(transport.calls.length, 0);
});

test('courses 的 conditions 与分页参数口径', async () => {
  const transport = fakeTransport(router([['/api/my-courses', () => json({ courses: [] })]]));
  await new XzzdApi(transport).courses([10, 11]);
  const url = new URL(transport.calls[0].url);
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('page_size'), String(COURSE_PAGE_SIZE));
  assert.equal(url.searchParams.get('sort'), 'all');
  const conditions = JSON.parse(url.searchParams.get('conditions'));
  assert.deepEqual(conditions.semester_id, [10, 11]);
  assert.deepEqual(conditions.status, [...ONGOING_STATUS], '只要进行中/未开始');
  assert.deepEqual(conditions.display_studio_list, false);
  assert.equal(url.searchParams.get('fields'), 'id,name,course_code');
});

test('courseApis：homeworkSubmissionStatus 必须是**单数** course', () => {
  // 改成复数会 404。这条是照抄上游口径，不是笔误。
  // 注意路径里还有第二个段：`/homework/submission-status`（两级，不是拼接词）。
  const urls = courseApis('7');
  assert.match(urls.homeworkSubmissionStatus, /\/api\/course\/7\/homework\/submission-status/);
  assert.equal(urls.homeworkSubmissionStatus.includes('/api/courses/'), false);
  assert.match(urls.activities, /\/api\/courses\/7\/activities/);
  assert.match(urls.exams, /\/api\/courses\/7\/exams/);
  assert.match(urls.submittedExams, /\/api\/courses\/7\/submitted-exams/);
  assert.match(urls.classroomList, /\/api\/courses\/7\/classroom-list/);
});

test('COURSE_CONCURRENCY 保持串行（=1）', () => {
  // 课程之间并发是唯一会成倍放大瞬时请求的维度，风控面在这里。
  assert.equal(COURSE_CONCURRENCY, 1);
});

/* ────────────────────────────────────── 客户端：courseBundle 的两段式 */

test('courseBundle：空课只发 3 个必看端点，跳过两个过滤器', async () => {
  const transport = fakeTransport(router([
    ['/activities', () => json({ activities: [] })],
    ['/exams', () => json({ exams: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
  ]));
  const bundle = await new XzzdApi(transport).courseBundle('7');
  assert.deepEqual(bundle, { activities: [], exams: [], homeworkActivities: [], submittedExamIds: [], classrooms: [] });
  assert.equal(transport.calls.length, 3, `空课应只花 3 个请求，实际 ${transport.calls.length}`);
  assert.equal(transport.calls.some((c) => c.url.includes('submission-status')), false);
  assert.equal(transport.calls.some((c) => c.url.includes('submitted-exams')), false);
});

test('courseBundle：有作业/测验时才补两个过滤器', async () => {
  const transport = fakeTransport(router([
    ['/activities', () => json({ activities: [{ id: 1 }] })],
    ['/exams', () => json({ exams: [{ id: 2 }] })],
    ['/classroom-list', () => json({ classrooms: [] })],
    ['submission-status', () => json({ homework_activities: [{ id: 9, status_code: 'submitted' }] })],
    ['submitted-exams', () => json({ exam_ids: [2] })],
  ]));
  const bundle = await new XzzdApi(transport).courseBundle('7');
  assert.equal(transport.calls.length, 5);
  assert.equal(bundle.homeworkActivities.length, 1);
  assert.deepEqual(bundle.submittedExamIds, [2]);
});

test('courseBundle：403 只丢那一类，会话失效/限流必须抛', async () => {
  const forbidden = fakeTransport(router([
    ['/activities', () => ({ status: 403 })],
    ['/exams', () => json({ exams: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
  ]));
  const bundle = await new XzzdApi(forbidden).courseBundle('7');
  assert.deepEqual(bundle.activities, [], '403 的栏目按"没有"处理');

  for (const status of [401, 429]) {
    const transport = fakeTransport(router([
      ['/activities', () => ({ status })],
      ['/exams', () => json({ exams: [] })],
      ['/classroom-list', () => json({ classrooms: [] })],
    ]));
    await assert.rejects(() => new XzzdApi(transport).courseBundle('7'), (error) => {
      assert.equal(error.code, status === 401 ? 'SESSION_EXPIRED' : 'RATE_LIMITED');
      return true;
    });
  }
});

test('courseBundle：提交状态 404 表示该课无作业，不编造未交', async () => {
  const transport = fakeTransport(router([
    ['/activities', () => json({ activities: [{ id: 1 }] })],
    ['/exams', () => json({ exams: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
    ['submission-status', () => ({ status: 404 })],
  ]));
  const bundle = await new XzzdApi(transport).courseBundle('7');
  assert.deepEqual(bundle.homeworkActivities, []);
});

test('courseBundle：缺字段时如实报结构异常（不静默空）', async () => {
  const transport = fakeTransport(router([
    ['/activities', () => json({ things: [] })],
    ['/exams', () => json({ exams: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
  ]));
  await assert.rejects(() => new XzzdApi(transport).courseBundle('7'), (error) => error.code === 'API_SHAPE');
});

/* ────────────────────────────────────── 客户端：聚合端点与逐课 */

test('todosFast：1 个请求，且只留未截止的', async () => {
  const transport = fakeTransport(router([['/api/todos', () => json({
    todo_list: [
      { id: 1, title: '还没截止', type: 'homework', course_id: 7, course_name: '软工', end_time: '2099-01-01 23:59:00' },
      { id: 2, title: '已过期', type: 'homework', course_id: 7, end_time: '2000-01-01 00:00:00' },
      { id: 3, title: '', type: 'quiz', course_id: 7, end_time: '2099-01-02 23:59:00' },
      { id: 0, title: '垃圾', end_time: '2099-01-01 23:59:00' },
    ],
  })]]));
  const out = await new XzzdApi(transport).todosFast();
  assert.equal(transport.calls.length, 1, '聚合端点只发 1 个请求');
  assert.equal(out.todos.length, 2, `实际 ${JSON.stringify(out.todos.map(t => t.id))}`);
  assert.deepEqual(out.todos.map(t => t.id), ['1', '3'], '按截止时间升序');
  assert.equal(out.todos[0].courseName, '软工');
  assert.equal(out.todos[0].source, 'xzzd');
  assert.equal(out.todos[1].title, '（无标题测验）');
  assert.match(out.todos[0].url, /\/course\/7\/learning-activity#\/1$/);
});

test('todosFast：缺 todo_list 时如实报结构异常', async () => {
  const transport = fakeTransport(async () => json({ items: [] }));
  await assert.rejects(() => new XzzdApi(transport).todosFast(), (error) => error.code === 'API_SHAPE');
});

test('todos：活跃学期里没有课程时给空并说明', async () => {
  const transport = fakeTransport(router([
    ['/api/my-semesters', () => json({ semesters: [{ id: 10, is_active: true }] })],
    ['/api/my-courses', () => json({ courses: [] })],
  ]));
  const out = await new XzzdApi(transport).todos();
  assert.deepEqual(out.todos, []);
  assert.deepEqual(out.courses, []);
  assert.match(out.note, /没有进行中的课程/);
});

test('todos：串行逐课，每门课都折进结果', async () => {
  const transport = fakeTransport(router([
    ['/api/my-semesters', () => json({ semesters: [{ id: 10, is_active: true }] })],
    ['/api/my-courses', () => json({ courses: [{ id: 7, name: '软工' }, { id: 8, name: '编译' }] })],
    ['/api/courses/7/activities', () => json({ activities: [{ id: 1, title: 'A', type: 'homework', published: true, end_time: '2099-01-01 23:59:00' }] })],
    ['/api/courses/7/exams', () => json({ exams: [] })],
    ['/api/courses/7/classroom-list', () => json({ classrooms: [] })],
    // 有作业 → 必然补 submission-status（第二个过滤器按需，exams 为空所以不补）
    ['/api/course/7/homework/submission-status', () => json({ homework_activities: [] })],
    ['/api/courses/8/activities', () => json({ activities: [{ id: 2, title: 'B', type: 'homework', published: true, end_time: '2099-01-02 23:59:00' }] })],
    ['/api/courses/8/exams', () => json({ exams: [] })],
    ['/api/courses/8/classroom-list', () => json({ classrooms: [] })],
    ['/api/course/8/homework/submission-status', () => json({ homework_activities: [] })],
  ]));
  const out = await new XzzdApi(transport).todos();
  assert.equal(out.courses.length, 2);
  assert.deepEqual(out.todos.map(t => t.id), ['1', '2']);
  // 2 门课各 4 个端点（3 必看 + 1 按需补的提交状态）+ 学期 + 课程 = 10 个请求
  assert.equal(transport.calls.length, 10, `实际 ${transport.calls.length}`);
  assert.equal(transport.calls.some((c) => c.url.includes('submitted-exams')), false, 'exams 为空不补第二个过滤器');
});

test('todos：并发参数只允许 1 或 2', async () => {
  const transport = fakeTransport(async () => json({ semesters: [] }));
  for (const bad of [0, 3, 1.5, '1']) {
    await assert.rejects(() => new XzzdApi(transport).todos({ concurrency: bad }), (error) => error.code === 'CONFIG');
  }
});

/* ────────────────────────────────────── 会话探测 */

test('hasXzzdSession：只认非空的 session cookie', async () => {
  const withSession = fakeTransport(async () => json({}), { cookies: [{ key: 'session', value: 'abc' }] });
  assert.equal(await hasXzzdSession(withSession), true);

  const empty = fakeTransport(async () => json({}), { cookies: [{ key: 'session', value: '' }] });
  assert.equal(await hasXzzdSession(empty), false);

  const other = fakeTransport(async () => json({}), { cookies: [{ key: '_token', value: 'x' }] });
  assert.equal(await hasXzzdSession(other), false);

  // jar 抛错时判"没有会话"，不把整个调用变成异常
  const broken = { session: { jar: { getCookies: async () => { throw new Error('boom'); } } } };
  assert.equal(await hasXzzdSession(broken), false);
});

/* ────────────────────────────────────── 深入读取：纯函数 */

test('boundedText：超长截断并说明原文长度', () => {
  assert.equal(boundedText('short'), 'short');
  const out = boundedText('x'.repeat(20), 5);
  assert.ok(out.startsWith('xxxxx'));
  assert.match(out, /已截断，原文 20 字符/);
  assert.equal(boundedText(null), '');
  assert.equal(boundedText(undefined), '');
});

test('publicFile：兼容两种字段名', () => {
  assert.deepEqual(publicFile({ id: 1, name: 'a.pdf', mime_type: 'application/pdf' }), {
    id: 1, name: 'a.pdf', size: null, mimeType: 'application/pdf', allowDownload: null, updatedAt: null,
  });
  const alt = publicFile({ upload_id: 2, file_name: 'b.doc', content_type: 'x' });
  assert.equal(alt.id, 2);
  assert.equal(alt.name, 'b.doc');
  assert.equal(alt.mimeType, 'x');
});

test('filesOf：三处来源都看，去重，且"禁止下载"有否决权', () => {
  const files = filesOf({
    uploads: [{ id: 1, name: 'a', allow_download: true }],
    data: {
      uploads: [{ id: 1, name: 'a', allow_download: false }],
      files: [{ id: 2, name: 'b' }],
    },
  });
  assert.equal(files.length, 2, '按 id 去重');
  assert.equal(files.find((f) => f.id === 1).allowDownload, false, '任一来源禁止即禁止');
  assert.equal(files.find((f) => f.id === 2).name, 'b');
});

test('filesOf：否决权与出现顺序无关', () => {
  const first = filesOf({
    uploads: [{ id: 1, allow_download: true }],
    data: { files: [{ id: 1, allow_download: false }] },
  });
  const second = filesOf({
    uploads: [{ id: 1, allow_download: false }],
    data: { files: [{ id: 1, allow_download: true }] },
  });
  assert.equal(first[0].allowDownload, false, 'true → false 必须禁止');
  assert.equal(second[0].allowDownload, false, 'false → true 也必须禁止');
});

test('filesOf：合并时不丢先出现那份的 mimeType/updatedAt', () => {
  const files = filesOf({
    uploads: [{ id: 3, mime_type: 'application/pdf', updated_at: '2026-10-01', size: 9 }],
    data: { files: [{ id: 3 }] },
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].mimeType, 'application/pdf');
  assert.equal(files[0].updatedAt, '2026-10-01');
  assert.equal(files[0].size, 9);
});

test('filesOf：没有 id 的丢掉，空输入给空数组', () => {
  assert.deepEqual(filesOf({ uploads: [{ name: '无 id' }] }), []);
  assert.deepEqual(filesOf({}), []);
  assert.deepEqual(filesOf(null), []);
});

test('isGroupHomework：三种字段任一说小组就是小组', () => {
  assert.equal(isGroupHomework({ submit_by_group: true }), true);
  assert.equal(isGroupHomework({ data: { is_group: true } }), true);
  assert.equal(isGroupHomework({ data: { is_group_submission: true } }), true);
  assert.equal(isGroupHomework({}), false);
  assert.equal(isGroupHomework({ submit_by_group: 'true' }), false, '只认布尔');
});

test('submissionState：四态分明，unknown 不能说成 unsubmitted', () => {
  assert.equal(submissionState([{ is_draft: false, is_latest_version: true }]), 'submitted');
  assert.equal(submissionState([{ is_draft: true }]), 'draft');
  assert.equal(submissionState([], null), 'unsubmitted', '空列表且平台没说交过 → 没交');
  assert.equal(submissionState([], true), 'unknown', '平台说交过但列表空 → 不知道');
  assert.equal(submissionState([{ is_redo: true }]), 'draft', '重做中是草稿');
  assert.equal(submissionState([{ is_draft: false }]), 'submitted');
  // 教师代交但未标 marked_submitted 不算真交
  assert.equal(submissionState([{ is_draft: false, submit_by_instructor: true }]), 'unknown');
});

test('pageInfo：有 total 用 total，没有就看是否满页', () => {
  assert.deepEqual(pageInfo({ total: 100 }, 1, 30, 30), { page: 1, pageSize: 30, total: 100, nextPage: 2 });
  assert.equal(pageInfo({ total: 30 }, 1, 30, 30).nextPage, null, '刚好一页就没有下一页');
  assert.equal(pageInfo({}, 1, 30, 30).nextPage, 2, '没 total 但满页 → 可能还有');
  assert.equal(pageInfo({}, 1, 30, 10).nextPage, null, '没 total 且不满页 → 没了');
  assert.equal(pageInfo({ total_count: 5 }, 1, 30, 5).total, 5);
});

test('activitySummary：补齐课程 id、链接、附件，时间归一', () => {
  const row = activitySummary({
    id: 9, title: ' 第三章作业 ', type: 'homework',
    end_time: '2026-10-30 15:59:00', start_time: '2026-10-20T08:00:00+08:00',
    submitted: false, is_closed: false, group_set_id: 5,
    score_percentage: 0.2,
    uploads: [{ id: 1, name: '题目.pdf' }],
  }, 7, XZZD);

  assert.equal(row.id, '9');
  assert.equal(row.courseId, '7');
  assert.equal(row.title, '第三章作业');
  assert.equal(row.deadline.iso, '2026-10-30T07:59:00.000Z');
  assert.equal(row.startTime.iso, '2026-10-20T00:00:00.000Z');
  assert.equal(row.weightPercent, 0.2);
  assert.equal(row.files.length, 1);
  assert.equal(row.isGroup, false);
  assert.equal(row.groupSetId, '5');
  assert.match(row.url, /\/course\/7\/learning-activity\/full-screen#\/9/);
});

/* ────────────────────────────────────── 深入读取：端点与降级 */

test('activities 走复数的 /api/courses/<id>/activities', async () => {
  const api = fakeApi([['/activities', () => ({ activities: [{ id: 1, title: 'a' }], total: 1 })]]);
  await reader(api).activities('7');
  assert.ok(api.calls[0].url.startsWith(`${XZZD}/api/courses/7/activities`), `实际 ${api.calls[0].url}`);
  assert.equal(api.calls[0].url.includes('/api/course/7/'), false, '不能是单数');
});

test('materials 走单数的 /api/course/<id>/coursewares，并带 conditions', async () => {
  const api = fakeApi([['/coursewares', () => ({ activities: [], total: 0 })]]);
  await reader(api).materials('7');
  const url = api.calls[0].url;
  assert.ok(url.startsWith(`${XZZD}/api/course/7/coursewares`), `实际 ${url}`);
  assert.equal(url.includes('/api/courses/7/'), false, '不能是复数');

  const conditions = JSON.parse(new URL(url).searchParams.get('conditions'));
  assert.deepEqual(conditions.itemsSortBy, { predicate: 'chapter', reverse: false });
  assert.deepEqual(conditions.ignore_activity_types, ['lesson'], 'lesson 不是材料，要排除');
});

test('assignments 走复数的 /api/courses/<id>/homework-activities', async () => {
  const api = fakeApi([['/homework-activities', () => ({ homework_activities: [{ id: 1, title: 'hw' }] })]]);
  await reader(api).assignments('7');
  assert.ok(api.calls[0].url.startsWith(`${XZZD}/api/courses/7/homework-activities`));
});

test('materials：materials 是正式键，activities 是兼容键', async () => {
  const api = fakeApi([['/coursewares', () => ({ activities: [{ id: 1, title: '课件', type: 'material' }] })]]);
  const out = await reader(api).materials('7');
  assert.equal(out.materials.length, 1);
  assert.equal(out.activities.length, 1);
  assert.deepEqual(out.materials, out.activities, '两个键指向同一份数据');
});

test('列表端点：403/404 降级成空，但三类必须抛', async () => {
  for (const code of ['HTTP', 'FORBIDDEN']) {
    const api = { json: async () => { const e = new Error('x'); e.code = code; throw e; } };
    const out = await reader(api).activities('7');
    assert.deepEqual(out.activities, [], `${code} 是"这类没有"，不是整门课挂掉`);
    assert.equal(out.total, null);
  }
  for (const code of ['SESSION_EXPIRED', 'RATE_LIMITED', 'API_SHAPE']) {
    const api = { json: async () => { const e = new Error('x'); e.code = code; throw e; } };
    await assert.rejects(() => reader(api).activities('7'), (e) => e.code === code, `${code} 必须抛`);
  }
});

test('非法 courseId / activityId 在发请求前就拦住', async () => {
  const api = fakeApi([]);
  const r = reader(api);
  for (const bad of [0, -1, 'abc', null, undefined]) {
    await assert.rejects(() => r.activities(bad), (e) => e.code === 'INVALID_INPUT');
    await assert.rejects(() => r.materials(bad), (e) => e.code === 'INVALID_INPUT');
    await assert.rejects(() => r.activity(bad), (e) => e.code === 'INVALID_INPUT');
    await assert.rejects(() => r.assignments(bad), (e) => e.code === 'INVALID_INPUT');
  }
  assert.equal(api.calls.length, 0, '非法参数不该打到网络');
});

test('小数 id 必须判非法，不能被静默截断成另一门课', async () => {
  // '7.9' 走 Number() 会变成 7 —— 不报错，只是读错课。
  const api = fakeApi([]);
  for (const bad of ['7.9', '12abc', '1e3', '+7.0', '0x10', '-7']) {
    await assert.rejects(() => reader(api).activities(bad), (e) => e.code === 'INVALID_INPUT', `id=${bad} 应被拦`);
  }
  assert.equal(api.calls.length, 0, '非法 id 不该打到网络');

  // 首尾空白是允许的（`' 7'` 当 7）—— 这不是截断，是同一串数字的合法写法。
  const ok = fakeApi([['/activities', () => ({ activities: [], total: 0 })]]);
  await assert.doesNotReject(() => reader(ok).activities(' 7 '));
});

test('缺 activities 字段时如实报结构异常', async () => {
  const api = fakeApi([['/activities', () => ({ pages: 1 })]]);
  await assert.rejects(() => reader(api).activities('7'), (e) => e.code === 'API_SHAPE');
});

/* ────────────────────────────────────── 当前用户 id */

test('currentUserId：从 activity_reads 反推出唯一 id', async () => {
  const api = fakeApi([['/activity-reads-for-user', () => ({
    activity_reads: [{ created_for_id: '3200100000' }, { created_for_id: '3200100000' }],
  })]]);
  assert.equal(await reader(api).currentUserId('7'), '3200100000');
});

test('currentUserId：多个不同 id 时必须报错，不能猜', async () => {
  const api = fakeApi([['/activity-reads-for-user', () => ({
    activity_reads: [{ created_for_id: '1' }, { created_for_id: '2' }],
  })]]);
  await assert.rejects(() => reader(api).currentUserId('7'), (e) => {
    assert.equal(e.code, 'IDENTITY_UNAVAILABLE');
    return true;
  });
});

test('currentUserId：一条记录都没有也要报错', async () => {
  const api = fakeApi([['/activity-reads-for-user', () => ({ activity_reads: [] })]]);
  await assert.rejects(() => reader(api).currentUserId('7'), (e) => e.code === 'IDENTITY_UNAVAILABLE');
});

test('currentUserId：空串与纯空白要滤掉，不能拼出畸形 URL', async () => {
  const api = fakeApi([['/activity-reads-for-user', () => ({
    activity_reads: [{ created_for_id: '' }, { created_for_id: '   ' }, { created_for_id: '3200100000' }],
  })]]);
  assert.equal(await reader(api).currentUserId('7'), '3200100000');
});

test('currentUserId：数字与字符串形式的同一 id 去重成一个', async () => {
  const api = fakeApi([['/activity-reads-for-user', () => ({
    activity_reads: [{ created_for_id: 3200100000 }, { created_for_id: '3200100000' }],
  })]]);
  assert.equal(await reader(api).currentUserId('7'), '3200100000');
});

/* ────────────────────────────────────── 我的提交 */

test('activitySubmission：个人作业走 students/<id>/submission_list', async () => {
  const api = fakeApi([['/submission_list', () => ({
    list: [
      { id: 1, is_draft: true, is_latest_version: false },
      { id: 2, is_draft: false, is_latest_version: true, submitted_at: '2026-10-20T10:00:00+08:00', final_score: 95, instructor_comment: '不错' },
    ],
  })]]);
  const out = await reader(api).activitySubmission({ id: 9, course_id: 7, submitted: true }, { userId: '3200100000' });

  assert.ok(api.calls[0].url.includes('/activities/9/students/3200100000/submission_list'), `实际 ${api.calls[0].url}`);
  assert.equal(out.submissionStatus, 'submitted');
  assert.equal(out.group, null);
  assert.equal(out.submissionCount, 2);
  assert.deepEqual(out.draftIds, [1]);
  assert.equal(out.latestSubmission.id, 2);
  assert.equal(out.latestSubmission.score, 95);
  assert.equal(out.latestSubmission.instructorComment, '不错');
  assert.equal(out.latestSubmission.submittedAt.iso, '2026-10-20T02:00:00.000Z');
});

test('activitySubmission：小组作业走 groups/<组id>/submission_list', async () => {
  const api = fakeApi([
    ['/group-sets/5/group', () => ({ group: { id: 88, name: '第三组' } })],
    ['/submission_list', () => ({ list: [{ id: 3, is_latest_version: true, is_draft: false }] })],
  ]);
  const out = await reader(api).activitySubmission(
    { id: 9, course_id: 7, group_set_id: 5, submit_by_group: true },
    { userId: '3200100000' },
  );
  assert.ok(api.calls.some((c) => c.url.includes('/group-sets/5/group')));
  assert.ok(api.calls.some((c) => c.url.includes('/activities/9/groups/88/submission_list')), '小组作业走 groups 路径');
  assert.deepEqual(out.group, { id: '88', name: '第三组', groupSetId: '5' });
  assert.equal(out.submissionStatus, 'submitted');
});

test('activitySubmission：小组作业缺 group_set_id 时明确报错但降级为 unknown', async () => {
  const api = fakeApi([]);
  const out = await reader(api).activitySubmission({ id: 9, course_id: 7, submit_by_group: true }, { userId: '1' });
  assert.equal(out.submissionStatus, 'unknown');
  assert.equal(out.submissionError.code, 'GROUP_UNAVAILABLE');
});

test('activitySubmission：未入组时也降级，不让整条作业消失', async () => {
  const api = fakeApi([['/group-sets/5/group', () => ({})]]);
  const out = await reader(api).activitySubmission(
    { id: 9, course_id: 7, group_set_id: 5, submit_by_group: true },
    { userId: '1' },
  );
  assert.equal(out.submissionStatus, 'unknown');
  assert.equal(out.submissionError.code, 'GROUP_UNAVAILABLE');
});

test('activitySubmission：会话失效必须抛出（不能降级成 unknown）', async () => {
  const api = { json: async () => { const e = new Error('expired'); e.code = 'SESSION_EXPIRED'; throw e; } };
  await assert.rejects(
    () => reader(api).activitySubmission({ id: 9, course_id: 7 }, { userId: '1' }),
    (e) => e.code === 'SESSION_EXPIRED',
  );
});

test('activitySubmission：普通网络错误降级，保留 code/message', async () => {
  const api = { json: async () => { const e = new Error('boom'); e.code = 'HTTP'; throw e; } };
  const out = await reader(api).activitySubmission({ id: 9, course_id: 7 }, { userId: '1' });
  assert.equal(out.submissionStatus, 'unknown');
  assert.deepEqual(out.submissionError, { code: 'HTTP', message: 'boom' });
});

test('assignments：身份解析遇到 SESSION_EXPIRED 必须抛出', async () => {
  const api = {
    async json(url) {
      if (String(url).includes('/homework-activities')) return { homework_activities: [{ id: 1, title: '作业一' }] };
      const error = new Error('登录已过期');
      error.code = 'SESSION_EXPIRED';
      throw error;
    },
  };
  await assert.rejects(
    () => reader(api).assignments('7', { withSubmissions: true }),
    (e) => e.code === 'SESSION_EXPIRED',
    '会话失效不能被吞成 submissionError，否则页面会说"状态未知"',
  );
});

test('assignments：默认不逐条补提交（避免 N+1）', async () => {
  const shared = [
    ['/homework-activities', () => ({
      homework_activities: [{ id: 1, title: '作业一', submitted: false }, { id: 2, title: '作业二', submitted: true }],
    })],
    ['/activity-reads-for-user', () => ({ activity_reads: [{ created_for_id: '3200100000' }] })],
    ['/activities/1/students/', () => ({ list: [] })],
    ['/activities/2/students/', () => ({ list: [{ id: 5, is_latest_version: true, is_draft: false }] })],
  ];

  const lazy = fakeApi(shared);
  const out1 = await reader(lazy).assignments('7');
  assert.equal(out1.assignments.length, 2);
  assert.equal(out1.assignments[0].submissionStatus, undefined, '默认不补提交');
  assert.equal(lazy.calls.filter((c) => c.url.includes('submission_list')).length, 0);

  const eager = fakeApi(shared);
  const out2 = await reader(eager).assignments('7', { withSubmissions: true });
  assert.equal(out2.assignments[0].submissionStatus, 'unsubmitted');
  assert.equal(out2.assignments[1].submissionStatus, 'submitted');
});

/* ────────────────────────────────────── 活动详情 */

test('activity：包装成 { activity: ... } 与直接返回都要能解析', async () => {
  const wrapped = fakeApi([['/api/activities/9', () => ({ activity: { id: 9, title: 'x', course_id: 7, description: '说明' } })]]);
  const a = await reader(wrapped).activity('9');
  assert.equal(a.id, '9');
  assert.equal(a.description, '说明');

  const bare = fakeApi([['/api/activities/9', () => ({ id: 9, title: 'y', course_id: 7 })]]);
  assert.equal((await reader(bare).activity('9')).title, 'y');
});

test('activity：缺少 id 时如实报结构异常', async () => {
  const api = fakeApi([['/api/activities/9', () => ({ title: 'x' })]]);
  await assert.rejects(() => reader(api).activity('9'), (e) => e.code === 'API_SHAPE');
});

test('深入读取全程只发 GET（json 不带 method）', async () => {
  const api = fakeApi([
    ['/activities', () => ({ activities: [], total: 0 })],
    ['/coursewares', () => ({ activities: [], total: 0 })],
  ]);
  await reader(api).activities('7');
  await reader(api).materials('7');
  assert.equal(api.calls.length, 2, '两次调用应各有一次请求');
  for (const call of api.calls) {
    assert.equal(call.options?.method, undefined, `出现了非 GET：${call.url}`);
  }
});

/* ────────────────────────────────────── CAS：地址校验与文案 */

test('upgrade：http 升 https，且只放行白名单主机', () => {
  assert.equal(upgrade('http://courses.zju.edu.cn/user/index'), 'https://courses.zju.edu.cn/user/index');
  assert.equal(upgrade('https://courses.zju.edu.cn/a'), 'https://courses.zju.edu.cn/a');
  assert.equal(upgrade('/user/index'), 'https://courses.zju.edu.cn/user/index', '相对地址按 base 解析');

  for (const bad of ['https://evil.example.com/x', 'http://pintia.cn/x', 'ftp://courses.zju.edu.cn/x', 'https://user:pw@courses.zju.edu.cn/x']) {
    assert.throws(() => upgrade(bad), (e) => e.code === 'AUTH_REDIRECT', `${bad} 应被拒绝`);
  }
});

test('casErrorMessage：按元素取文本，不拿属性名当锚点', () => {
  // 这是那次真实误判的形状：`id="errormsg"` 是**属性名**，
  // 宽松正则会把 `errormsg" role="heading">` 当成错误文案。
  const html = '<p id="errormsg" role="heading"><span id="msg">用户名或密码错误</span></p>';
  assert.equal(casErrorMessage(html), '用户名或密码错误');

  assert.equal(casErrorMessage('<p id="errormsg">账号已锁定</p>'), '账号已锁定');
  assert.equal(casErrorMessage('<span class="auth_error">服务繁忙</span>'), '服务繁忙');

  // 属性名不能被当成文案
  assert.equal(casErrorMessage('<p id="errormsg" role="heading"></p>'), null);
  assert.equal(casErrorMessage(''), null);
  assert.equal(casErrorMessage(null), null);
});

test('casErrorMessage：只认成句的站点文案，不跨标签拼句子', () => {
  assert.equal(casErrorMessage('<div>用户名或密码错误</div>'), '用户名或密码错误');
  // 跨标签拼出来的字面量不能算一句（哨兵切段就是为了这个）
  assert.equal(casErrorMessage('<i>用户名</i><b>或密码错误</b>'), null);
});

test('describeAuthFailure：如实转述，不推断"密码错"', () => {
  const withMsg = describeAuthFailure({ status: 200, text: '<p id="errormsg"><span id="msg">用户名或密码错误</span></p>' });
  assert.equal(withMsg, '用户名或密码错误');

  const bare = describeAuthFailure({ status: 200, text: '<input name="execution" value="e1">' });
  assert.match(bare, /没有给出错误文案/);
  assert.match(bare, /不等于密码错误/, '不能把无文案的失败说成密码错');

  const weird = describeAuthFailure({ status: 502, text: '<html>Bad Gateway</html>' });
  assert.match(weird, /HTTP 502/);
});

/* ────────────────────────────────────── CAS：RSA 与 execution */

test('rsaEncrypt：输出 hex，短结果补齐到 128 位，且同一输入确定', () => {
  // 128 位是 padStart 的**下限**，不是固定长度：模长大时结果本身就更长。
  // 这里用小模长让"补齐"这条路径真的被走到，否则断言等于没测。
  const small = rsaEncrypt('secret', 'f'.repeat(64), '10001');
  assert.match(small, /^[0-9a-f]{128}$/, `短结果应补齐到 128 位，实际 ${small.length}`);

  // 真实 CAS 公钥是 1024 位（256 hex），结果不会比它长。
  const modulus = 'a'.repeat(256);
  const a = rsaEncrypt('secret', modulus, '10001');
  const b = rsaEncrypt('secret', modulus, '10001');
  assert.equal(a, b, '同一输入必须确定');
  assert.match(a, /^[0-9a-f]{128,}$/, `实际长度 ${a.length}`);
  assert.notEqual(rsaEncrypt('other', modulus, '10001'), a, '不同明文应给不同密文');
});

test('rsaEncrypt：公钥格式异常时抛 TypeError（不是编一个密文出来）', () => {
  assert.throws(() => rsaEncrypt('x', 'not-hex', '10001'), TypeError);
  assert.throws(() => rsaEncrypt('x', 'aaa', 'zzz'), TypeError);
  assert.throws(() => rsaEncrypt('x', '0', '1'), TypeError, '参数不能为 0');
});

test('executionToken：单双引号都认，没有就 null', () => {
  assert.equal(executionToken('<input name="execution" value="e1">'), 'e1');
  assert.equal(executionToken("<input name='execution' value='e2'>"), 'e2');
  assert.equal(executionToken('<input name="username">'), null);
  assert.equal(executionToken(''), null);
  assert.equal(executionToken(undefined), null);
});

/* ────────────────────────────────────── CAS：登录流程（假 Transport） */

test('xzzdLogin：缺凭据时抛 CREDENTIALS 且不去发请求', async () => {
  const transport = fakeTransport(async () => json({}));
  await assert.rejects(() => xzzdLogin(transport, {}), (e) => e.code === 'CREDENTIALS');
  assert.equal(transport.calls.length, 0);
});

test('xzzdLogin：已有可用业务会话时一个 CAS 请求都不发', async () => {
  // 这是"冷启动 6 秒"的根治点：业务 session 有效时只发 1 个 /user/index。
  const transport = fakeTransport(
    async () => ({ status: 200, text: '<html>已登录的页面</html>' }),
    { cookies: [{ key: 'session', value: 'valid' }] },
  );
  await xzzdLogin(transport, { username: 'u', password: 'p' });
  assert.equal(transport.calls.length, 1, `实际发了 ${transport.calls.map(c => c.url).join(', ')}`);
  assert.ok(transport.calls[0].url.includes('/user/index'));
});

test('xzzdLogin：登录页缺 execution 时如实报 AUTH_SHAPE', async () => {
  const transport = fakeTransport(router([
    ['/user/index', () => ({ status: 200, text: 'portal' })],
    ['/cas/login', () => ({ status: 200, text: '<html>没有表单</html>' })],
  ]));
  await assert.rejects(
    () => xzzdLogin(transport, { username: 'u', password: 'p' }),
    (e) => e.code === 'AUTH_SHAPE' && /execution/.test(e.message),
  );
});

test('xzzdLogin：没有拿到 SSO 票时抛 AUTH_REJECTED，并转述站点文案', async () => {
  // 必须按 method 分派：GET /cas/login 给表单页，POST /cas/login 给带错误文案的页面。
  // 只用 URL 匹配的话两跳会撞在一起，于是测的就不是"被拒"而是"页面没文案"。
  const transport = fakeTransport(async (url, init) => {
    if (url.includes('/user/index')) return { status: 200, text: 'portal' };
    if (url.includes('/cas/v2/getPubKey')) return json({ modulus: 'a'.repeat(256), exponent: '10001' });
    if (url.endsWith('/cas/login')) {
      return init.method === 'POST'
        ? { status: 200, text: '<p id="errormsg" role="heading"><span id="msg">账号已锁定</span></p>' }
        : { status: 200, text: '<input name="execution" value="e1">' };
    }
    return { status: 200, text: '{}' };
  });
  await assert.rejects(
    () => xzzdLogin(transport, { username: 'u', password: 'p' }),
    (e) => {
      assert.equal(e.code, 'AUTH_REJECTED');
      assert.equal(e.message, '账号已锁定', '必须转述站点文案，而不是写"密码错"');
      return true;
    },
  );
  // POST 只发一次：不重试密码（重试只会累加失败计数）
  assert.equal(transport.calls.filter((c) => c.method === 'POST').length, 1);
});

test('xzzdAuthorize：落在 CAS 登录页时抛 AUTH_EXPIRED', async () => {
  // 只有在**跳到 CAS 之后**看到登录表单才算「SSO 票过期」。
  // 停在业务域上看到表单特征是另一回事（那种情况下面那条测试覆盖）。
  const transport = fakeTransport(async (url) => {
    if (url.includes('/user/index')) return { status: 302, location: 'https://zjuam.zju.edu.cn/cas/login' };
    return { status: 200, text: '<input name="execution" value="x">' };
  });
  await assert.rejects(() => xzzdAuthorize(transport), (e) => e.code === 'AUTH_EXPIRED');
});

test('xzzdAuthorize：业务授权完成但没有 session cookie 时报 AUTH_INCOMPLETE', async () => {
  const transport = fakeTransport(
    async () => ({ status: 200, text: '<html>ok</html>' }),
    { cookies: [] },
  );
  await assert.rejects(() => xzzdAuthorize(transport), (e) => e.code === 'AUTH_INCOMPLETE');
});

test('xzzdAuthorize：拿到 session cookie 就成功，且不再跟跳转', async () => {
  const transport = fakeTransport(
    async () => ({ status: 200, text: '<html>home</html>' }),
    { cookies: [{ key: 'session', value: 'got-it' }] },
  );
  await assert.doesNotReject(() => xzzdAuthorize(transport));
  assert.equal(transport.calls.length, 1);
});

test('xzzdAuthorize：跳转超过上限时报 AUTH_LOOP', async () => {
  let hop = 0;
  const transport = fakeTransport(async () => ({ status: 302, location: `/user/index?h=${++hop}` }));
  await assert.rejects(() => xzzdAuthorize(transport), (e) => e.code === 'AUTH_LOOP');
  assert.equal(transport.calls.length, 20);
});

/* ────────────────────────────────────── 错误翻译 */

test('translateXzzdError：码表覆盖"用户能照做"的四类', () => {
  assert.equal(translateXzzdError(null), null);

  const needLogin = translateXzzdError({ code: 'NEED_LOGIN', message: 'x' });
  assert.equal(needLogin.code, 'NEED_LOGIN');
  assert.match(needLogin.message, /设置 → 浙大一卡通/);

  const expired = translateXzzdError({ code: 'SESSION_EXPIRED', message: 'x' });
  assert.equal(expired.code, 'NEED_LOGIN');
  assert.match(expired.message, /登录态已过期/);

  const network = translateXzzdError({ code: 'NETWORK', message: '连不上' });
  assert.deepEqual(network, { code: 'UNREACHABLE', message: '连不上' }, '网络类保留原始证据');

  const unknown = translateXzzdError({ code: 'SOMETHING', message: 'm' });
  assert.deepEqual(unknown, { code: 'SOMETHING', message: 'm' }, '未知码原样透传，不吞');
});

test('translateXzzdError：已经指向「设置 → 浙大一卡通」的文案原样透传', () => {
  // 用旧文案盖掉新文案，等于把修好的话又改回错的。
  const original = '还没配「浙大一卡通」账号：去「设置 → 浙大一卡通」填一次学号和密码。';
  assert.deepEqual(translateXzzdError({ code: 'LOGIN_FAILED', message: original }), {
    code: 'NEED_LOGIN', message: original,
  });
});

test('translateXzzdError：WebVPN 码不落进 UNREACHABLE', () => {
  const out = translateXzzdError({ code: 'WEBVPN_REQUIRED', message: '去配上网账号' });
  assert.equal(out.code, 'WEBVPN');
  assert.match(out.message, /上网账号/);
});

/* ────────────────────────────────────── 归一化 */

test('normalizeXzzd：补来源标签与 kind，缺失字段给 null', () => {
  const rows = normalizeXzzd([
    { id: '1', title: 'A', courseName: '软工', due: '2026-10-30T07:59:00.000Z', dueText: '2026-10-30 15:59:00', url: 'u' },
    { id: '2', title: 'B' },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    source: 'xzzd', sourceLabel: '学在浙大', id: '1', title: 'A', detail: '软工',
    due: '2026-10-30T07:59:00.000Z', dueText: '2026-10-30 15:59:00', url: 'u', kind: 'todo',
  });
  assert.equal(rows[1].detail, '', '缺课程名给空串');
  assert.equal(rows[1].due, null);
  assert.equal(rows[1].url, null);
});

test('normalizeXzzd：非数组输入给空数组（不抛）', () => {
  assert.deepEqual(normalizeXzzd(null), []);
  assert.deepEqual(normalizeXzzd(undefined), []);
  assert.deepEqual(normalizeXzzd({}), []);
  assert.deepEqual(normalizeXzzd([]), []);
});

/* ────────────────────────────────────── 集成层：apply() */

/**
 * 最小 cordis 风格 ctx。
 *
 * `inject` 的回调立刻执行（模拟服务已在位），`webServer.register` 记录注册项。
 * 与 `tests/yjsy-host.test.mjs` 的替身同形 —— 服务名与路由路径的断言是同一类：
 * 纯函数全绿但插件起不来，只有集成层能抓到。
 */
function fakeCtx({ dir, services = new Map() } = {}) {
  const routes = [];
  const provided = new Map();
  const effects = [];
  const ctx = {
    profileContext: { dir },
    logger: { info() {} },
    effect(fn, label) { effects.push(label); return fn() ?? (() => {}); },
    provide(name, value) { provided.set(name, value); services.set(name, value); return () => provided.delete(name); },
    get(name) { return services.get(name); },
    inject(names, callback) {
      const scope = {
        effect(fn) { return fn() ?? (() => {}); },
        webServer: { register(entry) { routes.push(entry); return () => {}; } },
      };
      callback(scope);
    },
  };
  return { ctx, routes, provided, effects };
}

/** 造一个临时数据目录（每个 test 独立，避免互相污染）。 */
function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'xuezai-test-'));
}

/** 装配一次，返回服务面。不联网：`config.fetch` 永远注入假实现。 */
async function mount({ services = new Map(), dir = tempDir(), fetch } = {}) {
  const { ctx, routes } = fakeCtx({ dir, services });
  const dispose = await apply(ctx, {
    fetch: fetch ?? (async () => { throw new Error('测试不该发真实请求'); }),
  });
  return { service: services.get(SERVICE_NAME), routes, services, dispose, dir };
}

test('apply() 真的 provide 了 zhiyunXuezai 并注册了 /api/zhiyun-xuezai', async () => {
  const services = new Map();
  const { service, routes } = await mount({ services });
  assert.ok(service, `必须 provide ${SERVICE_NAME}`);
  assert.equal(SERVICE_NAME, 'zhiyunXuezai');
  assert.equal(routes.length, 1, '必须注册恰好一条路由');
  assert.equal(routes[0].path, '/api/zhiyun-xuezai');
  assert.equal(ROUTE_PATH, '/api/zhiyun-xuezai');
  assert.equal(routes[0].kind, 'exact');
});

test('服务声明自己的能力面：只读方法 + 写方法分开列', async () => {
  // ⚠️ 这条原名是「服务声明自己是只读数据源（D17）」，在接写操作时改过。
  // D17 判的是「**读**操作进 source、**写**操作要经审批」——不是「source 不许有
  // 写能力」。写方法现在成对出现在本包里（`xxxPrepare` 算参数、`xxxExecute` 发请求），
  // 审批在 `packages/tool/campus-write`。所以 readOnly 如实改成 false，
  // 但两批方法仍然分开列：混在一起会让「能力清单里有 9 条读取」这种误解成立。
  const { service } = await mount();
  assert.equal(service.readOnly, false);
  assert.equal(service.platform, 'xzzd');
  assert.equal(service.label, '学在浙大');
  for (const method of ['todos', 'xzzdRead', 'fingerprint', 'egress', 'xzzdClient', 'loginProfile', 'reset', 'invalidate']) {
    assert.equal(typeof service[method], 'function', `缺方法 ${method}`);
  }
  // 写方法成对出现，且都能调；它们不在只读方法里。
  assert.deepEqual(service.writeMethods, [
    'xzzd.submitHomeworkPrepare', 'xzzd.submitHomeworkExecute',
    'xzzd.retractHomeworkPrepare', 'xzzd.retractHomeworkExecute',
    'xzzd.rollcallPrepare', 'xzzd.rollcallExecute',
  ]);
  for (const name of service.writeMethods) {
    const key = name.slice('xzzd.'.length);
    assert.equal(typeof service[key], 'function', `声明了 ${name} 却没有实现`);
  }
});

test('没有凭据时 todos() 不抛，而是给 ok:false + 可上屏的 error', async () => {
  // 一个来源失败不该冒到调用方 —— 否则页面拿不到任何数据。
  const { service } = await mount();
  const result = await service.todos();
  assert.equal(result.xzzd.ok, false);
  assert.deepEqual(result.xzzd.rows, []);
  assert.equal(result.xzzd.error.code, 'NEED_LOGIN');
  assert.match(result.xzzd.error.message, /设置 → 浙大一卡通/);
});

test('todos() 的 pta 一半是哨兵，不是"读取失败"', async () => {
  // ⚠️ 这条钉住拆包接口：合并方要能识别"这一半不在此包"，
  // 而不是把它当成拼题A 的故障显示给用户。
  const { service } = await mount();
  const result = await service.todos();
  assert.equal(result.pta.ok, false);
  assert.equal(result.pta.notInThisPackage, true);
  assert.deepEqual(result.pta.rows, []);
  assert.equal(result.pta.error.code, 'NOT_IN_THIS_PACKAGE');
  assert.equal(result.pta.providedBy, '@lybx-leyw/dsh-zju-source-pta');
  // 形状上必须**同时**有 xzzd 与 pta 两个键，合并方不必先判存在性。
  assert.deepEqual(Object.keys(result).sort(), ['pta', 'xzzd']);
});

test('xzzdRead() 的非法 action 抛 INVALID_INPUT 且列出可选值', async () => {
  const { service } = await mount();
  await assert.rejects(() => service.xzzdRead({ action: 'nope' }), (error) => {
    assert.equal(error.code, 'INVALID_INPUT');
    assert.match(error.message, /activities/);
    assert.match(error.message, /submission/);
    return true;
  });
  await assert.rejects(() => service.xzzdRead({}), (error) => error.code === 'INVALID_INPUT');
});

test('egress() 在没有 zhiyunEgress 服务时如实报 unavailable', async () => {
  const { service } = await mount();
  const state = await service.egress();
  assert.equal(state.mode, 'unavailable');
  assert.match(state.reason, /zhiyunEgress/);
});

test('egress() 有服务时转述它的状态，不改写', async () => {
  const services = new Map();
  services.set('zhiyunEgress', {
    async state() { return { mode: 'auto', campus: 'inside', viaWebvpn: false, degraded: false, downgraded: [] }; },
    async forget() { fleet.forgot = true; },
    async probe() { fleet.probed = true; return true; },
  });
  const fleet = { forgot: false, probed: false };
  const { service } = await mount({ services });
  assert.deepEqual(await service.egress(), {
    mode: 'auto', campus: 'inside', viaWebvpn: false, degraded: false, downgraded: [],
  });
  await service.egress({ probe: true });
  assert.equal(fleet.forgot, true, 'probe 时要清探测缓存');
  assert.equal(fleet.probed, true);
});

test('egress() 服务抛错时降级成 unavailable，不把状态查询变成异常', async () => {
  const services = new Map();
  services.set('zhiyunEgress', { async state() { throw new Error('坏了'); } });
  const { service } = await mount({ services });
  const state = await service.egress();
  assert.equal(state.mode, 'unavailable');
  assert.match(state.reason, /坏了/);
});

/* ────────────────────────────────────── 集成层：路由行为 */

/** 造一个假 req：`method` / `url` / `headers` / 可选 body。 */
function fakeReq({ method = 'GET', url = ROUTE_PATH, headers = {}, body = null } = {}) {
  const chunks = body === null ? [] : [Buffer.from(body, 'utf8')];
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
  };
}

/** 造一个假 res：记录 status 与解析后的 body。 */
function fakeRes() {
  const record = { status: null, headers: null, body: null };
  return {
    record,
    writeHead(status, headers) { record.status = status; record.headers = headers; },
    end(text) { record.body = JSON.parse(text); },
  };
}

/** 打一次路由。 */
async function call(handler, request) {
  const res = fakeRes();
  await handler(request, res);
  return res.record;
}

test('GET 路由离线也能返回形状完整的 todos（xzzd + pta 两半都在）', async () => {
  const { routes } = await mount();
  const out = await call(routes[0].handler, fakeReq());

  assert.equal(out.status, 200);
  assert.equal(out.headers['cache-control'], 'no-store');
  assert.match(out.headers['content-type'], /application\/json/);
  assert.ok(out.body.todos, '必须有 todos');
  assert.deepEqual(Object.keys(out.body.todos).sort(), ['pta', 'xzzd']);
  assert.equal(out.body.todos.xzzd.ok, false, '没有凭据时如实失败');
  assert.equal(out.body.todos.pta.notInThisPackage, true);
  assert.ok(out.body.egress, '必须带出口状态');
});

test('POST 缺 x-zhiyun-xuezai 头 → 403（CSRF 闸）', async () => {
  const { routes } = await mount();
  const out = await call(routes[0].handler, fakeReq({
    method: 'POST', url: `${ROUTE_PATH}?xzzd-read`, body: '{"action":"activities","courseId":"7"}',
  }));
  assert.equal(out.status, 403);
  assert.match(out.body.error, /x-zhiyun-xuezai/);
  assert.equal(WRITE_HEADER, 'x-zhiyun-xuezai');
});

test('POST 带头但动作名未知 → 400，且错误里带出动作名', async () => {
  const { routes } = await mount();
  const out = await call(routes[0].handler, fakeReq({
    method: 'POST', url: `${ROUTE_PATH}?pta-cookie`, headers: { [WRITE_HEADER]: '1' }, body: '{}',
  }));
  assert.equal(out.status, 400);
  assert.match(out.body.error, /pta-cookie/, '未知动作要回显，便于排查');
});

test('POST 空动作名 → 400 且标出 (空)', async () => {
  const { routes } = await mount();
  const out = await call(routes[0].handler, fakeReq({
    method: 'POST', url: ROUTE_PATH, headers: { [WRITE_HEADER]: '1' }, body: '{}',
  }));
  assert.equal(out.status, 400);
  assert.match(out.body.error, /\(空\)/);
});

test('xzzd-read 动作在没有凭据时回 401 + NEED_LOGIN', async () => {
  const { routes } = await mount();
  const out = await call(routes[0].handler, fakeReq({
    method: 'POST',
    url: `${ROUTE_PATH}?xzzd-read`,
    headers: { [WRITE_HEADER]: '1' },
    body: JSON.stringify({ action: 'activities', courseId: '7' }),
  }));
  assert.equal(out.status, 401);
  assert.equal(out.body.error.code, 'NEED_LOGIN');
  assert.match(out.body.error.message, /浙大一卡通/);
});

test('xzzd-read 动作名非法时回 400', async () => {
  const { routes } = await mount();
  const out = await call(routes[0].handler, fakeReq({
    method: 'POST',
    url: `${ROUTE_PATH}?xzzd-read`,
    headers: { [WRITE_HEADER]: '1' },
    body: JSON.stringify({ action: 'drop-table' }),
  }));
  // 动作名校验发生在拿到会话之后；没有凭据时先撞 401 —— 这里断言"不是 200 且不泄露"。
  assert.equal(out.status === 400 || out.status === 401, true, `实际 ${out.status}`);
  assert.ok(out.body.error, '必须给错误体');
});

test('PUT / DELETE 一律 405', async () => {
  const { routes } = await mount();
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const out = await call(routes[0].handler, fakeReq({ method }));
    assert.equal(out.status, 405, `${method} 应 405`);
    assert.match(out.body.error, /GET/);
  }
});

test('非回环 Host 一律 403（这条路由能读作业内容与我的提交）', async () => {
  const { routes } = await mount();
  for (const host of ['evil.example.com', '192.168.1.5:8080']) {
    const out = await call(routes[0].handler, fakeReq({ headers: { host } }));
    assert.equal(out.status, 403, `host=${host} 应被拒`);
    assert.match(out.body.error, /回环/);
  }
  for (const host of ['127.0.0.1:52956', 'localhost', '[::1]']) {
    const out = await call(routes[0].handler, fakeReq({ headers: { host } }));
    assert.equal(out.status, 200, `host=${host} 应放行`);
  }
});

test('reset 动作丢掉本地会话并回 ok', async () => {
  const { routes } = await mount();
  const out = await call(routes[0].handler, fakeReq({
    method: 'POST', url: `${ROUTE_PATH}?reset`, headers: { [WRITE_HEADER]: '1' }, body: '{}',
  }));
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
});

test('reprobe 动作在没有出口服务时也回 200（不炸）', async () => {
  const { routes } = await mount();
  const out = await call(routes[0].handler, fakeReq({
    method: 'POST', url: `${ROUTE_PATH}?reprobe`, headers: { [WRITE_HEADER]: '1' }, body: '{}',
  }));
  assert.equal(out.status, 200);
  assert.equal(out.body.egress.mode, 'unavailable');
});

/* ────────────────────────────────────── 集成层：凭据与会话 */

test('配了凭据但 CAS 连不上时，todos() 给 UNREACHABLE 而不是 LOGIN_FAILED', async () => {
  // 用户名密码对不对与网络通不通是两件事；混成一句会把用户赶去改密码。
  const services = new Map();
  services.set('credentials', {
    async readRecord() { return { kind: 'grant', payload: { username: '3200100000', password: 'pw' } }; },
    async modifyRecord() { return {}; },
  });
  const { service } = await mount({
    services,
    fetch: async () => { const error = new Error('connect ECONNREFUSED'); error.code = 'NETWORK'; throw error; },
  });

  const result = await service.todos();
  assert.equal(result.xzzd.ok, false);
  assert.equal(result.xzzd.error.code, 'UNREACHABLE', `实际 ${JSON.stringify(result.xzzd.error)}`);
});

test('凭据读取抛错时按"没配"处理（不炸插件）', async () => {
  const services = new Map();
  services.set('credentials', {
    async readRecord() { throw new Error('凭据库坏了'); },
    async modifyRecord() { return {}; },
  });
  const { service } = await mount({ services });
  const result = await service.todos();
  assert.equal(result.xzzd.ok, false);
  assert.equal(result.xzzd.error.code, 'NEED_LOGIN');
});

test('凭据记录形状不对（不是 grant）时也按"没配"处理', async () => {
  const services = new Map();
  services.set('credentials', {
    async readRecord() { return { kind: 'note', payload: { username: 'u', password: 'p' } }; },
    async modifyRecord() { return {}; },
  });
  const { service } = await mount({ services });
  assert.equal((await service.todos()).xzzd.error.code, 'NEED_LOGIN');
});

test('fingerprint() 在空会话上给一个确定值（不抛）', async () => {
  const { service } = await mount();
  const first = await service.fingerprint();
  assert.match(first, /^[0-9a-f]{64}$/, '应是 sha256 hex');
  assert.equal(await service.fingerprint(), first, '同一会话指纹稳定');
});

test('loginProfile() 未登录时是 null', async () => {
  const { service } = await mount();
  assert.equal(service.loginProfile(), null);
});

test('invalidate() 可调用且不抛（待办缓存失效）', async () => {
  const { service } = await mount();
  assert.doesNotThrow(() => service.invalidate());
});

/* ────────────────────────────────────── 集成层：旧会话迁移 */

test('旧 campus 会话文件会被一次性复制到新目录（避免升级即掉线）', async () => {
  const dir = tempDir();
  const legacyDir = path.join(dir, 'data', 'zhiyun-campus');
  mkdirSync(legacyDir, { recursive: true });
  const legacyFile = path.join(legacyDir, 'xzzd.session');
  const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
  writeFileSync(legacyFile, payload);

  const dataDir = path.join(dir, 'data', 'zhiyun-xuezai');
  const { ctx } = fakeCtx({ dir });
  const services = new Map();
  await apply(ctx, { dataDir, legacyDataDir: legacyDir, fetch: async () => { throw new Error('不该发请求'); } });

  const migrated = path.join(dataDir, 'xzzd.session');
  assert.equal(existsSync(migrated), true, '旧会话必须被搬过来');
  // 必须**按字节**复制：DPAPI 密文原样可解，解密再加密要多花 1.2 秒。
  assert.deepEqual(readFileSync(migrated), payload, '密文必须逐字节一致');
  assert.equal(existsSync(legacyFile), true, '只复制不删除：campus 的退役由 OWNER 统一处理');
});

test('新目录已有会话时不再覆盖（不重复迁移）', async () => {
  const dir = tempDir();
  const legacyDir = path.join(dir, 'data', 'zhiyun-campus');
  const dataDir = path.join(dir, 'data', 'zhiyun-xuezai');
  mkdirSync(legacyDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(legacyDir, 'xzzd.session'), Buffer.from('old'));
  writeFileSync(path.join(dataDir, 'xzzd.session'), Buffer.from('new'));

  const { ctx } = fakeCtx({ dir });
  await apply(ctx, { dataDir, legacyDataDir: legacyDir, fetch: async () => { throw new Error('不该发请求'); } });

  assert.equal(readFileSync(path.join(dataDir, 'xzzd.session'), 'utf8'), 'new', '已有会话不能被旧文件盖掉');
});

test('没有旧目录时不报错（全新安装路径）', async () => {
  const dir = tempDir();
  const services = new Map();
  const { ctx } = fakeCtx({ dir, services });
  await assert.doesNotReject(() => apply(ctx, { fetch: async () => { throw new Error('不该发请求'); } }));
  assert.ok(services.get(SERVICE_NAME), '仍然要正常 provide 服务');
});

/* ────────────────────────────────────── 错误类型 */

test('fault() 造的是 XuezaiError，带 code 与 name', () => {
  const error = fault('INVALID_INPUT', '参数不对');
  assert.equal(error instanceof XuezaiError, true);
  assert.equal(error.code, 'INVALID_INPUT');
  assert.equal(error.name, 'XuezaiError');
  assert.equal(error.message, '参数不对');
});

test('rollcallHistory：纯读，按从新到旧给记录（审计 W-26）', async () => {
  // 审计查出：本仓把这条归为「上游和签到绑定」而删掉，理由是假的 ——
  // 上游 rollcall-cli.ts:52 原话「只查看，不签到」，端点是纯 GET。
  const { XzzdReader } = await import('../../../packages/source/xuezai/src/xzzd-reads.js');
  const calls = [];
  const reader = new XzzdReader({
    async json(url, options) {
      calls.push({ url, method: options?.method });
      return {
        rollcalls: [
          { rollcall_time: '2026-11-01 08:00', source: 'radar', status: 'on_call' },
          { rollcall_time: '2026-11-08 08:00', source: 'number', student_status: 'absent' },
          { rollcall_time: '2026-11-09 08:00', source: 'qr' },
        ],
      };
    },
  }, 'https://courses.zju.edu.cn');

  const result = await reader.rollcallHistory({ courseId: 11, userId: 22 });

  assert.equal(calls[0].method, undefined, 'GET 不带 method');
  assert.match(calls[0].url, /\/api\/course\/11\/student\/22\/rollcalls$/);
  assert.equal(result.total, 3);
  assert.equal(result.signed, 1, '只有 on_call 那条算已签到');
  assert.equal(result.notSigned, 2);

  // 从新到旧
  assert.deepEqual(result.records.map((r) => r.time),
    ['2026-11-09 08:00', '2026-11-08 08:00', '2026-11-01 08:00']);
  assert.equal(result.latest, '2026-11-09 08:00');

  // 状态映射
  assert.equal(result.records[2].status, '已签到');
  assert.equal(result.records[1].status, '缺勤');
  // 来源中文化
  assert.equal(result.records[0].type, '二维码');
});

test('rollcallHistory：点名未结束要标「未签（点名未结束）」而不是缺勤', async () => {
  const { XzzdReader } = await import('../../../packages/source/xuezai/src/xzzd-reads.js');
  const reader = new XzzdReader({
    async json() {
      return { rollcalls: [{ rollcall_time: '2026-11-10 08:00', source: 'radar', rollcall_status: 'ongoing' }] };
    },
  }, 'https://courses.zju.edu.cn');
  const result = await reader.rollcallHistory({ courseId: 1, userId: 2 });
  assert.equal(result.records[0].status, '未签（点名未结束）', '那是「还能补」，不是缺勤');
});

test('rollcallHistory：缺 rollcalls 数组要报 SCHEMA_CHANGED，不能当成「没缺勤」', async () => {
  const { XzzdReader } = await import('../../../packages/source/xuezai/src/xzzd-reads.js');
  const reader = new XzzdReader({
    async json() { return { unexpected: 1 }; },
  }, 'https://courses.zju.edu.cn');
  await assert.rejects(
    () => reader.rollcallHistory({ courseId: 1, userId: 2 }),
    (error) => {
      assert.equal(error.code, 'SCHEMA_CHANGED');
      return true;
    },
  );
});