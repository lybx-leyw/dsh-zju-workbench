/**
 * `@lybx-leyw/dsh-zju-source-cc98` 的离线单测。
 *
 * 三条硬约束：
 *
 * 1. **不联网**。令牌端点与 REST 端点都由假 `fetch` / 假 `Transport` 顶替，
 *    断言的是「发出去的请求长什么样」，而不是"CC98 现在回什么"。
 * 2. **不碰 DPAPI**。`SessionStore` 不传 `file` 就是纯内存（见共享层 `cas/session.js`），
 *    所以本文件不产生任何磁盘写入，也不会 spawn 保护器进程。
 * 3. **不装 Cordis 宿主**。插件半边用 `fakeContext()` 造一个只实现用到的那几个
 *    方法的假上下文 —— `apply` 的接线（信封、白名单、只读）照样能验。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { SessionStore, ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

import { ubbToText } from '../../../packages/source/cc98/src/ubb.js';
import { TOKEN_URL } from '../../../packages/source/cc98/src/hosts.js';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  SCOPE,
  parseTokenResponse,
  passwordForm,
  refreshForm,
  TokenStore,
} from '../../../packages/source/cc98/src/token.js';
import { Cc98Client, apiPath, withQuery, httpError, parseBody } from '../../../packages/source/cc98/src/client.js';
import {
  Cc98Reader,
  at,
  cc98Id,
  nextFrom,
  nextFromTotal,
  postText,
  fileLinks,
  floorAnchor,
  idsPath,
  ratingSummary,
  safeFileName,
} from '../../../packages/source/cc98/src/reads.js';
import { apply, METHODS, ROUTE_PATH } from '../../../packages/source/cc98/src/index.js';

/* ────────────────────────── UBB → 纯文本 ────────────────────────── */

test('ubb: 样式标签成对剥掉，正文原样保留', () => {
  assert.equal(ubbToText('[b]加粗[/b]和[i]斜体[/i]以及[u]下划线[/u]'), '加粗和斜体以及下划线');
  assert.equal(ubbToText('[del]删掉[/del][center]居中[/center][noubb]不要解析[/noubb]'), '删掉居中不要解析');
  assert.equal(ubbToText('[color=red]红[/color][size=5]大[/size][font=宋体]宋[/font][align=center]中[/align]'), '红大宋中');
});

test('ubb: 链接保留地址（[url=x]text[/url] 与 [url]x[/url] 两种写法）', () => {
  assert.equal(ubbToText('见[url=https://example.com/a]这个链接[/url]。'), '见这个链接 (https://example.com/a)。');
  assert.equal(ubbToText('[url]https://example.com/b[/url]'), 'https://example.com/b');
});

test('ubb: 图片/视频/音频/附件变成带地址的占位符', () => {
  assert.equal(ubbToText('[img]https://example.com/x.png[/img]'), '[图片: https://example.com/x.png]');
  assert.equal(ubbToText('[video]https://example.com/v.mp4[/video]'), '[视频: https://example.com/v.mp4]');
  assert.equal(ubbToText('[audio]https://example.com/a.mp3[/audio]'), '[音频: https://example.com/a.mp3]');
  assert.equal(ubbToText('[upload=2]https://example.com/f.zip[/upload]'), '[文件: https://example.com/f.zip]');
  // 站点历史上出现过不带闭合标签的写法，也必须收掉，不能留半截标签
  assert.equal(ubbToText('[upload]https://example.com/g.zip'), '[文件: https://example.com/g.zip]');
});

test('ubb: 引用保留层级提示，代码块只剥标签留内容', () => {
  assert.equal(ubbToText('[quote]别人的话[/quote]我的话'), '> [引用] 别人的话\n我的话');
  assert.equal(ubbToText('[code]const a = 1;\nconst b = 2;[/code]'), 'const a = 1;\nconst b = 2;');
  assert.equal(ubbToText('[code=js]if (a < b) { x(); }[/code]'), 'if (a < b) { x(); }');
});

test('ubb: 表情统一成占位符，多余空行折叠，首尾空白去掉', () => {
  assert.equal(ubbToText('[ac01][em02][CC9801][tb01][ms01]'), '[表情][表情][表情][表情][表情]');
  assert.equal(ubbToText('  \n\n\n第一段\n\n\n\n第二段\n\n  '), '第一段\n\n第二段');
});

test('ubb: 非字符串与空值不抛错', () => {
  assert.equal(ubbToText(null), '');
  assert.equal(ubbToText(undefined), '');
  assert.equal(ubbToText(''), '');
});

/* ───────────────────── OAuth2：表单构造与响应解析 ───────────────────── */

test('token: 密码模式的表单字段与 client 信息齐全', () => {
  assert.deepEqual(passwordForm({ username: '3190100000', password: 'pw' }), {
    grant_type: 'password',
    username: '3190100000',
    password: 'pw',
  });
  assert.equal(CLIENT_ID, '9a1fd200-8687-44b1-4c20-08d50a96e5cd');
  assert.equal(CLIENT_SECRET, '8b53f727-08e2-4509-8857-e34bf92b27f2');
  // offline_access 是拿到 refresh_token 的前提，少它就只能反复密码登录
  assert.ok(SCOPE.includes('offline_access'));
});

test('token: 刷新的表单只带 grant_type 与 refresh_token', () => {
  assert.deepEqual(refreshForm('rt-1'), { grant_type: 'refresh_token', refresh_token: 'rt-1' });
});

test('token: 响应解析提前 60 秒过期，缺 expires_in 时用 3600 秒', () => {
  const now = 1_700_000_000_000;
  const parsed = parseTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }, now);
  assert.equal(parsed.access_token, 'at');
  assert.equal(parsed.refresh_token, 'rt');
  assert.equal(parsed.expires_at, now + 3_600_000 - 60_000);
  const fallback = parseTokenResponse({ access_token: 'at' }, now);
  assert.equal(fallback.expires_at, now + 3_600_000 - 60_000);
  assert.equal(fallback.refresh_token, undefined);
});

test('token: 响应没有 access_token 时报 CC98_TOKEN_SHAPE', () => {
  assert.throws(() => parseTokenResponse({}), (error) => {
    assert.ok(error instanceof ClassroomError);
    assert.equal(error.code, 'CC98_TOKEN_SHAPE');
    return true;
  });
});

test('token: 密码模式发出的确实是 form-urlencoded 的 POST', async () => {
  const calls = [];
  const store = new SessionStore();
  const tokens = new TokenStore({
    store,
    account: async () => ({ username: '3190100000', password: 'pw' }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }), { status: 200 });
    },
  });

  assert.equal(await tokens.token(), 'at-1');
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, TOKEN_URL);
  assert.equal(call.init.method, 'POST');
  // 令牌端点的唯一合法编码就是 form-urlencoded；发 JSON 会被 400，且错误像"参数缺失"
  assert.equal(call.init.headers['content-type'], 'application/x-www-form-urlencoded');

  const form = new URLSearchParams(call.init.body);
  assert.equal(form.get('grant_type'), 'password');
  assert.equal(form.get('username'), '3190100000');
  assert.equal(form.get('password'), 'pw');
  assert.equal(form.get('client_id'), CLIENT_ID);
  assert.equal(form.get('client_secret'), CLIENT_SECRET);
  assert.equal(form.get('scope'), SCOPE);
});

