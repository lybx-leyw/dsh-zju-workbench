/**
 * 拼题A 数据源（`@lybx-leyw/dsh-zju-source-pta`）的测试。
 *
 * # 两层，理由
 *
 * 1. **纯函数 / 客户端层**（`src/pta.js`）：题集列表、题面、进度、Cookie 解析、
 *    错误分类。这一层用假 `request`，永不联网。
 * 2. **集成层**（`src/index.js`）：`apply()` 真的 provide 了 `zhiyunPta` 吗？
 *    路由路径对吗？非法动作会不会静默成功？
 *
 * 第二层单列，是因为 `tests/yjsy-host.test.mjs` 记过的教训：纯解析测试全绿
 * 而 `index.js` 里 `jar: null` 让这个包**一次请求也发不出去**。拆包之后必须
 * 重新钉住「服务名 / 路由 / 动作白名单」这三件事，否则拆完没人知道它还在不在。
 *
 * # 不联网
 *
 * `apply()` 的 `config.fetch` 注入口就是为此存在：`Transport` 拿到的是这个假
 * fetch，任何一次真实出网都说明注入口失效了。`config.protect` 同理 ——
 * 默认的 DPAPI 每次落盘要 spawn 一个 powershell（实测 1249ms）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { apply, ROUTE_PATH, WRITE_HEADER } from '../packages/source/pta/src/index.js';
import {
  PtaApi,
  parsePtaCookie,
  normalizePta,
  translatePtaError,
  PTA_PAGE_LIMIT,
  PTA_ORDER_BY,
  PTA_PROBLEM_TYPES,
  PTA_TYPE_LABELS,
  ptaId,
  yesterdayUtcMidnight,
  normalizeDeadline,
  isPendingProblemSet,
} from '../packages/source/pta/src/pta.js';
import { PTA_BASE, PTA_HOST, PTA_HOSTS, isPtaHost } from '../packages/source/pta/src/hosts.js';

/* ──────────────────────────────── 测试替身 ──────────────────────────────── */

/** 造一个 `Transport.request` 形状的 JSON 回包。 */
const json = (value, status = 200) => ({
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  text: JSON.stringify(value),
});

/**
 * 记录请求并按路径回包的假 transport。
 *
 * 形状必须是 `Transport.request` 的 `{ status, headers, text }`。
 * `jar` 也要给 —— `PtaApi.get` 的 403 分支会读它来判断"这次带没带 Cookie"。
 *
 * @param routes - `[子串, (url) => 回包]`。
 * @param cookies - `jar.getCookies` 要回的行（默认空 = 没带 Cookie）。
 */
function fakeTransport(routes, cookies = []) {
  const calls = [];
  return {
    calls,
    session: { jar: { getCookies: async () => cookies } },
    request: async (url, init) => {
      const target = String(url);
      calls.push({ url: target, method: init?.method ?? 'GET' });
      for (const [match, handler] of routes) {
        if (target.includes(match)) return handler(target);
      }
      return json({});
    },
  };
}

/** 只有方法名、没有实现 —— 只用来断言"没打到网络"。 */
const noRequestTransport = () => ({
  calls: [],
  session: { jar: { getCookies: async () => [] } },
  request: async (url) => { throw new Error(`不该发请求：${url}`); },
});

/**
 * 造一个最小的 cordis 风格 ctx。
 *
 * `inject` 的回调立刻执行（模拟服务已在位），`webServer.register` 记录注册项。
 * 与 `tests/yjsy-host.test.mjs` 同构 —— 两个包的宿主入口形状本来就该一样。
 *
 * @param options.dir - 数据目录（默认随机临时目录）。
 * @returns `{ ctx, services, routes, dir, cleanup }`。
 */
function fakeCtx({ dir } = {}) {
  const dataDir = dir ?? mkdtempSync(path.join(tmpdir(), 'pta-test-'));
  const services = new Map();
  const routes = [];
  const ctx = {
    profileContext: { dir: dataDir },
    effect(fn) { return fn() ?? (() => {}); },
    provide(name, value) { services.set(name, value); return () => services.delete(name); },
    inject(names, callback) {
      const scope = { effect: (fn) => fn(), webServer: { register(entry) { routes.push(entry); return () => {}; } } };
      callback(scope);
    },
  };
  return {
    ctx,
    dataDir,
    services,
    routes,
    cleanup: () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* 临时目录删不掉不算失败 */ } },
  };
}

/**
 * 假 fetch：按路径回 JSON，并记下每一次请求的 URL。
 *
 * 返回的是**真的 `Response`** —— `Transport` 会读 `.status` / `.headers.getSetCookie()`
 * / `.text()`，用对象字面量冒充会在细节上失真（`getSetCookie` 尤其）。
 *
 * @param routes - `[子串, (url) => 对象]`；没命中就回 `{}`。
 */
