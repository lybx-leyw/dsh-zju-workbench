/**
 * 「论文阅读」兼容层的测试。
 *
 * 覆盖的是**在没有浏览器、没有宿主、不连网**的前提下能钉死的那部分契约：
 *
 *   - 锁版：`upstream.js` 的预期版本、`package.json` 的声明、磁盘上真正装到的
 *     版本，三者必须一致（`^` 一次都不许出现）；
 *   - 选中翻译：缓存 / 在飞合并 / 截断 / 错误归一化 —— 这几条错了在浏览器里
 *     表现为「偶尔不翻」「翻出来是旧的」「一句话再也翻不出来」，手测不出来；
 *   - 自有路由：401/403 挡下来源、404/405、请求体畸形、拿不到模型时的 503；
 *   - 会话流：`snapshot`/`event`/`assistant-stream` 三路帧怎么变成气泡，
 *     以及 SSE 的具名 `meta` 帧与断开如何驱动 store；
 *   - 悬停判定的纯逻辑与 iframe 主题注入的产物。
 *
 * 写不下去的部分（真的拖动鼠标、真的 pdf.js 渲染）留给 `npm run test:host`。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PaperError, PAPER_ERROR_STATUS, paperErrorStatus } from '../packages/dsh-zhiyun-paper/src/errors.js';
import { createSelectionTranslator, SELECTION_MAX_CHARS } from '../packages/dsh-zhiyun-paper/src/selection.js';
import { createPaperHandler, PAPER_ROUTE_PREFIX } from '../packages/dsh-zhiyun-paper/src/routes.js';
import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from '../packages/dsh-zhiyun-paper/src/upstream.js';

import {
  applyFrame,
  messagesFromRecords,
  hasLiveAttempt,
  EMPTY_FEED,
} from '../packages/dsh-zhiyun-page-paper/src/transcript.js';
import {
  MIN_SELECTION_CHARS,
  normalizeSelectionText,
  isTranslatableSelection,
  intersectsRects,
  unionRect,
  createDwell,
} from '../packages/dsh-zhiyun-page-paper/src/selection-text.js';
import { createSessionFeed } from '../packages/dsh-zhiyun-page-paper/src/session-feed.js';
import { frameThemeCss, readThemeTokens } from '../packages/dsh-zhiyun-page-paper/src/frame-theme.js';
import * as clientApi from '../packages/dsh-zhiyun-page-paper/src/library.js';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const here = path.dirname(fileURLToPath(import.meta.url));

const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));

/* ────────────────────────── 锁版 ────────────────────────── */

test('锁版：声明、预期、实际安装三者一致，且不允许语义化范围', () => {
  const manifest = readJson('packages/dsh-zhiyun-paper/package.json');
  const declared = manifest.dependencies?.[UPSTREAM_PACKAGE];

  assert.equal(declared, UPSTREAM_VERSION, 'package.json 必须写精确版本，不是 ^ 或 ~ 范围');
  assert.match(declared, /^\d+\.\d+\.\d+$/, '依赖版本必须锁定为精确版本');

  // 真正装到的是哪一份，只有运行时才知道（lockfile、全局覆盖、npm link 都能改它）。
  // 从插件自己的位置解析：该包只装在 `packages/dsh-zhiyun-paper/node_modules` 下。
  const require = createRequire(new URL('../packages/dsh-zhiyun-paper/package.json', import.meta.url));
  const installedFile = require.resolve(`${UPSTREAM_PACKAGE}/package.json`);
  assert.equal(JSON.parse(readFileSync(installedFile, 'utf8')).version, UPSTREAM_VERSION);
  // 必须来自本插件自己的 node_modules，而不是仓库根或别处的同名包（npm link 会骗过版本）。
  const normalized = installedFile.split(path.sep).join('/');
  assert.ok(
    normalized.includes(`/packages/dsh-zhiyun-paper/node_modules/${UPSTREAM_PACKAGE}/`),
    `上游包应解析到本插件自己的 node_modules，实际解析到 ${installedFile}`,
  );
});

test('锁版：pdfjs-dist 也写精确版本（上游按深路径 import 它）', () => {
  const manifest = readJson('packages/dsh-zhiyun-paper/package.json');
  assert.match(manifest.dependencies['pdfjs-dist'], /^\d+\.\d+\.\d+$/, '深路径 import 的依赖同样不能浮动');
});

/* ────────────────────────── 错误类型 ────────────────────────── */

test('PaperError 带 code 与附加字段，未登记的 code 回退 500', () => {
  const error = new PaperError('INPUT', '请求体不是合法 JSON', { status: 400, cause: 'x' });
  assert.equal(error.name, 'PaperError');
  assert.ok(error instanceof Error);
  assert.equal(error.code, 'INPUT');
  assert.equal(error.status, 400);
  assert.equal(error.cause, 'x');

  assert.equal(paperErrorStatus('INPUT'), 400);
  assert.equal(paperErrorStatus('NO_LLM'), 503);
  assert.equal(paperErrorStatus('LLM_FAILED'), 502);
  assert.equal(paperErrorStatus('绝不存在的 code'), 500, '宁可少说，不要谎报 400');
  assert.equal(PAPER_ERROR_STATUS.CANCELLED, 499);
});

/* ────────────────────────── 选中翻译 ────────────────────────── */

const routeLlm = (text = '译文') => ({
  resolve: async () => ({ text: { provider: 'p', model: 'm1' } }),
  call: async () => ({ text }),
});

