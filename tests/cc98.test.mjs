/**
 * `dsh-zhiyun-source-cc98` 的离线单测。
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

import { SessionStore, ClassroomError } from 'dsh-zhiyun-source-campus/http';

import { ubbToText } from '../packages/dsh-zhiyun-source-cc98/src/ubb.js';
import { TOKEN_URL } from '../packages/dsh-zhiyun-source-cc98/src/hosts.js';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  SCOPE,
  parseTokenResponse,
  passwordForm,
  refreshForm,
  TokenStore,
} from '../packages/dsh-zhiyun-source-cc98/src/token.js';
import { Cc98Client, apiPath, withQuery, httpError, parseBody } from '../packages/dsh-zhiyun-source-cc98/src/client.js';
import { Cc98Reader, at, cc98Id, nextFrom, postText } from '../packages/dsh-zhiyun-source-cc98/src/reads.js';
import { apply, METHODS, ROUTE_PATH } from '../packages/dsh-zhiyun-source-cc98/src/index.js';

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
  const src = await readFile(new URL('../packages/dsh-zhiyun-source-cc98/src/index.js', import.meta.url), 'utf8');
  assert.match(src, /readCc98/, '应从 card 包取 CC98 专用凭据');
  assert.doesNotMatch(src, /readCard\b/, '不该再借用一卡通那份记录');
});

test('凭据：card 包为 CC98 单独开了记录键与四个操作', async () => {
  const card = await import('../packages/dsh-zhiyun-source-card/src/index.js');
  assert.equal(card.CC98_RECORD_KEY, 'zhiyun-cc98/account');
  assert.notEqual(card.CC98_RECORD_KEY, card.CARD_RECORD_KEY, '不能与一卡通共用同一个键');
  assert.notEqual(card.CC98_RECORD_KEY, card.WEBVPN_RECORD_KEY, '不能与 WebVPN 共用');
  for (const fn of ['readCc98', 'writeCc98', 'clearCc98', 'cc98Status']) {
    assert.equal(typeof card[fn], 'function', `缺 ${fn}`);
  }
});

test('凭据：CC98 账号与一卡通各自独立，清除一个不影响另一个', async () => {
  const card = await import('../packages/dsh-zhiyun-source-card/src/index.js');
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
  const card = await import('../packages/dsh-zhiyun-source-card/src/index.js');
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
  const api = fakeApi([
    { id: 1, senderId: 42, receiverId: 9, content: '[b]对方发的[/b]', time: '2024-01-02T03:04:05Z' },
    { id: 2, senderId: 9, receiverId: 42, content: '我发的', contentType: 1, time: null },
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

test('apply: 注册一条 GET/POST 路由，方法表就是那 10 个只读方法', async () => {
  const { ctx, routes, services } = fakeContext();
  const dispose = await apply(ctx, { dataDir: null, fetch: async () => new Response('{}', { status: 200 }) });

  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, ROUTE_PATH);
  assert.deepEqual(routes[0].methods, ['GET', 'POST']);

  const status = await (await routes[0].fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`))).json();
  assert.equal(status.ok, true);
  // GET 一次给全：能干什么（describe）+ 现在能不能读（status）
  assert.equal(status.value.platform, 'cc98');
  assert.equal(status.value.readOnly, true);
  assert.equal(status.value.dataDir, null, 'dataDir:null 是"纯内存"，自描述里要如实写 null');
  assert.equal(status.value.status.readOnly, true);
  assert.equal(status.value.status.configured, true);
  // 状态里绝不能出现令牌本身
  assert.equal(JSON.stringify(status).includes('access_token'), false);
  assert.deepEqual(status.value.methods.map(m => m.method), METHODS.map(m => `cc98.${m}`));
  // 每个方法都带一份参数示例（调用方靠它发现能力，不在别处维护第二份清单）
  assert.ok(status.value.methods.every(m => m.args && typeof m.args === 'object'));

  const service = services.get('zhiyunCc98');
  assert.equal(service.readOnly, true);
  assert.equal(service.methods.length, 10);
  assert.equal(service.describe().platform, 'cc98');
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

