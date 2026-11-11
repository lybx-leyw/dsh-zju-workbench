/**
 * 素质拓展数智平台数据源的行为测试。
 *
 * # 测什么
 *
 * 状态判定（尤其「已结束看结束时间而不是开始时间」）、时区转换、只读接口的
 * 形状校验、未登录时的登录重取、以及翻页收敛。
 *
 * 全部用假 `request` —— 平台在校内 IP 上，测试环境连不上。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE, STATUSES, Sztz, SztzError, beijing, category, freshActivities, points, statusOf,
} from '../../../packages/source/sztz/src/sztz.js';

/* ────────────────────────────── 纯函数 ── */

test('beijing：UTC 的 ISO 要换成北京时间（差 8 小时）', () => {
  // 2026-09-14T00:00:00Z = 北京时间 2026-09-14 08:00
  assert.equal(beijing('2026-09-14T00:00:00Z'), '2026-09-14 08:00');
  // 跨日：UTC 的 16:30 是北京时间次日 00:30
  assert.equal(beijing('2026-09-14T16:30:00Z'), '2026-09-15 00:30');
});

test('beijing：不可解析的值返回 undefined，不编造', () => {
  assert.equal(beijing(undefined), undefined);
  assert.equal(beijing(''), undefined);
  assert.equal(beijing('不是时间'), undefined);
  assert.equal(beijing(null), undefined);
});

test('points：起点终点相同时只写一个数；完全没字段时给空串', () => {
  assert.equal(points({ zxfs: 2, zdfs: 2 }), '2');
  assert.equal(points({ zxfs: 1, zdfs: 3 }), '1–3');
  // 没有记点字段时给空串，而不是一个看起来像「0 到 0」的 `–`。
  // 调用方据此能区分「没有记点信息」与「记点是 0–0」。
  assert.equal(points({}), '');
});

test('category：分类与类别用中点连接', () => {
  assert.equal(category({ xmfl: { mc: '文体活动' }, xmlb: { mc: '社团' } }), '文体活动·社团');
  assert.equal(category({ xmfl: { mc: '文体活动' } }), '文体活动');
  assert.equal(category({}), '');
});

/* ────────────────────────────── 状态判定 ── */

/** 造一条活动记录：报名 [1,2]、活动 [3,4]（数字是天偏移，相对基准时间）。 */
function activity({ bmFrom = -10, bmTo = 10, hdFrom = 20, hdTo = 30, ...rest } = {}) {
  const base = Date.parse('2026-09-01T00:00:00Z');
  const day = 86_400_000;
  return {
    id: 1, mc: '测试活动', zxfs: 1, zdfs: 2,
    bmkssj: new Date(base + bmFrom * day).toISOString(),
    bmjssj: new Date(base + bmTo * day).toISOString(),
    hdkssj: new Date(base + hdFrom * day).toISOString(),
    hdjssj: new Date(base + hdTo * day).toISOString(),
    ...rest,
  };
}

test('statusOf：报名中 / 未开始报名 / 报名已截止 / 进行中 / 已结束 五态', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  assert.equal(statusOf(activity(), now), '报名中');
  assert.equal(statusOf(activity({ bmFrom: 5, bmTo: 15 }), now), '未开始报名');
  assert.equal(statusOf(activity({ bmFrom: -20, bmTo: -5, hdFrom: 20, hdTo: 30 }), now), '报名已截止');
  assert.equal(statusOf(activity({ bmFrom: -20, bmTo: -5, hdFrom: -3, hdTo: 30 }), now), '进行中');
  assert.equal(statusOf(activity({ hdTo: -1 }), now), '已结束');
});

test('statusOf：「已结束」以结束时间为准，不是开始时间', () => {
  // 上游注释：平台上有「开始时间填错年份」的活动 —— 开始时间很早但还没结束。
  const now = Date.parse('2026-09-01T00:00:00Z');
  const longRunning = activity({ bmFrom: -100, bmTo: -90, hdFrom: -80, hdTo: 10 });
  assert.equal(statusOf(longRunning, now), '进行中', '开始时间早但结束时间在未来，不能判成已结束');

  // 反向：开始时间在未来但结束时间已过（数据异常），仍应判已结束。
  const weird = activity({ bmFrom: -100, bmTo: -90, hdFrom: 5, hdTo: -1 });
  assert.equal(statusOf(weird, now), '已结束', '结束时间已过就是已结束');
});

test('STATUSES 的顺序就是展示优先级', () => {
  assert.deepEqual([...STATUSES], ['报名中', '未开始报名', '报名已截止', '进行中', '已结束']);
});

/* ────────────────────────────── 新活动（不联网） ── */