test('没有窄 llm 接口时构造即抛 CONFIG，且不拦插件激活', () => {
  assert.throws(() => createSelectionTranslator(), (err) => err instanceof PaperError && err.code === 'CONFIG');
  assert.throws(() => createSelectionTranslator({ llm: {} }), (err) => err.code === 'CONFIG');
});

test('选中翻译：空输入拒绝，命中缓存零调用并区分 cached', async () => {
  let calls = 0;
  const llm = { resolve: async () => ({ text: { model: 'm1' } }), call: async () => { calls += 1; return { text: '  中文  ' }; } };
  const translator = createSelectionTranslator({ llm });

  await assert.rejects(() => translator.translate('   '), (err) => err.code === 'INPUT');
  await assert.rejects(() => translator.translate(undefined), (err) => err.code === 'INPUT');

  const first = await translator.translate('  attention  ');
  assert.deepEqual(first, { translation: '中文', model: 'm1', cached: false, truncated: false });

  const second = await translator.translate('attention');
  assert.equal(second.cached, true);
  assert.equal(calls, 1, '同一段文本第二次悬停不该再花钱');
  assert.equal(translator.stats.hits, 1);
  assert.equal(translator.stats.misses, 1);
});

test('选中翻译：同 key 的在飞请求合并成一个 Promise', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const llm = {
    resolve: async () => ({ text: { model: 'm1' } }),
    call: async () => { calls += 1; await gate; return { text: 'T' }; },
  };
  const translator = createSelectionTranslator({ llm });

  const first = translator.translate('hello world');
  const second = translator.translate('hello world');
  await new Promise((resolve) => setTimeout(resolve, 0)); // 两个调用都走到「要发请求」那一步
  assert.equal(translator.stats.inflight, 1, '同 key 只该有一条在飞的调用');
  assert.equal(translator.size, 0, '还没出结果就谈不上缓存命中');
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(a.translation, 'T');
  assert.equal(b.translation, 'T');
  assert.equal(translator.stats.joined, 1);
  assert.equal(translator.stats.inflight, 0, '结算后必须从在飞表里摘掉');
  assert.equal(translator.size, 1, '成功的请求进缓存，下一步悬停零延迟');
  assert.equal(translator.stats.misses, 1, '合并进来的那次不算一次未命中');
});

test('选中翻译：失败的在飞请求必须从表里摘掉，否则那句子再也翻不出来', async () => {
  let calls = 0;
  const llm = { call: async () => { calls += 1; throw Object.assign(new Error('超时'), { code: 'TIMEOUT' }); } };
  const translator = createSelectionTranslator({ llm });

  await assert.rejects(() => translator.translate('同一句话'), (err) => err.code === 'TIMEOUT');
  await assert.rejects(() => translator.translate('同一句话'), (err) => err.code === 'TIMEOUT');
  assert.equal(calls, 2, '第二次必须真的再试一次，而不是复用那个已 reject 的 Promise');
  assert.equal(translator.stats.size, 0, '失败的请求不进缓存');
});

test('选中翻译：超长截断并如实标记，缓存按条数限流（LRU）', async () => {
  const seen = [];
  const llm = {
    resolve: async () => ({ text: { model: 'm1' } }),
    call: async ({ variable }) => { seen.push(variable); return { text: `T:${variable}` }; },
  };
  const translator = createSelectionTranslator({ llm, maxChars: 5 });

  const long = await translator.translate('abcdefghij');
  assert.equal(long.truncated, true);
  assert.equal(seen[0], 'abcde', '送进模型的是截断后的文本');
  assert.equal(translator.stats.truncated, 1);

  const lru = createSelectionTranslator({ llm, cacheLimit: 2 });
  await lru.translate('a');
  await lru.translate('b');
  await lru.translate('c');
  assert.equal(lru.size, 2, '无界缓存就是长时间阅读里的内存泄漏');
  const hit = await lru.translate('c');
  assert.equal(hit.cached, true);
  assert.equal(lru.stats.hits, 1);

  assert.equal(SELECTION_MAX_CHARS, 1200);
});

test('选中翻译：把上游错误码归一成本包错误码（页面只认一套）', async () => {
  const cases = [
    ['TIMEOUT', 'TIMEOUT'],
    ['EMPTY_RESPONSE', 'EMPTY'],
    ['CONFIG', 'CONFIG'],
    ['VISION_MODEL', 'CONFIG'],
    ['TRUNCATED', 'LLM_FAILED'],
    ['PROTOCOL', 'LLM_FAILED'],
  ];
  for (const [upstreamCode, expected] of cases) {
    const llm = { call: async () => { throw Object.assign(new Error('x'), { code: upstreamCode }); } };
    const translator = createSelectionTranslator({ llm });
    await assert.rejects(
      () => translator.translate('hello'),
      (err) => err instanceof PaperError && err.code === expected,
      `${upstreamCode} 应归一为 ${expected}`,
    );
  }

  const plain = createSelectionTranslator({ llm: { call: async () => { throw new Error('网络断了'); } } });
  await assert.rejects(() => plain.translate('hello'), (err) => err.code === 'LLM_FAILED');

  const empty = createSelectionTranslator({ llm: { call: async () => ({ text: '   ' }) } });
  await assert.rejects(() => empty.translate('hello'), (err) => err.code === 'EMPTY');

  const controller = new AbortController();
  controller.abort();
  const cancelled = createSelectionTranslator({ llm: { call: async () => { throw new Error('中断'); } } });
  await assert.rejects(
    () => cancelled.translate('hello', { signal: controller.signal }),
    (err) => err.code === 'CANCELLED',
  );
});

