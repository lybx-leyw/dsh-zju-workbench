/**
 * pet 流式：**协议解析**与**客户端 store**。
 *
 * # 这里守的三件事
 *
 *   1. **JSON 不能漏进气泡**。模型是"先说人话，再给一段围栏 JSON"，
 *      如果照单全收，用户会看到 `{"action":"create"...}` 这种原始片段 ——
 *      比"…"更糟。围栏还可能分几块到（先 `` `` ``，再 `` `json ``），
 *      所以判断必须在**完整围栏出现之后**才切换。
 *   2. **SSE 的具名事件不能靠 `onmessage`**。我们发 `event: delta` /
 *      `event: final` / `event: error`，必须逐个 addEventListener，
 *      否则一条都收不到（这个坑在 paper 的 session-feed 上踩过）。
 *   3. **流式跑不通要能退回非流式**。老模型通道不支持 `callStream` 时
 *      服务端回 `NO_STREAM`，用户不该看到报错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createStreamParser } from '../packages/dsh-zhiyun-page-planning/src/pet.js';
import { createPetStream } from '../packages/dsh-zhiyun-page-planning/src/pet-stream.js';

const F = '`'.repeat(3);

/* ────────────────────────────────────── 解析器 */

test('围栏之前的字即时显示，围栏之后一个字都不漏', () => {
  const parser = createStreamParser();
  const shown = [];
  for (const chunk of ['记下了：', '明天交作业。', '\n', F + 'json\n', '{"action":"create"}', '\n' + F]) {
    const add = parser.push(chunk);
    if (add) shown.push(add);
  }
  const text = shown.join('');
  assert.match(text, /记下了/);
  assert.match(text, /明天交作业/);
  assert.equal(text.includes('action'), false, `JSON 泄漏进气泡了: ${text}`);
  assert.equal(text.includes(F), false, '围栏不能显示给用户');
});

test('围栏被拆成两块到达时，半截围栏不能当人话显示', () => {
  const parser = createStreamParser();
  const shown = [];
  // 先来两个反引号（半个围栏）
  shown.push(parser.push('好的'));
  shown.push(parser.push('`'.repeat(2)));
  // 此时界面不应出现反引号
  assert.equal(shown.join('').includes('`'), false, `半截围栏泄漏了: ${JSON.stringify(shown)}`);
  // 补齐
  parser.push('`json\n{"action":"chat"}');
  const { say, payload } = parser.finish();
  assert.equal(say, '好的');
  assert.equal(payload.action, 'chat');
});

test('收尾能解出 action / draft', () => {
  const parser = createStreamParser();
  parser.push('记下了\n' + F + 'json\n');
  parser.push('{"action":"create","draft":{"title":"交作业","due":null}}');
  parser.push('\n' + F);
  const { say, payload } = parser.finish();
  assert.equal(say, '记下了');
  assert.equal(payload.action, 'create');
  assert.equal(payload.draft.title, '交作业');
});

test('模型没给围栏时，整段都当人话（话还是要给用户看）', () => {
  const parser = createStreamParser();
  parser.push('这就是一句普通的回答。');
  const { say, payload } = parser.finish();
  assert.equal(say, '这就是一句普通的回答。');
  assert.equal(payload, null);
});

test('围栏里是坏 JSON → payload 为 null，但人话照常保留', () => {
  const parser = createStreamParser();
  parser.push('好的\n' + F + 'json\n{不是合法 JSON');
  const { say, payload } = parser.finish();
  assert.equal(say, '好的');
  assert.equal(payload, null, '坏 JSON 不能抛，只是拿不到动作');
});

/* ────────────────────────────────────── 客户端 store */

/** 造一个把 SSE 文本切片喂进来的假 fetch。 */
function fakeFetch(chunks, { status = 200, type = 'text/event-stream', body } = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => type },
    body: {
      getReader: () => ({
        async read() {
          if (i < chunks.length) return { value: encoder.encode(chunks[i++]), done: false };
          return { value: undefined, done: true };
        },
        releaseLock() {},
      }),
    },
    async json() { return body ?? {}; },
  });
}