test('freshActivities：只算还能报名或未开始的，不算已截止与进行中的', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const rows = [
    activity({ id: 1, bmFrom: -10, bmTo: 10 }),   // 报名中
    activity({ id: 2, bmFrom: 5, bmTo: 15 }),     // 未开始报名
    activity({ id: 3, bmFrom: -20, bmTo: -5, hdFrom: 20 }), // 报名已截止
    activity({ id: 4, bmFrom: -20, bmTo: -5, hdFrom: -3 }), // 进行中
  ];
  const { fresh } = freshActivities(rows, {}, now);
  assert.deepEqual(fresh.map((row) => row.id).sort(), [1, 2]);
});

test('freshActivities：已见过的不算新', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const rows = [activity({ id: 1 }), activity({ id: 2 })];
  const { fresh } = freshActivities(rows, { 1: rows[0].bmjssj }, now);
  assert.deepEqual(fresh.map((row) => row.id), [2]);
});

test('freshActivities：报名截止超过 7 天的从已读记录里清掉', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const day = 86_400_000;
  const old = new Date(now - 10 * day).toISOString();  // 10 天前截止
  const recent = new Date(now - 2 * day).toISOString(); // 2 天前截止
  const { seen } = freshActivities([], { 1: old, 2: recent }, now);
  assert.equal('1' in seen, false, '超过 7 天的要清掉');
  assert.equal('2' in seen, true, '7 天内的保留');
});

/* ────────────────────────────── 客户端 ── */

/**
 * 造一个假平台。
 *
 * @param routes - `[match, reply]`，reply 可为函数。
 * @returns `{ request, calls }`。
 */
function fakePlatform(routes) {
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) return typeof reply === 'function' ? reply(String(url), init) : reply;
    }
    return { status: 200, text: JSON.stringify({ code: 0, msg: null, data: [] }) };
  };
  return { request, calls };
}

/** 成功的平台响应。 */
const ok = (data, extra = {}) => ({ status: 200, text: JSON.stringify({ code: 0, msg: null, data, ...extra }) });

/** 未登录。 */
const DENIED = { status: 200, text: JSON.stringify({ code: -1, msg: '没有数据【x】访问权限!', data: null }) };

test('call：未登录（code=-1 + 访问权限）时登录后重取一次', async () => {
  let attempts = 0;
  const { request } = fakePlatform([
    ['getMyInfo', () => {
      attempts += 1;
      return attempts === 1 ? DENIED : ok(null, { extend: { myInfo: { dektJf: 5 } } });
    }],
    ['getZdySqjl', ok([], { totalPages: 1 })],
  ]);
  let signedIn = 0;
  const client = new Sztz({ request, acquireSession: async () => { signedIn += 1; } });
  const result = await client.myCredits();

  assert.equal(signedIn, 1, '要登录一次');
  assert.equal(attempts, 2, '登录后重取一次');
  assert.equal(result.summary.second.points, 5);
});

test('call：登录后仍被拒时抛 AUTH_EXPIRED（不在读学生的典型症状）', async () => {
  const { request } = fakePlatform([['getMyInfo', DENIED]]);
  const client = new Sztz({ request, acquireSession: async () => {} });

  await assert.rejects(() => client.myCredits(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /不是在读学生/);
    return true;
  });
});

test('call：业务码非 0 时抛 REJECTED 并带上游 msg', async () => {
  const { request } = fakePlatform([
    ['ajaxList', { status: 200, text: JSON.stringify({ code: 500, msg: '系统维护', data: null }) }],
  ]);
  const client = new Sztz({ request, acquireSession: async () => {} });
  await assert.rejects(() => client.listBulletins(), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /系统维护/);
    return true;
  });
});

test('HTTP 非 200 时抛 HTTP', async () => {
  const { request } = fakePlatform([['ajaxList', { status: 502, text: '' }]]);
  const client = new Sztz({ request, acquireSession: async () => {} });
  await assert.rejects(() => client.listBulletins(), { code: 'HTTP' });
});

test('响应不是 JSON 时抛 SHAPE', async () => {
  const { request } = fakePlatform([['ajaxList', { status: 200, text: '<html>' }]]);
  const client = new Sztz({ request, acquireSession: async () => {} });
  await assert.rejects(() => client.listBulletins(), { code: 'SHAPE' });
});

test('缺少 code 字段时也抛 SHAPE', async () => {
  const { request } = fakePlatform([['ajaxList', { status: 200, text: JSON.stringify({ data: [] }) }]]);
  const client = new Sztz({ request, acquireSession: async () => {} });
  await assert.rejects(() => client.listBulletins(), { code: 'SHAPE' });
});

test('POST 请求是表单体（不是 JSON）', async () => {
  const { request, calls } = fakePlatform([
    ['getWdhdList', ok([], { totalPages: 1 })],
  ]);
  const client = new Sztz({ request, acquireSession: async () => {} });
  await client.myList(0);

  const post = calls.find((call) => call.url.includes('getWdhdList'));
  assert.equal(post.method, 'POST');
  assert.match(post.body, /action=0/);
  assert.match(post.body, /limit=50/);
});