test('token: 未过期的缓存直接复用，不再发请求；过期才刷新', async () => {
  let clock = 1_700_000_000_000;
  const calls = [];
  const store = new SessionStore();
  const tokens = new TokenStore({
    store,
    now: () => clock,
    account: async () => ({ username: 'u', password: 'p' }),
    fetch: async (url, init) => {
      calls.push(new URLSearchParams(init.body).get('grant_type'));
      const body = calls.length === 1
        ? { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }
        : { access_token: 'at-2', expires_in: 3600 };
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });

  assert.equal(await tokens.token(), 'at-1');
  // 缓存命中：调用两次也只发过一次请求
  assert.equal(await tokens.token(), 'at-1');
  assert.deepEqual(calls, ['password']);

  // 越过 expires_at（含 60 秒余量）之后必须走 refresh_token
  clock += 3_600_000;
  assert.equal(await tokens.token(), 'at-2');
  assert.deepEqual(calls, ['password', 'refresh_token']);
});

test('token: refresh 被拒时退回密码模式，而不是把错误抛给用户', async () => {
  const calls = [];
  const store = new SessionStore();
  const tokens = new TokenStore({
    store,
    account: async () => ({ username: 'u', password: 'p' }),
    fetch: async (url, init) => {
      const grant = new URLSearchParams(init.body).get('grant_type');
      calls.push(grant);
      if (calls.length === 1) return new Response(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-bad' }), { status: 200 });
      // 第二次（refresh_token）被明确拒绝，第三次（密码模式）成功
      if (grant === 'refresh_token') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-good' }), { status: 200 });
    },
  });

  assert.equal(await tokens.token(), 'at-1');
  // force 跳过缓存 → 先 refresh（被拒，返回 null）→ 落到密码模式
  assert.equal(await tokens.token({ force: true }), 'at-2');
  assert.deepEqual(calls, ['password', 'refresh_token', 'password']);
});

test('token: 密码错误与端点故障是两种错误码（处置完全不同）', async () => {
  const make = (body) => new TokenStore({
    store: new SessionStore(),
    account: async () => ({ username: 'u', password: 'p' }),
    fetch: async () => new Response(JSON.stringify(body), { status: 400 }),
  });

  await assert.rejects(make({ error: 'invalid_grant' }).token(), (error) => {
    assert.equal(error.code, 'AUTH_REJECTED');
    return true;
  });
  await assert.rejects(make({ error: 'server_error' }).token(), (error) => {
    assert.equal(error.code, 'CC98_LOGIN_FAILED');
    return true;
  });
});

test('token: 没配账号时抛 NEED_LOGIN，且不发出任何请求', async () => {
  let called = 0;
  const tokens = new TokenStore({
    store: new SessionStore(),
    account: async () => null,
    fetch: async () => { called += 1; return new Response('{}', { status: 200 }); },
  });
  await assert.rejects(tokens.token(), (error) => {
    assert.equal(error.code, 'NEED_LOGIN');
    return true;
  });
  assert.equal(called, 0);
});

/* ───────────────────── 凭据来源：CC98 自己那份，不是一卡通 ───────────────────── */

test('凭据：cc98 包读的是 CC98 独立记录，不是「浙大一卡通」', async () => {
  const src = await readFile(new URL('../../../packages/source/cc98/src/index.js', import.meta.url), 'utf8');
  assert.match(src, /readCc98/, '应从 card 包取 CC98 专用凭据');
  assert.doesNotMatch(src, /readCard\b/, '不该再借用一卡通那份记录');
});

test('凭据：card 包为 CC98 单独开了记录键与四个操作', async () => {
  const card = await import('../../../packages/source/login/src/index.js');
  assert.equal(card.CC98_RECORD_KEY, 'zhiyun-cc98/account');
  assert.notEqual(card.CC98_RECORD_KEY, card.CARD_RECORD_KEY, '不能与一卡通共用同一个键');
  assert.notEqual(card.CC98_RECORD_KEY, card.WEBVPN_RECORD_KEY, '不能与 WebVPN 共用');
  for (const fn of ['readCc98', 'writeCc98', 'clearCc98', 'cc98Status']) {
    assert.equal(typeof card[fn], 'function', `缺 ${fn}`);
  }
});

test('凭据：CC98 账号与一卡通各自独立，清除一个不影响另一个', async () => {
  const card = await import('../../../packages/source/login/src/index.js');
  // 用一个最小的内存凭据服务
  const records = new Map();
  const ctx = {
    get: (name) => (name === 'credentials' ? {
      readRecord: async (key) => records.get(key) ?? null,
      modifyRecord: async (key, fn) => { records.set(key, fn(records.get(key))); },
      deleteRecord: async (key) => { records.delete(key); },
    } : null),
  };

  await card.writeCc98(ctx, { username: 'cc98-user', password: 'cc98-pass' });
  await card.writeCard(ctx, { username: 'zju-user', password: 'zju-pass' });

  assert.deepEqual(await card.readCc98(ctx), { username: 'cc98-user', password: 'cc98-pass' });
  assert.deepEqual(await card.readCard(ctx), { username: 'zju-user', password: 'zju-pass' });

  await card.clearCc98(ctx);
  assert.equal(await card.readCc98(ctx), null, 'CC98 账号已清');
  assert.deepEqual(await card.readCard(ctx), { username: 'zju-user', password: 'zju-pass' }, '一卡通不受影响');
});

test('凭据：只有 CC98 账号的人不会被要求去填浙大密码', async () => {
  const card = await import('../../../packages/source/login/src/index.js');
  const records = new Map();
  const ctx = {
    get: (name) => (name === 'credentials' ? {
      readRecord: async (key) => records.get(key) ?? null,
      modifyRecord: async (key, fn) => { records.set(key, fn(records.get(key))); },
      deleteRecord: async (key) => { records.delete(key); },
    } : null),
  };
  // 只配 CC98，不配一卡通
  await card.writeCc98(ctx, { username: 'only-cc98', password: 'p' });
  assert.equal(await card.readCard(ctx), null, '一卡通确实是空的');
  assert.deepEqual(await card.readCc98(ctx), { username: 'only-cc98', password: 'p' }, 'CC98 有账号');
});

/* ───────────────────── 客户端：Bearer、重试、错误归因 ───────────────────── */

/** 记录每次请求的假 `Transport`。 */
function fakeTransport(responses) {
  const calls = [];
  return {
    calls,
    async request(url, init) {
      calls.push({ url, init });
      const next = responses.shift() ?? { status: 200, text: '{}' };
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('client: 数据请求带 Bearer；匿名请求不带', async () => {
  const transport = fakeTransport([
    { status: 200, text: '{"ok":1}' },
    { status: 200, text: '{"ok":2}' },
  ]);
  const client = new Cc98Client({ tokens: { token: async () => 'TOKEN-1' }, transport });

  await client.get('/topic/1');
  assert.equal(transport.calls[0].init.headers.Authorization, 'Bearer TOKEN-1');
  assert.equal(transport.calls[0].init.headers.Referer, 'https://www.cc98.org/');
  assert.equal(transport.calls[0].url, 'https://api.cc98.org/topic/1');

  await client.get('/config/index', { anonymous: true });
  assert.equal(transport.calls[1].init.headers.Authorization, undefined);
});

test('client: 401 只刷新一次并重试，第二次仍 401 就报 LOGIN_REQUIRED', async () => {
  const transport = fakeTransport([
    { status: 401, text: '' },
    { status: 200, text: '{"ok":true}' },
  ]);
  let forced = 0;
  const client = new Cc98Client({
    tokens: { token: async (options) => { if (options?.force) forced += 1; return 'TOKEN'; } },
    transport,
  });
  assert.deepEqual(await client.get('/topic/1'), { ok: true });
  assert.equal(forced, 1);

  const always401 = fakeTransport([{ status: 401, text: '' }, { status: 401, text: '' }]);
  const client2 = new Cc98Client({ tokens: { token: async () => 'TOKEN' }, transport: always401 });
  await assert.rejects(client2.get('/topic/1'), (error) => {
    assert.equal(error.code, 'LOGIN_REQUIRED');
    return true;
  });
  assert.equal(always401.calls.length, 2, '只重试一次，不能无限刷新');
});

test('client: HTTP 状态翻成可操作错误码', () => {
  assert.equal(httpError(401, '', '/x').code, 'LOGIN_REQUIRED');
  assert.equal(httpError(403, '', '/x').code, 'FORBIDDEN');
  assert.equal(httpError(404, '', '/x').code, 'NOT_FOUND');
  assert.equal(httpError(429, '', '/x').code, 'RATE_LIMITED');
  assert.equal(httpError(302, '', '/x').code, 'UNEXPECTED_RESPONSE');
  assert.equal(httpError(500, 'boom', '/x').code, 'PLATFORM_REJECTED');
  // 响应体会被截断塞进 message，便于归因，但不会整段回灌
  assert.ok(httpError(500, 'x'.repeat(500), '/x').message.length < 200);
});

test('client: 路径白名单挡住绝对 URL 与 .. 穿越', () => {
  assert.equal(apiPath('/topic/1'), '/topic/1');
  assert.throws(() => apiPath('https://evil.example/x'), (error) => error.code === 'INVALID_PATH');
  assert.throws(() => apiPath('/topic/../../user/1'), (error) => error.code === 'INVALID_PATH');
  assert.throws(() => apiPath('/a//b'), (error) => error.code === 'INVALID_PATH');
});

test('client: 查询参数拼装跳过 undefined/null，布尔写成 true/false', () => {
  assert.equal(withQuery('https://api.cc98.org/topic/search', { keyword: '选课 攻略', from: 0, size: 20 }),
    'https://api.cc98.org/topic/search?keyword=%E9%80%89%E8%AF%BE+%E6%94%BB%E7%95%A5&from=0&size=20');
  assert.equal(withQuery('https://api.cc98.org/x', { a: undefined, b: null, c: false }), 'https://api.cc98.org/x?c=false');
});

test('client: 响应体优先按 JSON 解析，非 JSON 原样返回', () => {
  assert.deepEqual(parseBody('{"a":1}'), { a: 1 });
  assert.equal(parseBody('12345'), 12345);
  assert.equal(parseBody('not json'), 'not json');
  assert.equal(parseBody(''), undefined);
});

/* ───────────────────── 读取器：10 个方法的 URL/参数 ───────────────────── */

/**
 * 记录调用的假客户端。
 *
 * 每个方法都按 `path` + `query` 断言，因为这两样正是「接口契约」——
 * 路径大小写、查询键名、分页参数写错都会 404/400，而错误信息不会指出是哪个参数。
 */
function fakeApi(responder) {
  const calls = [];
  const api = {
    calls,
    async get(path, options = {}) {
      calls.push({ path, ...options });
      const value = typeof responder === 'function' ? responder(path, options, calls.length) : responder;
      return value;
    },
  };
  return api;
}

const TOPIC_ROW = {
  id: 7,
  title: '标题',
  boardName: '水源',
  boardId: 3,
  userName: 'someone',
  time: '2024-01-02T03:04:05Z',
  replyCount: 41,
  hitCount: 900,
  bestState: 1,
};

test('reads.search: /topic/search + keyword/from/size，空关键词直接拒绝', async () => {
  const api = fakeApi([TOPIC_ROW]);
  const result = await new Cc98Reader(api).search({ keyword: '  选课  ', from: 10, size: 5 });
  assert.equal(api.calls[0].path, '/topic/search');
  assert.deepEqual(api.calls[0].query, { keyword: '选课', from: 10, size: 5 });
  assert.equal(result.keyword, '选课');
  assert.equal(result.topics.length, 1);
  assert.equal(result.topics[0].url, 'https://www.cc98.org/topic/7');
  assert.equal(result.topics[0].time, '2024-01-02 11:04:05 +08:00');
  // 5 条满页才可能还有下一页，这里只返回 1 条 → 到底了
  assert.equal(result.next_from, null);

  await assert.rejects(new Cc98Reader(fakeApi([])).search({ keyword: '   ' }), (error) => error.code === 'INVALID_ARGUMENT');
});

test('reads.topic: 详情用 /topic/{id}，楼层用大写 T 的 /Topic/{id}/post', async () => {
  const api = fakeApi((path) => {
    if (path.startsWith('/Topic/')) {
      return [
        { id: 100, floor: 1, userName: '楼主', time: '2024-01-02T03:04:05Z', content: '[b]正文[/b]', likeCount: 2 },
        { id: 101, floor: 2, isAnonymous: true, time: '2024-01-02T04:05:06Z', isDeleted: true, content: 'x' },
      ];
    }
    return TOPIC_ROW;
  });
  const result = await new Cc98Reader(api).topic({ topic_id: '7', from: 0, size: 20 });

  assert.equal(api.calls[0].path, '/topic/7');
  assert.equal(api.calls[1].path, '/Topic/7/post');
  assert.deepEqual(api.calls[1].query, { from: 0, size: 20 });

  assert.equal(result.id, 7);
  assert.equal(result.posts[0].text, '正文');
  assert.equal(result.posts[0].author, '楼主');
  assert.equal(result.posts[1].author, '匿名');
  assert.equal(result.posts[1].text, '（已删除）');
  // replyCount=41 → 42 层（楼主那一层不在 replyCount 里）
  assert.equal(result.total_floors, 42);
  assert.equal(result.next_from, 20);
});

test('reads.topic: 正文超过 max_characters 时截断并说明原文长度', async () => {
  const api = fakeApi((path) => (path.startsWith('/Topic/')
    ? [{ id: 1, floor: 1, content: '[b]' + 'a'.repeat(50) + '[/b]' }]
    : { id: 7, replyCount: 0 }));
  const result = await new Cc98Reader(api).topic({ topic_id: 7, max_characters: 10 });
  assert.equal(result.posts[0].text, 'aaaaaaaaaa…（截断，共 50 字）');
});

test('reads.hot: today 走公开的 /config/index；其它范围走 /topic/hot-<range>', async () => {
  const api = fakeApi((path) => {
    if (path === '/config/index') return { hotTopic: [TOPIC_ROW] };
    return [TOPIC_ROW];
  });
  const reader = new Cc98Reader(api);

  const today = await reader.hot();
  assert.equal(api.calls[0].path, '/config/index');
  assert.equal(api.calls[0].anonymous, true, '首页配置是公开接口，不该要求令牌');
  assert.equal(today.range, 'today');
  assert.equal(today.topics.length, 1);

  const weekly = await reader.hot({ range: 'weekly' });
  assert.equal(api.calls[1].path, '/topic/hot-weekly');
  assert.equal(weekly.range, 'weekly');

  // range 会被拼进 URL，必须白名单
  await assert.rejects(reader.hot({ range: '../../user/1' }), (error) => error.code === 'INVALID_ARGUMENT');
  // 首页配置缺 hotTopic 时不能当成空列表（那会把"接口变了"显示成"今天没十大"）
  const broken = new Cc98Reader(fakeApi({})).hot();
  await assert.rejects(broken, (error) => error.code === 'API_SHAPE');
});

test('reads.newTopics: /topic/new + from/size，满页才有 next_from', async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ ...TOPIC_ROW, id: i + 1 }));
  const api = fakeApi(rows);
  const result = await new Cc98Reader(api).newTopics({ from: 0, size: 3 });
  assert.equal(api.calls[0].path, '/topic/new');
  assert.deepEqual(api.calls[0].query, { from: 0, size: 3 });
  assert.equal(result.topics.length, 3);
  assert.equal(result.next_from, 3);
});

test('reads.boards: /Board/all 是公开接口，分区与版面字段对齐', async () => {
  const api = fakeApi([{ id: 1, name: '分区', boards: [{ id: 2, name: '版面', todayCount: 5, topicCount: 999 }] }]);
  const result = await new Cc98Reader(api).boards();
  assert.equal(api.calls[0].path, '/Board/all');
  assert.equal(api.calls[0].anonymous, true);
  assert.deepEqual(result.groups[0], { id: 1, name: '分区', boards: [{ id: 2, name: '版面', today: 5, topics: 999 }] });
});

test('reads.boardTopics: 普通与精品（best）走两条不同路径', async () => {
  const api = fakeApi([TOPIC_ROW]);
  const reader = new Cc98Reader(api);

  const normal = await reader.boardTopics({ board_id: 3, from: 0, size: 20 });
  assert.equal(api.calls[0].path, '/board/3/topic');
  assert.deepEqual(api.calls[0].query, { from: 0, size: 20 });
  assert.equal(normal.best, false);

  const best = await reader.boardTopics({ board_id: '3', best: true });
  assert.equal(api.calls[1].path, '/topic/best/board/3');
  assert.equal(best.best, true);

  await assert.rejects(reader.boardTopics({ board_id: 'abc' }), (error) => error.code === 'INVALID_ID');
});

test('reads.user: 有 ID 走 /user/{id}，只有名字走 /user/name/{编码后的名字}', async () => {
  const api = fakeApi({ id: 42, name: '水友', gender: 0, postCount: 3, fanCount: 4, levelTitle: 'Lv.3', introduction: '[b]简介[/b]', registerTime: '2020-01-02T03:04:05Z', lastLogOnTime: null });
  const reader = new Cc98Reader(api);

  const byId = await reader.user({ user_id: 42 });
  assert.equal(api.calls[0].path, '/user/42');
  assert.equal(byId.gender, '女');
  assert.equal(byId.introduction, '简介');
  assert.equal(byId.url, 'https://www.cc98.org/user/id/42');

  await reader.user({ name: '水 友' });
  assert.equal(api.calls[1].path, `/user/name/${encodeURIComponent('水 友')}`);

  await assert.rejects(reader.user({}), (error) => error.code === 'INVALID_ARGUMENT');
});

test('reads.notifications: 未读数失败不拖垮列表；通知只读', async () => {
  const api = {
    calls: [],
    async get(path, options = {}) {
      this.calls.push({ path, ...options });
      if (path === '/me/unread-count') throw new ClassroomError('FORBIDDEN', 'x');
      return [{ id: 1, type: 'reply', title: '有人回复你', topicId: 7, postId: 100, time: '2024-01-02T03:04:05Z', isRead: false, content: '[b]内容[/b]' }];
    },
  };
  const result = await new Cc98Reader(api).notifications({ kind: 'at', from: 5, size: 10 });
  assert.equal(api.calls[0].path, '/me/unread-count');
  assert.equal(api.calls[1].path, '/notification/at');
  assert.deepEqual(api.calls[1].query, { from: 5, size: 10 });
  assert.equal(result.unread, null);
  assert.equal(result.items[0].content, '内容');
  assert.equal(result.items[0].topic_id, 7);

  await assert.rejects(new Cc98Reader(fakeApi([])).notifications({ kind: 'nope' }), (error) => error.code === 'INVALID_ARGUMENT');
});

test('reads.conversations: /message/recent-contact-users + 预览截断', async () => {
  const api = fakeApi([{ userId: 42, lastContent: 'x'.repeat(300), time: '2024-01-02T03:04:05Z', isRead: true }]);
  const result = await new Cc98Reader(api).conversations({ from: 0, size: 1 });
  assert.equal(api.calls[0].path, '/message/recent-contact-users');
  assert.deepEqual(api.calls[0].query, { from: 0, size: 1 });
  assert.equal(result.conversations[0].user_id, 42);
  assert.equal(result.conversations[0].last.length, 200);
  assert.equal(result.conversations[0].read, true);
  assert.equal(result.next_from, 1);
});

test('reads.messages: /message/user/{id}，按 senderId 判方向，正文清洗 UBB', async () => {
  // ⚠️ 夹具按**平台真实顺序（从新到旧）**给：id=2 是我最新发的。
  // 上游 index.ts:346 的 thread() 有 .reverse() 把它转成「从早到晚」。先前的夹具
  // 是按从早到晚给的，于是 .reverse() 删掉也照样绿 —— 审计查出「messages 顺序反了」
  // 时正是这条测试没能发现。
  const api = fakeApi([
    { id: 2, senderId: 9, receiverId: 42, content: '我发的', contentType: 1, time: null },
    { id: 1, senderId: 42, receiverId: 9, content: '[b]对方发的[/b]', time: '2024-01-02T03:04:05Z' },
  ]);
  const result = await new Cc98Reader(api).messages({ user_id: 42, from: 0, size: 20 });
  assert.equal(api.calls[0].path, '/message/user/42');
  assert.deepEqual(api.calls[0].query, { from: 0, size: 20 });
  assert.equal(result.messages[0].from, 'them');
  assert.equal(result.messages[0].content, '对方发的');
  assert.equal(result.messages[1].from, 'me');
  assert.equal(result.next_from, null);
});

test('reads: 列表形状不认识时报 SCHEMA_CHANGED，而不是悄悄返回空数组', async () => {
  const reader = new Cc98Reader(fakeApi({ unexpected: 'shape' }));
  await assert.rejects(reader.newTopics(), (error) => error.code === 'SCHEMA_CHANGED');
});

/* ────────────────────────── 小工具 ────────────────────────── */

test('reads 工具函数：ID 校验、时间、分页、正文类型', () => {
  assert.equal(cc98Id('12', '帖子'), 12);
  assert.throws(() => cc98Id(0, '帖子'), (error) => error.code === 'INVALID_ID');
  assert.throws(() => cc98Id(1.5, '帖子'), (error) => error.code === 'INVALID_ID');
  assert.throws(() => cc98Id(Number.MAX_SAFE_INTEGER + 2, '帖子'), (error) => error.code === 'INVALID_ID');

  // 没有时区的时间戳不猜，原样保留
  assert.equal(at('2024-01-02 11:04:05'), '2024-01-02 11:04:05');
  assert.equal(at(null), null);
  assert.equal(at('2024-01-02T03:04:05Z'), '2024-01-02 11:04:05 +08:00');

  assert.equal(nextFrom(20, 20, 0), 20);
  assert.equal(nextFrom(19, 20, 0), null);

  // contentType=1 是服务端已给的纯文本，不能再过 UBB（否则 `[b]` 这类字面量会被吃掉）
  assert.equal(postText({ contentType: 1, content: ' [b]原样[/b] ' }), '[b]原样[/b]');
  assert.equal(postText({ contentType: 0, content: '[b]清洗[/b]' }), '清洗');
});

/* ───────────────────── 插件半边：信封、白名单、只读 ───────────────────── */

/**
 * 一个最小的假 Cordis 上下文。
 *
 * 只实现 `apply` 真正用到的四样：`logger`、`profileContext.dir`、`provide`、
 * `inject(['connection'], …)`，外加凭据的 `get('credentials')`。
 * 这样整条链路（信封 → 白名单 → 读取器 → 客户端 → 假 fetch）都能离线跑通，
 * 而不需要把宿主装起来。
 */
function fakeContext({ account = { username: '3190100000', password: 'pw' } } = {}) {
  const routes = [];
  const services = new Map();
  return {
    routes,
    services,
    ctx: {
      logger: { info: () => {} },
      profileContext: { dir: 'C:/tmp/zhiyun-profile' },
      provide(name, value) { services.set(name, value); return () => services.delete(name); },
      inject(_deps, register) {
        return register({
          connection: { fetch: { register(spec) { routes.push(spec); return () => {}; } } },
          effect: (fn) => fn(),
        });
      },
      get(name) {
        if (name !== 'credentials') return undefined;
        return {
          readRecord: async () => (account ? { kind: 'grant', payload: account } : null),
          modifyRecord: async () => {},
        };
      },
    },
  };
}

/** 发一条信封请求，返回解析后的 `result`。 */
async function rpc(route, method, payload = {}) {
  const response = await route.fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method, payload }),
  }));
  return response.json();
}

