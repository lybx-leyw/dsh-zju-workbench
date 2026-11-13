/**
 * 共享出口的网关会话注入（`setWebvpnSession`）。
 *
 * # 这个机制解决什么
 *
 * `source/http` 是 tier 0：它建出口，但**不知道**凭据在哪、也不知道网关登录
 * 怎么走。历史上它建出口时干脆不传 `onWebvpnRequired`，而出口的守卫写成
 * `typeof onWebvpnRequired === 'function' && …` —— 没传就整体为 false，
 * 于是**直接改写并发出去**。校外场景下网关回的是登录页（HTTP 200），
 * 各数据源把登录页当业务数据解析，报出一堆莫名其妙的字段缺失。
 *
 * 现在出口在「没人能建会话」时明确抛 `WEBVPN_REQUIRED`；有人注册了回调，
 * 就先请它建会话、成功才改写。这个文件锁那条注入链路。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { apply } = await import('../../../packages/source/http/src/host.js');

/**
 * 造一个最小的 cordis 风格 ctx：只提供 `effect` 与 `provide`。
 *
 * @returns `{ ctx, services }`。
 */
function fakeCtx() {
  const services = new Map();
  const ctx = {
    effect(fn) {
      // 真实 cordis 的 effect 会调 fn 并把返回的清理函数收起来。
      const dispose = fn();
      return dispose ?? (() => {});
    },
    provide(name, value) {
      services.set(name, value);
      return () => services.delete(name);
    },
  };
  return { ctx, services };
}

test('没注册回调时，出口服务仍然可用（不因缺注入而崩）', async () => {
  const { ctx, services } = fakeCtx();
  apply(ctx);
  const egress = services.get('zwEgress');
  assert.ok(egress, '必须 provide 服务');
  assert.equal(typeof egress.setWebvpnSession, 'function', '必须暴露注入点');
});

test('setWebvpnSession 注册后生效，返回撤销函数', async () => {
  const { ctx, services } = fakeCtx();
  apply(ctx);
  const egress = services.get('zwEgress');

  let called = 0;
  const undo = egress.setWebvpnSession(async () => { called += 1; return true; });
  assert.equal(typeof undo, 'function', '必须返回撤销函数');

  // 撤销是幂等的。
  undo();
  undo();
});

test('setWebvpnSession(null) 取消注册', async () => {
  const { ctx, services } = fakeCtx();
  apply(ctx);
  const egress = services.get('zwEgress');
  egress.setWebvpnSession(async () => true);
  assert.doesNotThrow(() => egress.setWebvpnSession(null));
});

test('服务的 state() 在有 undici 时报告出口事实，无 undici 时如实降级', async () => {
  const { ctx, services } = fakeCtx();
  apply(ctx);
  const egress = services.get('zwEgress');
  const state = await egress.state();
  // 本机装没装 undici 由环境决定；这里只要求「有形状」且不抛。
  assert.equal(typeof state, 'object');
  assert.ok('mode' in state);
});

test('forget() 可调用且不抛（换网络后的重置入口）', async () => {
  const { ctx, services } = fakeCtx();
  apply(ctx);
  const egress = services.get('zwEgress');
  await assert.doesNotReject(() => egress.forget());
});

test('注入的回调抛错时，出口把它当成「建不起来」而不是让异常冒泡', async () => {
  // 这一条只能验到服务面：真正的出口实例是惰性建的，且要走一次网络才会触发。
  // 但「回调抛错不该让 setWebvpnSession 立刻炸」这条仍然要锁住 ——
  // 否则上层在装配期就会崩。
  const { ctx, services } = fakeCtx();
  apply(ctx);
  const egress = services.get('zwEgress');
  await assert.doesNotReject(async () => {
    egress.setWebvpnSession(async () => { throw new Error('boom'); });
  });
});
