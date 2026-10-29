/**
 * 变速快捷键的测试。
 *
 * 这个功能的失败形态全是"体感"问题，用眼睛看不出来：
 * 按住不动、一按冲到顶、在输入框里打字被改成倍速、松手还在跑。
 * 用显式时间戳把时序构造成参数，就能精确钉住它们。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOLD_DEFAULTS, heldSteps, pendingSteps, speedKeyAction, shouldHandleSpeedKey, isTypingTarget,
} from '../packages/dsh-zhiyun-page-study/src/speed-key.js';

// ── 按键识别 ─────────────────────────────────────────────

test('Q 加速（quick）、S 减速（slow），看 code 与输入法无关', () => {
  assert.equal(speedKeyAction({ code: 'KeyQ' }), 'faster');
  assert.equal(speedKeyAction({ code: 'KeyS' }), 'slower');
  assert.equal(speedKeyAction({ code: 'KeyA' }), null);
});

test('没有 code 时退回 key，且不区分大小写', () => {
  assert.equal(speedKeyAction({ key: 'q' }), 'faster');
  assert.equal(speedKeyAction({ key: 'Q' }), 'faster');
  assert.equal(speedKeyAction({ key: 's' }), 'slower');
  assert.equal(speedKeyAction({ key: 'S' }), 'slower');
  assert.equal(speedKeyAction({ key: 'x' }), null);
  assert.equal(speedKeyAction(null), null);
});

test('code 优先于 key：中文输入法下 key 可能是别的字符', () => {
  // 输入法激活时 event.key 可能是 'ｑ' 之类，但 code 仍是 KeyQ
  assert.equal(speedKeyAction({ code: 'KeyQ', key: 'ｑ' }), 'faster');
});

// ── 输入框保护 ───────────────────────────────────────────

test('在输入框里打字时不接管按键', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
    assert.equal(isTypingTarget({ tagName: tag }), true, tag);
  }
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true, 'contenteditable 也算');
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});

test('修饰键组合必须放行（否则会和 ⌘S 保存打架）', () => {
  assert.equal(shouldHandleSpeedKey({ code: 'KeyS', ctrlKey: true }), false);
  assert.equal(shouldHandleSpeedKey({ code: 'KeyS', metaKey: true }), false);
  assert.equal(shouldHandleSpeedKey({ code: 'KeyS', altKey: true }), false);
  assert.equal(shouldHandleSpeedKey({ code: 'KeyS', shiftKey: true }), false);
  assert.equal(shouldHandleSpeedKey({ code: 'KeyS' }), true);
});

test('shouldHandleSpeedKey 同时看焦点', () => {
  assert.equal(shouldHandleSpeedKey({ code: 'KeyQ' }, { tagName: 'INPUT' }), false);
  assert.equal(shouldHandleSpeedKey({ code: 'KeyQ' }, { tagName: 'DIV' }), true);
});

// ── 长按时序 ─────────────────────────────────────────────

test('短按（< holdDelay）不产生连发档数', () => {
  // 第 0 档由 keydown 立即执行，这里只算"额外"的
  assert.equal(heldSteps(0), 0);
  assert.equal(heldSteps(100), 0);
  assert.equal(heldSteps(HOLD_DEFAULTS.holdDelayMs - 1), 0);
});

test('过了延迟之后，每 repeatMs 加一档', () => {
  const { holdDelayMs: d, repeatMs: r } = HOLD_DEFAULTS;
  assert.equal(heldSteps(d), 1, '刚过延迟就走第 1 档');
  assert.equal(heldSteps(d + r - 1), 1);
  assert.equal(heldSteps(d + r), 2);
  assert.equal(heldSteps(d + 2 * r), 3);
});

test('坑 1：按住不放会一直加档（持续快速变化）', () => {
  // 按住 2 秒，档数应明显大于 1
  const steps = heldSteps(2000);
  assert.ok(steps > 10, `按住 2 秒应走很多档，实际 ${steps}`);
});

test('坑 2：pendingSteps 补偿定时器被节流', () => {
  const { holdDelayMs: d, repeatMs: r } = HOLD_DEFAULTS;
  // 场景：定时器本该在 d+r 触发，但被节流到 d+5r 才跑
  const held = d + 5 * r;
  // 已经执行过 1 档，那么这次要补 5 档（而不是只补 1 档）
  assert.equal(heldSteps(held), 6, '应累计 6 档');
  assert.equal(pendingSteps(held, 1), 5, '补 5 档追上');
});

test('坑 3：pendingSteps 不会返回负数（已追平后不再动）', () => {
  assert.equal(pendingSteps(100, 0), 0);
  assert.equal(pendingSteps(0, 5), 0, '已走超过应走，不该返回负');
  assert.equal(pendingSteps(HOLD_DEFAULTS.holdDelayMs, 1), 0);
});

test('坑 4：坏了的时间输入不产生档数', () => {
  assert.equal(heldSteps(Number.NaN), 0);
  assert.equal(heldSteps(undefined), 0);
  assert.equal(heldSteps(-100), 0);
  assert.equal(heldSteps(1000, { holdDelayMs: 400, repeatMs: 0 }), 0, 'repeatMs 为 0 时不能除零');
});

test('时序参数可覆盖（便于将来调手感）', () => {
  assert.equal(heldSteps(300, { holdDelayMs: 200, repeatMs: 50 }), 3, '200 后每 50 一档 → 3 档');
});

test('HOLD_DEFAULTS 的取值符合"能按住调、也不会一按冲顶"', () => {
  assert.equal(HOLD_DEFAULTS.holdDelayMs, 420);
  assert.equal(HOLD_DEFAULTS.repeatMs, 80);
  // 从 1.0 到 2.0 需要 10 档，耗时 = 420 + 10×80 = 1220ms —— 一秒多，手感合理
  const toDouble = HOLD_DEFAULTS.holdDelayMs + 10 * HOLD_DEFAULTS.repeatMs;
  assert.ok(toDouble > 900 && toDouble < 2000, `1.0→2.0 应约一秒，实际 ${toDouble}ms`);
});