function fakeFetch(routes = []) {
  const calls = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [match, handler] of routes) {
      if (target.includes(match)) {
        return new Response(JSON.stringify(handler(target)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** 恒等保护器：跳过 DPAPI（它每次要 spawn 一个 powershell）。 */
const identityProtect = async (bytes) => bytes;

/** 造一个请求对象（`for await` 可迭代，与真实可读流一致）。 */
function makeReq(body, { method = 'POST', url = ROUTE_PATH, headers = {} } = {}) {
  const buffer = Buffer.from(body ?? '', 'utf8');
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (buffer.length) yield buffer;
    },
  };
}

/** 造一个响应对象，把 `end` 的载荷解析出来交给 `assert`。 */
function makeRes() {
  const result = { status: null, headers: null, body: null };
  return {
    result,
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(payload) { result.body = JSON.parse(payload); },
  };
}

/* ────────────────────────────── 纯函数：id 与常量 ────────────────────────────── */

test('题集/题目 id 必须是数字串（挡住路径穿越与非数字）', () => {
  assert.equal(ptaId('123'), '123');
  assert.equal(ptaId(456), '456');
  assert.equal(ptaId(' 789 '), '789');
  for (const bad of ['', 'abc', '12/34', '../1', '1.5', null, undefined, '-1', '0x10']) {
    assert.throws(() => ptaId(bad), (error) => {
      assert.equal(error.code, 'INVALID_ID', `bad=${String(bad)}`);
      return true;
    });
  }
});

test('题型标签与枚举一一对应（数量与逐项都要对）', () => {
  assert.equal(PTA_PROBLEM_TYPES.length, 9);
  assert.equal(Object.keys(PTA_TYPE_LABELS).length, PTA_PROBLEM_TYPES.length);
  for (const type of PTA_PROBLEM_TYPES) {
    assert.ok(PTA_TYPE_LABELS[type], `${type} 缺中文标签`);
  }
  assert.equal(PTA_TYPE_LABELS.PROGRAMMING, '编程题');
  assert.equal(PTA_TYPE_LABELS.SUBJECTIVE, '主观题');
});

test('列表口径：单页上限 100、按 END_AT 排', () => {
  assert.equal(PTA_PAGE_LIMIT, 100);
  assert.equal(PTA_ORDER_BY, 'END_AT');
});

/* ────────────────────────────── 站点常量 ────────────────────────────── */

test('主机表只含拼题A 的三个域（收窄是故意的）', () => {
  assert.equal(PTA_BASE, 'https://pintia.cn');
  assert.equal(PTA_HOST, 'pintia.cn');
  assert.equal(PTA_HOSTS.size, 3);
  assert.ok(PTA_HOSTS.has('pintia.cn'));
  assert.ok(PTA_HOSTS.has('passport.pintia.cn'));
  assert.ok(PTA_HOSTS.has('www.pintia.cn'));
});

test('isPtaHost 点边界匹配（evilpintia.cn 不算）', () => {
  assert.equal(isPtaHost('pintia.cn'), true);
  assert.equal(isPtaHost('passport.pintia.cn'), true);
  assert.equal(isPtaHost('pintia.cn.'), true, '尾部点要归一');
  assert.equal(isPtaHost('evilpintia.cn'), false);
  assert.equal(isPtaHost('notpintia.cn'), false);
  assert.equal(isPtaHost(''), false);
  assert.equal(isPtaHost(null), false);
});

/* ────────────────────────────── 时间口径 ────────────────────────────── */

test('昨天 UTC 零点（兜住服务端过滤边界）', () => {
  assert.equal(yesterdayUtcMidnight(new Date('2026-10-19T12:00:00Z')), '2026-10-18T00:00:00.000Z');
  // UTC 当天的 0 点刚过，仍然是"昨天"
  assert.equal(yesterdayUtcMidnight(new Date('2026-10-19T00:00:00Z')), '2026-10-18T00:00:00.000Z');
});

test('Unix 纪元表示"没有截止时间"，不能显示成 1970 年过期', () => {
  assert.deepEqual(normalizeDeadline(null), { iso: null, text: null });
  assert.deepEqual(normalizeDeadline(''), { iso: null, text: null });
  assert.deepEqual(normalizeDeadline('1970-01-01T00:00:00.000Z'), { iso: null, text: null });
  // 无法解析时保留原文（用户至少看得到原样），但 iso 为 null
  assert.deepEqual(normalizeDeadline('不是时间'), { iso: null, text: '不是时间' });
  assert.equal(normalizeDeadline('2026-10-30T15:59:00+08:00').iso, '2026-10-30T07:59:00.000Z');
});

test('是否"还要做"：无 DDL 的保留，已截止的按开关丢', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  assert.equal(isPendingProblemSet({ endAt: null }, now), true, '长期开放的练习集不是过期');
  assert.equal(isPendingProblemSet({ endAt: '1970-01-01T00:00:00.000Z' }, now), true);
  assert.equal(isPendingProblemSet({ endAt: '2026-10-21T00:00:00.000Z' }, now), true, '还在 DDL 之前');
  assert.equal(isPendingProblemSet({ endAt: '2026-10-19T00:00:00.000Z' }, now), false, '已截止');
  assert.equal(isPendingProblemSet({ endAt: '2026-10-19T00:00:00.000Z' }, now, true), true, 'includeEnded 保留');
  assert.equal(isPendingProblemSet(null, now), false);
  assert.equal(isPendingProblemSet('x', now), false);
});

/* ────────────────────────────── 归一化与错误翻译 ────────────────────────────── */

test('normalizePta 形状与「规划」页一致', () => {
  const rows = normalizePta([
    { id: '2', name: '第三章作业', ended: false, endsAt: { iso: '2026-10-21T00:00:00.000Z', text: 'x' }, url: 'u' },
    { id: '3', name: '已结束的', ended: true, endsAt: { iso: null, text: null }, url: null },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(),
    ['detail', 'due', 'dueText', 'id', 'kind', 'source', 'sourceLabel', 'title', 'url']);
  assert.equal(rows[0].source, 'pta');
  assert.equal(rows[0].sourceLabel, '拼题A');
  assert.equal(rows[0].kind, 'problemSet');
  assert.equal(rows[0].detail, '未结束');
  assert.equal(rows[1].detail, '已结束');
  assert.equal(rows[1].due, null);
});

test('normalizePta 对非数组与缺字段不抛错', () => {
  assert.deepEqual(normalizePta(undefined), []);
  assert.deepEqual(normalizePta(null), []);
  assert.deepEqual(normalizePta('x'), []);
  // 缺字段的行原样透传（`title` 为 undefined），但 `detail` 必须落到"未结束" ——
  // `ended` 缺失不等于"已结束"，把它当成已结束会让用户以为作业没了。
  const [row] = normalizePta([{}]);
  assert.equal(row.title, undefined);
  assert.equal(row.detail, '未结束');
  assert.equal(row.kind, 'problemSet');
});

test('translatePtaError：Cookie 类错误指向「设置 → 拼题A」', () => {
  const expired = translatePtaError({ code: 'COOKIE_EXPIRED', message: '内部细节' });
  assert.equal(expired.code, 'COOKIE_IMPORT_REQUIRED');
  assert.match(expired.message, /设置 → 拼题A/);
  assert.match(expired.message, /短信验证/);
  assert.doesNotMatch(expired.message, /内部细节/, '要换成可操作的一句，不是转述内部消息');

  const save = translatePtaError({ code: 'COOKIE_IMPORT_REQUIRED', message: 'x' });
  assert.equal(save.code, 'COOKIE_IMPORT_REQUIRED');

  // 其它码原样透传 message（数据源已给好可上屏的一句）
  assert.deepEqual(translatePtaError({ code: 'RATE_LIMITED', message: '太频繁' }),
    { code: 'RATE_LIMITED', message: '太频繁' });
  assert.deepEqual(translatePtaError({ code: 'X', message: 42 }), { code: 'X', message: '42' });
  assert.equal(translatePtaError(null), null);
});

/* ────────────────────────────── 客户端：错误分类 ────────────────────────────── */

test('404 = Cookie 失效（PTA 用它表示"用户不存在"）', async () => {
  const transport = fakeTransport([['/api/problem-sets', () => ({ status: 404, headers: new Headers(), text: '{}' })]]);
  await assert.rejects(() => new PtaApi(transport).problemSets(), (error) => {
    assert.equal(error.code, 'COOKIE_EXPIRED');
    assert.match(error.message, /Cookie 已失效/, '必须说"Cookie 失效"，不能让用户以为是没配');
    return true;
  });
});

test('400 被解释成"查询串编码有问题"', async () => {
  const transport = fakeTransport([['/api/problem-sets', () => ({ status: 400, headers: new Headers(), text: '{}' })]]);
  await assert.rejects(() => new PtaApi(transport).problemSets(), (error) => {
    assert.equal(error.code, 'BAD_REQUEST');
    assert.match(error.message, /编码/);
    return true;
  });
});

test('401 / 3xx 都归为登录失效', async () => {
  for (const status of [401, 302]) {
    const transport = fakeTransport([['/api/problem-sets', () => ({ status, headers: new Headers(), text: '{}' })]]);
    await assert.rejects(() => new PtaApi(transport).problemSets(), (error) => {
      assert.equal(error.code, 'COOKIE_EXPIRED', `status=${status}`);
      return true;
    });
  }
});

test('403 分两种：没带 Cookie 是配置问题，带了是权限问题', async () => {
  const forbidden = () => ({ status: 403, headers: new Headers(), text: '{}' });

  const without = fakeTransport([['/api/problem-sets', forbidden]], []);
  await assert.rejects(() => new PtaApi(without).problemSets(), (error) => {
    assert.equal(error.code, 'COOKIE_EXPIRED');
    assert.match(error.message, /没有带上 Cookie/);
    return true;
  });

  const withCookie = fakeTransport([['/api/problem-sets', forbidden]], [{ key: 'SESSION' }]);
  await assert.rejects(() => new PtaApi(withCookie).problemSets(), (error) => {
    assert.equal(error.code, 'FORBIDDEN');
    assert.match(error.message, /权限/, '带 Cookie 还被拒 → 不要把人赶去改 Cookie');
    return true;
  });
});

test('429 是限速，不是失效', async () => {
  const transport = fakeTransport([['/api/problem-sets', () => ({ status: 429, headers: new Headers(), text: '{}' })]]);
  await assert.rejects(() => new PtaApi(transport).problemSets(), (error) => {
    assert.equal(error.code, 'RATE_LIMITED');
    return true;
  });
});

test('200 里包着网页 → 登录态失效；包着非对象 → 结构异常', async () => {
  const html = fakeTransport([['/api/problem-sets', () => ({ status: 200, headers: new Headers(), text: '  <html>' })]]);
  await assert.rejects(() => new PtaApi(html).problemSets(), (e) => e.code === 'COOKIE_EXPIRED');

  const broken = fakeTransport([['/api/problem-sets', () => ({ status: 200, headers: new Headers(), text: '不是 JSON' })]]);
  await assert.rejects(() => new PtaApi(broken).problemSets(), (e) => e.code === 'API_SHAPE');

  const list = fakeTransport([['/api/problem-sets', () => ({ status: 200, headers: new Headers(), text: '[1,2]' })]]);
  await assert.rejects(() => new PtaApi(list).problemSets(), (e) => e.code === 'API_SHAPE');
});

test('业务错误包在 200 里也要分类', async () => {
  const userGone = fakeTransport([['/api/problem-sets', () => json({ error: { code: 'USER_NOT_FOUND' } })]]);
  await assert.rejects(() => new PtaApi(userGone).problemSets(), (e) => e.code === 'COOKIE_EXPIRED');

  const rejected = fakeTransport([['/api/problem-sets', () => json({ error: { code: 'SOMETHING', message: '不行' } })]]);
  await assert.rejects(() => new PtaApi(rejected).problemSets(), (error) => {
    assert.equal(error.code, 'PLATFORM_REJECTED');
    assert.match(error.message, /不行/);
    return true;
  });
});

test('只允许 /api/ 路径，且挡住 ..', async () => {
  const transport = noRequestTransport();
  const api = new PtaApi(transport);
  await assert.rejects(() => api.get('/other/x'), (e) => e.code === 'INVALID_PATH');
  await assert.rejects(() => api.get('/api/../etc'), (e) => e.code === 'INVALID_PATH');
  await assert.rejects(() => api.get(42), (e) => e.code === 'INVALID_PATH');
});

test('构造时没有 request 就抛 CONFIG（早失败好过发请求时崩）', () => {
  assert.throws(() => new PtaApi({}), (e) => e.code === 'CONFIG');
  assert.throws(() => new PtaApi(null), (e) => e.code === 'CONFIG');
});

/* ────────────────────────────── 客户端：题集列表 ────────────────────────────── */

test('题集列表：filter 只编码一次，参数顺序与值都对', async () => {
  let seen = null;
  const transport = fakeTransport([['/api/problem-sets', (url) => {
    seen = url;
    return json({ problemSets: [], total: 0 });
  }]]);

  await new PtaApi(transport).problemSets({ now: () => new Date('2026-10-19T12:00:00Z') });

  const url = new URL(seen);
  assert.equal(url.pathname, '/api/problem-sets');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('order_by'), 'END_AT');
  assert.equal(url.searchParams.get('asc'), 'true');
  assert.deepEqual(JSON.parse(url.searchParams.get('filter')), { endAtAfter: '2026-10-18T00:00:00.000Z' });
  // 双重编码的表现是 `%257B` —— 那会让 PTA 回 400
  assert.doesNotMatch(seen, /%257B/, 'filter 被双重编码了');
  assert.match(seen, /filter=%7B/, 'filter 应该被编码一次');
});

test('题集列表：includeEnded 时不带 filter', async () => {
  let seen = null;
  const transport = fakeTransport([['/api/problem-sets', (url) => { seen = url; return json({ problemSets: [] }); }]]);
  await new PtaApi(transport).problemSets({ includeEnded: true });
  assert.doesNotMatch(seen, /filter=/);
});

test('题集列表：本地按 endAt 重排（服务端排序不保证）', async () => {
  const transport = fakeTransport([['/api/problem-sets', () => json({
    problemSets: [
      { id: '1', name: '晚的', endAt: '2026-11-01T00:00:00Z' },
      { id: '2', name: '早的', endAt: '2026-10-25T00:00:00Z' },
      { id: '3', name: '无 DDL', endAt: null },
    ],
  })]]);

  const out = await new PtaApi(transport).problemSets({ now: () => new Date('2026-10-20T00:00:00Z') });
  assert.equal(out.problemSets.length, 3);
  assert.deepEqual(out.problemSets.map((row) => row.id), ['2', '1', '3'], '无 DDL 的排最后');
  assert.equal(out.problemSets[0].url, `${PTA_BASE}/problem-sets/2/exam/problems`);
  assert.equal(out.problemSets[2].endsAt.iso, null);
  assert.equal(out.problemSets[2].ended, null);
});

test('题集列表：total 是**服务端**行数，不是过滤后的', async () => {
  const transport = fakeTransport([['/api/problem-sets', () => json({
    problemSets: [
      { id: '1', name: '过期', endAt: '2026-10-01T00:00:00Z' },
      { id: '2', name: '未过期', endAt: '2026-12-01T00:00:00Z' },
    ],
  })]]);
  const out = await new PtaApi(transport).problemSets({ now: () => new Date('2026-10-20T00:00:00Z') });
  assert.equal(out.problemSets.length, 1, '过期的被本地筛掉');
  assert.equal(out.total, 2, 'total 反映服务端给了几行');
});

test('题集列表：缺 problemSets 时如实报结构异常，不冒充"没有题集"', async () => {
  const transport = fakeTransport([['/api/problem-sets', () => json({ data: [] })]]);
  await assert.rejects(() => new PtaApi(transport).problemSets(), (error) => {
    assert.equal(error.code, 'API_SHAPE');
    assert.match(error.message, /problemSets/);
    return true;
  });
});

/* ────────────────────────────── 客户端：看题 ────────────────────────────── */

test('题集详情：题型分布 + 我的进度', async () => {
  const transport = fakeTransport([
    ['/exam-problems', () => json({ problemSet: { name: '第三章作业', description: '本周题集' } })],
    ['/problem-summaries', () => json({
      summaries: { PROGRAMMING: { total: 3, totalScore: 60 }, MULTIPLE_CHOICE: { total: 5, totalScore: 40 } },
    })],
    ['/exam-problem-status', () => json({
      problemStatus: [
        { id: '1', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
        { id: '2', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
        { id: '3', problemSubmissionStatus: 'PROBLEM_WRONG_ANSWER' },
        { id: '4', problemSubmissionStatus: 'PROBLEM_NO_SUBMISSION' },
      ],
    })],
  ]);

  const out = await new PtaApi(transport).problemSet('100');
  assert.equal(out.id, '100');
  assert.equal(out.name, '第三章作业');
  assert.equal(out.description, '本周题集');
  assert.equal(out.problemTypes.length, 2);
  assert.deepEqual(out.problemTypes.map((t) => t.type), ['PROGRAMMING', 'MULTIPLE_CHOICE']);
  assert.equal(out.problemTypes[0].label, '编程题');
  assert.equal(out.problemTypes[0].total, 3);
  assert.deepEqual(out.progress, {
    total: 4,
    accepted: 2,
    byStatus: { PROBLEM_ACCEPTED: 2, PROBLEM_WRONG_ANSWER: 1, PROBLEM_NO_SUBMISSION: 1 },
  });
});

test('题集详情：进度拿不到不算失败（题集仍可读，进度是 null 不是 0）', async () => {
  const transport = fakeTransport([
    ['/exam-problems', () => json({ problemSet: { name: '匿名可读' } })],
    ['/problem-summaries', () => json({ summaries: { PROGRAMMING: { total: 1 } } })],
    ['/exam-problem-status', () => ({ status: 403, headers: new Headers(), text: '{}' })],
  ]);
  const out = await new PtaApi(transport).problemSet('100');
  assert.equal(out.name, '匿名可读');
  assert.equal(out.progress, null);
});

test('题集详情：详情端点挂了也能拿到题型（它的失败被吞掉）', async () => {
  const transport = fakeTransport([
    ['/exam-problems', () => ({ status: 500, headers: new Headers(), text: '{}' })],
    ['/problem-summaries', () => json({ summaries: { PROGRAMMING: { total: 2 } } })],
    ['/exam-problem-status', () => json({ problemStatus: [] })],
  ]);
  const out = await new PtaApi(transport).problemSet('100');
  assert.equal(out.name, null);
  assert.equal(out.problemTypes.length, 1);
});

test('题目列表：带提交状态与翻页信息', async () => {
  const transport = fakeTransport([
    ['/exam-problem-list', () => json({
      total: 60,
      problemSetProblems: [
        { id: '11', label: 'A', title: '第一题', score: 20, acceptCount: 5, submitCount: 9, deadline: '2026-10-30T15:59:00+08:00' },
        { id: '12', label: 'B', title: '第二题', score: 20 },
      ],
    })],
    ['/exam-problem-status', () => json({
      problemStatus: [
        { id: '11', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
        { id: '12', problemSubmissionStatus: 'PROBLEM_NO_SUBMISSION' },
      ],
    })],
  ]);

  const out = await new PtaApi(transport).problems('100', { problemType: 'PROGRAMMING', limit: 50 });
  assert.equal(out.problemSetId, '100');
  assert.equal(out.problemType, 'PROGRAMMING');
  assert.equal(out.typeLabel, '编程题');
  assert.equal(out.total, 60);
  assert.equal(out.nextPage, 2);
  assert.equal(out.problems.length, 2);
  assert.equal(out.problems[0].myStatus, 'PROBLEM_ACCEPTED');
  assert.equal(out.problems[1].myStatus, 'PROBLEM_NO_SUBMISSION');
  assert.equal(out.problems[0].deadline.iso, '2026-10-30T07:59:00.000Z');
  assert.equal(out.problems[1].deadline.iso, null, '没有 deadline 就是 null');
});

test('题目列表：分页参数 page 从 0 起（对外 1 起）', async () => {
  const seen = [];
  const transport = fakeTransport([
    ['/exam-problem-list', (url) => { seen.push(url); return json({ total: 100, problemSetProblems: [] }); }],
    ['/exam-problem-status', () => json({ problemStatus: [] })],
  ]);
  const out = await new PtaApi(transport).problems('100', { problemType: 'PROGRAMMING', page: 2, limit: 10 });
  const url = new URL(seen[0]);
  assert.equal(url.searchParams.get('page'), '1', '对外第 2 页 = 服务端 page 1');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.get('problem_type'), 'PROGRAMMING');
  // total=100、page=2、limit=10 → 20 < 100 还有下一页
  assert.equal(out.nextPage, 3);
});

test('题目列表：不指定题型时按 summaries 挑第一个可用', async () => {
  let listUrl = null;
  const transport = fakeTransport([
    ['/problem-summaries', () => json({ summaries: { FILL_IN_THE_BLANK: { total: 2 } } })],
    ['/exam-problem-list', (url) => { listUrl = url; return json({ problemSetProblems: [] }); }],
    ['/exam-problem-status', () => json({ problemStatus: [] })],
  ]);
  const out = await new PtaApi(transport).problems('100');
  assert.equal(out.problemType, 'FILL_IN_THE_BLANK');
  assert.ok(listUrl.includes('problem_type=FILL_IN_THE_BLANK'), `实际 ${listUrl}`);
});

test('题目列表：编程题优先于其它可用题型', async () => {
  const transport = fakeTransport([
    ['/problem-summaries', () => json({ summaries: { MULTIPLE_CHOICE: { total: 1 }, PROGRAMMING: { total: 2 } } })],
    ['/exam-problem-list', () => json({ problemSetProblems: [] })],
    ['/exam-problem-status', () => json({ problemStatus: [] })],
  ]);
  const out = await new PtaApi(transport).problems('100');
  assert.equal(out.problemType, 'PROGRAMMING');
});

test('题目列表：一个题型都没有时返回空结构，不抛错也不发列表请求', async () => {
  const calls = [];
  const transport = {
    calls,
    session: { jar: { getCookies: async () => [] } },
    request: async (url) => {
      calls.push(url);
      assert.ok(!String(url).includes('/exam-problem-list'), '不该去要一个不存在的题型的列表');
      return json({ summaries: {} });
    },
  };
  const out = await new PtaApi(transport).problems('100');
  assert.equal(out.problemType, null);
  assert.equal(out.problems.length, 0);
  assert.equal(out.nextPage, null);
});

test('题目列表：拿不到提交状态时 myStatus 为 null（不当成未做）', async () => {
  const transport = fakeTransport([
    ['/exam-problem-list', () => json({ total: 1, problemSetProblems: [{ id: '11', title: '匿名题' }] })],
    ['/exam-problem-status', () => ({ status: 403, headers: new Headers(), text: '{}' })],
  ]);
  const out = await new PtaApi(transport).problems('100', { problemType: 'PROGRAMMING' });
  assert.equal(out.problems[0].myStatus, null);
});

test('题目列表：缺 problemSetProblems 时如实报结构异常', async () => {
  const transport = fakeTransport([['/exam-problem-list', () => json({ total: 1 })]]);
  await assert.rejects(() => new PtaApi(transport).problems('100', { problemType: 'PROGRAMMING' }),
    (e) => e.code === 'API_SHAPE');
});

test('题面：原始 Markdown 按 offset/maxCharacters 分页，拼回来等于原文', async () => {
  const content = 'A'.repeat(100);
  const transport = fakeTransport([
    ['/exam-problems/11', () => json({
      problemSetProblem: {
        label: 'A', title: '第一题', type: 'PROGRAMMING', score: 20,
        author: '出题人',
        content,
        problemConfig: { programmingProblemConfig: { timeLimit: 400, memoryLimit: 65536, codeSizeLimit: 16 } },
        compiler: 'GCC',
        deadline: '2026-10-30T15:59:00+08:00',
      },
      organization: { name: '浙江大学' },
    })],
  ]);

  const api = new PtaApi(transport);
  const head = await api.problem('100', '11', { maxCharacters: 40 });
  assert.equal(head.content.length, 40);
  assert.equal(head.totalCharacters, 100);
  assert.equal(head.nextOffset, 40);
  assert.equal(head.timeLimitMs, 400);
  assert.equal(head.memoryLimitKb, 65536);
  assert.equal(head.codeSizeLimitKb, 16);
  assert.equal(head.typeLabel, '编程题');
  assert.equal(head.organization, '浙江大学');
  assert.match(head.url, /problemSetProblemId=11/);

  const tail = await api.problem('100', '11', { offset: 40 });
  assert.equal(tail.content.length, 60);
  assert.equal(tail.nextOffset, null);
  assert.equal(head.content + tail.content, content);
});

test('题面：缺 problemSetProblem 时如实报结构异常', async () => {
  const transport = fakeTransport([['/exam-problems/11', () => json({})]]);
  await assert.rejects(() => new PtaApi(transport).problem('100', '11'), (e) => e.code === 'API_SHAPE');
});

test('进度：按状态分组统计', async () => {
  const transport = fakeTransport([['/exam-problem-status', () => json({
    problemStatus: [
      { id: '1', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
      { id: '2', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
      { id: '3', problemSubmissionStatus: 'PROBLEM_WRONG_ANSWER' },
      { id: '4' },
    ],
  })]]);
  const out = await new PtaApi(transport).progress('100');
  assert.equal(out.total, 4);
  assert.equal(out.accepted, 2);
  assert.equal(out.byStatus.PROBLEM_WRONG_ANSWER, 1);
  assert.equal(out.byStatus.UNKNOWN, 1, '缺状态的归 UNKNOWN，不悄悄丢掉');
});

test('进度：响应里没有 problemStatus 时返回 null', async () => {
  const transport = fakeTransport([['/exam-problem-status', () => json({})]]);
  assert.equal(await new PtaApi(transport).progress('100'), null);
});

test('题面地址：编程题/函数题给具体页，其余回题集概览', () => {
  const api = new PtaApi(noRequestTransport());
  assert.match(api.problemUrl('100', '11', 'PROGRAMMING'), /\/type\/7\?problemSetProblemId=11$/);
  assert.match(api.problemUrl('100', '11', 'CODE_COMPLETION'), /\/type\/6\?problemSetProblemId=11$/);
  assert.equal(api.problemUrl('100', '11', 'MULTIPLE_CHOICE'), `${PTA_BASE}/problem-sets/100/exam/overview`);
  assert.equal(api.problemUrl('100', null, 'PROGRAMMING'), `${PTA_BASE}/problem-sets/100/exam/overview`);
});

test('看题全程只发 GET（只读边界）', async () => {
  const transport = fakeTransport([
    ['/exam-problems', () => json({ problemSet: { name: 'x' } })],
    ['/problem-summaries', () => json({ summaries: {} })],
    ['/exam-problem-status', () => json({ problemStatus: [] })],
    ['/exam-problem-list', () => json({ problemSetProblems: [] })],
  ]);
  const api = new PtaApi(transport);
  await api.problemSet('100');
  await api.problems('100', { problemType: 'PROGRAMMING' });
  await api.progress('100');
  assert.ok(transport.calls.length >= 4, `请求太少：${transport.calls.length}`);
  for (const call of transport.calls) assert.equal(call.method, 'GET', `出现非 GET：${call.method} ${call.url}`);
});

test('看题的 id 校验在发请求之前就拦住非法输入', async () => {
  const api = new PtaApi(noRequestTransport());
  await assert.rejects(() => api.problem('../etc', '11'), (e) => e.code === 'INVALID_ID');
  await assert.rejects(() => api.problems('abc'), (e) => e.code === 'INVALID_ID');
  await assert.rejects(() => api.problemSet('1/2'), (e) => e.code === 'INVALID_ID');
});

/* ────────────────────────────── Cookie 解析（共享层，接本包口径） ────────────────────────────── */

test('Cookie 解析：四种粘贴形态都认，属性行与表头都排除', () => {
  const plain = parsePtaCookie('SESSION=abc; Path=/; HttpOnly');
  assert.deepEqual(plain.names, ['SESSION']);

  const table = parsePtaCookie('Name\tValue\nSESSION\tabc\nPath\t/\nHttpOnly\t✓');
  assert.deepEqual(table.names, ['SESSION']);

  const curl = parsePtaCookie('curl "https://pintia.cn/api" -H "cookie: SESSION=x; PTASESSION=y"');
  assert.deepEqual(curl.names.sort(), ['PTASESSION', 'SESSION']);
  assert.equal(curl.source, 'curl 命令');

  assert.equal(parsePtaCookie(''), null);
  assert.equal(parsePtaCookie(null), null);
});

test('整串 Cookie 原样保留（PTA 用整串认证，不是挑单个键）', () => {
  const parsed = parsePtaCookie('PTASESSION=a; SESSION=b');
  assert.equal(parsed.cookie, 'PTASESSION=a; SESSION=b', '顺序与内容都要保住');
});

/* ────────────────────────────── 集成层：服务面与路由 ────────────────────────────── */

test('apply() provide 了 zhiyunPta 并注册了 /api/zhiyun-pta', () => {
  const { ctx, services, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const pta = services.get('zhiyunPta');
    assert.ok(pta, '必须 provide zhiyunPta');
    assert.equal(pta.routePath, ROUTE_PATH);
    assert.equal(ROUTE_PATH, '/api/zhiyun-pta');
    assert.equal(pta.platform, 'pta');
    // ⚠️ 接写操作后从 true 改成 false：本包含 `saveAnswer` / `submitAnswer` 的
  // Prepare/Execute 对（见 `writes.js`）。只读动作表 `reads` 不变，
  // 写方法另列在 `writeMethods` 里。
  assert.equal(pta.readOnly, false);
    assert.equal(routes.length, 1, '必须注册一条路由');
    assert.equal(routes[0].path, '/api/zhiyun-pta');
    // 服务自述的名单要与实现一致 —— 少一个动作等于对外少一个能力
    assert.equal(pta.reads.length, 4);
    assert.deepEqual([...pta.reads].sort(), ['problem', 'problemSet', 'problems', 'progress']);
    assert.equal(pta.actions.length, 3);
  } finally { cleanup(); }
});

test('服务面把 pta 的纯函数也暴露出来（宿主侧可直接用）', () => {
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const pta = services.get('zhiyunPta');
    for (const method of ['ptaStatus', 'status', 'todos', 'ptaTodos', 'saveCookie',
      'savePtaCookie', 'clearCookie', 'problemSets', 'read', 'client', 'session']) {
      assert.equal(typeof pta[method], 'function', `缺少方法 ${method}`);
    }
    assert.equal(pta.hosts.base, 'https://pintia.cn');
    assert.equal(pta.hosts.all.length, 3);
  } finally { cleanup(); }
});

test('GET 反映"没配 Cookie"，且不回任何 Cookie 值', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const res = makeRes();
    await routes[0].handler(makeReq('', { method: 'GET' }), res);

    assert.equal(res.result.status, 200);
    assert.equal(res.result.body.ok, true);
    assert.equal(res.result.body.pta.configured, false, '没配就是 false，不是 unknown');
    assert.equal(res.result.body.pta.names.length, 0);
    assert.equal(res.result.body.route, '/api/zhiyun-pta');
    assert.equal(res.result.body.platform.label, '拼题A');
    // 只回键名，不回值 —— 这条路由的输出会出现在浏览器里
    assert.doesNotMatch(JSON.stringify(res.result.body), /PTASESSION=/);
  } finally { cleanup(); }
});

test('非法 action 返回 400 + INVALID_INPUT（不静默成功）', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const res = makeRes();
    await routes[0].handler(makeReq('{}', {
      url: `${ROUTE_PATH}?不存在的动作`,
      headers: { [WRITE_HEADER]: '1' },
    }), res);

    assert.equal(res.result.status, 400);
    assert.equal(res.result.body.error.code, undefined, '非 read 动作走的是纯文本 error');
    assert.match(res.result.body.error, /未知动作/);
  } finally { cleanup(); }
});