test('apply: 注册一条 GET/POST 路由，方法表就是那 22 个只读方法', async () => {
  const { ctx, routes, services } = fakeContext();
  const dispose = await apply(ctx, { dataDir: null, fetch: async () => new Response('{}', { status: 200 }) });

  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, ROUTE_PATH);
  assert.deepEqual(routes[0].methods, ['GET', 'POST']);

  const status = await (await routes[0].fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`))).json();
  assert.equal(status.ok, true);
  // GET 一次给全：能干什么（describe）+ 现在能不能读（status）
  assert.equal(status.value.platform, 'cc98');
  // ⚠️ 这四条 `readOnly` 断言在接写操作时从 true 改成了 false。
  // 本包现在含 `xxxPrepare` / `xxxExecute` 写方法（见 `writes.js`），
  // 自描述里写 true 会让「这个包会不会改我的账号」这个问题答错。
  // 只读方法表 `methods` 仍是 22 条 —— 写方法与它分开列在 `writeMethods`。
  assert.equal(status.value.readOnly, false);
  assert.equal(status.value.dataDir, null, 'dataDir:null 是"纯内存"，自描述里要如实写 null');
  assert.equal(status.value.status.readOnly, false);
  assert.equal(status.value.status.configured, true);
  // 状态里绝不能出现令牌本身
  assert.equal(JSON.stringify(status).includes('access_token'), false);
  assert.deepEqual(status.value.methods.map(m => m.method), METHODS.map(m => `cc98.${m}`));
  // 每个方法都带一份参数示例（调用方靠它发现能力，不在别处维护第二份清单）
  assert.ok(status.value.methods.every(m => m.args && typeof m.args === 'object'));

  const service = services.get('zhiyunCc98');
  assert.equal(service.readOnly, false);
  assert.equal(service.methods.length, 22);
  assert.equal(service.describe().platform, 'cc98');
  // 落盘目录默认是 null（只回链接），这条要能自描述出来
  assert.equal(status.value.downloadDir, null);
  await dispose();
});

test('apply: 未知方法被白名单挡住（含写操作名）', async () => {
  const { ctx, routes } = fakeContext();
  await apply(ctx, { dataDir: null, fetch: async () => new Response('[]', { status: 200 }) });
  const result = await rpc(routes[0], 'cc98.reply');
  assert.equal(result.type, 'server-response');
  assert.equal(result.rpcId, 'rpc-1');
  assert.equal(result.result.ok, false);
  assert.equal(result.result.error.code, 'INVALID_METHOD');
});

test('apply: 信封不对时报 INPUT；payload 不是对象时报 INVALID_ARGUMENT', async () => {
  const { ctx, routes } = fakeContext();
  await apply(ctx, { dataDir: null, fetch: async () => new Response('[]', { status: 200 }) });

  const bad = await (await routes[0].fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'nope', rpcId: 'r' }),
  }))).json();
  assert.equal(bad.result.error.code, 'INPUT');

  const listPayload = await rpc(routes[0], 'cc98.newTopics', ['not', 'an', 'object']);
  assert.equal(listPayload.result.error.code, 'INVALID_ARGUMENT');
});

test('apply: 走完整条链路时确实带上了 Bearer（密码模式换来的令牌）', async () => {
  const seen = [];
  const { ctx, routes } = fakeContext();
  await apply(ctx, {
    dataDir: null,
    fetch: async (url, init) => {
      seen.push({ url, init });
      if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: 'TOKEN-9', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify([{ id: 1, title: '帖子' }]), { status: 200 });
    },
  });

  const result = await rpc(routes[0], 'cc98.newTopics', { size: 20 });
  assert.equal(result.result.ok, true);
  assert.equal(result.result.value.topics[0].id, 1);

  assert.equal(seen[0].url, TOKEN_URL);
  assert.equal(seen[1].url, 'https://api.cc98.org/topic/new?from=0&size=20');
  assert.equal(seen[1].init.headers.Authorization, 'Bearer TOKEN-9');
});

test('apply: 网络失败翻成 WEBVPN_REQUIRED（而不是伪装成密码错误）', async () => {
  const { ctx, routes } = fakeContext();
  await apply(ctx, {
    dataDir: null,
    // 令牌也拿不到 → 同一个错误码，用户看到的必须是同一句话
    fetch: async () => { throw new TypeError('fetch failed'); },
  });

  const result = await rpc(routes[0], 'cc98.hot', {});
  assert.equal(result.result.ok, false);
  assert.equal(result.result.error.code, 'WEBVPN_REQUIRED');
});

test('apply: 匿名接口不需要账号，需要账号的接口报 NEED_LOGIN 且不打令牌端点', async () => {
  let calls = 0;
  const { ctx, routes } = fakeContext({ account: null });
  await apply(ctx, {
    dataDir: null,
    fetch: async (url) => {
      calls += 1;
      // 匿名接口照常返回；令牌端点若被调用就说明判错了
      if (url === TOKEN_URL) throw new Error('不该去打令牌端点');
      return new Response(JSON.stringify([{ id: 1, name: '分区', boards: [] }]), { status: 200 });
    },
  });

  // `boards` 刻意是公开接口：没配账号也该看得到版面列表
  const anonymous = await rpc(routes[0], 'cc98.boards', {});
  assert.equal(anonymous.result.ok, true);
  assert.equal(calls, 1);

  const needsAuth = await rpc(routes[0], 'cc98.newTopics', {});
  assert.equal(needsAuth.result.error.code, 'NEED_LOGIN');
  assert.equal(calls, 1, '需要账号的接口在没配账号时不该发出任何请求');
});

/* ═══════════════════════════════════════════════════════════════════════
 * 补齐上游只读能力的 12 个方法（版面标签 / 帖内文件 / 评分理由 / 楼层原文 /
 * 账号 7 条 / 签到记录）
 *
 * 约定与上面一致：假客户端记录 URL 与查询参数，**不联网**；
 * 每个方法都断言「成功分支的具体值」与「失败分支的具体错误码」。
 * ═══════════════════════════════════════════════════════════════════════ */

test('reads.boardTags: 两层标签拆成 tag1 / tag2，tag2 按 ID 去重', async () => {
  const api = fakeApi({
    layers: 2,
    tags: [
      { id: 11, name: '提问', subTags: [{ id: 21, name: '课程' }, { id: 22, name: '生活' }] },
      { id: 12, name: '分享', subTags: [{ id: 21, name: '课程' }] },
    ],
  });
  const result = await new Cc98Reader(api).boardTags({ board_id: '3' });

  assert.equal(api.calls[0].path, '/board/3/tag-v2');
  assert.equal(result.board_id, 3);
  assert.equal(result.layers, 2);
  assert.deepEqual(result.tag1, [{ id: 11, name: '提问' }, { id: 12, name: '分享' }]);
  // 21 出现两次，只能留一条 —— 平铺的第二层选择器里出现重复项会让人选重
  assert.deepEqual(result.tag2, [{ id: 21, name: '课程' }, { id: 22, name: '生活' }]);
  assert.equal(result.tag1.length, 2);
  assert.equal(result.tag2.length, 2);

  // 版面没有标签：空数组是**真答案**，不是"接口变了"
  const empty = await new Cc98Reader(fakeApi({ layers: 1, tags: [] })).boardTags({ board_id: 1 });
  assert.equal(empty.tag1.length, 0);
  assert.equal(empty.tag2.length, 0);

  // 缺 tags 字段：同样算"没有标签"（body 仍是对象，能分辨出这不是形状错）
  const missing = await new Cc98Reader(fakeApi({ layers: 1 })).boardTags({ board_id: 1 });
  assert.equal(missing.tag1.length, 0);

  await assert.rejects(new Cc98Reader(fakeApi({})).boardTags({ board_id: 0 }), (error) => error.code === 'INVALID_ID');
  // body 不是对象 → 形状错，不能当成"这个版面没标签"
  await assert.rejects(new Cc98Reader(fakeApi('[]')).boardTags({ board_id: 2 }), (error) => error.code === 'SCHEMA_CHANGED');
  // body 是对象但 tags 不是数组 → 形状错
  await assert.rejects(new Cc98Reader(fakeApi({ tags: 'nope' })).boardTags({ board_id: 2 }), (error) => error.code === 'API_SHAPE');
});

test('reads.ratingReasons: type=1/2 各查一次，停用的理由被剔掉', async () => {
  const api = fakeApi((path, options) => {
    assert.equal(path, '/post/rating-reason');
    return options.query.type === 1
      ? [{ id: 1, reason: '很有帮助', enabled: true }, { id: 2, reason: '旧理由', enabled: false }, { id: 3, reason: '内容优质' }]
      : [{ id: 9, reason: '广告', enabled: true }];
  });
  const result = await new Cc98Reader(api).ratingReasons();

  assert.deepEqual(api.calls.map(c => c.query.type), [1, 2]);
  // enabled:false 与服务端保留但停用的历史项被剔掉；缺 enabled 的（id 3）算启用
  assert.deepEqual(result.plus, [{ id: 1, reason: '很有帮助' }, { id: 3, reason: '内容优质' }]);
  assert.equal(result.plus.length, 2);
  assert.deepEqual(result.minus, [{ id: 9, reason: '广告' }]);
  assert.equal(result.minus.length, 1);

  await assert.rejects(new Cc98Reader(fakeApi({ nope: 1 })).ratingReasons(), (error) => error.code === 'SCHEMA_CHANGED');
});

test('reads.original: 原文不清洗，format 按 contentType 判定', async () => {
  const api = fakeApi({ id: 100, topicId: 7, floor: 3, title: null, contentType: 0, content: '[b]原样[/b][img]https://file.cc98.org/a.png[/img]' });
  const ubb = await new Cc98Reader(api).original({ post_id: '100' });

  assert.equal(api.calls[0].path, '/post/100/original');
  assert.equal(ubb.post_id, 100);
  assert.equal(ubb.topic_id, 7);
  assert.equal(ubb.floor, 3);
  assert.equal(ubb.format, 'ubb');
  // 这是它存在的意义：标记必须原样留着，不能被 ubbToText 吃掉
  assert.equal(ubb.content, '[b]原样[/b][img]https://file.cc98.org/a.png[/img]');

  const md = await new Cc98Reader(fakeApi({ id: 101, topicId: 7, floor: 4, contentType: 1, content: '**粗**' })).original({ post_id: 101 });
  assert.equal(md.format, 'markdown');
  assert.equal(md.content, '**粗**');

  await assert.rejects(new Cc98Reader(fakeApi({})).original({ post_id: 'abc' }), (error) => error.code === 'INVALID_ID');
  await assert.rejects(new Cc98Reader(fakeApi('nope')).original({ post_id: 5 }), (error) => error.code === 'SCHEMA_CHANGED');
});

test('reads.overview: /me + 签到 + 未读 + 自定义版面；版面为空时不发多余请求', async () => {
  const api = fakeApi((path) => {
    if (path === '/me') return { id: 42, name: '我', gender: 1, postCount: 10, fanCount: 3, levelTitle: 'Lv.5', customBoards: [3, 4], signInCardCount: 2 };
    if (path === '/me/signin') return { hasSignedInToday: true, lastSignInCount: 12, lastReward: 5, lastSignInTime: '2026-11-10T01:02:03Z' };
    if (path === '/me/unread-count') return { systemCount: 1, atCount: 2, replyCount: 3, messageCount: 4 };
    if (path.startsWith('/board/')) return [{ id: 3, name: '水源', todayCount: 7 }, { id: 4, name: '科技', todayCount: 9 }];
    throw new Error(`意外的路径 ${path}`);
  });
  const result = await new Cc98Reader(api).overview();

  assert.deepEqual(api.calls.map(c => c.path), ['/me', '/me/signin', '/me/unread-count', '/board/?id=3&id=4']);
  assert.equal(result.user.name, '我');
  assert.equal(result.user.gender, '男');
  assert.equal(result.user.sign_in_cards, 2);
  assert.deepEqual(result.sign_in, { signed_today: true, streak: 12, last_reward: 5, last_sign_in_time: '2026-11-10 09:02:03 +08:00' });
  assert.deepEqual(result.unread, { system: 1, at: 2, reply: 3, message: 4 });
  assert.deepEqual(result.custom_boards, [{ id: 3, name: '水源', today: 7 }, { id: 4, name: '科技', today: 9 }]);
  assert.equal(result.custom_boards.length, 2);

  // 没有自定义版面：不能拼出 `/board/?` 去问一个空查询
  const bare = fakeApi((path) => {
    if (path === '/me') return { id: 42, name: '我', customBoards: [] };
    if (path === '/me/signin') return {};
    return { systemCount: 0, atCount: 0, replyCount: 0, messageCount: 0 };
  });
  const noBoards = await new Cc98Reader(bare).overview();
  assert.deepEqual(bare.calls.map(c => c.path), ['/me', '/me/signin', '/me/unread-count']);
  assert.deepEqual(noBoards.custom_boards, []);
  // 缺字段的签到状态：signed_today 是 false，streak 是 null（不编 0）
  assert.equal(noBoards.sign_in.signed_today, false);
  assert.equal(noBoards.sign_in.streak, null);
  // 老账号没有 signInCardCount：字段不出现，而不是 0
  assert.equal('sign_in_cards' in noBoards.user, false);

  await assert.rejects(new Cc98Reader(fakeApi({})).overview(), (error) => error.code === 'SCHEMA_CHANGED');
});

test('reads.myTopics: /me/recent-topic + from/size，满页才有 next_from', async () => {
  const rows = Array.from({ length: 2 }, (_, i) => ({ ...TOPIC_ROW, id: i + 1 }));
  const api = fakeApi(rows);
  const result = await new Cc98Reader(api).myTopics({ from: 0, size: 2 });
  assert.equal(api.calls[0].path, '/me/recent-topic');
  assert.deepEqual(api.calls[0].query, { from: 0, size: 2 });
  assert.equal(result.topics.length, 2);
  assert.equal(result.topics[0].id, 1);
  assert.equal(result.next_from, 2);

  await assert.rejects(new Cc98Reader(fakeApi({})).myTopics(), (error) => error.code === 'SCHEMA_CHANGED');
});

test('reads.myPosts: 分页对象保住 count，next_from 用总数算而不是"满页猜"', async () => {
  const post = { id: 900, topicId: 7, floor: 12, userName: '我', content: '[b]我的回复[/b]', time: '2024-01-02T03:04:05Z', likeCount: 3 };
  const api = fakeApi({ data: [post], count: 25, from: 0, size: 20 });
  const result = await new Cc98Reader(api).myPosts({ from: 0, size: 20 });

  assert.equal(api.calls[0].path, '/me/recent-post');
  assert.deepEqual(api.calls[0].query, { from: 0, size: 20 });
  assert.equal(result.count, 25);
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].text, '我的回复');
  assert.equal(result.posts[0].topic_id, 7);
  // 11 楼以上要跳到第 2 页的锚点，不能被写成 /topic/7#12
  assert.equal(result.posts[0].url, 'https://www.cc98.org/topic/7/2#2');
  assert.equal(result.next_from, 20);

  // hot 走另一条路径
  const hotApi = fakeApi({ data: [{ id: 1, topicId: 7, floor: 1, content: 'x' }], count: 1 });
  const hot = await new Cc98Reader(hotApi).myPosts({ hot: true });
  assert.equal(hotApi.calls[0].path, '/me/hot-post');
  assert.equal(hot.hot, true);
  assert.equal(hot.next_from, null, 'count=1、size=20 → 已经到底');

  // 满页但 count 说没了：靠 count 判 null，而不是靠"满页"
  const exact = await new Cc98Reader(fakeApi({ data: Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })), count: 20 }))
    .myPosts({ from: 0, size: 20 });
  assert.equal(exact.posts.length, 20);
  assert.equal(exact.next_from, null);

  await assert.rejects(new Cc98Reader(fakeApi({ weird: 1 })).myPosts(), (error) => error.code === 'SCHEMA_CHANGED');
});

test('reads.history: 浏览记录带 last_browsing_time，count 来自服务端', async () => {
  const api = fakeApi({ data: [{ ...TOPIC_ROW, lastBrowsingTime: '2024-02-03T04:05:06Z' }], count: 41 });
  const result = await new Cc98Reader(api).history({ from: 20, size: 20 });

  assert.equal(api.calls[0].path, '/me/browsing-record');
  assert.deepEqual(api.calls[0].query, { from: 20, size: 20 });
  assert.equal(result.count, 41);
  assert.equal(result.topics[0].last_browsing_time, '2024-02-03 12:05:06 +08:00');
  assert.equal(result.topics[0].title, '标题');
  // from 20 + size 20 = 40 < 41 → 还有一条
  assert.equal(result.next_from, 40);
  // 恰好取到第 40 条（count=40）时，靠 count 判定「到底了」而不是靠"满页"
  const exact = await new Cc98Reader(fakeApi({ data: [TOPIC_ROW], count: 40 })).history({ from: 20, size: 20 });
  assert.equal(exact.count, 40);
  assert.equal(exact.next_from, null);

  await assert.rejects(new Cc98Reader(fakeApi(null)).history(), (error) => error.code === 'SCHEMA_CHANGED');
});

test('reads.favorites: 分组每次都取；有 keyword 走搜索，顺序参数被校验', async () => {
  const api = fakeApi((path) => {
    if (path === '/me/favorite-topic-group') return { data: [{ id: 0, name: '默认', count: 2 }, { id: 5, name: '考研', count: 1 }], count: 2 };
    return [TOPIC_ROW];
  });
  const reader = new Cc98Reader(api);

  const normal = await reader.favorites({ from: 0, size: 20 });
  assert.equal(api.calls[0].path, '/me/favorite-topic-group');
  assert.equal(api.calls[1].path, '/topic/me/favorite');
  assert.deepEqual(api.calls[1].query, { from: 0, size: 20, order: 1, groupid: 0 });
  assert.deepEqual(normal.groups, [{ id: 0, name: '默认', count: 2 }, { id: 5, name: '考研', count: 1 }]);
  assert.equal(normal.groups.length, 2);
  assert.equal(normal.topics.length, 1);
  assert.equal('keyword' in normal, false, '没搜就不该出现 keyword 字段');

  const searched = await reader.favorites({ keyword: '  选课 ', group_id: 5, order: 0 });
  assert.equal(api.calls[2].path, '/me/favorite-topic-group');
  assert.equal(api.calls[3].path, '/topic/me/search-favorite');
  assert.deepEqual(api.calls[3].query, { from: 0, size: 20, keyword: '选课' });
  assert.equal(searched.keyword, '选课');

  await assert.rejects(reader.favorites({ order: 2 }), (error) => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(reader.favorites({ group_id: -1 }), (error) => error.code === 'INVALID_ARGUMENT');
});

test('reads.following: 纯 ID 数组 → 再查 /user/basic，顺序按原始列表', async () => {
  const api = fakeApi((path) => {
    if (path === '/me/followee') return [34, 12, 34];
    if (path === '/me/follower') return [56];
    if (path.startsWith('/user/basic')) {
      // 服务端按自己的顺序回，不能拿它当展示顺序
      return [{ id: 12, name: '小明' }, { id: 34, name: '小红' }];
    }
    throw new Error(`意外的路径 ${path}`);
  });
  const reader = new Cc98Reader(api);

  const following = await reader.following({ from: 0, size: 20 });
  assert.equal(api.calls[0].path, '/me/followee');
  // 去重后按原始出现顺序拼重复参数
  assert.equal(api.calls[1].path, '/user/basic?id=34&id=12');
  assert.deepEqual(following.users, [
    { id: 34, name: '小红', url: 'https://www.cc98.org/user/id/34' },
    { id: 12, name: '小明', url: 'https://www.cc98.org/user/id/12' },
  ]);
  assert.equal(following.users.length, 2);
  assert.equal(following.fans, false);
  assert.equal(following.next_from, null);

  const fans = await reader.following({ fans: true });
  assert.equal(api.calls[2].path, '/me/follower');
  assert.equal(fans.fans, true);
  // 查不到名字 → null，绝不编一个「用户56」
  assert.equal(fans.users[0].name, null);

  // 一个都不关注：不该去打 /user/basic（空 id 查询没有形状保证）
  const emptyApi = fakeApi([]);
  const none = await new Cc98Reader(emptyApi).following();
  assert.deepEqual(emptyApi.calls.map(c => c.path), ['/me/followee']);
  assert.equal(none.users.length, 0);

  await assert.rejects(new Cc98Reader(fakeApi({})).following(), (error) => error.code === 'SCHEMA_CHANGED');
});

test('reads.feed: boards / users 两条路径，users 带 order=0', async () => {
  const api = fakeApi([TOPIC_ROW]);
  const reader = new Cc98Reader(api);

  const boards = await reader.feed({ from: 0, size: 10 });
  assert.equal(api.calls[0].path, '/me/custom-board/topic');
  assert.deepEqual(api.calls[0].query, { from: 0, size: 10 });
  assert.equal(boards.kind, 'boards');
  assert.equal(boards.topics.length, 1);

  const users = await reader.feed({ kind: 'users', from: 10, size: 10 });
  assert.equal(api.calls[1].path, '/me/followee/topic');
  // order 缺了服务端会换一种排序，"动态"就不是网页上那一批了
  assert.deepEqual(api.calls[1].query, { from: 10, size: 10, order: 0 });
  assert.equal(users.kind, 'users');

  // kind 会被拼进 URL 分支，必须白名单
  await assert.rejects(reader.feed({ kind: '../me' }), (error) => error.code === 'INVALID_ARGUMENT');
});

test('reads.signinMonth: 只算有记录的日期，奖励缺字段不当 0', async () => {
  const api = fakeApi([
    { year: 2026, month: 11, day: 1, reward: 5, useCard: false },
    { year: 2026, month: 11, day: 2, reward: 3, useCard: true },
    { year: 2026, month: 11, day: 3 },
  ]);
  const result = await new Cc98Reader(api).signinMonth({ year: '2026', month: '11' });

  assert.equal(api.calls[0].path, '/me/signin-in-month');
  assert.deepEqual(api.calls[0].query, { year: 2026, month: 11 });
  assert.equal(result.year, 2026);
  assert.equal(result.month, 11);
  assert.equal(result.signed_days, 3);
  assert.deepEqual(result.days, [
    { day: 1, reward: 5 },
    { day: 2, reward: 3, use_card: true },
    { day: 3, reward: null },
  ]);
  // 5 + 3 + 0（day 3 缺奖励，按 0 累加但不是"全是 null"）
  assert.equal(result.total_reward, 8);

  // 全是 null 时总量是 null（不知道），不是 0（确实没奖励）
  const unknown = await new Cc98Reader(fakeApi([{ day: 1 }])).signinMonth({ year: 2026, month: 11 });
  assert.equal(unknown.total_reward, null);
  assert.equal(unknown.signed_days, 1);

  await assert.rejects(new Cc98Reader(fakeApi([])).signinMonth({ year: 2026, month: 13 }), (error) => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(new Cc98Reader(fakeApi([])).signinMonth({ year: 1800, month: 1 }), (error) => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(new Cc98Reader(fakeApi({})).signinMonth({ year: 2026, month: 1 }), (error) => error.code === 'SCHEMA_CHANGED');
});

/* ───────────────────── 帖内文件：链接提取 + 可选落盘 ───────────────────── */

test('fileLinks: 只算本楼自己的文件，嵌套引用里的不算', () => {
  // 引用的引用，且外层引用块在**内层结束之后**还有内容。
  // 「第一个 [quote] 到第一个 [/quote]」那种非贪婪写法在这里会配对错：
  // 它只删掉 `[quote]外层[quote]内层[/quote]`，把外层剩下的
  // `https://file.cc98.org/quoted.png` 留在正文里，于是上一楼的附件被算成本楼的。
  const nested = '[quote]外层[quote]内层[/quote][img]https://file.cc98.org/quoted.png[/img][/quote]'
    + '[img]https://file.cc98.org/mine.png[/img]';
  assert.deepEqual(fileLinks(nested), ['https://file.cc98.org/mine.png']);

  // 单个引用块
  assert.deepEqual(
    fileLinks('[quote][img]https://file.cc98.org/q.png[/img][/quote][img]https://file.cc98.org/a.png[/img][img]https://file.cc98.org/a.png[/img]'),
    ['https://file.cc98.org/a.png'],
  );

  // Markdown 的引用是 > 行
  assert.deepEqual(
    fileLinks('> ![](https://file.cc98.org/old.png)\n![](https://file.cc98.org/new.png)', true),
    ['https://file.cc98.org/new.png'],
  );

  // 别的主机不算（这些不是帖内文件，不该进入下载清单）
  assert.deepEqual(fileLinks('[img]https://example.com/x.png[/img]'), []);

  assert.deepEqual(fileLinks(null), []);
});