test('选中翻译：路由延迟解析，模型没配好时插件仍能激活', async () => {
  let resolves = 0;
  const llm = {
    resolve: async () => { resolves += 1; return { text: { model: 'lazy' } }; },
    call: async () => ({ text: 'ok' }),
  };
  const translator = createSelectionTranslator({ llm });

  assert.equal(resolves, 0, '构造时不该碰模型目录');
  await translator.translate('a');
  await translator.translate('b');
  assert.equal(resolves, 1, '解析一次就记住，不必每次悬停都问一次');

  // 没有 resolve 的窄接口（或它返回空）也不该抛：route 为 undefined 照样能翻。
  const bare = createSelectionTranslator({ llm: { call: async () => ({ text: 'ok' }) } });
  const result = await bare.translate('a');
  assert.equal(result.translation, 'ok');
  assert.equal(result.model, null);

  const routeLess = await createSelectionTranslator({ llm: { resolve: async () => null, call: async () => ({ text: 'ok' }) } })
    .translate('a');
  assert.equal(routeLess.model, null);
});

test('清除函数只清缓存，不影响在飞表与统计口径', async () => {
  const translator = createSelectionTranslator({ llm: routeLlm() });
  await translator.translate('a');
  assert.equal(translator.size, 1);
  translator.clear();
  assert.equal(translator.size, 0);
  assert.equal(translator.stats.inflight, 0);
});

/* ────────────────────────── 自有路由 ────────────────────────── */

function createResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(body) { if (body !== undefined) this.body = String(body); },
  };
}

function createRequest({ method = 'GET', url = '/', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(body)];
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
  };
}

/** handler 是「立即返回 + 异步 dispatch」，所以等到响应头落地再看结果。 */
async function settle(res) {
  for (let i = 0; i < 100 && !res.headersSent; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(res.headersSent, 'handler 一直没有写出响应');
  return { status: res.status, headers: res.headers, json: JSON.parse(res.body) };
}

const okTranslator = () => ({
  translate: async (text) => ({ translation: `zh:${text}`, model: 'm1', cached: false, truncated: false }),
});

test('自有路由：来源校验交给宿主 connection，401/403 直接挡掉', async () => {
  for (const [rejection, expected] of [[401, 'unauthorized'], [403, 'forbidden']]) {
    const handler = createPaperHandler({
      connection: { requestRejection: () => rejection },
      getTranslator: okTranslator,
      describe: () => ({ ok: true }),
    });
    const res = createResponse();
    handler(createRequest({ url: `${PAPER_ROUTE_PREFIX}/api/status` }), res);
    const seen = await settle(res);
    assert.equal(seen.status, rejection);
    assert.deepEqual(seen.json, { error: expected });
  }

  // 没有 connection 服务（headless）时不该把自己挡死。
  const handler = createPaperHandler({ getTranslator: okTranslator, describe: () => ({ ok: true }) });
  const res = createResponse();
  handler(createRequest({ url: `${PAPER_ROUTE_PREFIX}/api/status` }), res);
  assert.equal((await settle(res)).status, 200);
});

test('自有路由：/api/status 返回挂载与版本核对结果', async () => {
  const describe = () => ({
    prefix: PAPER_ROUTE_PREFIX,
    upstream: { package: UPSTREAM_PACKAGE, expected: UPSTREAM_VERSION, installed: UPSTREAM_VERSION, mounted: true, error: null },
    translate: { available: true, stats: null },
  });
  const handler = createPaperHandler({ getTranslator: okTranslator, describe });
  const res = createResponse();
  handler(createRequest({ url: `${PAPER_ROUTE_PREFIX}/api/status` }), res);
  const seen = await settle(res);
  assert.equal(seen.status, 200);
  assert.equal(seen.json.upstream.installed, UPSTREAM_VERSION);
  assert.match(seen.headers['content-type'], /application\/json/);
  assert.equal(seen.headers['cache-control'], 'no-store');
});

test('自有路由：选中翻译走窄接口并原样回传结果', async () => {
  const calls = [];
  const handler = createPaperHandler({
    getTranslator: () => ({
      translate: async (text) => { calls.push(text); return { translation: '注意力', model: 'm1', cached: false, truncated: false }; },
    }),
    describe: () => ({}),
  });
  const res = createResponse();
  handler(createRequest({
    method: 'POST',
    url: `${PAPER_ROUTE_PREFIX}/api/translate`,
    body: JSON.stringify({ text: 'attention' }),
  }), res);
  const seen = await settle(res);
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.json, { translation: '注意力', model: 'm1', cached: false, truncated: false });
  assert.deepEqual(calls, ['attention']);
});

test('自有路由：拿不到模型时 503 + NO_LLM（提示去个人面板配）', async () => {
  const handler = createPaperHandler({ getTranslator: () => null, describe: () => ({}) });
  const res = createResponse();
  handler(createRequest({ method: 'POST', url: `${PAPER_ROUTE_PREFIX}/api/translate`, body: JSON.stringify({ text: 'x' }) }), res);
  const seen = await settle(res);
  assert.equal(seen.status, 503);
  assert.equal(seen.json.code, 'NO_LLM');
  assert.match(seen.json.error, /AI 服务/);
});

