// Python 运行时桥（runtime.js / models.js / python/**）的测试。
//
// 跑法：`node tests/deeptutor-bridge.test.mjs`
// 为什么不是 `node --test`：受限沙箱里测试运行器自己 spawn 子进程会 EPERM，
// 直接执行本文件用 `node:test` 的 test() 同样会输出逐条结果与失败详情，退出码也正确。
//
// 覆盖的是**能真出问题的地方**，不是行覆盖率：
// 1. 协议常量在 Node 与 Python 两侧是否真的一致（"逐字节一致"这句承诺只能靠测试守）；
// 2. --selftest 是否真的不 import 上游（依赖装了一半时必须还能跑）；
// 3. NDJSON 半包/多包/坏包这些真实会撞上的边界；
// 4. 解释器/依赖探测失败时是否给出可解释的 reason，而不是抛未捕获异常；
// 5. 桥的分发（响应 / 反向请求 / 通知 / 未知方法 / 协议版本不符）；
// 6. 模型桥的聚合（text-delta / usage / finish）；tool-call-delta **不得静默丢弃**；
// 7. 桥 + 模型桥联动：Python 侧发来的 llm.complete 真的由 models.js 应答。
//
// 刻意**不**覆盖：真模型出题（要凭证，属于人工验证，见 scripts/deeptutor_bridge_selftest.mjs）。

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm,mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Keep cross-process fixtures in a shared writable directory. On Windows the
// system temp directory may grant Node access without granting the Python child.
async function pythonHome(prefix){
  const base=fileURLToPath(new URL('../artifacts/deeptutor-tests/',import.meta.url));
  await mkdir(base,{recursive:true});return mkdtemp(join(base,prefix));
}

import {
  CALLBACKS,
  DIAGNOSTIC_KIND,
  DeepTutorError,
  ERROR_KINDS,
  EVENT_KIND_BY_UPSTREAM,
  METHODS,
  NOTIFICATIONS,
  PROTOCOL_VERSION,
  RUN_MODES,
  STATUS_STATES,
  UPSTREAM_EVENT_TYPES,
} from '../packages/dsh-zhiyun-host-deeptutor/src/protocol.js';
import {
  PythonBridge,
  isSupportedPythonVersion,
  ndjsonReader,
  probeVendorDeps,
  resolvePython,
  runCapture,
} from '../packages/dsh-zhiyun-host-deeptutor/src/runtime.js';
import { createLlmBridge, toHostMessages } from '../packages/dsh-zhiyun-host-deeptutor/src/models.js';

const PACKAGE_DIR = fileURLToPath(new URL('../packages/dsh-zhiyun-host-deeptutor', import.meta.url));
const BRIDGE_SCRIPT = join(PACKAGE_DIR, 'python', 'deeptutor_bridge.py');
const SHIM_SCRIPT = join(PACKAGE_DIR, 'python', 'llm_shim.py');
const PROBE_SCRIPT = join(PACKAGE_DIR, 'python', 'capabilities_probe.py');
const VENDOR_DIR = join(PACKAGE_DIR, 'vendor', 'deeptutor');

// ── 测试装置 ────────────────────────────────────────────────────────────────

