/**
 * 校园数据源（`dsh-zhiyun-source-campus`）：学在浙大待办 + 拼题A 题集。
 *
 * 实现口径来自本仓的 Flutter 版（`zhiyun-pro` 的 `courses_todo_data_source.dart` /
 * `pta_data_source.dart` / `zjuam_client.dart`）。那些文件里写下的结论是踩出来的，
 * 所以这里把它们**逐条钉成断言**，而不是只测"能不能跑"：
 *
 *   1. **不用 `/api/todos`**（它会漏）→ 走 my-semesters → my-courses → 逐课；
 *   2. 逐课端点里 `/api/course/` 是**单数**，改成复数会 404；
 *   3. **不做降级、不造占位数据**：一门课挂了就是没条目；
 *   4. 过滤口径：已发布 + 未截止 + 已开始 + 未提交 + 没满分；
 *   5. 拼题A 的 **404 = Cookie 失效**（不是"题集不存在"）；
 *   6. `filter` **只编码一次**（双编码 → 400）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  XzzdApi, buildCourseTodos, isPendingTodo, normalizeDeadline, hasXzzdSession,
  API_MY_SEMESTERS, API_MY_COURSES, courseApis, ONGOING_STATUS, COURSE_CONCURRENCY,
} from '../packages/dsh-zhiyun-source-campus/src/xzzd.js';
import {
  PtaApi, parsePtaCookie, yesterdayUtcMidnight, isPendingProblemSet,
} from '../packages/dsh-zhiyun-source-campus/src/pta.js';
import { normalizeXzzd, normalizePta } from '../packages/dsh-zhiyun-source-campus/src/index.js';
import { Transport, AUTH_HOSTS } from '../packages/dsh-zhiyun-source-campus/src/cas/transport.js';
import { CAMPUS_HOSTS } from '../packages/dsh-zhiyun-source-campus/src/hosts.js';

/** 造一个已装 cookie 的 Transport，`fetch` 可注入。 */
async function makeTransport(fetchImpl, cookies = [], hosts = CAMPUS_HOSTS) {
  const transport = new Transport({ fetch: fetchImpl, hosts });
  for (const [line, url] of cookies) await transport.session.jar.setCookie(line, url);
  return transport;
}

const XZZD_COOKIE = ['session=xyz; Domain=.courses.zju.edu.cn; Path=/', 'https://courses.zju.edu.cn/user/index'];

