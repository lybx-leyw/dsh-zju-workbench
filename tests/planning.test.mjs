/**
 * 「规划」页的守卫。
 *
 * 这一页的数据是**四份东西并起来**的，所以断言分四类：
 *
 *   1. 凭证：读密钥不得以明文回到页面，客户端不得把它写进任何持久化位置；
 *   2. 输入：域名与密钥是用户随手填的，"看着像地址"的字符串很多都不是；
 *   3. **本地留存**：这是本页最容易被写错的一处 —— 中转站不稳，本地是兜底，
 *      去重（前缀匹配）既不能重复保存，也不能把不同的两条误判成同一条；
 *   4. 待办：两个来源的形状不同、失败原因不同，必须能分别带出。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEDUPE_PREFIX,
  LocalStore,
  ROUTE_PATH,
  URGENCY,
  WRITE_HEADER,
  entryPrefix,
  loadConfig,
  mask,
  mergeIncoming,
  normalizeEndpoint,
  normalizeKey,
  normalizePtaSets,
  normalizeXzzdTodos,
  pullEntries,
  saveConfig,
  urgencyOf,
} from '../packages/dsh-zhiyun-page-planning/src/index.js';

const KEY = 'read-key-1234';

/* ───────────────────────────────────────────────────────── 凭证与输入 */

test('域名只保留 origin，且只接受 http/https', () => {
  assert.equal(normalizeEndpoint('https://a-b.ms.show'), 'https://a-b.ms.show');
  assert.equal(normalizeEndpoint('https://a-b.ms.show/entries?x=1'), 'https://a-b.ms.show');
  assert.equal(normalizeEndpoint('  http://127.0.0.1:7860  '), 'http://127.0.0.1:7860');
  for (const bad of ['', '   ', 'a-b.ms.show', 'ftp://a-b.ms.show', 'javascript:alert(1)',
    'file:///etc/passwd', 'https://user:pw@a-b.ms.show', null, undefined]) {
    assert.equal(normalizeEndpoint(bad), null, `${JSON.stringify(bad)} 不该被接受`);
  }
});

test('密钥要求够长、且不含空白', () => {
  assert.equal(normalizeKey('  abcdefgh  '), 'abcdefgh');
  for (const bad of ['', 'short', 'has space', 'tab\there', 'line\nbreak', null]) {
    assert.equal(normalizeKey(bad), null, `${JSON.stringify(bad)} 不该被接受`);
  }
});

test('回给页面的配置里密钥是打码值，不是明文', () => {
  const view = mask({ endpoint: 'https://a-b.ms.show', readKey: KEY });
  assert.equal(view.readKey === KEY, false, '视图里不得出现明文密钥');
  assert.equal(JSON.stringify(view).includes(KEY), false, '整个视图序列化后也不得含明文');
  assert.equal(view.configured, true);
  assert.equal(mask({ endpoint: 'https://a-b.ms.show', readKey: '' }).configured, false);
  assert.equal(mask({ endpoint: '', readKey: KEY }).configured, false);
});