test('floorAnchor / ratingSummary / idsPath / safeFileName 的具体行为', () => {
  assert.equal(floorAnchor(7, 1), '/topic/7#1');
  assert.equal(floorAnchor(7, 10), '/topic/7#10');
  // 第 11 楼在第 2 页、页内第 1 楼
  assert.equal(floorAnchor(7, 11), '/topic/7/2#1');
  assert.equal(floorAnchor(7, 12), '/topic/7/2#2');
  assert.equal(floorAnchor(7, 20), '/topic/7/2#10');
  assert.equal(floorAnchor(7, 21), '/topic/7/3#1');
  assert.equal(floorAnchor(7, 0), '/topic/7');

  // 同一项求和；deleted 的不算
  assert.equal(ratingSummary([
    { content: '风评值 +1' }, { content: '风评值 +4' }, { content: '财富值 +1000' },
    { content: '风评值 -2' }, { content: '已删的 +99', deleted: true },
  ]), '风评值 +3，财富值 +1000');
  // 没有数值的纯文字理由原样保留，不硬造 0
  assert.equal(ratingSummary([{ content: '写得好' }]), '写得好');
  assert.equal(ratingSummary([]), null);

  assert.equal(idsPath('/board/', [3, 4, 3]), '/board/?id=3&id=4');
  assert.equal(idsPath('/user/basic', [0, -1, 'x', 5]), '/user/basic?id=5');
  assert.equal(idsPath('/board/', []), '/board/');

  assert.equal(safeFileName(new URL('https://file.cc98.org/2024/a%20b.png')), 'a b.png');
  // 只有 `.` / `..` 的路径段落不能当成文件名（会变成"写上一级目录"）
  assert.equal(safeFileName(new URL('https://file.cc98.org/x/..')), 'file');
  assert.equal(safeFileName(new URL('https://file.cc98.org/')), 'file');
  // 非法字符被替换，且只取最后一段 —— 不能凭链接造出子目录
  assert.equal(safeFileName(new URL('https://file.cc98.org/dir/sub/c:d.zip')), 'c_d.zip');
  assert.equal(safeFileName(new URL('https://file.cc98.org/dir/a*b|c.png')), 'a_b_c.png');
});