test('自有路由：畸形请求体与超限都是 400 INPUT', async () => {
  const handler = createPaperHandler({ getTranslator: okTranslator, describe: () => ({}) });

  const bad = createResponse();
  handler(createRequest({ method: 'POST', url: `${PAPER_ROUTE_PREFIX}/api/translate`, body: 'not json' }), bad);
  const badSeen = await settle(bad);
  assert.equal(badSeen.status, 400);
  assert.equal(badSeen.json.code, 'INPUT');

  const huge = createResponse();
  handler(createRequest({
    method: 'POST',
    url: `${PAPER_ROUTE_PREFIX}/api/translate`,
    body: JSON.stringify({ text: 'x'.repeat(70 * 1024) }),
  }), huge);
  const hugeSeen = await settle(huge);
  assert.equal(hugeSeen.status, 400);
  assert.equal(hugeSeen.json.code, 'INPUT');
});

test('自有路由：404 / 405，且方法不允许时给出 allow 头', async () => {
  const handler = createPaperHandler({ getTranslator: okTranslator, describe: () => ({}) });

  const missing = createResponse();
  handler(createRequest({ url: `${PAPER_ROUTE_PREFIX}/api/nope` }), missing);
  const missingSeen = await settle(missing);
  assert.equal(missingSeen.status, 404);
  assert.equal(missingSeen.json.code, 'NOT_FOUND');

  const wrongMethod = createResponse();
  handler(createRequest({ method: 'GET', url: `${PAPER_ROUTE_PREFIX}/api/translate` }), wrongMethod);
  const wrongSeen = await settle(wrongMethod);
  assert.equal(wrongSeen.status, 405);
  assert.equal(wrongSeen.headers.allow, 'POST');
  assert.equal(wrongSeen.json.code, 'METHOD');

  const statusPost = createResponse();
  handler(createRequest({ method: 'POST', url: `${PAPER_ROUTE_PREFIX}/api/status` }), statusPost);
  assert.equal((await settle(statusPost)).status, 405);
});

test('自有路由：翻译链路上的 PaperError 按 code 映射状态码，未知异常收敛成 500', async () => {
  const cases = [
    [new PaperError('TIMEOUT', '模型超时'), 504],
    [new PaperError('CONFIG', '去配模型'), 503],
    [new PaperError('INPUT', '没有选中任何文字'), 400],
    [new Error('崩了'), 500],
  ];
  for (const [thrown, expected] of cases) {
    const handler = createPaperHandler({
      getTranslator: () => ({ translate: async () => { throw thrown; } }),
      describe: () => ({}),
    });
    const res = createResponse();
    handler(createRequest({ method: 'POST', url: `${PAPER_ROUTE_PREFIX}/api/translate`, body: JSON.stringify({ text: 'x' }) }), res);
    const seen = await settle(res);
    assert.equal(seen.status, expected, `${thrown.code ?? thrown.message} → ${expected}`);
    assert.ok(seen.json.code, '对外永远是 { error, code } 的形状');
  }
});

test('前缀常量：宿主路由与页面调用点必须逐字符一致', () => {
  assert.equal(PAPER_ROUTE_PREFIX, clientApi.PAPER_PREFIX);
  assert.equal(clientApi.UPSTREAM_PREFIX, '/paper-reader', '上游那条前缀不能改：改了上游 HTML 里的写死路径就对不上');
  assert.notEqual(PAPER_ROUTE_PREFIX, clientApi.UPSTREAM_PREFIX, '同 (kind,path) 重复注册会被 webserver 直接抛错');
});

/* ────────────────────────── 页面调用点 ────────────────────────── */

test('地址拼装：阅读器必须带 topic/name，否则会回落到上次打开的那篇', () => {
  assert.equal(clientApi.readerUrl('专题 A', '论文 B'), '/paper-reader/?topic=%E4%B8%93%E9%A2%98+A&name=%E8%AE%BA%E6%96%87+B');
  assert.equal(
    clientApi.readerUrl('t', 'n', { page: 3, q: 'attention is all' }),
    '/paper-reader/?topic=t&name=n&page=3&q=attention+is+all',
  );

  assert.equal(clientApi.followUrl('t', 'n'), '/paper-reader/api/session/follow?topic=t&name=n');
  assert.equal(clientApi.followUrl('t', 'n', 2), '/paper-reader/api/session/follow?topic=t&name=n&n=2');

  assert.equal(clientApi.pdfUrl('t', 'n'), '/paper-reader/api/pdf?topic=t&name=n');
  assert.equal(clientApi.pdfUrl('t', 'n', 'dual'), '/paper-reader/api/pdf?topic=t&name=n&variant=dual');
});

test('地址拼装：提问只在真的有选区时带 selectedText/page', async () => {
  const bodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    bodies.push({ url, body: options.body === undefined ? null : JSON.parse(options.body), headers: options.headers });
    return { ok: true, status: 200, json: async () => ({ ok: true, sessionId: 's', n: 1 }) };
  };
  try {
    await clientApi.ask({ topic: 't', name: 'n', question: '这是什么' });
    await clientApi.ask({ topic: 't', name: 'n', question: '这句呢', selectedText: 'attention', page: 4, n: 2, fresh: true });

    assert.deepEqual(bodies[0].body, { topic: 't', name: 'n', question: '这是什么' });
    assert.deepEqual(bodies[1].body, {
      topic: 't', name: 'n', question: '这句呢', selectedText: 'attention', page: 4, n: 2, fresh: true,
    });
    assert.ok(bodies.every((item) => item.url === '/paper-reader/api/ask'));
  } finally {
    globalThis.fetch = original;
  }
});

