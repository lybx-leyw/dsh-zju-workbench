/**
 * 队列管道的**收场契约**测试。
 *
 * 审查报告第 6 条：消费者抛错后，若它是唯一消费者，就再没人取货；
 * 生产者填满队列后在等空位 → 永不返回 → `parse()` 挂死，
 * 且那个已 reject 的消费者 promise 没人 await → `unhandledRejection`。
 *
 * 这里用**超时**证明"不挂死"：挂死的话测试会超时失败。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline, SharedQueue } from '../packages/dsh-zhiyun-core-parser/src/pipeline.js';

test('【缺陷 6】唯一消费者抛错时，流水线必须收场而不是永久等待', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  const boom = new Error('消费者炸了');
  const started = Date.now();

  let error = null;
  try {
    await runPipeline({
      workers: 1,
      capacity: 1,                       // 极小容量：生产者很快就会等空位
      produce: async (queue) => {
        /* 疯狂生产，远超容量 —— 旧实现会卡在 push() 上。 */
        for (let i = 0; i < 200; i += 1) await queue.push({ i });
        queue.close();
      },
      consume: async () => { throw boom; },
    });
  } catch (e) {
    error = e;
  }

  const elapsed = Date.now() - started;
  /* 让事件循环转一圈，给 unhandledRejection 一个机会冒出来。 */
  await new Promise((r) => setTimeout(r, 60));
  process.off('unhandledRejection', onUnhandled);

  assert.ok(elapsed < 3000, `必须很快收场，实际耗时 ${elapsed}ms（挂死了）`);
  assert.ok(error, '必须把真实错误抛出来，而不是静默结束');
  assert.equal(error.message, '消费者炸了', `抛出的应当是消费端的原始错误，实际：${error.message}`);
  assert.equal(unhandled.length, 0, `不允许有 unhandledRejection，实际 ${unhandled.length} 个`);
});

test('【缺陷 6】多个消费者时，一个炸了不影响收场', async () => {
  const boom = new Error('第二个消费者炸了');
  let calls = 0;
  let error = null;

  try {
    await runPipeline({
      workers: 3,
      capacity: 2,
      produce: async (queue) => {
        for (let i = 0; i < 50; i += 1) await queue.push({ i });
        queue.close();
      },
      consume: async () => {
        calls += 1;
        if (calls === 2) throw boom;
      },
    });
  } catch (e) {
    error = e;
  }

  assert.ok(error, '错误必须传出来');
  assert.equal(error.message, '第二个消费者炸了');
});

test('【缺陷 6】生产者抛错时，消费者不得一直等下去', async () => {
  const boom = new Error('生产者炸了');
  let error = null;
  const started = Date.now();

  try {
    await runPipeline({
      workers: 2,
      capacity: 4,
      produce: async (queue) => {
        await queue.push({ i: 1 });
        throw boom;
      },
      consume: async () => { /* 慢消费者 */ await new Promise((r) => setTimeout(r, 20)); },
    });
  } catch (e) {
    error = e;
  }

  assert.ok(Date.now() - started < 2000, '必须很快收场');
  assert.equal(error?.message, '生产者炸了');
});

test('【缺陷 6】正常路径不受影响：全部消费完、无错误', async () => {
  const seen = [];
  const { consumed } = await runPipeline({
    workers: 2,
    capacity: 4,
    produce: async (queue) => {
      for (let i = 0; i < 20; i += 1) await queue.push({ i });
      queue.close();
    },
    consume: async (item) => { seen.push(item.i); },
  });
  assert.equal(consumed, 20);
  assert.equal(seen.length, 20);
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));
});

test('SharedQueue.abort(reason) 会让等待者抛，而不是静默返回 null', async () => {
  const queue = new SharedQueue({ capacity: 1 });
  const boom = new Error('作废原因');
  const taker = queue.take();
  queue.abort(boom);
  await assert.rejects(taker, /作废原因/);
});