/** 记录请求并按 URL 匹配回包。 */
function recorder(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, method: init?.method ?? 'GET', body: init?.body ?? null });
    for (const [match, handler] of routes) {
      if (target.includes(match)) return handler(target, init);
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

const json = (payload) => new Response(JSON.stringify(payload), {
  status: 200, headers: { 'content-type': 'application/json' },
});

/* ────────────────────────────────────── 主机白名单（登录的根因） */

test('Transport 的主机白名单必须覆盖学在浙大与拼题A', async () => {
  // 这条是"登录成功但会话为空"的根因：Transport 只在主机命中白名单时才读写 cookie。
  // classroom 那套默认值里没有这两个域，漏传就永远拿不到会话。
  assert.equal(AUTH_HOSTS.has('courses.zju.edu.cn'), false, '默认值只含智云课堂的域');
  assert.equal(CAMPUS_HOSTS.has('courses.zju.edu.cn'), true);
  assert.equal(CAMPUS_HOSTS.has('pintia.cn'), true);
  assert.equal(CAMPUS_HOSTS.has('zjuam.zju.edu.cn'), true, 'CAS 域也要在，否则 SSO 票存不进去');
});

test('传了 hosts 才会真的收发 cookie', async () => {
  const fetchImpl = async (url) => {
    const headers = new Headers();
    if (String(url).includes('/user/index')) {
      headers.append('Set-Cookie', 'session=GOTIT; Path=/; Domain=.courses.zju.edu.cn');
    }
    return new Response('{}', { status: 200, headers });
  };

  // 不传 hosts：cookie 收不到
  const wrong = new Transport({ fetch: fetchImpl });
  await wrong.request('https://courses.zju.edu.cn/user/index');
  assert.equal((await wrong.session.jar.getCookies('https://courses.zju.edu.cn/')).length, 0);

  // 传 hosts：能收到
  const right = new Transport({ fetch: fetchImpl, hosts: CAMPUS_HOSTS });
  await right.request('https://courses.zju.edu.cn/user/index');
  assert.equal((await right.session.jar.getCookies('https://courses.zju.edu.cn/')).length, 1);
});

test('SSO 票必须发给学在浙大（classroom 的默认过滤会把它挡掉）', async () => {
  // 这是"登录成功但会话为空"的第二个根因：
  // classroom 的 Transport 只把 iPlanetDirectoryPro 发给 zjuam，
  // 而学在浙大恰恰要带着它去 courses.zju.edu.cn 让 CAS 过滤器认身份。
  let sent = null;
  const fetchImpl = async (_url, init) => {
    sent = init?.headers?.Cookie ?? null;
    return new Response('{}', { status: 200, headers: new Headers() });
  };
  const transport = new Transport({ fetch: fetchImpl, hosts: CAMPUS_HOSTS });
  await transport.session.jar.setCookie(
    'iPlanetDirectoryPro=TICKET; Path=/; Domain=.zju.edu.cn',
    'https://courses.zju.edu.cn/user/index',
  );
  await transport.request('https://courses.zju.edu.cn/user/index');

  assert.ok(sent, '请求必须带 cookie');
  assert.match(sent, /iPlanetDirectoryPro=TICKET/, 'SSO 票要发到 courses 域');
});

test('完整的登录链路：CAS 换票 → 带票访问业务页 → 拿到 session', async () => {
  const MODULUS = 'b2f3c1a9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1';
  const CAS = 'https://zjuam.zju.edu.cn/cas';
  const COURSES = 'https://courses.zju.edu.cn';

  const fakeFetch = async (url, init) => {
    const target = String(url);
    const cookie = init?.headers?.Cookie ?? null;
    const headers = new Headers();

    if (target === `${CAS}/login` && init?.method !== 'POST') {
      return new Response('<html><input name="execution" value="e1"></html>', { status: 200, headers });
    }
    if (target.includes('/cas/v2/getPubKey')) {
      return new Response(JSON.stringify({ modulus: MODULUS, exponent: '010001' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (target === `${CAS}/login` && init?.method === 'POST') {
      headers.append('Set-Cookie', 'iPlanetDirectoryPro=TICKET; Path=/; Domain=.zju.edu.cn');
      return new Response('<html>ok</html>', { status: 200, headers });
    }
    if (target.startsWith(`${COURSES}/user/index`)) {
      // 带票才给 session —— 这正是真实站点的行为
      if (cookie && cookie.includes('iPlanetDirectoryPro=TICKET')) {
        headers.append('Set-Cookie', 'session=SESSION; Path=/; Domain=.courses.zju.edu.cn');
        return new Response('<html>首页</html>', { status: 200, headers });
      }
      headers.append('Location', `${CAS}/login`);
      return new Response(null, { status: 302, headers });
    }
    return new Response('{}', { status: 200, headers });
  };

  const transport = new Transport({ fetch: fakeFetch, hosts: CAMPUS_HOSTS });
  const { xzzdLogin } = await import('../packages/dsh-zhiyun-source-campus/src/cas/login.js');
  await xzzdLogin(transport, { username: 'u', password: 'p' });

  assert.equal(await hasXzzdSession(transport), true, '登录后应该有 session cookie');
});

test('CAS 拒绝时回 AUTH_REJECTED，并如实转述站点给的原因', async () => {
  // ⚠️ 这条测试原本断言「返回登录页 = 学号或密码错误」。那个假设是错的：
  //    CAS 回登录页有多种原因（凭据被拒、会话异常、页面结构变化…），
  //    不能只凭"回了登录页"就断定密码错。
  //    现在的规则：**页面明确写了错误文案才转述**，没有就如实说"没给原因"。
  const fakeFetch = async (url, init) => {
    const target = String(url);
    const headers = new Headers();
    if (target.includes('/cas/v2/getPubKey')) {
      return new Response(JSON.stringify({
        modulus: 'b2f3c1a9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1',
        exponent: '010001',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('/cas/login') && init?.method === 'POST') {
      // 站点明确给出错误文案（这一支才是真的"密码错"）
      return new Response('<html><span>错误密码</span><input name="execution" value="e2"></html>', { status: 200, headers });
    }
    return new Response('<html><input name="execution" value="e1"></html>', { status: 200, headers });
  };

  const transport = new Transport({ fetch: fakeFetch, hosts: CAMPUS_HOSTS });
  const { xzzdLogin } = await import('../packages/dsh-zhiyun-source-campus/src/cas/login.js');
  await assert.rejects(
    () => xzzdLogin(transport, { username: 'u', password: 'wrong' }),
    (error) => {
      assert.equal(error.code, 'AUTH_REJECTED', `实际是 ${error.code}`);
      assert.match(error.message, /错误密码/, '站点写了什么就转述什么');
      return true;
    },
  );
});

/* ────────────────────────────────────── 学在浙大：端点口径 */

test('CAS 错误文案必须按元素取文本，不能把属性名当文案', async () => {
  // ⚠️ 这是一次真实误判的回归测试。
  //
  // 浙大 CAS 的拒绝页面结构是：
  //   <p class="error" id="errormsg" role="heading"><span id="msg">用户名或密码错误</span></p>
  //
  // 旧实现用 `(?:auth_error|errorMsg|error_message|错误提示)[^<]{0,120}` 去找文案，
  // 结果 `errorMsg`（忽略大小写）**先命中了属性名 `id="errormsg"`**，
  // 于是"文案"变成了 `errormsg" role="heading">`。
  // 再往上，调用方把所有 AUTH_REJECTED 一律说成"学号或密码不对" ——
  // 一次网络失败被报成了密码错，用户于是反复去改密码。
  const { casErrorMessage, describeAuthFailure } = await import('../packages/dsh-zhiyun-source-campus/src/cas/login.js');

  const realPage = `<div class="login-middle"><form id="fm1" action="/cas/login" method="post">
      <div class="form-group">
        <p class="error text-left" id="errormsg" role="heading">
          <span id="msg">用户名或密码错误</span>
        </p>
        <input id="username" name="username">
        <input name="execution" value="e1">
      </div></form></div>`;

  assert.equal(casErrorMessage(realPage), '用户名或密码错误');
  assert.match(describeAuthFailure({ status: 200, text: realPage }), /^用户名或密码错误$/);

  // 只有容器没有内层 span 时也要能取到
  assert.equal(
    casErrorMessage('<p id="errormsg">账号已被暂时锁定</p>'),
    '账号已被暂时锁定',
  );

  // 关键：**没有**错误文案时绝不能编一个出来
  const plainLoginPage = '<html><form><input name="execution" value="e1"></form></html>';
  assert.equal(casErrorMessage(plainLoginPage), null);
  const described = describeAuthFailure({ status: 200, text: plainLoginPage });
  assert.match(described, /没有给出错误文案/);
  assert.match(described, /不等于密码错误/);
  assert.doesNotMatch(described, /学号或密码(不对|错)/);
});

test('CAS 拒绝时回 AUTH_REJECTED，并如实转述站点给的原因', async () => {
  const fetchImpl = recorder([
    ['/api/my-semesters', () => json({ semesters: [{ id: 100, is_active: true }] })],
    ['/api/my-courses', () => json({ courses: [{ id: 7, name: '示例课程' }] })],
    ['/activities', () => json({ activities: [] })],
    ['/exams', () => json({ exams: [] })],
    ['/homework/submission-status', () => json({ activities: [] })],
    ['/submitted-exams', () => json({ submitted_exams: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
  ]);

  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  await api.todos();

  const urls = fetchImpl.calls.map((c) => c.url);
  assert.equal(urls.some((u) => u.includes('/api/todos')), false, '不该碰会漏的聚合端点');
  assert.ok(urls.some((u) => u.includes('/api/my-semesters')), '要先取学期');
  assert.ok(urls.some((u) => u.includes('/api/my-courses')), '再取课程');
});

test('课程查询只要"进行中 / 未开始"，且 page_size=1000', async () => {
  let body = null;
  const fetchImpl = recorder([
    ['/api/my-semesters', () => json({ semesters: [{ id: 100, is_active: true }] })],
    ['/api/my-courses', (_u, init) => { const params = new URL(_u).searchParams; body = {page_size:Number(params.get('page_size')), conditions:JSON.parse(params.get('conditions'))}; assert.equal(init.method, 'GET'); return json({ courses: [] }); }],
  ]);
  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  await api.todos();

  assert.deepEqual(body.conditions.status, [...ONGOING_STATUS]);
  assert.equal(body.page_size, 1000);
});

test('活跃学期要带上相邻的 id+1 / id+2（短学期）', async () => {
  let body = null;
  const fetchImpl = recorder([
    ['/api/my-semesters', () => json({ semesters: [{ id: 100, is_active: true }, { id: 50, is_active: false }] })],
    ['/api/my-courses', (_u, init) => { body = {conditions:JSON.parse(new URL(_u).searchParams.get("conditions"))}; assert.equal(init.method,"GET"); return json({ courses: [] }); }],
  ]);
  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  await api.todos();

  assert.deepEqual(body.conditions.semester_id, [100, 101, 102], '只取活跃学期，并带相邻两个');
});

test('逐课端点：homework/submission-status 是**单数** course', () => {
  const urls = courseApis('7');
  // 上游就是单数；改成复数会 404
  assert.ok(urls.homeworkSubmissionStatus.includes('/api/course/7/'), `实际是 ${urls.homeworkSubmissionStatus}`);
  assert.equal(urls.homeworkSubmissionStatus.includes('/api/courses/7/'), false);
  assert.ok(urls.activities.includes('/api/courses/7/activities'));
  assert.ok(urls.exams.includes('/api/courses/7/exams'));
});

/* ────────────────────────────────────── 过滤口径 */

test('待办判定：已发布 + 未截止 + 已开始 + 未提交 + 没满分', () => {
  const now = new Date('2026-10-19T12:00:00+08:00');
  const base = {
    published: true,
    startTime: null,
    endTime: '2026-10-21T15:59:00+08:00',
    submitted: false,
    fullyScored: false,
    now,
  };
  assert.equal(isPendingTodo(base), true, '正常的一条');

  assert.equal(isPendingTodo({ ...base, published: false }), false, '未发布');
  assert.equal(isPendingTodo({ ...base, endTime: null }), false, '没有截止时间');
  assert.equal(isPendingTodo({ ...base, endTime: '2026-10-18T00:00:00+08:00' }), false, '已截止');
  assert.equal(isPendingTodo({ ...base, startTime: '2026-10-25T00:00:00+08:00' }), false, '还没开始');
  assert.equal(isPendingTodo({ ...base, submitted: true }), false, '已提交');
  assert.equal(isPendingTodo({ ...base, fullyScored: true }), false, '已拿满分');
});

test('一门课挂掉不拖垮其它课（单端 403 只丢那一类）', async () => {
  const fetchImpl = recorder([
    ['/api/my-semesters', () => json({ semesters: [{ id: 100, is_active: true }] })],
    ['/api/my-courses', () => json({ courses: [{ id: 7, name: 'A' }] })],
    ['/activities', () => json({
      activities: [{
        id: 1, title: '该交的作业', published: true,
        end_time: '2026-10-30T15:59:00+08:00',
      }],
    })],
    // exams 没权限 —— 只该丢这一类
    ['/exams', () => new Response('{}', { status: 403 })],
    ['/homework/submission-status', () => json({ activities: [] })],
    ['/submitted-exams', () => json({ submitted_exams: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
  ]);

  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  const out = await api.todos();
  assert.equal(out.todos.length, 1, 'activities 那条要留下');
  assert.equal(out.todos[0].title, '该交的作业');
});

test('homework/submission-status 返回 404 是"这门课没有作业"，不是失败', async () => {
  // 上游实测：没有作业的课，该端点直接回 404。任何把它抛成 HTTP 错误的写法
  // 都会把整门课、进而把整次取数拖垮（todos() 整体 reject → 空列表）。
  const fetchImpl = recorder([
    ['/api/my-semesters', () => json({ semesters: [{ id: 100, is_active: true }] })],
    ['/api/my-courses', () => json({ courses: [{ id: 7, name: 'A' }] })],
    ['/activities', () => json({
      activities: [{
        id: 1, title: '该交的作业', published: true,
        end_time: '2026-10-30T15:59:00+08:00',
      }],
    })],
    ['/exams', () => json({ exams: [] })],
    ['/homework/submission-status', () => new Response('{}', { status: 404 })],
    ['/submitted-exams', () => json({ exam_ids: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
  ]);

  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  const out = await api.todos();
  assert.equal(out.todos.length, 1, '404 只降级，不能拖垮整课');
  assert.equal(out.todos[0].title, '该交的作业');
});

test('无 end_at 的进行中课堂互动要保留（它不是"已结束"）', () => {
  const now = new Date('2026-10-19T12:00:00+08:00');
  // status === 'start' 且没有 end_at：进行中、没有截止时间，两种语义都不该排除它。
  // 注意它不走 isPendingTodo（那条要求 end_time 非空，会把这类条目静默丢掉）。
  const todos = buildCourseTodos(
    { id: '7', name: 'A' },
    {
      activities: [], exams: [], homeworkActivities: [], submittedExamIds: [],
      classrooms: [
        { id: 301, status: 'start', title: '进行中的互动' },
        { id: 302, status: 'start', title: '已结束的互动', end_at: '2026-10-18T12:00:00+08:00' },
        { id: 303, status: 'end', title: '状态不对' },
      ],
    },
    now,
  );
  assert.deepEqual(todos.map((t) => t.title), ['进行中的互动']);
  assert.equal(todos[0].due, null, '没有 end_at 就是没有截止时间，不编一个');
});

test('会话失效（登录页 HTML）是整体失败，不能静默成空', async () => {
  const fetchImpl = async () => new Response(
    '<html><form><input name="execution" value="x"></form></html>',
    { status: 200, headers: { 'content-type': 'text/html' } },
  );
  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  await assert.rejects(() => api.todos(), (error) => {
    assert.equal(error.code, 'SESSION_EXPIRED', `实际是 ${error.code}`);
    return true;
  });
});

/* ────────────────────────────────────── 不做降级、不造占位 */

test('没有课程就返回空，不造占位条目', async () => {
  const fetchImpl = recorder([
    ['/api/my-semesters', () => json({ semesters: [{ id: 100, is_active: true }] })],
    ['/api/my-courses', () => json({ courses: [] })],
  ]);
  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  const out = await api.todos();
  assert.deepEqual(out.todos, [], '空就是空');
  assert.equal(out.todos.some((t) => /加载失败|未知|占位/.test(t.title)), false);
});

test('缺 activities 字段时当"这类没有"，不抛也不编', () => {
  const todos = buildCourseTodos(
    { id: '7', name: 'A' },
    { activities: [{}], exams: [], homeworkActivities: [], submittedExamIds: [], classrooms: [] },
    new Date('2026-10-19T12:00:00+08:00'),
  );
  // 没有 id 的行直接跳过（不是编一个"无标题"）
  assert.deepEqual(todos, []);
});

test('已提交的作业要从待办里排掉（两个口径都认）', () => {
  const now = new Date('2026-10-19T12:00:00+08:00');
  const activity = { id: 1, title: 'x', published: true, end_time: '2026-10-30T15:59:00+08:00' };

  // status_code = submitted
  assert.deepEqual(buildCourseTodos({ id: '7', name: 'A' }, {
    activities: [activity], exams: [], homeworkActivities: [{ id: 1, status_code: 'submitted' }],
    submittedExamIds: [], classrooms: [],
  }, now), []);

  // status = finished（另一版口径）
  assert.deepEqual(buildCourseTodos({ id: '7', name: 'A' }, {
    activities: [activity], exams: [], homeworkActivities: [{ id: 1, status: 'finished' }],
    submittedExamIds: [], classrooms: [],
  }, now), []);
});

/* ────────────────────────────────────── 拼题A */

test('拼题A 只发 1 个请求，且不带逐题集详情', async () => {
  const fetchImpl = recorder([['/api/problem-sets', () => json({
    problemSets: Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1), name: `题集${i + 1}`,
      endAt: new Date(Date.now() + (i + 1) * 86400000).toISOString(),
    })),
  })]]);
  const transport = await makeTransport(fetchImpl, [['SESSION=abc; Domain=.pintia.cn; Path=/', 'https://pintia.cn/']]);
  const out = await new PtaApi(transport).problemSets();

  assert.equal(fetchImpl.calls.length, 1, `实际 ${fetchImpl.calls.length} 个请求`);
  assert.equal(fetchImpl.calls.some((c) => c.url.includes('/exams')), false, '不该请求 /exams');
  assert.equal(out.problemSets.length, 12);
});

test('查询串只编码一次（双编码会被 PTA 回 400）', async () => {
  let seenUrl = null;
  const fetchImpl = async (url) => {
    seenUrl = String(url);
    return json({ problemSets: [] });
  };
  const transport = await makeTransport(fetchImpl, [['SESSION=abc; Domain=.pintia.cn; Path=/', 'https://pintia.cn/']]);
  await new PtaApi(transport).problemSets();

  // filter 里的 { } " 只能以 %7B %22 出现一次；出现 %257B 就是双编码
  assert.equal(seenUrl.includes('%257B'), false, `出现了双编码：${seenUrl}`);
  assert.ok(seenUrl.includes('order_by=END_AT'), '要带排序参数');
  assert.ok(seenUrl.includes('asc=true'));
  assert.ok(seenUrl.includes('limit='));
});

test('拼题A 404 是 Cookie 失效，不是"题集不存在"', async () => {
  const fetchImpl = async () => json({ error: { code: 'USER_NOT_FOUND' } });
  // 用真 404
  const notFound = async () => new Response(JSON.stringify({ error: { code: 'USER_NOT_FOUND' } }), {
    status: 404, headers: { 'content-type': 'application/json' },
  });
  const transport = await makeTransport(notFound, [['SESSION=abc; Domain=.pintia.cn; Path=/', 'https://pintia.cn/']]);
  await assert.rejects(() => new PtaApi(transport).problemSets(), (error) => {
    // 报成 NOT_FOUND 会让用户以为题集被删了；实际要重新登录
    assert.equal(error.code, 'COOKIE_EXPIRED', `实际是 ${error.code}`);
    assert.match(error.message, /Cookie 已失效/);
    return true;
  });
});

test('1970 纪元 = 没有截止时间；无 DDL 的题集要保留', () => {
  const now = new Date('2026-10-19T12:00:00+08:00');
  assert.equal(isPendingProblemSet({ endAt: '1970-01-01T00:00:00.000Z' }, now), true, '长期开放的练习集不是过期');
  assert.equal(isPendingProblemSet({ endAt: null }, now), true);
  assert.equal(isPendingProblemSet({ endAt: '2026-10-18T00:00:00Z' }, now), false, '真过期的要排掉');
  assert.equal(isPendingProblemSet({ endAt: '2026-10-30T00:00:00Z' }, now), true);
});

test('本地再排一次序（服务端排序不保证）', async () => {
  const fetchImpl = async () => json({
    problemSets: [
      { id: '2', name: '晚', endAt: '2026-11-01T00:00:00Z' },
      { id: '1', name: '早', endAt: '2026-10-25T00:00:00Z' },
    ],
  });
  const transport = await makeTransport(fetchImpl, [['SESSION=abc; Domain=.pintia.cn; Path=/', 'https://pintia.cn/']]);
  const out = await new PtaApi(transport).problemSets({ includeEnded: true });
  assert.deepEqual(out.problemSets.map((row) => row.name), ['早', '晚']);
});

test('拼题A 缺 problemSets 时如实报错', async () => {
  const fetchImpl = async () => json({ data: [] });
  const transport = await makeTransport(fetchImpl, [['SESSION=abc; Domain=.pintia.cn; Path=/', 'https://pintia.cn/']]);
  await assert.rejects(() => new PtaApi(transport).problemSets(), (e) => e.code === 'API_SHAPE');
});

/* ────────────────────────────────────── Cookie 解析 */

test('Cookie 解析排除属性行与表头', () => {
  const plain = parsePtaCookie('SESSION=abc; Path=/; HttpOnly');
  assert.deepEqual(plain.names, ['SESSION'], 'Path / HttpOnly 是属性');

  const table = parsePtaCookie('Name\tValue\nSESSION\tabc\nPath\t/\nHttpOnly\t✓');
  assert.deepEqual(table.names, ['SESSION'], '表头与属性行都要排除');

  const curl = parsePtaCookie('curl "https://pintia.cn/api" -H "cookie: SESSION=x; PTASESSION=y"');
  assert.deepEqual(curl.names.sort(), ['PTASESSION', 'SESSION']);
  assert.equal(curl.source, 'curl 命令');

  assert.equal(parsePtaCookie(''), null);
});

test('整串 Cookie 原样保留（PTA 用整串认证）', () => {
  const parsed = parsePtaCookie('PTASESSION=a; SESSION=b');
  assert.equal(parsed.cookie, 'PTASESSION=a; SESSION=b', '顺序与内容都要保住');
});

/* ────────────────────────────────────── 时间与归一化 */

test('平台裸时间按上海时区解析，不受本机时区影响', () => {
  assert.equal(normalizeDeadline('2026-10-20T15:59:00').iso, '2026-10-20T07:59:00.000Z');
  assert.equal(normalizeDeadline('2026-10-20T15:59:00+08:00').iso, '2026-10-20T07:59:00.000Z');
  assert.equal(normalizeDeadline(null).iso, null);
});

test('昨天 UTC 零点（兜住服务端过滤边界）', () => {
  const at = yesterdayUtcMidnight(new Date('2026-10-19T12:00:00Z'));
  assert.equal(at, '2026-10-18T00:00:00.000Z');
});

test('归一化形状与「规划」页一致', () => {
  const xzzd = normalizeXzzd([{ id: '1', title: 'a', courseName: 'c', due: '2026-10-20T00:00:00.000Z', dueText: 'x', url: 'u' }]);
  assert.deepEqual(Object.keys(xzzd[0]).sort(), ['detail', 'due', 'dueText', 'id', 'kind', 'source', 'sourceLabel', 'title', 'url']);
  assert.equal(xzzd[0].kind, 'todo');

  const pta = normalizePta([{ id: '2', name: 'b', ended: false, endsAt: { iso: null, text: null }, url: 'u' }]);
  assert.equal(pta[0].kind, 'problemSet');
  assert.equal(pta[0].detail, '未结束');

  assert.deepEqual(normalizeXzzd(null), []);
  assert.deepEqual(normalizePta(undefined), []);
});

test('会话判定：有 session cookie 才算就绪', async () => {
  assert.equal(await hasXzzdSession(await makeTransport(recorder([]), [XZZD_COOKIE])), true);
  assert.equal(await hasXzzdSession(await makeTransport(recorder([]))), false);
});

test('模块加载时不能引用未导入的常量（PTA_BASE 曾漏导入）', async () => {
  // 真实故障：`index.js` 的 `ptaTransport()` 里用了 `PTA_BASE`，但只把它放在
  // re-export 里、没有 import。加载时不报错（顶层没执行到那行），
  // 直到**拼题A 真的去取数**才抛 `PTA_BASE is not defined`，
  // 而它被 `toError` 兜成一个没有具体含义的 `CAMPUS_FAILED`。
  //
  // 所以这里不测函数，而是**真的走一次拼题A 的读取路径**：
  // 只要那个常量没导入，这条路一定炸。
  const module = await import('../packages/dsh-zhiyun-source-campus/src/index.js');
  assert.equal(typeof module.PTA_BASE, 'string', 'PTA_BASE 必须能作为值导出');
  assert.ok(module.PTA_BASE.startsWith('https://'), 'PTA_BASE 应是完整 URL');

  // 同类的还有 XZZD_BASE / CAMPUS_HOSTS
  assert.ok(module.XZZD_BASE.startsWith('https://'));
  assert.ok(module.CAMPUS_HOSTS instanceof Set);
});

test('拼题A 未配 Cookie 时报"需要粘贴"，不是笼统的失败', async () => {
  // 这条同时守住了 PTA_BASE 那条路径：它必须真的走到 `ptaTransport()` 里，
  // 才会暴露出常量缺失或 throw 位置错误。
  const { apply } = await import('../packages/dsh-zhiyun-source-campus/src/index.js');
  const services = {};
  const ctx = {
    profileContext: { dir: '.verify-campus' },
    logger: { info() {}, warn() {} },
    get: (name) => (name === 'credentials' ? null : undefined),
    inject: () => {},
    provide: (name, value) => { services[name] = value; return () => {}; },
  };
  await apply(ctx, { dataDir: '.verify-campus' });
  const result = await services.zhiyunCampus.todos();

  assert.equal(result.pta.ok, false);
  // 没配 Cookie 是**配置问题**，必须是明确的 COOKIE_IMPORT_REQUIRED
  assert.equal(result.pta.error.code, 'COOKIE_IMPORT_REQUIRED', `实际是 ${result.pta.error.code}`);
  assert.equal(
    result.pta.error.code === 'CAMPUS_FAILED',
    false,
    'CAMPUS_FAILED 是兜底码，出现它说明抛了没有 code 的普通错误（如常量未定义）',
  );
});

/* ────────────────────────────────────── courseBundle：课内 5 端点并行 */

/**
 * 这组测试钉住「课内并行」的契约（OWNER 决策 2026-10-21）。
 *
 * 背景：30 门课的待办原先要 78 秒 —— 每门课 5 个端点串行，5 个 RTT × 30。
 * 改成并行后每门课只花 1 RTT（实测等比基准 15200ms → 3250ms）。
 *
 * 并行最怕三件事，下面逐条钉住：
 *   1. **假并行**：写起来像并发，实际还是一个个 await（性能没变好）；
 *   2. **429 被吞**：限流信号被别的成功结果掩盖，继续压接口；
 *   3. **403 不再降级**：单个端点没权限本该只丢那一类，却让整门课失败。
 */

/** 造一门课的场景：学期 + 课程 + 5 个端点。 */
function courseScenario(endpoints) {
  return recorder([
    ['/api/my-semesters', () => json({ semesters: [{ id: 100, is_active: true }] })],
    ['/api/my-courses', () => json({ courses: [{ id: 7, name: '课', status: 'ongoing' }] })],
    ...endpoints,
  ]);
}

test('courseBundle 的 5 个端点真的并发（不是挨个 await）', async () => {
  // 用「同时在飞的请求数」判定，而不是看代码形状：
  // 真并发 → 峰值 > 1；串行 → 恒为 1。
  let inFlight = 0;
  let peak = 0;
  const slow = (payload) => async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return json(payload);
  };

  const fetchImpl = courseScenario([
    ['/activities', slow({ activities: [] })],
    ['/exams', slow({ exams: [] })],
    ['/homework/submission-status', slow({ activities: [] })],
    ['/submitted-exams', slow({ submitted_exams: [] })],
    ['/classroom-list', slow({ classrooms: [] })],
  ]);

  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  await api.courseBundle(7);

  assert.ok(peak > 1, `5 个端点应同时在飞，实测峰值 = ${peak}（=1 说明还是串行）`);
});

test('courseBundle 遇到 429 立即中止，不重试放大', async () => {
  let hits = 0;
  const fetchImpl = courseScenario([
    ['/activities', async () => { hits += 1; return new Response('{}', { status: 429 }); }],
    ['/exams', () => json({ exams: [] })],
    ['/homework/submission-status', () => json({ activities: [] })],
    ['/submitted-exams', () => json({ submitted_exams: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
  ]);

  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  await assert.rejects(
    () => api.courseBundle(7),
    (error) => error.code === 'RATE_LIMITED',
    '429 必须以 RATE_LIMITED 抛出，不能被降级成空数组',
  );
  assert.equal(hits, 1, '限流端点只该被打一次（不得自动重试）');
});

test('courseBundle 的 403 仍然只丢那一类，不拖垮整门课', async () => {
  const fetchImpl = courseScenario([
    ['/activities', () => new Response('{}', { status: 403 })],
    ['/exams', () => json({ exams: [{ id: 1 }] })],
    ['/homework/submission-status', () => json({ activities: [] })],
    ['/submitted-exams', () => json({ submitted_exams: [] })],
    ['/classroom-list', () => new Response('{}', { status: 403 })],
  ]);

  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  const bundle = await api.courseBundle(7);

  assert.deepEqual(bundle.activities, [], '403 的活动列表降级为空');
  assert.deepEqual(bundle.classrooms, [], '403 的课堂互动降级为空');
  assert.equal(bundle.exams.length, 1, '没被 403 的端点照常返回');
});

test('courseBundle 的 SESSION_EXPIRED 必须抛出（并行也不能吞）', async () => {
  const fetchImpl = courseScenario([
    ['/activities', () => new Response('{}', { status: 401 })],
    ['/exams', () => json({ exams: [] })],
    ['/homework/submission-status', () => json({ activities: [] })],
    ['/submitted-exams', () => json({ submitted_exams: [] })],
    ['/classroom-list', () => json({ classrooms: [] })],
  ]);

  const api = new XzzdApi(await makeTransport(fetchImpl, [XZZD_COOKIE]));
  await assert.rejects(
    () => api.courseBundle(7),
    (error) => error.code === 'SESSION_EXPIRED',
    '会话失效是整体失败，不能被并行的成功分支掩盖',
  );
});

test('课程之间仍然串行：COURSE_CONCURRENCY 保持 1', async () => {
  // 课内并行放开了，但**跨课程**必须还是串行 —— 那才是会成倍放大并发的维度。
  assert.equal(COURSE_CONCURRENCY, 1);
  // 且并发参数仍被限制在 1..2，不允许悄悄放宽
  const api = new XzzdApi(await makeTransport(recorder([]), [XZZD_COOKIE]));
  await assert.rejects(() => api.todos({ concurrency: 8 }), /并发/, '并发参数不允许超过 2');
});