test('README 承诺的四个 read 动作里，非法的那一个返回 INVALID_INPUT', async () => {
  const { ctx, routes, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const pta = services.get('zhiyunPta');
    // 先配上 Cookie，否则会先撞 COOKIE_IMPORT_REQUIRED（那是另一条断言）
    await pta.saveCookie('PTASESSION=a; SESSION=b');

    await assert.rejects(() => pta.read({ action: 'deleteEverything' }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /未知的看题动作/);
      return true;
    });
    await assert.rejects(() => pta.read({}), (e) => e.code === 'INVALID_INPUT');
    // 服务面直调与路由解析必须用同一张白名单
    const res = makeRes();
    await routes[0].handler(makeReq(JSON.stringify({ action: 'deleteEverything' }), {
      url: `${ROUTE_PATH}?read`,
      headers: { [WRITE_HEADER]: '1' },
    }), res);
    assert.equal(res.result.status, 400);
    assert.equal(res.result.body.error.code, 'INVALID_INPUT');
  } finally { cleanup(); }
});

test('没有 Cookie 时 read 返回 401 + COOKIE_IMPORT_REQUIRED', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const res = makeRes();
    await routes[0].handler(makeReq(JSON.stringify({ action: 'problemSet', problemSetId: '100' }), {
      url: `${ROUTE_PATH}?read`,
      headers: { [WRITE_HEADER]: '1' },
    }), res);

    assert.equal(res.result.status, 401);
    assert.equal(res.result.body.error.code, 'COOKIE_IMPORT_REQUIRED');
    assert.match(res.result.body.error.message, /设置 → 拼题A/);
  } finally { cleanup(); }
});