test('错误体：上游的 {error} 与 {reason} 统一成一个 Error 并带上 code/status', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: '文件被占用', code: 'BUSY' }) });
    await assert.rejects(() => clientApi.generateTranslation('t', 'n'), (err) => {
      assert.equal(err.message, '文件被占用');
      assert.equal(err.code, 'BUSY');
      assert.equal(err.status, 409);
      return true;
    });

    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ reason: '没有端点' }) });
    await assert.rejects(() => clientApi.generateTranslation('t', 'n'), (err) => err.message === '没有端点' && err.code === null);

    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => { throw new Error('不是 JSON'); } });
    await assert.rejects(() => clientApi.loadLibrary(), (err) => err.message === 'HTTP 500');
  } finally {
    globalThis.fetch = original;
  }
});

test('上传：中文专题与文件名走 x-dpr-* 头并 encodeURIComponent', async () => {
  let seen = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return { ok: true, status: 200, json: async () => ({ ok: true, name: '论文' }) };
  };
  try {
    await clientApi.uploadPaper({ topic: '专题', name: '论文.pdf', bytes: new Uint8Array([1, 2, 3]) });
    assert.equal(seen.url, '/paper-reader/api/library/upload');
    assert.equal(seen.options.headers['x-dpr-topic'], encodeURIComponent('专题'));
    assert.equal(seen.options.headers['x-dpr-name'], encodeURIComponent('论文.pdf'));
  } finally {
    globalThis.fetch = original;
  }
});

/* ────────────────────────── 会话流 → 气泡 ────────────────────────── */

const userRecord = (seq, id, text) => ({
  type: 'event',
  event: { type: 'user/message', seq, data: { id, role: 'user', content: [{ type: 'text', text }] } },
});

const assistantRecord = (seq, id, text, turn = 1) => ({
  type: 'event',
  event: {
    type: 'assistant/message',
    seq,
    data: { turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }] } },
  },
});

test('快照帧：消息整条内联在记录里，非文本块与空文本被丢掉', () => {
  const records = [
    userRecord(1, 'u1', '什么是注意力'),
    { type: 'event', event: { type: 'turn/start', seq: 2, data: { turn: 1 } } },
    { type: 'event', event: { type: 'assistant/message', seq: 3, data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'reasoning', text: '想一下' }] } } } },
    assistantRecord(4, 'a2', '注意力是一种加权'),
    { type: 'event', event: { type: 'user/message', seq: 5, data: { id: 'u2', role: 'user', content: [{ type: 'text', text: '   ' }] } } },
    { type: 'event', event: { type: 'user/message', seq: 6, data: { id: 'u3', role: 'user', content: [{ type: 'image', attachment: {} }, { type: 'text', text: '配图' }] } } },
  ];
  const messages = messagesFromRecords(records);

  assert.deepEqual(messages.map((message) => [message.role, message.text]), [
    ['user', '什么是注意力'],
    ['assistant', '注意力是一种加权'],
    ['user', '配图'],
  ]);
  assert.equal(messages[0].id, 'u1');
  assert.equal(messages[1].turn, 1, 'assistant 的 turn/step 用于和实时气泡对齐');

  // 没有 id 的消息用 seq 兜底，保证去重键永远存在。
  const anonymous = messagesFromRecords([
    { type: 'event', event: { type: 'user/message', seq: 9, data: { role: 'user', content: [{ type: 'text', text: '没有 id' }] } } },
  ]);
  assert.equal(anonymous[0].id, 'u:9');
});

test('快照帧：重复应用同一份历史不改状态（重连不能长出重复气泡）', () => {
  const first = applyFrame(EMPTY_FEED, { type: 'snapshot', records: [userRecord(1, 'u1', 'a'), assistantRecord(2, 'a1', 'b')] });
  assert.equal(first.messages.length, 2);
  assert.equal(first.live, null);

  const again = applyFrame(first, { type: 'snapshot', records: [userRecord(1, 'u1', 'a'), assistantRecord(2, 'a1', 'b')] });
  assert.equal(again, first, '没有变化时必须返回同一个引用，订阅者才不会被无意义地唤醒');

  const extra = applyFrame(first, { type: 'snapshot', records: [userRecord(1, 'u1', 'a'), userRecord(3, 'u2', 'c')] });
  assert.equal(extra.messages.length, 3);
});

test('事件帧：权威回答到达时收掉实时气泡，但不早于它自己那一轮', () => {
  const live = { attemptId: 'att1', turn: 2, step: 1, text: '半句话' };
  const feed = { messages: [], live };

  const settled = applyFrame(feed, {
    type: 'event',
    event: { type: 'assistant/message', seq: 5, data: { turn: 2, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '完整回答' }] } } },
  });
  assert.equal(settled.live, null, '同一条回答不能显示两遍');
  assert.equal(settled.messages[0].text, '完整回答');

  const earlier = applyFrame(feed, {
    type: 'event',
    event: { type: 'assistant/message', seq: 6, data: { turn: 1, step: 1, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '上一轮' }] } } },
  });
  assert.notEqual(earlier.live, null, '旧一轮到达不能收掉正在生成的新一轮');

  const user = applyFrame(feed, {
    type: 'event',
    event: { type: 'user/message', seq: 7, data: { id: 'u9', role: 'user', content: [{ type: 'text', text: '再问' }] } },
  });
  assert.notEqual(user.live, null, '用户消息不结算实时气泡');
});

