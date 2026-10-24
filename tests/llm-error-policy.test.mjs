/**
 * 重试策略与流看门狗的测试。
 *
 * 策略层的关键不是"会不会重试"，而是：
 *   ① 该重试的**真的**重试了（而且次数有界）
 *   ② 不该重试的**一次都不重试**（402/401/422 这类，重发是白花时间）
 *   ③ 429 时**并发被下调**（这是 DeepSeek 唯一有效的自救动作）
 *   ④ 流静默停滞**不会**被当成"读得慢"
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION, DEFAULT_POLICY, decide, withRetry, backoffDelay, throttleConcurrency,
  createStreamWatchdog, guardedStream,
} from '../packages/dsh-zhiyun-core-llm-error/src/index.js';

/** 立即返回的 sleep（测试不该真的等）。 */
const noSleep = async () => {};

test('① 429 → 不停止、给出退避时长、并**下调并发**', () => {
  const d = decide({ attempt: 1, status: 429, message: 'rate limit', concurrency: 8 });
  assert.equal(d.stop, false);
  assert.equal(d.action, ACTION.THROTTLE);
  assert.ok(d.delayMs > 0, '应当等一会儿');
  assert.equal(d.nextConcurrency, 4, '并发应当砍半（8 → 4）');
});

test('② 402 余额不足 → 立刻停，**不等待也不重试**', () => {
  const d = decide({ attempt: 1, status: 402, message: 'insufficient balance', concurrency: 8 });
  assert.equal(d.stop, true);
  assert.equal(d.action, ACTION.FIX);
  assert.equal(d.delayMs, 0, '不该白等');
  assert.equal(d.nextConcurrency, null, '也不该动并发');
});

test('③ 401 / 422 / 400 / 403 都是一次就停', () => {
  for (const [status, message] of [
    [401, 'invalid api key'],
    [422, 'invalid parameter'],
    [400, 'bad request body'],
    [403, 'region not available'],
  ]) {
    const d = decide({ attempt: 1, status, message, concurrency: 4 });
    assert.equal(d.stop, true, `${status} 不该重试`);
    assert.equal(d.delayMs, 0, `${status} 不该等`);
  }
});

test('④ 500/503 → 可重试，但**不动并发**（降并发帮不上服务端故障）', () => {
  for (const status of [500, 503]) {
    const d = decide({ attempt: 1, status, message: 'server error', concurrency: 8 });
    assert.equal(d.stop, false);
    assert.equal(d.action, ACTION.RETRY);
    assert.ok(d.delayMs > 0);
    assert.equal(d.nextConcurrency, null, `${status} 不该降并发`);
  }
});

test('⑤ 重试次数有上限（到顶就停，不会无限重试）', () => {
  const d = decide({ attempt: DEFAULT_POLICY.maxAttempts, status: 500, message: 'x', concurrency: 4 });
  assert.equal(d.stop, true);
  assert.match(d.reason, /上限/);
});

test('⑥ 并发砍到下限就停，不会砍成 0', () => {
  assert.equal(throttleConcurrency(1), 1);
  assert.equal(throttleConcurrency(2), 1);
  assert.equal(throttleConcurrency(16), 8);
  assert.ok(throttleConcurrency(1) >= DEFAULT_POLICY.minConcurrency);
});

test('⑦ backoff 指数增长但有封顶', () => {
  const a = backoffDelay(1, { ...DEFAULT_POLICY, jitter: 0 });
  const b = backoffDelay(3, { ...DEFAULT_POLICY, jitter: 0 });
  const capped = backoffDelay(50, { ...DEFAULT_POLICY, jitter: 0 });
  assert.ok(b > a, '后者应更长');
  assert.equal(capped, DEFAULT_POLICY.maxDelayMs, '应被封顶');
});