test('saveCookie：粘 cURL 后 ptaStatus 变 configured，键名正确', async () => {
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const pta = services.get('zhiyunPta');

    assert.deepEqual(await pta.ptaStatus(), { configured: false, names: [] });

    const result = await pta.saveCookie('curl "https://pintia.cn/api" -H "cookie: PTASESSION=abc; SESSION=def"');
    assert.equal(result.cleared, false);
    assert.equal(result.source, 'curl 命令');
    assert.deepEqual(result.names.sort(), ['PTASESSION', 'SESSION']);

    const status = await pta.ptaStatus();
    assert.equal(status.configured, true);
    assert.deepEqual(status.names.sort(), ['PTASESSION', 'SESSION']);
  } finally { cleanup(); }
});

test('saveCookie：空串 = 清除（不是"没识别出 Cookie"）', async () => {
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const pta = services.get('zhiyunPta');
    await pta.saveCookie('PTASESSION=abc');
    assert.equal((await pta.ptaStatus()).configured, true);

    const cleared = await pta.saveCookie('');
    assert.equal(cleared.cleared, true);
    assert.equal(cleared.names.length, 0, '清除要真的清掉，不是回一个空名单');
    assert.equal((await pta.ptaStatus()).configured, false);

    // clearCookie 是同一条路径
    await pta.saveCookie('PTASESSION=xyz');
    await pta.clearCookie();
    assert.equal((await pta.ptaStatus()).configured, false);
  } finally { cleanup(); }
});