test('配置落盘后可原样读回，损坏的配置退回未配置而不是抛错', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'planning-cfg-'));
  const file = path.join(dir, 'nested', 'config.json');
  try {
    saveConfig(file, { endpoint: 'https://a-b.ms.show', readKey: KEY });
    assert.deepEqual(loadConfig(file), { endpoint: 'https://a-b.ms.show', readKey: KEY });
    await writeFile(file, '{ not json', 'utf8');
    assert.deepEqual(loadConfig(file), { endpoint: '', readKey: '' });
    assert.deepEqual(loadConfig(path.join(dir, 'missing.json')), { endpoint: '', readKey: '' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ───────────────────────────────────────────────────── 中转站传输（失败语义） */

function fakeFetch({ status = 200, body = { entries: [] }, throws = null } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    if (throws) throw throws;
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

test('请求带读密钥，且只用中转站认的那个头', async () => {
  const fetchImpl = fakeFetch();
  await pullEntries({ endpoint: 'https://a-b.ms.show/', readKey: KEY }, fetchImpl);
  const [{ url, options }] = fetchImpl.calls;
  assert.equal(url, 'https://a-b.ms.show/entries');
  assert.equal(options.headers['X-Zy-Read-Key'], KEY);
  assert.equal('Authorization' in options.headers, false, '不能占用平台的头');
  assert.match(options.headers['User-Agent'], /Mozilla\/5\.0/);
});

test('四种失败必须能被区分开', async () => {
  for (const status of [401, 403, 404]) {
    const result = await pullEntries({ endpoint: 'https://a.ms.show', readKey: KEY }, fakeFetch({ status }));
    assert.equal(result.code, 'KEY_REJECTED', `HTTP ${status} 应判为密钥问题`);
  }
  const upstream = await pullEntries({ endpoint: 'https://a.ms.show', readKey: KEY }, fakeFetch({ status: 500 }));
  assert.equal(upstream.code, 'UPSTREAM');
  const unreachable = await pullEntries(
    { endpoint: 'https://a.ms.show', readKey: KEY },
    fakeFetch({ throws: Object.assign(new Error('boom'), { cause: { code: 'ECONNREFUSED' } }) }),
  );
  assert.equal(unreachable.code, 'UNREACHABLE');
  assert.match(unreachable.message, /ECONNREFUSED/);
  const notJson = await pullEntries({ endpoint: 'https://a.ms.show', readKey: KEY },
    async () => ({ status: 200, ok: true, json: async () => { throw new Error('nope'); } }));
  assert.equal(notJson.code, 'BAD_PAYLOAD');
});

/* ──────────────────────────────────────────────── 本地留存与去重（本页核心） */

test('去重前缀：同一内容稳定，不同内容可分', () => {
  const a = { kind: 'note', title: '标题', text: '正文内容' };
  assert.equal(entryPrefix(a), entryPrefix({ ...a }), '同样的输入必须给同样的前缀');
  assert.notEqual(entryPrefix(a), entryPrefix({ ...a, title: '另一个标题' }));
  assert.notEqual(entryPrefix(a), entryPrefix({ ...a, kind: 'plan' }));
  assert.ok(entryPrefix(a).length <= DEDUPE_PREFIX);
});

test('去重前缀只取前 N 字符：尾部微调不该变成新条目', () => {
  // 这是"前缀匹配"刻意的取舍：用户改一个错别字仍算同一条，避免重复堆积
  const base = { kind: 'diary', title: '今天', text: 'x'.repeat(200) };
  const edited = { ...base, text: `${'x'.repeat(200)}（改了一个字）` };
  assert.equal(entryPrefix(base), entryPrefix(edited), '超长正文的尾部改动在前缀里看不出来');
});

test('重复同步不会重复保存', () => {
  const local = [];
  const incoming = [
    { seq: 1, kind: 'plan', title: '本周计划', text: '写代码', tags: ['plan'], at: 100 },
    { seq: 2, kind: 'diary', title: '今天', text: '跑步', tags: [], at: 200 },
  ];
  const first = mergeIncoming(local, incoming);
  assert.equal(first.added.length, 2);
  assert.equal(local.length, 2);

  const second = mergeIncoming(local, incoming);
  assert.equal(second.added.length, 0, '同一批再来一次不该新增');
  assert.equal(second.skipped, 2);
  assert.equal(local.length, 2, '本地条数不该变');
});

test('中转站新增的那条会被单独算出来', () => {
  const local = [];
  mergeIncoming(local, [{ seq: 1, kind: 'plan', title: 'A', text: 'a', at: 100 }]);
  const result = mergeIncoming(local, [
    { seq: 1, kind: 'plan', title: 'A', text: 'a', at: 100 },
    { seq: 2, kind: 'plan', title: 'B', text: 'b', at: 200 },
  ]);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].title, 'B');
  assert.equal(local.length, 2);
});

test('本地留存是只增的：中转站清空后历史仍在', () => {
  const local = [];
  mergeIncoming(local, [{ seq: 1, kind: 'note', title: '会被记住', text: '内容', at: 100 }]);
  // 中转站把数据丢了，返回空表
  const result = mergeIncoming(local, []);
  assert.equal(result.added.length, 0);
  assert.equal(local.length, 1, '空响应不该抹掉本地已有的内容');
});

test('LocalStore 落盘后可读回，文件损坏退回空表而不是抛错', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'planning-store-'));
  const file = path.join(dir, 'entries.json');
  try {
    const store = new LocalStore(file);
    store.absorb([{ seq: 1, kind: 'plan', title: '存下来', text: 'x', at: 100 }]);
    store.absorb([{ seq: 1, kind: 'plan', title: '存下来', text: 'x', at: 100 }]);

    const reopened = new LocalStore(file);
    assert.equal(reopened.list().length, 1, '重复同步后仍只有一条');

    await writeFile(file, 'not json', 'utf8');
    assert.deepEqual(new LocalStore(file).list(), [], '坏文件退回空表');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('LocalStore.list 按时间正序，页面才能自己分组', () => {
  const dir = path.join(tmpdir(), `planning-order-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const store = new LocalStore(path.join(dir, 'e.json'));
  store.absorb([
    { seq: 2, kind: 'note', title: '后', text: 'b', at: 200 },
    { seq: 1, kind: 'note', title: '前', text: 'a', at: 100 },
  ]);
  assert.deepEqual(store.list().map((row) => row.title), ['前', '后']);
  return rm(dir, { recursive: true, force: true });
});

/* ─────────────────────────────────────────────────────────────── 待办 */

test('学在浙大待办归一化：字段改名但不改语义', () => {
  const rows = normalizeXzzdTodos({
    todos: [{
      id: 42,
      title: '示例作业',
      type: 'homework',
      course_name: '示例课程',
      deadline: { iso: '2026-10-20T15:59:00+08:00', text: '10月20日 15:59' },
      url: 'https://xzzd.example/activity/42',
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'xzzd');
  assert.equal(rows[0].sourceLabel, '学在浙大');
  assert.equal(rows[0].title, '示例作业');
  assert.equal(rows[0].detail, '示例课程');
  assert.equal(rows[0].due, '2026-10-20T15:59:00+08:00', '截止时间必须原样保留');
  assert.equal(rows[0].kind, 'todo');
});

test('学在浙大待办：缺字段不抛错，标题为空时给占位', () => {
  assert.deepEqual(normalizeXzzdTodos(null), []);
  assert.deepEqual(normalizeXzzdTodos({ todos: [] }), []);
  const rows = normalizeXzzdTodos({ todos: [{ id: 1 }] });
  assert.equal(rows[0].title, '未命名待办');
  assert.equal(rows[0].detail, '');
  assert.equal(rows[0].due, null);
});

test('拼题A 题集归一化：来源与动作都如实说明', () => {
  const rows = normalizePtaSets({
    problem_sets: [{
      id: '1234',
      name: '示例题集',
      ends_at: { iso: '2026-10-21T23:59:00+08:00', text: '10月21日 23:59' },
      ended: false,
      url: 'https://pintia.cn/problem-sets/1234/exam/overview',
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'pta');
  assert.equal(rows[0].sourceLabel, '拼题A');
  assert.equal(rows[0].kind, 'problemSet', '题集不是作业，类别要区分开');
  assert.equal(rows[0].detail, '未结束');
  assert.equal(rows[0].due, '2026-10-21T23:59:00+08:00');
});

test('拼题A 题集：空输入与缺字段都安全', () => {
  assert.deepEqual(normalizePtaSets(undefined), []);
  assert.deepEqual(normalizePtaSets({ problem_sets: null }), []);
  const rows = normalizePtaSets({ problem_sets: [{ id: 7, ended: true }] });
  assert.equal(rows[0].title, '未命名题集');
  assert.equal(rows[0].detail, '已结束');
});

test('紧迫度按"还剩多久"分档，不是按哪天真', () => {
  const now = Date.parse('2026-10-18T12:00:00+08:00');
  const at = (iso) => urgencyOf(iso, now);
  assert.equal(at(null), URGENCY.none);
  assert.equal(at('not-a-date'), URGENCY.none);
  assert.equal(at('2026-10-17T12:00:00+08:00'), URGENCY.overdue);
  assert.equal(at('2026-10-18T20:00:00+08:00'), URGENCY.today);
  assert.equal(at('2026-10-21T12:00:00+08:00'), URGENCY.week);
  assert.equal(at('2026-11-30T12:00:00+08:00'), URGENCY.later);
});

/* ───────────────────────────────────────────────────────── 客户端契约 */

test('路由与写头两端一致（漂移会表现为"保存没反应"）', async () => {
  const client = await readFile(
    new URL('../packages/dsh-zhiyun-page-planning/src/client.jsx', import.meta.url), 'utf8',
  );
  assert.ok(ROUTE_PATH.startsWith('/_dsh/'));
  assert.ok(client.includes(`'${ROUTE_PATH}'`), '客户端必须打同一个路由');
  assert.ok(client.includes(`'${WRITE_HEADER}'`), '客户端必须带同一个写头');
});

test('客户端不得把读密钥或 Cookie 写进任何持久化位置', async () => {
  const client = await readFile(
    new URL('../packages/dsh-zhiyun-page-planning/src/client.jsx', import.meta.url), 'utf8',
  );
  for (const sink of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    assert.equal(client.includes(sink), false, `客户端不该用 ${sink} 存凭证`);
  }
});

test('拼题A 必须有独立配置项（它与智云用的不是同一套凭证）', async () => {
  const client = await readFile(
    new URL('../packages/dsh-zhiyun-page-planning/src/client.jsx', import.meta.url), 'utf8',
  );
  assert.match(client, /拼题A Cookie/, '拼题A 必须有独立配置项');
  // 学在浙大复用智云账号，本页不该再出现账号密码输入
  assert.equal(/name="username"/.test(client), false, '本页不该重复录入浙大账号');
  assert.equal(/name="password"/.test(client), false, '本页不该重复录入浙大密码');
});