test('⑧ withRetry：可重试的错误真的重试，且成功即返回', async () => {
  let calls = 0;
  const result = await withRetry({
    sleep: noSleep,
    send: async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('server error'), { status: 500 });
      return 'ok';
    },
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('⑨ withRetry：不可重试的错误**只发一次**，并把分类挂在错误上', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry({
      sleep: noSleep,
      send: async () => { calls += 1; throw Object.assign(new Error('insufficient balance'), { status: 402 }); },
    }),
    (error) => {
      assert.equal(error.status, 402);
      assert.ok(error.llmError, '分类结论要挂在原错误上');
      assert.equal(error.llmError.action, ACTION.FIX);
      assert.equal(error.llmError.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1, '余额不足只该发一次');
});

test('⑩ withRetry：429 时下一次调用看到的是**调低后的并发**', async () => {
  const seen = [];
  let calls = 0;
  await assert.rejects(withRetry({
    sleep: noSleep,
    concurrency: 8,
    send: async ({ concurrency }) => {
      seen.push(concurrency);
      calls += 1;
      throw Object.assign(new Error('rate limit'), { status: 429 });
    },
  }));
  assert.equal(calls, DEFAULT_POLICY.maxAttempts, '用尽次数后才放弃');
  // 第一次 8，之后每次都应比上一次小（或已到下限）
  assert.equal(seen[0], 8);
  assert.ok(seen[1] < seen[0], `第二次并发应更低：${seen.join(' → ')}`);
  assert.ok(seen.every((c) => c >= DEFAULT_POLICY.minConcurrency));
});

test('⑪ 流静默停滞：空闲超时后立刻报 STREAM_STALLED，而不是等到请求总超时', async () => {
  const controller = new AbortController();
  /* ⚠️ 断言要**宽**：这里测的是"停滞会被发现"，不是"定时器有多准"。
   *
   * 早先写的是 idleMs: 40 且断言 `elapsed < 500`：CI 上 concurrent 跑几十个
   * 测试文件时，事件循环被抢占能让 40ms 的定时器拖到几百毫秒，于是这条
   * 偶发失败。定时器精度不是本包的契约。
   * 现在把阈值放大到 5 秒 —— 只要能证明"远小于请求总超时（300 秒）就炸了"，
   * 目的就达到了；`>= idleMs` 才是有意义的强断言。
   */
  const idleMs = 80;
  const dog = createStreamWatchdog({ idleMs, controller });
  const started = Date.now();
  await assert.rejects(dog.promise, (error) => {
    assert.equal(error.code, 'STREAM_STALLED');
    assert.ok(error.llmError, '要把分类一起带上');
    assert.equal(error.llmError.action, ACTION.CLIENT);
    return true;
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= idleMs - 5, `不该早于 idleMs 就炸，实际 ${elapsed}ms`);
  assert.ok(elapsed < 5000, `应当很快发现，而不是拖到请求总超时，实际 ${elapsed}ms`);
  assert.equal(controller.signal.aborted, true, '应当同时中止底层请求');
  dog.stop();
});

test('⑫ touch() 会重置空闲计时（持续有 chunk 就不会误判）', async () => {
  /* ⚠️ 时间参数要留足余量，否则这是个**抖动测试**。
   *
   * 早先写的是 idleMs: 60、每 30ms 摸一次：两次触摸之间只差 30ms，
   * 而定时器精度、GC、CI 上的调度延迟都可能超过 30ms —— 机器一慢就误判成停滞。
   * 现在把 idleMs 拉到 200、间隔压到 40：触摸间隔远小于阈值（5 倍余量），
   * 总时长又明显超过阈值（验证"确实重置了"而不是"根本没到时间"）。
   */
  const idleMs = 200;
  const gapMs = 40;
  const rounds = 8;                       // 8 × 40 = 320ms > idleMs，说明确实重置过
  const dog = createStreamWatchdog({ idleMs });
  let stalled = false;
  dog.promise.catch(() => { stalled = true; });
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((r) => setTimeout(r, gapMs));
    dog.touch();
  }
  assert.ok(rounds * gapMs > idleMs, '构造前提：总时长要超过 idleMs');
  assert.equal(stalled, false, '有数据流动时不该判定停滞');
  dog.stop();
});

test('⑬ guardedStream：正常流原样透传；停滞则抛 STREAM_STALLED', async () => {
  // 正常流
  async function* normal() { yield 1; yield 2; yield 3; }
  const got = [];
  for await (const chunk of guardedStream(normal(), { idleMs: 200 })) got.push(chunk);
  assert.deepEqual(got, [1, 2, 3]);

  // 卡住的流：yield 一个之后再也不返回
  async function* stuck() {
    yield 'first';
    await new Promise(() => {});   // 永不 resolve
  }
  const chunks = [];
  await assert.rejects(async () => {
    for await (const chunk of guardedStream(stuck(), { idleMs: 50 })) chunks.push(chunk);
  }, (error) => {
    assert.equal(error.code, 'STREAM_STALLED');
    return true;
  });
  assert.deepEqual(chunks, ['first'], '停滞前收到的数据不该丢');
});