test('实时帧：start/chunk/end 三态，断线重连（attemptId 变了）也要继续显示', () => {
  const start = { type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, startedAfterSeq: 0, turn: 3, step: 1 } };
  const feed = applyFrame(EMPTY_FEED, start);
  assert.deepEqual(feed.live, { attemptId: 'a1', turn: 3, step: 1, text: '' });
  assert.equal(hasLiveAttempt(feed), true);

  const delta = (attemptId, text) => ({
    type: 'assistant-stream',
    frame: { type: 'chunk', attemptId, revision: 1, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text } },
  });
  const grown = applyFrame(feed, delta('a1', '注'));
  const grown2 = applyFrame(grown, delta('a1', '意力'));
  assert.equal(grown2.live.text, '注意力');

  // 推理增量不是回答，别混进气泡。
  const reasoning = applyFrame(grown2, {
    type: 'assistant-stream',
    frame: { type: 'chunk', attemptId: 'a1', revision: 1, index: 1, time: 2, chunk: { type: 'reasoning-delta', index: 1, text: '让我想想' } },
  });
  assert.equal(reasoning.live.text, '注意力');

  // 断线重连后 attemptId 会换，此时不能把旧文本接在新尝试后面。
  const rebuilt = applyFrame(grown2, delta('a2', '从头来'));
  assert.equal(rebuilt.live.text, '从头来');
  assert.equal(rebuilt.live.attemptId, 'a2');

  // block-end 是权威文本，覆盖累积值而不是拼接。
  const blocked = applyFrame(grown2, {
    type: 'assistant-stream',
    frame: { type: 'chunk', attemptId: 'a1', revision: 1, index: 2, time: 3, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '注意力机制' } } },
  });
  assert.equal(blocked.live.text, '注意力机制');

  const committed = applyFrame(blocked, {
    type: 'assistant-stream',
    frame: { type: 'end', attemptId: 'a1', revision: 1, index: 3, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 8 } },
  });
  assert.equal(committed.live.text, '注意力机制', '提交后保留文本，等权威消息来替换，避免闪烁');

  const abandoned = applyFrame(blocked, {
    type: 'assistant-stream',
    frame: { type: 'end', attemptId: 'a1', revision: 1, index: 3, outcome: { kind: 'abandoned' } },
  });
  assert.equal(abandoned.live, null, '放弃的一轮不能挂着一句没说完的话');
  assert.equal(hasLiveAttempt(abandoned), false);
});

test('未知帧与畸形帧原样返回，不制造状态变化', () => {
  const feed = applyFrame(EMPTY_FEED, { type: 'snapshot', records: [userRecord(1, 'u1', 'a')] });
  for (const frame of [null, undefined, 42, 'x', {}, { type: 'assistant-stream' }, { type: 'assistant-stream', frame: {} }, { type: '莫名其妙' }]) {
    assert.equal(applyFrame(feed, frame), feed);
  }
});

/* ────────────────────────── SSE store ────────────────────────── */

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.closed = false;
    this.listeners = new Map();
    this.onmessage = null;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  close() { this.closed = true; }

  emit(type, data) {
    const event = { data };
    if (type === 'message' && this.onmessage) this.onmessage(event);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const makeFeed = () => {
  FakeEventSource.instances = [];
  return createSessionFeed({ topic: 't', name: 'n', eventSourceFactory: (url) => new FakeEventSource(url) });
};

test('SSE store：getSnapshot 在状态没变时必须返回同一个对象', () => {
  // `useStore` 是 `useSyncExternalStore`：每次调用返回新对象 → React 认为状态一直在变，
  // 无限重渲染并抛 #185，崩掉整页（实测「选完文献页面变空白」就是这个原因）。
  const feed = makeFeed();

  const before = feed.getSnapshot();
  assert.equal(feed.getSnapshot(), before, '没有 emit 时快照必须逐次相同');

  feed.open(null);
  const afterOpen = feed.getSnapshot();
  assert.notEqual(afterOpen, before, '状态真的变了就要换新快照');
  assert.equal(feed.getSnapshot(), afterOpen);
  assert.equal(feed.getSnapshot(), afterOpen, '重复读仍然稳定');

  FakeEventSource.instances[0].emit('message', JSON.stringify({ type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '你好' }] } } }));
  const afterFrame = feed.getSnapshot();
  assert.notEqual(afterFrame, afterOpen, '新消息要换快照，否则气泡不会更新');
  assert.equal(afterFrame.messages.length, 1);
  assert.equal(feed.getSnapshot(), afterFrame);
});

test('SSE store：open 会换 URL，重复同一个 n 是幂等的', () => {
  const feed = makeFeed();

  feed.open(null);
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(FakeEventSource.instances[0].url, '/paper-reader/api/session/follow?topic=t&name=n');
  assert.equal(feed.getSnapshot().phase, 'connecting');

  feed.open(3);
  assert.equal(FakeEventSource.instances.length, 2, '换会话必须换 URL（n 在 query 上）');
  assert.equal(FakeEventSource.instances[1].url, '/paper-reader/api/session/follow?topic=t&name=n&n=3');
  assert.equal(FakeEventSource.instances[0].closed, true, '旧的连接必须关掉');

  feed.open(3);
  feed.open(3);
  assert.equal(FakeEventSource.instances.length, 2, '同一个 n 重复 open 不该反复断连');
  assert.equal(FakeEventSource.instances[1].closed, false);
});

