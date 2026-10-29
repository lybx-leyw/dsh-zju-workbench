/**
 * 均速模式死循环的回归测试。
 *
 * # 出过的事故
 *
 * 2026-10-28：一开均速模式整页卡死。根因是一个**双向同步环**：
 *
 * ```
 * effect A: rate 变 → 写 video.playbackRate
 * event  : playbackRate 一变 → 触发 ratechange
 * effect B: ratechange → sync() 把 playbackRate 写回 rate
 *          → rate 又变 → 回到 effect A
 * ```
 *
 * 非均速时这个环是闭合的（用户设什么就是什么，写完立刻收敛）。但均速模式下
 * `playbackRate` 是随 `nowMs` 变化的加权值，每次 `timeupdate` 都会让环再转一圈，
 * 于是变成每秒数次的渲染风暴。
 *
 * 修法是单向：**均速模式下 `sync` 不把 `playbackRate` 写回 `rate`**。
 *
 * 这个测试用纯逻辑模拟这条链，确认单向之后能收敛。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { rateAt, buildUniformPlan } from '../packages/dsh-zhiyun-page-study/src/uniform-speed.js';

/**
 * 模拟"同步环"：返回在给定规则下，`rate` 经过若干步是否收敛。
 *
 * @param options.uniform - 是否均速模式。
 * @param options.syncsBack - `sync` 是否把 playbackRate 写回 rate（旧行为）。
 */
function simulateLoop({ uniform, syncsBack, steps = 50 }) {
  // 平均语速 4；两段：慢段(2字/秒) → 建议 2x，快段(8字/秒) → 建议 0.5x
  const buckets = [
    { startMs: 0, endMs: 60_000, charsPerSecond: 2 },
    { startMs: 60_000, endMs: 120_000, charsPerSecond: 8 },
  ];
  const { plan } = buildUniformPlan(buckets, 4, 1, { minRate: 0.2, maxRate: 4, mergeTolerance: 0.0001 });

  let rate = 1.5;                 // 用户设的平均值
  let playbackRate = 1.5;         // 元素上的值
  const seen = [];

  for (let step = 0; step < steps; step += 1) {
    // effect A：按当前时刻写 playbackRate
    const base = uniform && plan.length ? rateAt(plan, 0, 1) : 1;
    playbackRate = uniform && plan.length ? base * rate : rate;

    // event：ratechange 触发 sync
    if (syncsBack) {
      // 旧行为：无条件写回（均速时把加权值当成了用户设定）
      rate = playbackRate;
    } else if (!uniform) {
      // 新行为：只在非均速时同步
      rate = playbackRate;
    }

    seen.push({ step, rate, playbackRate });
    // 收敛判断：连续两步 rate 与 playbackRate 都不再变
    if (step >= 2) {
      const [a, b, c] = seen.slice(-3);
      if (a.rate === b.rate && b.rate === c.rate
        && a.playbackRate === b.playbackRate && b.playbackRate === c.playbackRate) {
        return { converged: true, steps: step, finalRate: rate, history: seen };
      }
    }
  }
  return { converged: false, steps, finalRate: rate, history: seen };
}

test('回归：旧行为（均速 + sync 写回）会让 rate 被加权值污染', () => {
  const result = simulateLoop({ uniform: true, syncsBack: true });
  // 慢段加权值是 2x，rate 被拉成 2，再乘上去变成 4，一路发散
  assert.notEqual(result.finalRate, 1.5, 'rate 不该还是 1.5');
  assert.ok(
    result.finalRate > 1.5,
    `rate 会被越推越高（实际 ${result.finalRate}），这正是卡死的来源`,
  );
});

test('修复后：均速模式不再把 playbackRate 写回 rate，值保持为平均值', () => {
  const result = simulateLoop({ uniform: true, syncsBack: false });
  assert.equal(result.finalRate, 1.5, 'rate 应始终是用户设的平均值');
  assert.equal(result.converged, true, '应当收敛');
});

test('非均速模式：同步照旧（用户改倍率 UI 要跟着变）', () => {
  const result = simulateLoop({ uniform: false, syncsBack: false });
  // 非均速时 base 恒为 1，所以 playbackRate = rate，两者一致且收敛
  assert.equal(result.converged, true);
  assert.equal(result.finalRate, result.history.at(-1).playbackRate);
});

test('均速模式下 rate 是平均值，playbackRate 是加权值（两者本就该不同）', () => {
  const { plan } = buildUniformPlan(
    [{ startMs: 0, endMs: 60_000, charsPerSecond: 2 }],
    4,
    1,
    { minRate: 0.2, maxRate: 4, mergeTolerance: 0.0001 },
  );
  const average = 1.5;
  const weighted = rateAt(plan, 0, 1) * average;
  assert.ok(weighted !== average, `加权值 ${weighted} 应不同于平均值 ${average}`);
  assert.ok(Math.abs(weighted - 1.5 * 2) < 0.06, '慢段应加速到约 3x');
});