test('reads.topicDownload: 没配目录时只回链接；配了才落盘', async () => {
  const post = {
    id: 100,
    topicId: 7,
    floor: 2,
    contentType: 0,
    content: '[img]https://file.cc98.org/a.png[/img][upload=2]https://file.cc98.org/b.zip[/upload]',
  };
  const api = fakeApi((path) => {
    assert.equal(path, '/Topic/7/post');
    return [post];
  });
  // 未配目录：只回链接，且**不该**调用 fetchFile
  const result = await new Cc98Reader(api).topicDownload({ topic_id: 7, floor: 2 });

  assert.deepEqual(api.calls[0].query, { from: 1, size: 1 });
  assert.equal(result.topic_id, 7);
  assert.equal(result.floor, 2);
  assert.equal(result.downloaded, false);
  assert.equal(result.dir, null);
  assert.deepEqual(result.files, [
    { url: 'https://file.cc98.org/a.png', name: 'a.png', path: null, bytes: null },
    { url: 'https://file.cc98.org/b.zip', name: 'b.zip', path: null, bytes: null },
  ]);
  assert.equal(result.files.length, 2);
  assert.match(result.note, /只回了文件链接/);

  // 配了目录但客户端只实现了 get → 明确报 UNSUPPORTED，不假装已落盘
  await assert.rejects(
    new Cc98Reader(api, { downloadDir: 'C:/tmp/cc98' }).topicDownload({ topic_id: 7, floor: 2 }),
    (error) => error.code === 'UNSUPPORTED',
  );
});

