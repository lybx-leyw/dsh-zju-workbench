/**
 * 自由速度模式的取值测试。
 *
 * 这个功能的坑都在"看不见"的地方：界面上没有数值，所以一旦累加误差或边界判断
 * 出错，用户只会感觉到"点着点着就不动了"或"速度怪但说不出哪怪"。
 *
 * 钉住四件事：
 *   1. 浮点累加不攒脏值（`1 + 0.1 + 0.1 != 1.2000000000000002`）；
 *   2. 到边界就停（不会滑出 0.2–4.0）；
 *   3. 边界的按钮状态判断不会因为 1e-16 而永不生效；
 *   4. 坏输入（NaN / undefined）退化成原速，不写脏值回 `playbackRate`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RATE_MIN, RATE_MAX, RATE_STEP, roundRate, nextRate, atRateBound,
} from '../packages/dsh-zhiyun-page-study/src/speed.js';

test('roundRate 对齐到一位小数', () => {
  assert.equal(roundRate(1), 1);
  assert.equal(roundRate(1.2000000000000002), 1.2);
  assert.equal(roundRate(1.9000000000000004), 1.9);
  assert.equal(roundRate(0.30000000000000004), 0.3);
  // 0.25 这类真实值也要正确（不能把 0.25 抹成 0.2）
  assert.equal(roundRate(0.25), 0.3);
});

test('坑 1：连加 20 次不攒浮点脏值', () => {
  let rate = 1;
  for (let i = 0; i < 20; i += 1) rate = nextRate(rate, RATE_STEP);
  // 1 + 20×0.1 = 3.0，必须**精确**是 3
  assert.equal(rate, 3, `累加后应是 3，实际 ${rate}`);
  // 对照：裸浮点累加会得到 3.0000000000000013 之类
  let raw = 1;
  for (let i = 0; i < 20; i += 1) raw += RATE_STEP;
  assert.notEqual(raw, 3, '（对照）裸累加不等于 3');
});

test('坑 2：下界 0.2，再减不动', () => {
  let rate = 0.4;
  rate = nextRate(rate, -RATE_STEP);   // 0.3
  assert.equal(rate, 0.3);
  rate = nextRate(rate, -RATE_STEP);   // 0.2
  assert.equal(rate, 0.2);
  rate = nextRate(rate, -RATE_STEP);   // 已到下界，不该变成 0.1
  assert.equal(rate, RATE_MIN, '不能滑出下界');
});

test('坑 2：上界 4.0，再加不动', () => {
  let rate = 3.9;
  rate = nextRate(rate, RATE_STEP);
  assert.equal(rate, RATE_MAX);
  rate = nextRate(rate, RATE_STEP);
  assert.equal(rate, RATE_MAX, '不能滑出上界');
});

test('坑 2：一次性大幅越界也会被夹住', () => {
  assert.equal(nextRate(1, 99), RATE_MAX);
  assert.equal(nextRate(1, -99), RATE_MIN);
});

test('坑 3：边界判断不会因为浮点余量失效', () => {
  assert.equal(atRateBound(RATE_MIN, 'min'), true);
  assert.equal(atRateBound(0.3, 'min'), false);
  assert.equal(atRateBound(RATE_MAX, 'max'), true);
  assert.equal(atRateBound(3.9, 'max'), false);
  // 从下界再减一次后的值仍然判为"在边界上"（按钮该保持 disabled）
  assert.equal(atRateBound(nextRate(RATE_MIN, -RATE_STEP), 'min'), true);
  assert.equal(atRateBound(nextRate(RATE_MAX, RATE_STEP), 'max'), true);
});

test('坑 4：坏输入退化成原速，不写脏值', () => {
  // playbackRate 在媒体还没就绪时可能是 NaN
  assert.equal(nextRate(Number.NaN, RATE_STEP), 1.1, 'NaN 当 1 处理');
  assert.equal(nextRate(undefined, -RATE_STEP), 0.9);
  assert.equal(nextRate(1, Number.NaN), 1, 'delta 坏了就原地不动');
  assert.equal(roundRate(Number.NaN), Number.NaN, 'roundRate 本身不吞 NaN');
});

test('步长就是 0.1，且范围是 0.2–4.0', () => {
  assert.equal(RATE_STEP, 0.1);
  assert.equal(RATE_MIN, 0.2);
  assert.equal(RATE_MAX, 4);
});

test('从 1.0 加减一次得到 1.1 / 0.9（可验证的相邻档）', () => {
  assert.equal(nextRate(1, RATE_STEP), 1.1);
  assert.equal(nextRate(1, -RATE_STEP), 0.9);
});
