/**
 * 倍率显示偏好的测试。
 *
 * 三个坑：
 *   1. 存储抛异常（隐私模式 / 配额满）不能让播放器崩；
 *   2. 脏值（手改、旧版本、别的脚本）不能被当成"隐藏"；
 *   3. 浮点尾巴不能出现在 UI 上（`1.2000000000000002x`）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RATE_VISIBLE_KEY, RATE_VISIBLE_DEFAULT, readRateVisible, writeRateVisible, formatRate,
} from '../packages/dsh-zhiyun-page-study/src/rate-display.js';

/** 内存版 Storage，便于精确控制返回值与抛错。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
    snapshot: () => Object.fromEntries(map),
  };
}

// ── 读写 ─────────────────────────────────────────────────

test('默认显示（不隐藏是默认态，隐藏要用户主动点）', () => {
  assert.equal(RATE_VISIBLE_DEFAULT, true);
  assert.equal(readRateVisible(memoryStorage()), true);
});

test('存 hidden 之后读回 false，存 shown 读回 true', () => {
  const store = memoryStorage();
  assert.equal(writeRateVisible(false, store), true);
  assert.equal(store.snapshot()[RATE_VISIBLE_KEY], 'hidden');
  assert.equal(readRateVisible(store), false);

  assert.equal(writeRateVisible(true, store), true);
  assert.equal(readRateVisible(store), true);
});

test('坑 2：脏值一律回默认，不猜', () => {
  for (const dirty of ['1', '0', 'true', 'false', '', 'HIDDEN', '{}', 'null']) {
    const store = memoryStorage({ [RATE_VISIBLE_KEY]: dirty });
    assert.equal(
      readRateVisible(store), RATE_VISIBLE_DEFAULT,
      `脏值 ${JSON.stringify(dirty)} 应回默认`,
    );
  }
});

test('坑 1：getItem 抛错时回默认，不崩', () => {
  const throwing = { getItem: () => { throw new Error('SecurityError'); } };
  assert.equal(readRateVisible(throwing), true);
});

test('坑 1：setItem 抛错时返回 false，不崩', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.equal(writeRateVisible(false, full), false);
});

test('没有 storage（SSR / 无 localStorage）时不崩', () => {
  assert.equal(readRateVisible(null), true);
  assert.equal(writeRateVisible(false, null), false);
});

// ── 倍率文本 ─────────────────────────────────────────────

test('整数省掉 .0', () => {
  assert.equal(formatRate(1), '1x');
  assert.equal(formatRate(2), '2x');
  assert.equal(formatRate(0.2), '0.2x');
});

test('一位小数：0.1 步长的档位都要显示清楚', () => {
  assert.equal(formatRate(1.1), '1.1x');
  assert.equal(formatRate(1.3), '1.3x');
  assert.equal(formatRate(1.9), '1.9x');
  assert.equal(formatRate(3.7), '3.7x');
});

test('坑 3：浮点尾巴被抹掉', () => {
  assert.equal(formatRate(1.2000000000000002), '1.2x');
  assert.equal(formatRate(1.9000000000000004), '1.9x');
  assert.equal(formatRate(0.30000000000000004), '0.3x');
});

test('坏输入回 1x，不显示 NaNx', () => {
  assert.equal(formatRate(Number.NaN), '1x');
  assert.equal(formatRate(undefined), '1x');
  assert.equal(formatRate(null), '1x', 'null 不是有效速度');
  assert.equal(formatRate(Infinity), '1x');
});