test('reads.topicDownload: 楼层不存在 / 已删除 / 没有文件 三种都报 NOT_FOUND', async () => {
  const readerFor = (rows) => new Cc98Reader(fakeApi(rows));

  // 服务端回的那一楼不是我们要的楼层（分页语义变了）→ 不能拿错的那一楼去下文件
  await assert.rejects(readerFor([{ id: 1, floor: 5 }]).topicDownload({ topic_id: 7, floor: 2 }),
    (error) => error.code === 'NOT_FOUND');
  await assert.rejects(readerFor([]).topicDownload({ topic_id: 7, floor: 2 }),
    (error) => error.code === 'NOT_FOUND');
  await assert.rejects(readerFor([{ id: 2, floor: 2, isDeleted: true }]).topicDownload({ topic_id: 7, floor: 2 }),
    (error) => error.code === 'NOT_FOUND');
  await assert.rejects(readerFor([{ id: 3, floor: 2, content: '纯文字，没有附件' }]).topicDownload({ topic_id: 7, floor: 2 }),
    (error) => error.code === 'NOT_FOUND');
  // 楼层号不合法（0 / 非整数）在发请求之前就该拒掉
  await assert.rejects(readerFor([{ id: 3, floor: 2, content: 'x' }]).topicDownload({ topic_id: 7, floor: 0 }),
    (error) => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(readerFor([{ id: 3, floor: 2, content: 'x' }]).topicDownload({ topic_id: 7 }),
    (error) => error.code === 'INVALID_ARGUMENT');
  // 只允许 file.cc98.org：别的主机一律拒绝
  await assert.rejects(readerFor([{ id: 4, floor: 2, content: '[img]https://evil.example/x.png[/img]' }])
    .topicDownload({ topic_id: 7, floor: 2 }), (error) => error.code === 'NOT_FOUND');
  await assert.rejects(new Cc98Reader(fakeApi({})).topicDownload({ url: 'https://evil.example/x.png' }),
    (error) => error.code === 'INVALID_PATH');
  await assert.rejects(new Cc98Reader(fakeApi({})).topicDownload({ url: 'http://file.cc98.org/x.png' }),
    (error) => error.code === 'INVALID_PATH');
});

test('reads.topicDownload: 配了目录时真的把字节写进文件，撞名加序号不覆盖', async () => {
  const { mkdtemp, readFile, rm, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const nodePath = await import('node:path');
  const dir = await mkdtemp(nodePath.join(tmpdir(), 'cc98-download-'));
  try {
    const saved = [];
    const api = {
      calls: [],
      async get(path, options = {}) {
        this.calls.push({ path, ...options });
        return [{ id: 100, topicId: 7, floor: 2, contentType: 0, content: '[img]https://file.cc98.org/a.png[/img]' }];
      },
      async fetchFile(url) {
        saved.push(url);
        return { bytes: Buffer.from(`bytes-of:${url}`), contentType: 'image/png' };
      },
    };
    const reader = new Cc98Reader(api, { downloadDir: dir });

    const first = await reader.topicDownload({ topic_id: 7, floor: 2 });
    assert.equal(first.downloaded, true);
    assert.equal(first.dir, dir);
    assert.deepEqual(saved, ['https://file.cc98.org/a.png']);
    assert.equal(first.files[0].path, nodePath.join(dir, 'a.png'));
    assert.equal(first.files[0].bytes, 'bytes-of:https://file.cc98.org/a.png'.length);
    assert.equal(first.files[0].content_type, 'image/png');
    assert.equal(await readFile(first.files[0].path, 'utf8'), 'bytes-of:https://file.cc98.org/a.png');

    // 同名再下一次：加序号，**不覆盖**已下载的那份
    const second = await reader.topicDownload({ topic_id: 7, floor: 2 });
    assert.equal(second.files[0].path, nodePath.join(dir, 'a (1).png'));
    assert.equal(await readFile(nodePath.join(dir, 'a.png'), 'utf8'), 'bytes-of:https://file.cc98.org/a.png');
    assert.equal(await readFile(second.files[0].path, 'utf8'), 'bytes-of:https://file.cc98.org/a.png');
    assert.deepEqual((await readdir(dir)).sort(), ['a (1).png', 'a.png']);

    // 直接给 url 的入口也走同一条落盘路径
    const direct = await reader.topicDownload({ url: 'https://file.cc98.org/2019/12/31/pic.jpg' });
    assert.equal(direct.files.length, 1);
    assert.equal(direct.files[0].name, 'pic.jpg');
    assert.equal(await readFile(nodePath.join(dir, 'pic.jpg'), 'utf8'), 'bytes-of:https://file.cc98.org/2019/12/31/pic.jpg');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('client.fetchFile: 不把 Bearer 发给 file.cc98.org；网页/空体/错误状态都报错', async () => {
  const okTransport = {
    calls: [],
    async request(url, init) {
      this.calls.push({ url, init });
      return {
        response: {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/png' }),
          async arrayBuffer() { return new TextEncoder().encode('PNG-BYTES').buffer; },
        },
        release: () => { this.released = true; },
      };
    },
  };
  const client = new Cc98Client({ tokens: { token: async () => 'TOKEN-9' }, transport: okTransport });
  const file = await client.fetchFile('https://file.cc98.org/a.png');

  assert.equal(okTransport.calls[0].url, 'https://file.cc98.org/a.png');
  assert.equal(okTransport.calls[0].init.method, 'GET');
  // 令牌不该出现在另一个域上
  assert.equal(okTransport.calls[0].init.headers.Authorization, undefined);
  assert.equal(okTransport.calls[0].init.stream, true);
  assert.equal(file.bytes.toString('utf8'), 'PNG-BYTES');
  assert.equal(file.contentType, 'image/png');
  assert.equal(okTransport.released, true);

  const make = (response) => new Cc98Client({
    tokens: { token: async () => 'TOKEN-9' },
    transport: { async request() { return { response, release: () => {} }; } },
  });

  // 不存在的文件回了 200 + 网页：落到 .png 里会是个打不开的文件，比报错更难查
  await assert.rejects(
    make({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), async arrayBuffer() { return new ArrayBuffer(0); } })
      .fetchFile('https://file.cc98.org/gone.png'),
    (error) => error.code === 'NOT_FOUND',
  );
  await assert.rejects(
    make({ ok: false, status: 404, headers: new Headers(), async arrayBuffer() { return new ArrayBuffer(0); } })
      .fetchFile('https://file.cc98.org/gone.png'),
    (error) => error.code === 'NOT_FOUND',
  );
  await assert.rejects(
    make({ ok: false, status: 403, headers: new Headers(), async arrayBuffer() { return new ArrayBuffer(0); } })
      .fetchFile('https://file.cc98.org/gone.png'),
    (error) => error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    make({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), async arrayBuffer() { return new ArrayBuffer(0); } })
      .fetchFile('https://file.cc98.org/empty.png'),
    (error) => error.code === 'UNEXPECTED_RESPONSE',
  );
  await assert.rejects(client.fetchFile('https://evil.example/x.png'), (error) => error.code === 'INVALID_PATH');
});

test('apply: 新增的 12 个方法都在白名单里，且旧的那批一个不少', () => {
  for (const key of [
    'boardTags', 'topicDownload', 'ratingReasons', 'original',
    'overview', 'myTopics', 'myPosts', 'history', 'favorites', 'following', 'feed', 'signinMonth',
  ]) {
    assert.ok(METHODS.includes(key), `缺 cc98.${key}`);
  }
  assert.equal(METHODS.length, 22);
  // 写操作名一个都不能进来（它们归 packages/tool/campus-write）
  for (const write of ['reply', 'post', 'favorite', 'like', 'rate', 'edit', 'send', 'signin']) {
    assert.equal(METHODS.includes(write), false, `写操作 ${write} 不该出现在只读方法表里`);
  }
});


test('describe：会话动作与读取方法分开列，且 logout 在清单里', async () => {
  // 1-A 裁决：`session logout` 要能被看到。
  // 但它是**会话动作**，不是读取方法 —— 混进 `methods` 会让
  // 「能力清单里有 23 条读取」这种误解成立。
  const { ctx, services } = fakeContext();
  const dispose = await apply(ctx);
  const described = services.get('zhiyunCc98').describe();
  assert.equal(described.readOnly, false);
  assert.ok(Array.isArray(described.actions), 'describe 要有 actions');
  const names = described.actions.map((item) => item.action);
  assert.equal(names.includes('cc98.logout'), true, 'logout 必须在自描述里');
  assert.equal(names.includes('cc98.status'), true, 'status 也在');
  assert.equal(described.actions.length, 2);

  // 两个动作都不许混进读取方法表。
  const readMethods = described.methods.map((item) => item.method);
  assert.equal(readMethods.includes('cc98.logout'), false, 'logout 不是读取方法');
  assert.equal(readMethods.includes('cc98.status'), false, 'status 不是读取方法');
  assert.equal(readMethods.length, 22, '读取方法仍是 22 条');
  await dispose();
});