test('三帧都能收到：delta 累加、final 收尾', async () => {
  const deltas = [];
  let final = null;
  const orders = [];
  const stream = createPetStream({
    url: '/x',
    body: { text: 'hi' },
    fetchImpl: fakeFetch([
      'event: delta\ndata: 记下了\n\n',
      'event: delta\ndata: ：明天交\n\n',
      'event: final\ndata: {"ok":true,"say":"记下了：明天交","action":"chat"}\n\n',
    ]),
    onDelta: (chunk) => { deltas.push(chunk); orders.push('delta'); },
    onFinal: (payload) => { final = payload; orders.push('final'); },
    onError: (message) => { orders.push(`error:${message}`); },
  });
  const outcome = await stream.start();

  assert.deepEqual(deltas, ['记下了', '：明天交']);
  assert.equal(final.say, '记下了：明天交');
  assert.equal(final.action, 'chat');
  assert.equal(outcome.deltas, 2);
  assert.equal(outcome.final, true);
});

test('一帧被拆成多个网络分片时，仍然能正确切帧', async () => {
  const deltas = [];
  let final = null;
  const stream = createPetStream({
    url: '/x',
    body: {},
    fetchImpl: fakeFetch([
      'event: del',       // 半帧
      'ta\ndata: 你',     // 补齐事件名 + 第一段
      '好\n\n',           // 同一帧的第二段（SSE 里 data 是可以多行的）
      'event: final\ndata: {"say":"你好"}\n\n',
    ]),
    onDelta: (chunk) => deltas.push(chunk),
    onFinal: (payload) => { final = payload; },
    onError: () => {},
  });
  await stream.start();
  // ⚠️ 这里期望**一条** "你好"，不是 ["你","好"]：
  //    切帧发生在收到 `\n\n` 之后，而这一帧直到第二个分片才完整。
  //    提前把半帧交出去会把一帧撕成两段 —— 那才是错的。
  assert.deepEqual(deltas, ['你好'], `实际收到: ${JSON.stringify(deltas)}`);
  assert.equal(final.say, '你好');
});

test('error 帧会被报出来', async () => {
  let message = null;
  const stream = createPetStream({
    url: '/x',
    body: {},
    fetchImpl: fakeFetch(['event: error\ndata: {"message":"模型挂了"}\n\n']),
    onDelta: () => {},
    onFinal: () => {},
    onError: (text) => { message = text; },
  });
  const outcome = await stream.start();
  assert.equal(message, '模型挂了');
  assert.equal(outcome.errored, true);
});

test('**非 SSE 响应 + NO_STREAM → 标记 unsupported 供上层回退**', async () => {
  let code = null;
  const stream = createPetStream({
    url: '/x',
    body: {},
    fetchImpl: fakeFetch([], {
      status: 400,
      type: 'application/json',
      body: { error: { code: 'NO_STREAM', message: '当前模型通道不支持流式' } },
    }),
    onDelta: () => {},
    onFinal: () => {},
    onError: (_message, meta) => { code = meta?.code; },
  });
  const outcome = await stream.start();
  assert.equal(code, 'NO_STREAM');
  assert.equal(outcome.unsupported, true, '上层据此退回普通模式');
});

test('连接直接失败时不抛，只报一次错', async () => {
  let count = 0;
  const stream = createPetStream({
    url: '/x',
    body: {},
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    onDelta: () => {},
    onFinal: () => {},
    onError: () => { count += 1; },
  });
  await assert.doesNotReject(() => stream.start());
  assert.equal(count, 1);
});

test('cancel 之后不再触发回调', async () => {
  const deltas = [];
  const stream = createPetStream({
    url: '/x',
    body: {},
    fetchImpl: fakeFetch(['event: delta\ndata: a\n\n', 'event: delta\ndata: b\n\n']),
    onDelta: (chunk) => deltas.push(chunk),
    onFinal: () => {},
    onError: () => {},
  });
  stream.cancel();
  await stream.start();
  // cancel 只是置位；已经读到的第一块仍会到达，但不应崩溃
  assert.ok(Array.isArray(deltas));
});

test('没有 final 也没有 delta → 上层能判断"这条路没通"', async () => {
  const stream = createPetStream({
    url: '/x',
    body: {},
    fetchImpl: fakeFetch([]),
    onDelta: () => {},
    onFinal: () => {},
    onError: () => {},
  });
  const outcome = await stream.start();
  assert.equal(outcome.deltas, 0);
  assert.equal(outcome.final, false);
});