test('saveCookie：认不出的输入抛 INVALID_INPUT，且不冲掉已有 Cookie', async () => {
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const pta = services.get('zhiyunPta');
    await pta.saveCookie('PTASESSION=abc');

    await assert.rejects(() => pta.saveCookie('Path=/; HttpOnly'), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /没有从输入里识别出 Cookie/);
      return true;
    });
    assert.equal((await pta.ptaStatus()).configured, true, '失败不该把已有的会话清掉');
  } finally { cleanup(); }
});

test('路由：缺写头返回 403（CSRF 防线）', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const res = makeRes();
    await routes[0].handler(makeReq('{"cookie":"PTASESSION=a"}', { url: `${ROUTE_PATH}?cookie` }), res);
    assert.equal(res.result.status, 403);
    assert.match(res.result.body.error, /x-zhiyun-pta/);
  } finally { cleanup(); }
});

test('路由：非回环 Host 直接 403', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const res = makeRes();
    await routes[0].handler(makeReq('', { method: 'GET', headers: { host: '10.0.0.5:8080' } }), res);
    assert.equal(res.result.status, 403);
    assert.match(res.result.body.error, /回环/);
  } finally { cleanup(); }
});

test('路由：非 GET/POST 返回 405', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const res = makeRes();
    await routes[0].handler(makeReq('', { method: 'DELETE' }), res);
    assert.equal(res.result.status, 405);
  } finally { cleanup(); }
});

