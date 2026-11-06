/**
 * 适配层的调用形状必须与宿主官方调用点一致。
 *
 * # 为什么这条测试用「读源码」而不是「跑运行时」
 *
 * `LlmRuntime` 依赖 Cordis 的 `ctx.reflect`，脱离宿主容器实例化会报
 * `Cannot read properties of undefined (reading 'reflect')`。
 * 所以走另一条更硬的验证：**直接比对官方调用点的写法**。
 *
 * 官方调用点在 `@deepseek-ai/dsh-agent-loop/lib/index.js`：
 *   L1189  preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal);
 *   L1072  const stream = preparedCall?.stream(request) ?? ...;
 *   L1199  request = this.buildRequest(config, preparedCall, tools, ...)
 *
 * 三条事实：
 *   1. prepareCall 收**对象**（proposedConfig），不是位置参数
 *   2. NO_ADAPTER 是被**显式捕获并降级**的（L1194），不是致命错误
 *   3. stream(request) 的 request 建立在 preparedCall.config 之上
 *
 * 适配层只要偏离这三点，就会在真机上以各种奇怪错误失败。
 * 我先后错成「位置参数」和「自己拼 config」，都是因为没看这段。
 *
 * 用法：node tests/host-llm-contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const AGENT_LOOP = path.join(ROOT, '.runtime/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js');
const BACKEND = path.join(ROOT, 'packages/dsh-zhiyun-core-study/src/core-question-backend.js');

const hasHost = fs.existsSync(AGENT_LOOP);

test('宿主官方调用点：prepareCall 收对象 config', { skip: !hasHost }, () => {
  const source = fs.readFileSync(AGENT_LOOP, 'utf8');
  // 抓 `llm.prepareCall(xxx, signal)` 的实参形态
  const m = source.match(/\.llm\.prepareCall\(\s*([A-Za-z_$][\w$]*)/);
  assert.ok(m, '没找到官方 prepareCall 调用点');
  const arg = m[1];
  // 实参必须是标识符（对象变量），不能是 `.provider` 这种属性访问
  assert.ok(!arg.includes('.'), `官方传的是 ${arg}，说明是对象而不是位置参数`);
  // 反向确认：源码里出现 proposedConfig.provider 的校验
  assert.match(source, /proposedConfig\.provider/, '官方用 proposedConfig.provider 取字段，进一步证明是对象');
});

test('宿主官方调用点：NO_ADAPTER 被显式降级处理', { skip: !hasHost }, () => {
  const source = fs.readFileSync(AGENT_LOOP, 'utf8');
  assert.match(source, /error\.code !== "NO_ADAPTER"/,
    '官方会 catch NO_ADAPTER 并降级，说明它不是致命错误 —— 适配层不该把它当不可恢复');
});

test('适配层：prepareCall 传的是对象 config', () => {
  const source = fs.readFileSync(BACKEND, 'utf8');
  // 抓 `pool.base.llm.prepareCall(...)` 的实参
  const m = source.match(/pool\.base\.llm\.prepareCall\(\s*\{?/);
  assert.ok(m, '没找到适配层的 prepareCall 调用');
  const callStart = source.indexOf('pool.base.llm.prepareCall(');
  const after = source.slice(callStart, callStart + 200);
  assert.match(after, /pool\.base\.llm\.prepareCall\(\s*\{/,
    `传参必须是对象字面量。实际片段：${after.slice(0, 120)}`);
  assert.match(after, /provider:/, '对象里要有 provider');
  assert.match(after, /model:/, '对象里要有 model');
});

test('适配层：stream 的入参建立在 prepared.config 之上', () => {
  const source = fs.readFileSync(BACKEND, 'utf8');
  const idx = source.indexOf('prepared.stream(');
  assert.ok(idx > 0, '没找到 prepared.stream 调用');
  const after = source.slice(idx, idx + 260);
  assert.match(after, /prepared\.config/,
    `stream 的配置必须以 prepared.config 为基准（与官方 buildRequest 一致）。实际：${after.slice(0, 160)}`);
});

test('适配层：必须把 finish 失败块翻成异常', () => {
  const source = fs.readFileSync(BACKEND, 'utf8');
  assert.match(source, /finishError/,
    '缺少 finishError —— 不翻的话宿主失败会被读成「模型什么都没返回」，最终显示 0 道题');
  assert.match(source, /chunk\.type === 'finish'/,
    '必须在流里检查 finish 块');
});