test('SSE store：数据帧变成气泡，具名 meta 帧补上真实会话号', () => {
  const feed = makeFeed();
  const snapshots = [];
  feed.subscribe(() => snapshots.push(feed.getSnapshot()));

  feed.open(null);
  const source = FakeEventSource.instances[0];

  source.emit('meta', JSON.stringify({ n: 2, sessionId: 'dpr-abc-2' }));
  assert.equal(feed.getSnapshot().n, 2);
  assert.equal(feed.getSnapshot().sessionId, 'dpr-abc-2');
  assert.equal(feed.n, 2);

  source.emit('message', JSON.stringify({ type: 'event', event: userRecord(1, 'u1', '问题').event }));
  source.emit('message', JSON.stringify({ type: 'event', event: assistantRecord(2, 'a1', '回答').event }));

  const state = feed.getSnapshot();
  assert.equal(state.phase, 'open');
  assert.deepEqual(state.messages.map((message) => message.text), ['问题', '回答']);
  assert.ok(snapshots.length >= 3, '每次变化都通知订阅者');

  const before = snapshots.length;
  source.emit('message', JSON.stringify({ type: 'event', event: userRecord(1, 'u1', '问题').event }));
  assert.equal(snapshots.length, before, '重复消息不触发重渲染');
});

test('SSE store：坏 JSON 静默跳过，上游错误帧与断线区分开且都不清空消息', () => {
  const feed = makeFeed();
  feed.open(null);
  const source = FakeEventSource.instances[0];

  source.emit('message', '{"type":"event"');
  assert.equal(feed.getSnapshot().phase, 'connecting', '半个 JSON 不该让整个抽屉报错');

  source.emit('message', JSON.stringify({ type: 'event', event: userRecord(1, 'u1', '问题').event }));
  assert.equal(feed.getSnapshot().messages.length, 1);

  source.emit('error', JSON.stringify({ error: '上游炸了' }));
  assert.equal(feed.getSnapshot().phase, 'error');
  assert.equal(feed.getSnapshot().error, '上游炸了');
  assert.equal(feed.getSnapshot().messages.length, 1);

  source.emit('error');
  assert.match(feed.getSnapshot().error, /连接中断/);
  assert.equal(feed.getSnapshot().messages.length, 1, '断线不等于清空历史：浏览器会自己重连');
});

test('SSE store：EventSource 构造失败进 error，close 复位', () => {
  const feed = createSessionFeed({
    topic: 't',
    name: 'n',
    eventSourceFactory: () => { throw new Error('EventSource 不可用'); },
  });
  feed.open(null);
  assert.equal(feed.getSnapshot().phase, 'error');
  assert.equal(feed.getSnapshot().error, 'EventSource 不可用');

  const ok = makeFeed();
  ok.open(1);
  ok.close();
  assert.equal(FakeEventSource.instances[0].closed, true);
  assert.equal(ok.getSnapshot().phase, 'idle');
  assert.equal(ok.n, null);
});

test('SSE store：快照帧铺底后，实时帧接在后面', () => {
  const feed = makeFeed();
  feed.open(null);
  const source = FakeEventSource.instances[0];

  source.emit('message', JSON.stringify({ type: 'snapshot', records: [userRecord(1, 'u1', '历史问题'), assistantRecord(2, 'a1', '历史回答')] }));
  assert.equal(feed.getSnapshot().messages.length, 2);

  source.emit('message', JSON.stringify({
    type: 'assistant-stream',
    frame: { type: 'start', attemptId: 'x', revision: 1, startedAfterSeq: 2, turn: 2, step: 1 },
  }));
  source.emit('message', JSON.stringify({
    type: 'assistant-stream',
    frame: { type: 'chunk', attemptId: 'x', revision: 1, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text: '正在' } },
  }));

  const state = feed.getSnapshot();
  assert.equal(state.messages.length, 2);
  assert.equal(state.live.text, '正在');
});

/* ────────────────────────── 悬停判定 ────────────────────────── */

test('选区文本归一：去掉 PDF 换行留下的软连字符与断词连字符', () => {
  assert.equal(normalizeSelectionText('atten\u00adtion'), 'attention');
  assert.equal(normalizeSelectionText('trans-\nformer'), 'transformer');
  assert.equal(normalizeSelectionText('attention   is\n\tall'), 'attention is all');
  assert.equal(normalizeSelectionText(null), '');
  assert.equal(normalizeSelectionText(42), '');
});

test('该不该翻：像英文就翻，公式与中文不翻', () => {
  assert.equal(MIN_SELECTION_CHARS, 2);
  for (const yes of ['attention', 'of', 'a self-attention layer.', 'Fig. 3 shows that']) {
    assert.equal(isTranslatableSelection(yes), true, `${yes} 应该触发翻译`);
  }
  for (const no of ['中', '注意力机制', '1 + 2 = 3', 'E = mc^2', '', '   ', '（见 Fig. 3）', '[12]']) {
    assert.equal(isTranslatableSelection(no), false, `${no} 不该花钱`);
  }
});

test('光标判定与浮层定位：矩形求交与并集', () => {
  const rects = [{ left: 10, top: 20, right: 100, bottom: 40 }, { left: 10, top: 44, right: 60, bottom: 60 }];
  assert.equal(intersectsRects(rects, 50, 30), true);
  assert.equal(intersectsRects(rects, 5, 30), false);
  assert.equal(intersectsRects(rects, 50, 42), false, '两行之间的空隙不算压在选区上');
  assert.equal(intersectsRects([], 1, 1), false);
  assert.equal(intersectsRects(undefined, 1, 1), false);

  assert.deepEqual(unionRect(rects), { left: 10, top: 20, right: 100, bottom: 60, width: 90, height: 40 });
  assert.equal(unionRect([]), null);
});