test('路由：cookie 动作写成功并把状态一起带回来', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const res = makeRes();
    await routes[0].handler(makeReq(JSON.stringify({ cookie: 'PTASESSION=abc; SESSION=def' }), {
      url: `${ROUTE_PATH}?cookie`,
      headers: { [WRITE_HEADER]: '1' },
    }), res);

    assert.equal(res.result.status, 200);
    assert.equal(res.result.body.ok, true);
    assert.equal(res.result.body.pta.configured, true);
    assert.equal(res.result.body.cleared, false);
    assert.deepEqual(res.result.body.names.sort(), ['PTASESSION', 'SESSION']);
  } finally { cleanup(); }
});

test('路由：旧动作名 pta-cookie / pta-read 仍是别名', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });

    const saved = makeRes();
    await routes[0].handler(makeReq(JSON.stringify({ cookie: 'PTASESSION=abc' }), {
      url: `${ROUTE_PATH}?pta-cookie`,
      headers: { [WRITE_HEADER]: '1' },
    }), saved);
    assert.equal(saved.result.status, 200);
    assert.equal(saved.result.body.pta.configured, true);

    const readRes = makeRes();
    await routes[0].handler(makeReq(JSON.stringify({ action: 'progress', problemSetId: '100' }), {
      url: `${ROUTE_PATH}?pta-read`,
      headers: { [WRITE_HEADER]: '1' },
    }), readRes);
    assert.equal(readRes.result.status, 200);
    assert.equal(readRes.result.body.ok, true);
  } finally { cleanup(); }
});

