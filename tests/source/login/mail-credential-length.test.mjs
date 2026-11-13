/**
 * 邮箱密码「16 位」这条约束的边界。
 *
 * # 为什么单独一份
 *
 * 本仓原先照搬了上游 `MailSettings.tsx` 的硬校验：`password.length !== 16`
 * 直接判保存失败，理由是「你可能填了统一身份认证密码」。
 *
 * 2026-11-17 实测证明它**过严**：用户填的密码确实不是 16 位，却被拦在保存这一步。
 * 而真正的认证方（`source/mail` 走 IMAP）只做 `text(password, 128, false)` ——
 * 非空、不超长，**没有任何长度要求**。
 *
 * 所以正确的边界是：
 *
 * | 情形 | 该怎样 |
 * | --- | --- |
 * | 地址不像邮箱 | **拒绝**（真填错了） |
 * | 密码为空 | **拒绝**（真的没法用） |
 * | 密码非 16 位 | **保存成功 + 一句提示**（可能对，也可能不对，交给认证去判） |
 * | 密码 16 位 | 保存成功，无提示 |
 *
 * # 为什么这份测试要直接调 `writeMail`
 *
 * 我第一版把它写进了 `tests/source/mail/mail.test.mjs`，测的是 `Mail` 类 ——
 * 那个类根本不经过 `writeMail` 的长度逻辑，所以把硬校验加回去**测试照样全绿**。
 * 反证没变红就说明测错了地方。这份测试必须直接打 `writeMail`。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAIL_RECORD_KEY, readMail, writeMail } from '../../../packages/source/login/src/index.js';

/** 内存版宿主凭据服务。 */
function memoryCtx() {
  const store = new Map();
  const service = {
    async readRecord(key) { return store.get(key) ?? null; },
    async modifyRecord(key, fn) {
      store.set(key, fn(store.get(key) ?? null));
      return store.get(key);
    },
    async deleteRecord(key) { store.delete(key); },
  };
  return { get: (name) => (name === 'credentials' ? service : null), store };
}

test('非 16 位密码保存成功 —— 这是用户实际遇到的那个场景', async () => {
  // 用户的密码确实不是 16 位，被原来的硬校验挡住，保存失败。
  const ctx = memoryCtx();
  const result = await writeMail(ctx, { address: 'abc@zju.edu.cn', password: 'not-16-chars-at-all' });

  assert.equal(result.saved, true, '必须保存成功，不能抛错');
  assert.deepEqual(
    await readMail(ctx),
    { address: 'abc@zju.edu.cn', password: 'not-16-chars-at-all' },
    '密码要原样落盘 —— 我们不是认证方，无权替它判断对错',
  );
});

test('非 16 位时给提示，但**不阻断**', async () => {
  const ctx = memoryCtx();
  const result = await writeMail(ctx, { address: 'abc@zju.edu.cn', password: 'abc' });
  assert.equal(result.saved, true);
  assert.equal(typeof result.warning, 'string', '要有提示');
  assert.match(result.warning, /客户端专用密码|16 位/, '提示要说清常见的是哪种密码');
  assert.match(result.warning, /已按你填的保存/, '要说清已经保存了，否则用户以为没存上');
});

test('16 位密码保存成功且没有提示', async () => {
  const ctx = memoryCtx();
  const result = await writeMail(ctx, { address: 'abc@zju.edu.cn', password: 'a'.repeat(16) });
  assert.equal(result.saved, true);
  assert.equal(result.warning, undefined, '正常长度不该打扰用户');
});

test('各种长度都能保存 —— 16 不是门槛', async () => {
  for (const password of ['x', 'abc123', 'a'.repeat(15), 'a'.repeat(17), 'a'.repeat(64)]) {
    const ctx = memoryCtx();
    const result = await writeMail(ctx, { address: 'abc@zju.edu.cn', password });
    assert.equal(result.saved, true, `${password.length} 位应当能保存`);
    assert.equal((await readMail(ctx)).password, password, `${password.length} 位原样落盘`);
  }
});

test('空密码仍然拒绝 —— 这个是真的没法用', async () => {
  for (const password of ['', '   ', undefined, null]) {
    const ctx = memoryCtx();
    await assert.rejects(
      () => writeMail(ctx, { address: 'abc@zju.edu.cn', password }),
      (error) => error.code === 'CREDENTIALS',
      `空密码（${JSON.stringify(password)}）必须拒绝`,
    );
  }
});

test('地址不像邮箱仍然拒绝 —— 这是真填错了', async () => {
  for (const address of ['not-an-email', 'a@b', '', 'abc@']) {
    const ctx = memoryCtx();
    await assert.rejects(
      () => writeMail(ctx, { address, password: 'a'.repeat(16) }),
      (error) => error.code === 'CREDENTIALS',
      `地址 ${JSON.stringify(address)} 必须拒绝`,
    );
  }
});

test('落盘记录带 kind 与 payload —— 宿主白名单只收这两层', async () => {
  // 顶层多放字段会让工作台起不来（这个包的历史上踩过）。
  const ctx = memoryCtx();
  await writeMail(ctx, { address: 'abc@zju.edu.cn', password: 'short' });
  const record = ctx.store.get(MAIL_RECORD_KEY);
  assert.equal(record.kind, 'grant');
  assert.equal(record.payload.address, 'abc@zju.edu.cn');
  assert.equal(record.payload.password, 'short');
});

test('没有凭据服务时返回 false，不抛', async () => {
  const ctx = { get: () => null };
  assert.equal(await writeMail(ctx, { address: 'a@zju.edu.cn', password: 'x' }), false);
});

test('前后空白被裁掉，但密码内部的字符不动', async () => {
  const ctx = memoryCtx();
  await writeMail(ctx, { address: '  abc@zju.edu.cn  ', password: '  ab cd ef  ' });
  const saved = await readMail(ctx);
  assert.equal(saved.address, 'abc@zju.edu.cn');
  assert.equal(saved.password, 'ab cd ef', '首尾空白裁掉；内部空格是密码的一部分，不能动');
});