test('myActivities：三个列表都要读，且给出计数', async () => {
  const row = { id: 7, mc: '活动A', zxfs: 1, zdfs: 1, bmkssj: '2026-09-01T00:00:00Z', bmjssj: '2026-09-30T00:00:00Z', hdkssj: '2026-10-01T00:00:00Z', hdjssj: '2026-10-02T00:00:00Z' };
  const { request, calls } = fakePlatform([
    ['getWdhdList', (url, init) => {
      const action = new URLSearchParams(init.body).get('action');
      return action === '0' ? ok([row], { totalPages: 1 })
        : action === '1' ? ok([row], { totalPages: 1 })
          : ok([], { totalPages: 1 });
    }],
  ]);
  const client = new Sztz({ request, acquireSession: async () => {} });
  const result = await client.myActivities();

  assert.equal(result.counts.signedUp, 1);
  assert.equal(result.counts.favorites, 1);
  assert.equal(result.counts.recognized, 0);
  assert.equal(result.signedUp[0].signedUp, true);
  assert.equal(result.signedUp[0].favorite, true);
  assert.equal(calls.filter((call) => call.url.includes('getWdhdList')).length, 3, '三个列表各一次');
});

test('listProjects：按分类过滤', async () => {
  const make = (id, fl, lb) => ({ id, mc: `项目${id}`, zxfs: 1, zdfs: 1, xmfl: { mc: fl }, xmlb: { mc: lb }, bmkssj: '2026-01-01T00:00:00Z', bmjssj: '2026-01-02T00:00:00Z', hdkssj: '2026-01-03T00:00:00Z', hdjssj: '2026-01-04T00:00:00Z' });
  const { request } = fakePlatform([
    ['getXmList', ok([make(1, '学科竞赛', 'A'), make(2, '社会实践', 'B')], { totalPages: 1 })],
  ]);
  const client = new Sztz({ request, acquireSession: async () => {} });

  assert.equal((await client.listProjects({})).count, 2);
  const filtered = await client.listProjects({ category: '学科竞赛' });
  assert.equal(filtered.count, 1);
  assert.equal(filtered.projects[0].name, '项目1');
});

test('listActivities：负责人是 **** 时（匿名读）登录后重取', async () => {
  const base = { id: 1, mc: '活动', zxfs: 1, zdfs: 1,
    bmkssj: new Date(Date.now() - 86_400_000).toISOString(),
    bmjssj: new Date(Date.now() + 86_400_000).toISOString(),
    hdkssj: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    hdjssj: new Date(Date.now() + 3 * 86_400_000).toISOString() };
  let attempt = 0;
  const { request } = fakePlatform([
    ['getWdhdList', ok([], { totalPages: 1 })],
    ['getXmList', () => {
      attempt += 1;
      return ok([{ ...base, fzr: attempt === 1 ? '****' : '张老师' }], { totalPages: 1 });
    }],
  ]);
  let signedIn = 0;
  const client = new Sztz({ request, acquireSession: async () => { signedIn += 1; } });
  const result = await client.listActivities({ limit: 5 });

  assert.equal(signedIn, 1, '看到 **** 要登录');
  assert.equal(attempt, 2, '登录后重取一次');
  assert.equal(result.activities[0].contact, '张老师');
});

test('listActivities：日期格式不对时抛 CONFIG', async () => {
  const { request } = fakePlatform([]);
  const client = new Sztz({ request, acquireSession: async () => {} });
  await assert.rejects(() => client.listActivities({ date: '2026/01/01' }), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
});

test('listBulletins：附件拆成数组，地址拼好', async () => {
  const { request } = fakePlatform([
    ['ajaxList', ok([
      { mc: '通知一', fbsj: '2026-09-01T00:00:00Z', nr: '<p>正文</p>', fjmc: '附件1,附件2', fjid: '11,22' },
      { mc: '通知二', fbsj: '2026-09-02T00:00:00Z', nr: '无附件' },
    ])],
  ]);
  const client = new Sztz({ request, acquireSession: async () => {} });
  const result = await client.listBulletins();

  assert.equal(result.count, 2);
  assert.equal(result.notices[0].attachments.length, 2);
  assert.equal(result.notices[0].attachments[0].text, '附件1');
  assert.match(result.notices[0].attachments[0].url, /\/common\/file\/download\?id=11$/);
  assert.equal(result.notices[1].attachments, undefined, '无附件时不写这个键');
});

test('没有 acquireSession 时抛 CONFIG 且文案可操作', async () => {
  const { request } = fakePlatform([['getMyInfo', DENIED]]);
  const client = new Sztz({ request });
  await assert.rejects(() => client.myCredits(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /浙大一卡通/);
    return true;
  });
});

test('BASE 指向 dekt', () => {
  assert.equal(BASE, 'https://sztz.zju.edu.cn/dekt');
});