test('路由：请求体不是 JSON 返回 400', async () => {
  const { ctx, routes, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const res = makeRes();
    await routes[0].handler(makeReq('{不是 json', {
      url: `${ROUTE_PATH}?cookie`,
      headers: { [WRITE_HEADER]: '1' },
    }), res);
    assert.equal(res.result.status, 400);
    assert.equal(res.result.body.error.code, 'INVALID_INPUT');
  } finally { cleanup(); }
});

/* ────────────────────────────── 集成层：真的读到数据 ────────────────────────────── */

test('read:problemSet 走真实 Transport + 假 fetch，返回题型分布', async () => {
  const fetchImpl = fakeFetch([
    ['/problem-summaries', () => ({ summaries: { PROGRAMMING: { total: 3, totalScore: 60 } } })],
    ['/exam-problems', () => ({ problemSet: { name: '第三章作业' } })],
    ['/exam-problem-status', () => ({ problemStatus: [] })],
  ]);
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fetchImpl, protect: identityProtect });
    const pta = services.get('zhiyunPta');
    await pta.saveCookie('PTASESSION=abc');

    const out = await pta.read({ action: 'problemSet', problemSetId: '100' });
    assert.equal(out.id, '100');
    assert.equal(out.name, '第三章作业');
    assert.equal(out.problemTypes.length, 1);
    assert.ok(fetchImpl.calls.length >= 2, `请求太少：${fetchImpl.calls.length}`);
    // 每次请求都要带上 Cookie —— 主机表漏了 pintia.cn 就会静默丢它
    for (const url of fetchImpl.calls) assert.ok(url.startsWith('https://pintia.cn/api/'), url);
  } finally { cleanup(); }
});

