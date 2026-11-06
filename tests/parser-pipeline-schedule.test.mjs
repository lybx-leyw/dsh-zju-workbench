/**
 * 队列调度契约（审查报告第 7 条）。
 *
 * 图 `queue-pipeline.html` 规定：
 *   · **一条跨课程共享的 FIFO**，不是每门课各建一条；
 *   · 背压要算上**在飞预留**（`queue.length + reserved + batch <= cap`），
 *     只看队列长度会让峰值冲破上限；
 *   · 生产端**轮流喂课**，避免某一门被饿死；
 *   · 认领要**当场生效**，否则同一 tick 里多个 worker 会重复产出同一批页。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SharedQueue, PipelineScheduler } from '../packages/dsh-zhiyun-core-parser/src/pipeline.js';

test('【缺陷 7】背压把在飞预留算进去：只看队列长度会冲破上限', () => {
  const queue = new SharedQueue({ capacity: 10 });
  const sched = new PipelineScheduler({ queue, capacity: 10, batchSize: 4, workers: 2 });

  /* 队列为空，但已认领 8 页还没 push —— 此刻不该再认领。 */
  sched.reserve(8);
  assert.equal(sched.reserved, 8);
  assert.equal(sched.canVision(), false, '空队列 + 在飞 8 页 + 一批 4 页 > 上限 10，不该再产');

  /* 队列本身空着，旧判据 `queue.length < capacity` 会放行 → 峰值冲破。 */
  assert.equal(queue.length, 0);
});

test('【缺陷 7】认领是当场生效的：同时认领不会超发', () => {
  const queue = new SharedQueue({ capacity: 100 });
  const sched = new PipelineScheduler({ queue, capacity: 100, batchSize: 4, workers: 2 });
  /* 认领必须挂在某门课上（一次解析 = 一门课），否则无课可产。 */
  sched.addCourse('A', 100);

  const a = sched.claim(4);
  const b = sched.claim(4);
  assert.equal(a, 4, '第一次认领拿到 4 页');
  assert.equal(b, 4, '第二次也拿到 4 页（不同区间）');
  assert.equal(sched.reserved, 8);

  /* 交出后 reserved 应减。 */
  sched.settle(4);
  assert.equal(sched.reserved, 4);
});

test('【缺陷 7】轮流喂课：不会某一门被饿死', () => {
  const queue = new SharedQueue({ capacity: 1000 });
  const sched = new PipelineScheduler({ queue, capacity: 1000, batchSize: 1, workers: 4 });
  sched.addCourse('A', 10);
  sched.addCourse('B', 10);

  const picked = [];
  for (let i = 0; i < 8; i += 1) {
    const job = sched.nextVision();
    if (!job) break;
    picked.push(job.courseId);
    sched.settle(job.pages);
  }
  /* 8 次里 A、B 各自至少 3 次 —— 严格交替不该出现"前 8 次全是 A"。 */
  const countA = picked.filter((x) => x === 'A').length;
  const countB = picked.filter((x) => x === 'B').length;
  assert.ok(countA >= 3 && countB >= 3, `应当轮流喂，实际 A=${countA} B=${countB}（${picked.join('')}）`);
});

test('【缺陷 7】课程产完之后不再被选中', () => {
  const queue = new SharedQueue({ capacity: 1000 });
  const sched = new PipelineScheduler({ queue, capacity: 1000, batchSize: 4, workers: 1 });
  sched.addCourse('A', 4);
  const first = sched.nextVision();
  assert.equal(first.courseId, 'A');
  assert.equal(first.pages, 4);
  sched.settle(4);
  sched.markProduced('A', 4);
  assert.equal(sched.nextVision(), null, 'A 已产完，不该再被选中');
});

test('【缺陷 7】队列够深时优先消费（压低单页延迟）', () => {
  const queue = new SharedQueue({ capacity: 100 });
  const sched = new PipelineScheduler({ queue, capacity: 100, batchSize: 1, workers: 2 });
  sched.addCourse('A', 100);

  queue.push({ page: 1 });
  queue.push({ page: 2 });
  /* 队列深度 >= workers，应当先给 mix */
  assert.equal(sched.shouldMixFirst(), true);
  assert.equal(sched.shouldMixFirst(), true);
});

test('【缺陷 7】空队列 + 无课可产 → 该收工', () => {
  const queue = new SharedQueue({ capacity: 10 });
  const sched = new PipelineScheduler({ queue, capacity: 10, batchSize: 1, workers: 2 });
  sched.addCourse('A', 2);
  sched.markProduced('A', 2);
  assert.equal(sched.queue.length, 0);
  assert.equal(sched.allProduced(), true);
  assert.equal(sched.nextVision(), null);
});