/** 静默 logger：测试只关心行为，不关心日志；需要断言日志时单独传自己的。 */
function silentLogger(sink = null) {
  const push = (level) => (message, fields) => sink?.push([level, message, fields]);
  return { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') };
}

/**
 * 找一次解释器路径（整个测试文件共用一次探测结果）。
 * 找不到时返回 null —— 依赖 Python 的用例会明确 skip，而不是假装通过。
 */
let pythonProbePromise = null;
function pythonPath() {
  if (!pythonProbePromise) {
    pythonProbePromise = resolvePython({ rootDir: PACKAGE_DIR, env: {}, logger: silentLogger() })
      .then((resolved) => (resolved.ok ? resolved.path : null))
      .catch(() => null);
  }
  return pythonProbePromise;
}

/** 用「输出重定向到文件」的方式跑一次 Python（受限沙箱里管道会 EPERM）。 */
async function runPython(script, args = [], { timeoutMs = 120_000, env = {} } = {}) {
  const python = await pythonPath();
  assert.ok(python, '找不到可用的 Python 解释器（这条用例需要真实解释器）');
  return runCapture({
    command: python,
    args: [script, ...args],
    env: { ...process.env, ...env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    timeoutMs,
  });
}

/** 轮询等待一个条件成立；超时抛断言错误（把最后观测值带上，便于定位）。 */
async function waitFor(check, { timeoutMs = 3000, label = '条件', describe = () => null } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) {
      assert.fail(`${label} 在 ${timeoutMs}ms 内没有成立；最后观测：${JSON.stringify(describe())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 一个「假传输层」：记录 Node 发出的每一行，并允许测试把 Python 的行喂回来。 */
function makeFakeTransport(reply) {
  const transport = {
    kind: 'fake',
    pid: 4242,
    sent: [],
    _feed: null,
    send(line) {
      const message = JSON.parse(line);
      transport.sent.push(message);
      const produced = reply?.(message, transport);
      if (produced) {
        // 异步回灌，模拟真实子进程的「下一轮」时序（同步回灌会让握手看不到竞态）。
        queueMicrotask(() => transport._feed?.(JSON.stringify(produced)));
      }
    },
    async stop() {},
  };
  transport.attach = (bridge) => {
    transport._feed = (line) => bridge._acceptLine(line);
  };
  return transport;
}

/** 合法的 ping 应答（握手用）。 */
function pongFor(message, overrides = {}) {
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      ok: true,
      pid: 4242,
      pythonVersion: '3.11.9',
      deeptutorVersion: '1.6.15',
      protocolVersion: PROTOCOL_VERSION,
      transport: 'fake',
      ...overrides,
    },
  };
}

/** 最小可用的假宿主模型服务（形状对齐 @deepseek-ai/dsh-llm）。 */
function makeFakeLlm(chunks, captures = {}) {
  return {
    async resolveModelInfo(provider, model) {
      return { provider, model, reasoning: { efforts: [{ id: 'none' }, { id: 'high' }] } };
    },
    async prepareCall(config, signal) {
      captures.preparedSignal = signal;
      return {
        config,
        async *stream(options) {
          captures.options = options;
          for (const chunk of chunks) yield chunk;
        },
      };
    },
  };
}

// ── 1. 协议常量一致性 ───────────────────────────────────────────────────────

test('协议常量：python/deeptutor_bridge.py 与 src/protocol.js 逐字节一致', async (t) => {
  if (!(await pythonPath())) return t.skip('没有可用解释器，跳过协议常量比对');

  const result = await runPython(BRIDGE_SCRIPT, ['--dump-protocol']);
  assert.equal(result.code, 0, `--dump-protocol 退出码应为 0，实际 ${result.code}：${result.stderr}`);
  const dumped = JSON.parse(result.stdout);

  assert.equal(dumped.PROTOCOL_VERSION, PROTOCOL_VERSION, '协议版本不一致，两侧会互相拒绝握手');
  assert.deepEqual(dumped.METHODS, { ...METHODS }, 'Node→Python 方法目录不一致');
  assert.deepEqual(dumped.CALLBACKS, { ...CALLBACKS }, 'Python→Node 反向方法目录不一致');
  assert.deepEqual(dumped.NOTIFICATIONS, { ...NOTIFICATIONS }, '通知目录不一致');
  assert.deepEqual(dumped.UPSTREAM_EVENT_TYPES, [...UPSTREAM_EVENT_TYPES], '上游事件类型表不一致');
  assert.deepEqual(dumped.EVENT_KIND_BY_UPSTREAM, { ...EVENT_KIND_BY_UPSTREAM }, '事件 kind 映射不一致');
  assert.equal(dumped.DIAGNOSTIC_KIND, DIAGNOSTIC_KIND, '未登记事件的兜底 kind 不一致');
  assert.deepEqual(dumped.ERROR_KINDS, [...ERROR_KINDS], '错误 taxonomy 不一致');
  assert.deepEqual(dumped.STATUS_STATES, [...STATUS_STATES], '状态枚举不一致');
  assert.deepEqual(dumped.RUN_MODES, { ...RUN_MODES }, '运行模式不一致');
});

// ── 2. Python 自检 ─────────────────────────────────────────────────────────

test('桥 --selftest：不 import 上游也能跑通，退出码 0 并打印协议版本', async (t) => {
  if (!(await pythonPath())) return t.skip('没有可用解释器，跳过 --selftest');

  const result = await runPython(BRIDGE_SCRIPT, ['--selftest']);
  assert.equal(result.code, 0, `--selftest 退出码应为 0，实际 ${result.code}；stderr=${result.stderr}`);
  assert.match(result.stdout, /protocol version 1/, '--selftest 必须打印协议版本');
  // 依赖装了一半时这条仍然必须绿：--selftest 一旦 import 上游就会在有/无依赖两种环境里表现不同。
  assert.doesNotMatch(result.stdout, /Traceback/, `--selftest 不应抛异常：${result.stdout}`);
});

test('llm_shim.py 与 capabilities_probe.py 的 --selftest 都能独立跑通', async (t) => {
  if (!(await pythonPath())) return t.skip('没有可用解释器，跳过垫片自检');

  for (const [label, script] of [['llm_shim', SHIM_SCRIPT], ['capabilities_probe', PROBE_SCRIPT]]) {
    const result = await runPython(script, ['--selftest']);
    assert.equal(result.code, 0, `${label} --selftest 退出码应为 0，实际 ${result.code}；stderr=${result.stderr}`);
    assert.doesNotMatch(result.stderr, /Traceback/, `${label} --selftest 不应抛异常`);
  }
});

// ── 3. NDJSON 读取边界 ─────────────────────────────────────────────────────

async function* chunkStream(chunks) {
  for (const chunk of chunks) yield chunk;
}

test('ndjsonReader：半包、多包、空行、Buffer 混入都能正确切分', async () => {
  const objects = [];
  for await (const item of ndjsonReader(
    chunkStream(['{"a":1}\n{"b"', ':2}\n\n{"c":3}\n{"d":', Buffer.from('4}\n')]),
  )) {
    objects.push(item);
  }
  assert.deepEqual(objects, [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }]);
});

test('ndjsonReader：最后一行没有换行也不能丢', async () => {
  const objects = [];
  for await (const item of ndjsonReader(chunkStream(['{"a":1}\n{"b":2}']))) objects.push(item);
  assert.deepEqual(objects, [{ a: 1 }, { b: 2 }]);
});

test('ndjsonReader：坏行抛 E_PROTOCOL 且带原文样本（否则日志里只剩「桥挂了」）', async () => {
  await assert.rejects(
    async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of ndjsonReader(chunkStream(['not-json\n']))) { /* 不应该产出任何行 */ }
    },
    (error) => {
      assert.ok(error instanceof DeepTutorError, '必须是 DeepTutorError，便于上层按 kind 处理');
      assert.equal(error.kind, 'E_PROTOCOL');
      assert.match(String(error.detail?.sample ?? ''), /not-json/);
      return true;
    },
  );
});

// ── 4. 解释器 / 依赖探测的失败面 ───────────────────────────────────────────

test('resolvePython：候选全部失败时返回可解释 reason，不抛未捕获异常', async () => {
  const eperm = () => {
    const error = new Error('spawn EPERM');
    error.code = 'EPERM';
    throw error;
  };
  const resolved = await resolvePython({
    rootDir: join(tmpdir(), `no-such-pkg-${randomUUID()}`),
    env: {},
    spawnImpl: eperm,
    logger: silentLogger(),
  });
  assert.equal(resolved.ok, false, '全部候选失败时必须报 ok:false');
  assert.equal(resolved.path, null);
  assert.equal(typeof resolved.reason, 'string');
  assert.ok(resolved.reason.length > 0, 'reason 不能是空串：用户要据此知道下一步做什么');
  assert.match(resolved.reason, /EPERM/, 'reason 必须带上失败原因，而不是只有一句「找不到」');
  assert.match(resolved.reason, /3\.11|解释器/, 'reason 要说清是「找解释器」这件事失败了');
});

test('resolvePython：能解析出受管 venv 的 3.11 解释器（真实机器）', async (t) => {
  const resolved = await resolvePython({ rootDir: PACKAGE_DIR, env: {}, logger: silentLogger() });
  if (!resolved.ok) return t.skip(`本机没有可用的 3.11–3.14 解释器：${resolved.reason}`);
  assert.equal(resolved.ok, true);
  assert.equal(typeof resolved.path, 'string');
  assert.ok(existsSync(resolved.path), `解析出的解释器必须真实存在：${resolved.path}`);
  assert.equal(isSupportedPythonVersion(resolved.version), true, `版本 ${resolved.version} 不在支持区间内`);
  // source 说明「路径是怎么来的」：只报路径会让用户无法复核为什么用了这一个。
  assert.ok(['recorded', 'env', 'managed-venv', 'py-launcher'].includes(resolved.source), resolved.source);
});

test('probeVendorDeps：解释器不可用时返回 installed:false + reason', async () => {
  const result = await probeVendorDeps({
    pythonPath: join(tmpdir(), `no-such-python-${randomUUID()}.exe`),
    vendorPath: VENDOR_DIR,
    env: {},
    timeoutMs: 15_000,
  });
  assert.equal(result.installed, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0, 'reason 不能为空');
});

test('probeVendorDeps：vendor 快照能 import 出 1.6.15', async (t) => {
  const python = await pythonPath();
  if (!python) return t.skip('没有可用解释器，跳过依赖探测');
  const result = await probeVendorDeps({ pythonPath: python, vendorPath: VENDOR_DIR, timeoutMs: 180_000 });
  assert.equal(result.installed, true, `上游依赖应可 import，实际失败原因：${result.reason}`);
  assert.equal(result.deeptutorVersion, '1.6.15', '上游版本必须与 upstream.lock.json 一致');
});

test('isSupportedPythonVersion：3.11–3.14 支持，3.10/3.15 与认不出的串有明确结论', () => {
  assert.equal(isSupportedPythonVersion('3.11.9'), true);
  assert.equal(isSupportedPythonVersion('3.14.0'), true);
  assert.equal(isSupportedPythonVersion('3.10.14'), false);
  assert.equal(isSupportedPythonVersion('3.15.0'), false);
  assert.equal(isSupportedPythonVersion('2.7.18'), false);
  assert.equal(isSupportedPythonVersion('不知道'), null, '认不出的版本不能当成「不支持」');
});

// ── 5. 桥的分发逻辑（注入传输，不起子进程） ────────────────────────────────

test('PythonBridge：注入传输下的握手、请求分发、错误映射与通知', async () => {
  const notifications = [];
  const transport = makeFakeTransport((message) => {
    if (message.method === METHODS.ping) return pongFor(message);
    if (message.method === METHODS.status) {
      return { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: '上游炸了', data: { kind: 'E_UPSTREAM_ERROR', detail: { where: 'status' } } } };
    }
    return undefined;
  });
  const bridge = new PythonBridge({
    rootDir: PACKAGE_DIR,
    pythonPath: 'fake-python',
    transport,
    logger: silentLogger(),
    startTimeoutMs: 2000,
  });
  transport.attach(bridge);
  bridge.onNotification((method, params) => notifications.push([method, params]));

  await bridge.start();
  assert.equal(bridge.state(), 'ready');
  assert.equal(bridge.protocolVersion, PROTOCOL_VERSION);
  assert.equal(bridge.pythonVersion, '3.11.9');
  assert.equal(bridge.deeptutorVersion, '1.6.15');
  assert.equal(bridge.info().transport, bridge.transportKind);

  // 响应 → result 原样返回
  const pong = await bridge.request(METHODS.ping, {});
  assert.equal(pong.ok, true);

  // 响应 → error 必须还原成带 kind 的 DeepTutorError（上层靠 kind 决定重试/降级）
  await assert.rejects(
    () => bridge.request(METHODS.status, {}),
    (error) => {
      assert.ok(error instanceof DeepTutorError);
      assert.equal(error.kind, 'E_UPSTREAM_ERROR');
      assert.match(error.message, /上游炸了/);
      assert.deepEqual(error.detail, { where: 'status' });
      return true;
    },
  );

  // Python→Node 通知
  bridge._acceptLine(JSON.stringify({ jsonrpc: '2.0', method: NOTIFICATIONS.turnEvent, params: { runId: 'r1' } }));
  await waitFor(() => notifications.length > 0, { label: 'turn.event 通知' });
  assert.deepEqual(notifications[0], [NOTIFICATIONS.turnEvent, { runId: 'r1' }]);

  await bridge.stop({ drain: false });
  assert.equal(bridge.state(), 'stopped');
});

test('PythonBridge：未知反向方法回 -32601，绝不挂死（契约 §3.2）', async () => {
  const transport = makeFakeTransport((message) => (message.method === METHODS.ping ? pongFor(message) : undefined));
  const bridge = new PythonBridge({
    rootDir: PACKAGE_DIR,
    pythonPath: 'fake-python',
    transport,
    logger: silentLogger(),
    startTimeoutMs: 2000,
  });
  transport.attach(bridge);
  await bridge.start();

  bridge._acceptLine(JSON.stringify({ jsonrpc: '2.0', id: 's1', method: 'no.such.callback', params: {} }));
  const response = await waitFor(
    () => transport.sent.find((entry) => entry.id === 's1' && entry.error),
    { label: '未知反向方法的错误应答', describe: () => transport.sent },
  );
  assert.equal(response.error.code, -32601);
  assert.equal(response.error.data.kind, 'E_PROTOCOL');
  await bridge.stop({ drain: false });
});

test('PythonBridge：协议版本不符时拒绝握手并报 E_PROTOCOL', async () => {
  const transport = makeFakeTransport((message) => (
    message.method === METHODS.ping ? pongFor(message, { protocolVersion: PROTOCOL_VERSION + 1 }) : undefined
  ));
  const bridge = new PythonBridge({
    rootDir: PACKAGE_DIR,
    pythonPath: 'fake-python',
    transport,
    logger: silentLogger(),
    startTimeoutMs: 2000,
  });
  transport.attach(bridge);
  await assert.rejects(
    () => bridge.start(),
    (error) => {
      assert.equal(error.kind, 'E_PROTOCOL');
      assert.match(error.message, /协议版本不一致/);
      return true;
    },
  );
  assert.equal(bridge.state(), 'stopped', '握手失败必须回到 stopped，不能半死不活');
});

test('PythonBridge：未登记方法立刻抛 E_PROTOCOL（拼错不该等 Python 回 -32601）', async () => {
  const bridge = new PythonBridge({ rootDir: PACKAGE_DIR, pythonPath: 'fake-python', logger: silentLogger() });
  await assert.rejects(() => bridge.request('turn.typo', {}), (error) => error.kind === 'E_PROTOCOL');
});

// ── 6. 模型桥 ──────────────────────────────────────────────────────────────

test('createLlmBridge：聚合 text-delta / usage / finish，tool-call-delta 不丢', async () => {
  const captures = {};
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '第一段' },
    { type: 'text-delta', index: 0, text: '续写' },
    { type: 'reasoning-delta', index: 0, text: '内部推理' },
    { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'search', argumentsDelta: '{"q":' },
    { type: 'tool-call-delta', index: 1, argumentsDelta: '"成本"}' },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
  const llmBridge = createLlmBridge({
    llm: () => makeFakeLlm(chunks, captures),
    getSelection: () => ({ provider: 'host-provider', model: 'host-model' }),
    logger: silentLogger(),
  });

  const result = await llmBridge.handleRequest(CALLBACKS.llmComplete, {
    messages: [
      { role: 'system', content: '你是出题助手' },
      { role: 'user', content: '出一道成本题' },
    ],
    temperature: 0.3,
  });

  assert.equal(result.content, '第一段续写');
  assert.equal(result.reasoning, '内部推理', '推理内容不能混进正文（会被当成答案拼进题目）');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.provider, 'host-provider');
  assert.equal(result.model, 'host-model');
  // usage：宿主计数字段互不重叠，total 必须把缓存命中加回来。
  assert.deepEqual(result.usage, { input: 10, output: 5, total: 17 });
  assert.equal(result.toolCalls.length, 1, 'tool-call-delta 不得静默丢弃');
  assert.equal(result.toolCalls[0].name, 'search');
  assert.equal(result.toolCalls[0].arguments, '{"q":"成本"}');

  // system 必须提升到 GenerateOptions.system，而不是留在 messages 里
  assert.equal(captures.options.system, '你是出题助手');
  assert.equal(captures.options.messages.length, 1);
  assert.equal(captures.options.messages[0].role, 'user');
  assert.equal(captures.options.temperature, 0.3);
});

test('createLlmBridge：未配置模型时按五态回 E_DISABLED / E_CAPABILITY_UNAVAILABLE，而不是崩溃', async () => {
  // ① 宿主模型服务本身缺席
  const withoutLlm = createLlmBridge({ logger: silentLogger() });
  await assert.rejects(
    () => withoutLlm.handleRequest(CALLBACKS.llmComplete, { messages: [{ role: 'user', content: 'hi' }] }),
    (error) => {
      assert.equal(error.kind, 'E_DISABLED');
      return true;
    },
  );
  assert.equal(withoutLlm.selection(), null, '未配置时 selection() 必须给 null（不是 false、不是 {}）');

  // ② 服务在，但用户没选 provider/model
  const withoutSelection = createLlmBridge({
    llm: () => makeFakeLlm([]),
    getSelection: () => null,
    logger: silentLogger(),
  });
  await assert.rejects(
    () => withoutSelection.handleRequest(CALLBACKS.llmComplete, { messages: [{ role: 'user', content: 'hi' }] }),
    (error) => {
      assert.equal(error.kind, 'E_CAPABILITY_UNAVAILABLE');
      assert.match(error.message, /provider|model/);
      return true;
    },
  );
});

test('createLlmBridge：不属于自己的方法返回 undefined（让桥继续问下一个订阅者）', async () => {
  const llmBridge = createLlmBridge({ llm: () => makeFakeLlm([]), logger: silentLogger() });
  assert.equal(await llmBridge.handleRequest('no.such.callback', {}), undefined);
  // 配额：没有配额服务时按「永不受限」答复，而不是让上游出题卡死
  assert.deepEqual(await llmBridge.handleRequest(CALLBACKS.quotaAcquire, {}), { granted: true, waitMs: 0 });
  assert.deepEqual(await llmBridge.handleRequest(CALLBACKS.quotaRelease, {}), {});
});

test('toHostMessages：system 走 system-prompt、assistant 必须带 source、图片换不到引用时降级但说出来', () => {
  const messages = toHostMessages(
    [
      { role: 'system', content: '规则' },
      { role: 'assistant', content: '之前的回答' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' }, name: '图1.png' }] },
    ],
    { provider: 'p', model: 'm' },
  );
  assert.equal(messages[0].role, 'system');
  assert.deepEqual(messages[0].source, { kind: 'system-prompt' });
  assert.deepEqual(messages[1].source, { kind: 'model', provider: 'p', model: 'm' });
  // 用户消息不允许带 id/source（宿主类型上是 never，带上会被拒）
  assert.equal(messages[2].id, undefined);
  assert.equal(messages[2].source, undefined);
  assert.match(messages[2].content[0].text, /图片已省略/, '换不到引用的图片必须留下痕迹，不能静默丢');
});

// ── 7. 桥 + 模型桥联动 ─────────────────────────────────────────────────────

test('联动：Python 侧 llm.complete 反向请求由 models.js 应答，结果回到 Python', async () => {
  const transport = makeFakeTransport((message) => (message.method === METHODS.ping ? pongFor(message) : undefined));
  const bridge = new PythonBridge({
    rootDir: PACKAGE_DIR,
    pythonPath: 'fake-python',
    transport,
    logger: silentLogger(),
    startTimeoutMs: 2000,
  });
  transport.attach(bridge);

  const llmBridge = createLlmBridge({
    llm: () => makeFakeLlm([
      { type: 'text-delta', index: 0, text: '答案' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]),
    getSelection: () => ({ provider: 'p', model: 'm' }),
    logger: silentLogger(),
  });
  const detach = llmBridge.attachTo(bridge);

  await bridge.start();
  // 模拟 Python 侧 llm_shim 发出的反向请求
  bridge._acceptLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 's1',
    method: CALLBACKS.llmComplete,
    params: { messages: [{ role: 'user', content: '出一题' }], model: 'm' },
  }));

  const response = await waitFor(
    () => transport.sent.find((entry) => entry.id === 's1'),
    { label: 'llm.complete 的应答', describe: () => transport.sent },
  );
  assert.equal(response.error, undefined, `不应是错误应答：${JSON.stringify(response)}`);
  assert.equal(response.result.content, '答案');
  assert.equal(response.result.provider, 'p');
  assert.deepEqual(response.result.usage, { input: 3, output: 1, total: 4 });

  detach();
  await bridge.stop({ drain: false });
});

// ── 8. 真起子进程：桥端到端 ────────────────────────────────────────────────

test('真实桥：起 Python 子进程完成 ping / status / capabilities', async (t) => {
  const python = await pythonPath();
  if (!python) return t.skip('没有可用解释器，跳过桥端到端');
  if (!existsSync(BRIDGE_SCRIPT)) assert.fail(`桥脚本缺失：${BRIDGE_SCRIPT}`);

  const home = await pythonHome('home-');
  const warnings = [];
  const bridge = new PythonBridge({
    rootDir: PACKAGE_DIR,
    pythonPath: python,
    vendorPath: VENDOR_DIR,
    homeDir: home,
    // 'auto'：正常机器走管道；受限沙箱自动降级为文件传输（降级会记一条 warn）。
    transport: 'auto',
    logger: silentLogger(warnings),
    startTimeoutMs: 60_000,
    requestTimeoutMs: 180_000,
  });
  try {
    const simultaneous=await Promise.all([bridge.request(METHODS.ping,{}),bridge.request(METHODS.ping,{})]);
    assert.equal(simultaneous.length,2,'并发的首次请求共享同一次进程启动');
    assert.equal(bridge.state(), 'ready');
    assert.ok(['pipe', 'files'].includes(bridge.transportKind), `未知传输：${bridge.transportKind}`);
    assert.equal(bridge.protocolVersion, PROTOCOL_VERSION);

    const pong = await bridge.request(METHODS.ping, {});
    assert.equal(pong.protocolVersion, PROTOCOL_VERSION);
    assert.match(String(pong.pythonVersion), /^3\.1[1-4]\./);
    assert.equal(pong.deeptutorVersion, '1.6.15');

    const status = await bridge.request(METHODS.status, { probe: false }, { timeoutMs: 60_000 });
    assert.equal(status.deeptutorVersion, '1.6.15');
    assert.equal(typeof status.home, 'string');
    assert.ok(status.home.startsWith(home), `DEEPTUTOR_HOME 应落在调用方给的目录，实际 ${status.home}`);
    assert.ok(existsSync(status.dataRoot), `数据根应被创建：${status.dataRoot}`);
    // 上游 settings 目录此刻还没播种（probe:false 且没起过门面），status 必须如实说
    // seeded:false，而不是假装配置已经准备好。
    assert.equal(status.settings.seeded, false, '没起过门面时 settings.seeded 应为 false');
    assert.ok(
      status.settings.dir.endsWith(join('data', 'user', 'settings')),
      `settings.dir 应指向上游的 data/user/settings，实际 ${status.settings.dir}`,
    );

    const caps = await bridge.request(METHODS.capabilities, {}, { timeoutMs: 180_000 });
    // capabilities 走 true 上游门面，会触发首次运行播种（§4.3）。这一步之后
    // main.yaml / agents.yaml / interface.json 必须都已在盘上 —— 缺 main.yaml 会让
    // 出题在第 2 个事件就 FileNotFoundError。
    const seeded = await bridge.request(METHODS.status, { probe: false }, { timeoutMs: 60_000 });
    assert.equal(seeded.settings.seeded, true, '起过门面后 settings.seeded 应为 true');
    for (const name of ['main.yaml', 'agents.yaml', 'interface.json']) {
      assert.ok(
        existsSync(join(seeded.settings.dir, name)),
        `上游首次运行播种缺少 ${name}（${seeded.settings.dir}）`,
      );
    }
    assert.equal(caps.capabilities.length, 11, '上游内置能力应为 11 项');
    const names = caps.capabilities.map((entry) => entry.name);
    for (const expected of ['chat', 'deep_question', 'deep_research', 'math_animator', 'immersive_reading']) {
      assert.ok(names.includes(expected), `能力目录缺少 ${expected}`);
    }
    for (const entry of caps.capabilities) {
      // 契约 §7 的字段名是 depsAvailable（不是 available）；available 是内部的推导中间值。
      assert.equal(typeof entry.depsAvailable, 'boolean', `${entry.name} 的 depsAvailable 必须是布尔值`);
      assert.equal(typeof entry.upstream, 'boolean', `${entry.name} 的 upstream 必须是布尔值`);
      assert.equal(typeof entry.installHint, 'string', `${entry.name} 的 installHint 必须是字符串`);
    }
    const animator = caps.capabilities.find((entry) => entry.name === 'math_animator');
    // venv 里没装 manim，所以这一项必须如实报 false 且给出 pip 提示。
    assert.equal(animator.depsAvailable, false, '缺 manim 时 math_animator 的 depsAvailable 必须是 false');
    assert.match(animator.installHint, /manim/, '缺依赖时必须给安装提示');
  } finally {
    await bridge.stop({ drain: false }).catch(() => {});
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
});

// ── 9. 真实桥：模型快照的落点 ──────────────────────────────────────────────

test('真实桥：带 llm 快照的 turn.start 能起来（不塞上游 llm_selection）', async (t) => {
  const python = await pythonPath();
  if (!python) return t.skip('没有可用解释器，跳过');
  if (!existsSync(BRIDGE_SCRIPT)) assert.fail(`桥脚本缺失：${BRIDGE_SCRIPT}`);

  const home = await pythonHome('llm-');
  const bridge = new PythonBridge({
    rootDir: PACKAGE_DIR,
    pythonPath: python,
    vendorPath: VENDOR_DIR,
    homeDir: home,
    transport: 'auto',
    logger: silentLogger(),
    startTimeoutMs: 60_000,
    requestTimeoutMs: 180_000,
  });
  const runId = `run_llm_${randomUUID()}`;
  try {
    await bridge.start();
    const started = await bridge.request(
      METHODS.turnStart,
      {
        runId,
        capability: 'chat',
        content: '你好',
        llm: { provider: 'deepseek', model: 'deepseek-flash' },
      },
      { timeoutMs: 120_000 },
    );
    // 这条回归守的是真跑过的坑：上游 TurnRequest 的 llm_selection 是「从上游
    // data/user/settings/model_catalog.json 里挑一条」，宿主从不写那份 catalog，
    // 所以一旦把 llm 映射成 llm_selection，turn.start 必然抛
    // "Invalid LLM selection: selected profile/model was not found." —— 起不来。
    assert.ok(started.turnId, `turn.start 应返回 turnId，实际 ${JSON.stringify(started)}`);
    // 模型快照的唯一落点是 llm_shim，回执里必须能看出「这轮用哪个模型」。
    assert.equal(started.llmSelectionUsed?.provider, 'deepseek', '回执应说明实际生效的供应商');
    assert.equal(started.llmSelectionUsed?.model, 'deepseek-flash', '回执应说明实际生效的模型');

    const status = await bridge.request(METHODS.status, { probe: false }, { timeoutMs: 60_000 });
    assert.equal(status.llmShim?.installed, true, 'llm_shim 必须已接管上游模型入口');
    assert.ok(
      Array.isArray(status.llmShim?.patchedModules) && status.llmShim.patchedModules.length > 0,
      `llm_shim 应报出被改写的模块，实际 ${JSON.stringify(status.llmShim)}`,
    );
    assert.equal(status.llmShim?.selectedModel, 'deepseek-flash', 'status 应回显当前模型快照');
  } finally {
    // 这一轮真的会去调模型，收尾前一并取消，别让它在后台跑。
    await bridge.request(METHODS.turnCancel, { runId }, { timeoutMs: 30_000 }).catch(() => {});
    await bridge.stop({ drain: false }).catch(() => {});
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
});