test('todos() 的 pta 半：形状是 { pta: { ok, rows, error } }', async () => {
  const fetchImpl = fakeFetch([['/api/problem-sets', () => ({
    problemSets: [
      { id: '7', name: '第四章', endAt: '2099-01-01T00:00:00Z' },
      { id: '8', name: '已截止', endAt: '2020-01-01T00:00:00Z' },
    ],
  })]]);
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fetchImpl, protect: identityProtect });
    const pta = services.get('zhiyunPta');
    await pta.saveCookie('PTASESSION=abc');

    const out = await pta.todos();
    assert.deepEqual(Object.keys(out), ['pta'], '本包只拥有 pta 那一半');
    assert.equal(out.pta.ok, true);
    assert.equal(out.pta.error, null);
    assert.equal(out.pta.rows.length, 1, '已截止的被本地筛掉');
    assert.equal(out.pta.rows[0].source, 'pta');
    assert.equal(out.pta.rows[0].title, '第四章');
    assert.equal(out.pta.rows[0].kind, 'problemSet');
  } finally { cleanup(); }
});

test('todos() 的 pta 半：失败也返回 ok:false，绝不抛到调用方', async () => {
  const { ctx, services, cleanup } = fakeCtx();
  try {
    // 没有 Cookie：这是最常见的"没配"
    apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    const pta = services.get('zhiyunPta');

    const out = await pta.todos();
    assert.equal(out.pta.ok, false);
    assert.equal(out.pta.rows.length, 0);
    assert.equal(out.pta.error.code, 'COOKIE_IMPORT_REQUIRED', '已经被 translatePtaError 翻译过');
    assert.match(out.pta.error.message, /设置 → 拼题A/, 'message 可直接上屏');
  } finally { cleanup(); }
});

test('todos() 的 pta 半：网络层失败也收成 ok:false', async () => {
  const failing = async () => { throw new Error('connection reset'); };
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: failing, protect: identityProtect });
    const pta = services.get('zhiyunPta');
    await pta.saveCookie('PTASESSION=abc');

    const out = await pta.todos();
    assert.equal(out.pta.ok, false);
    assert.equal(out.pta.rows.length, 0);
    assert.ok(out.pta.error.code, '要有错误码，不能是 undefined');
    assert.equal(typeof out.pta.error.message, 'string');
  } finally { cleanup(); }
});

test('problemSets() 服务方法返回原始形状（不归一）', async () => {
  const fetchImpl = fakeFetch([['/api/problem-sets', () => ({
    problemSets: [{ id: '7', name: '第四章', endAt: '2099-01-01T00:00:00Z' }],
  })]]);
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, { fetch: fetchImpl, protect: identityProtect });
    const pta = services.get('zhiyunPta');
    await pta.saveCookie('PTASESSION=abc');

    const out = await pta.problemSets();
    assert.equal(out.total, 1);
    assert.equal(out.problemSets.length, 1);
    assert.equal(out.problemSets[0].name, '第四章');
    assert.equal(Object.hasOwn(out.problemSets[0], 'source'), false, '原始形状里没有页面字段');
  } finally { cleanup(); }
});

test('会话落盘：写成文件后重新装配能读回（重启不丢 Cookie）', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pta-persist-'));
  try {
    const first = fakeCtx({ dir });
    apply(first.ctx, { fetch: fakeFetch(), protect: identityProtect });
    await first.services.get('zhiyunPta').saveCookie('PTASESSION=keepme; SESSION=2');
    assert.equal((await first.services.get('zhiyunPta').ptaStatus()).configured, true);
    // 显式刷盘（卸载钩子也做这件事，这里直接等 saveCookie 里的 save）
    await first.services.get('zhiyunPta').session().flush();

    const second = fakeCtx({ dir });
    apply(second.ctx, { fetch: fakeFetch(), protect: identityProtect });
    const status = await second.services.get('zhiyunPta').ptaStatus();
    assert.equal(status.configured, true, '重新装配后 Cookie 应该在');
    assert.deepEqual(status.names.sort(), ['PTASESSION', 'SESSION']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('卸载后服务被摘掉、路由也解绑（可重复卸载）', async () => {
  const { ctx, services, routes, cleanup } = fakeCtx();
  try {
    const dispose = apply(ctx, { fetch: fakeFetch(), protect: identityProtect });
    assert.ok(services.get('zhiyunPta'));
    assert.equal(routes.length, 1);
    await dispose();
    assert.equal(services.get('zhiyunPta'), undefined, '卸载必须摘掉服务');
    await assert.doesNotReject(async () => { await dispose(); }, '重复卸载不该抛');
  } finally { cleanup(); }
});

test('config.now 注入生效（题集过滤用注入的时间，不用系统时间）', async () => {
  const fetchImpl = fakeFetch([['/api/problem-sets', () => ({
    problemSets: [{ id: '1', name: '刚好过期', endAt: '2026-10-20T00:00:00Z' }],
  })]]);
  const { ctx, services, cleanup } = fakeCtx();
  try {
    apply(ctx, {
      fetch: fetchImpl,
      protect: identityProtect,
      now: () => new Date('2026-10-21T00:00:00Z'),
    });
    const pta = services.get('zhiyunPta');
    await pta.saveCookie('PTASESSION=abc');

    const out = await pta.problemSets({ includeEnded: false });
    assert.equal(out.problemSets.length, 0, '注入的时间说它已过期');
    assert.equal(out.total, 1);
    // `filter` 是"昨天 UTC 零点"：注入 10-21 → 10-20。它必须跟着注入的时间走，
    // 否则测试会随系统时间漂移。
    const filter = JSON.parse(new URL(fetchImpl.calls[0]).searchParams.get('filter'));
    assert.equal(filter.endAtAfter, '2026-10-20T00:00:00.000Z');
  } finally { cleanup(); }
});