test('悬停停顿：同 key 幂等、换 key 取消上一个、cancel 后不触发', async () => {
  const fired = [];
  const dwell = createDwell({ delay: 10, onFire: (key, payload) => fired.push([key, payload]) });

  dwell.arm('sel-1', { text: 'a' });
  assert.equal(dwell.pending, true);
  dwell.arm('sel-1', { text: 'b' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(fired, [['sel-1', { text: 'a' }]], '同一选区里移动鼠标不能重置计时器');
  assert.equal(dwell.pending, false);

  dwell.arm('sel-2', { text: 'c' });
  dwell.arm('sel-3', { text: 'd' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(fired.at(-1), ['sel-3', { text: 'd' }], '换选区必须取消上一个，否则会弹出前一段的译文');

  dwell.arm('sel-4', { text: 'e' });
  dwell.cancel();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(fired.length, 2);
  assert.equal(dwell.pending, false);
});

/* ────────────────────────── iframe 主题注入 ────────────────────────── */

test('主题注入：外层变量映射进 iframe，缺失时回落兜底色', () => {
  const fakeStyle = { getPropertyValue: (name) => ({ '--zy-bg': '#101010', '--zy-accent': '  ' }[name] ?? '') };
  const tokens = readThemeTokens(fakeStyle);
  assert.equal(tokens['--zp-frame-bg'], '#101010');
  assert.equal(tokens['--zp-frame-accent'], '#165dff', '空值回落兜底色，别让 iframe 变透明黑');
  assert.equal(tokens['--zp-frame-text'], '#1f2328');

  const fallback = readThemeTokens(undefined);
  assert.equal(Object.keys(fallback).length, 6);
  assert.equal(fallback['--zp-frame-surface'], '#f7f7f8');
});

test('主题注入：藏掉已经搬到本壳的上游控件', () => {
  const css = frameThemeCss();
  for (const selector of ['#ask-pop', '#cfg-open', '#cfg-pop', '#pdf-path', '#ver']) {
    assert.match(css, new RegExp(`${selector} \\{ display: none !important; \\}`), `${selector} 必须被藏掉`);
  }
  assert.match(css, /:root \{/);
  assert.match(css, /--zp-frame-bg: #ffffff;/);
  assert.match(css, /html, body \{ background: var\(--zp-frame-bg\); color: var\(--zp-frame-text\); \}/);
});

/* ────────────────────────── 接线 ────────────────────────── */

test('接线：两个新包都已进 profile 与构建清单', () => {
  const profile = readJson('profiles/zhiyun-bench/package.json');
  assert.ok(profile.dsh.profile.bundles.includes('dsh-zhiyun-paper'));
  assert.ok(profile.dsh.profile.bundles.includes('dsh-zhiyun-page-paper'));

  const build = readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8');
  assert.match(build, /'dsh-zhiyun-page-paper'/, '有 src/client.jsx 的包必须进 CLIENT_PACKAGES');

  const nav = readFileSync(path.join(root, 'packages/dsh-zhiyun-shell/src/model.js'), 'utf8');
  assert.match(nav, /id: 'paper'/);
  assert.match(nav, /icon: 'paper'/);

  const primitives = readFileSync(path.join(root, 'packages/dsh-zhiyun-ui-primitives/src/primitives.jsx'), 'utf8');
  assert.match(primitives, /paper:/);
  assert.match(primitives, /translate:/);
});

test('接线：页面包只注册自己的插槽，设置入口集中在 settings.section', () => {
  const source = readFileSync(path.join(here, '../packages/dsh-zhiyun-page-paper/src/client.jsx'), 'utf8');
  assert.match(source, /'zhiyun\.paper\.content'/, '内容插槽由外壳声明，页面只注册');
  assert.match(source, /'settings\.section'/);
  assert.match(source, /export const name = 'zhiyun-page-paper-client'/);
  assert.ok(!/sidebar\.workspaces/.test(source), '上游客户端会抢侧栏，我们不引入它');
  assert.ok(!/shell\.overlay/.test(source), 'overlay 归外壳，页面不该占');
});

test('接线：ReaderFrame 解构出来的每个 prop，Paper 都真的传了', () => {
  // 真踩过：ReaderFrame 里写 `translate` 当必需出口，Paper 却忘了传，
  // 于是悬停计时器照常触发、`sinkRef.current` 却是 undefined —— 浮层永远不出现，
  // 页面其余部分毫无异常，肉眼只能看到「悬停没反应」。
  const dir = '../packages/dsh-zhiyun-page-paper/src';
  const frame = readFileSync(path.join(here, `${dir}/ReaderFrame.jsx`), 'utf8');
  const paper = readFileSync(path.join(here, `${dir}/Paper.jsx`), 'utf8');

  const signature = frame.match(/export function ReaderFrame\(\{([^}]*)\}\)/);
  assert.ok(signature, 'ReaderFrame 的签名变了，这条守卫要跟着改');
  const props = signature[1].split(',').map((part) => part.trim().split(/[=:]/)[0].trim()).filter(Boolean);
  assert.ok(props.length >= 6, `ReaderFrame 应该还有若干必需 prop，实际解构出 ${props.join('、')}`);

  const usage = paper.match(/<ReaderFrame\b([\s\S]*?)\/>/);
  assert.ok(usage, 'Paper 应该渲染 ReaderFrame');
  for (const prop of props) {
    assert.match(usage[1], new RegExp(`\\b${prop}=`), `Paper 渲染 ReaderFrame 时漏传了 ${prop}`);
  }
});
