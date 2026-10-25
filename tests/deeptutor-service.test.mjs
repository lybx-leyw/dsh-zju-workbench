/**
 * DeepTutor 宿主**服务面**与**出题适配器**的契约测试。
 *
 * 这一层的价值同样在「失败的样子」上：服务不可用时要抛对错误种类、事件序列号不许
 * 编造、未映射的上游事件不许丢、`concept` 不许被当成概念填空、`verified` 不许被
 * 手工置真。所以大部分用例钉的是坏情况下的反应。
 *
 * 运行方式（本沙箱下 `node --test` 会 spawn EPERM）：
 *   node tests/deeptutor-service.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createService } from '../packages/dsh-zhiyun-host-deeptutor/src/service.js';
import {
  DEFERRED_EXTRAS,
  FIVE_STATES,
  createCapabilityCatalog,
} from '../packages/dsh-zhiyun-host-deeptutor/src/capabilities.js';
import {
  JUDGE_ALIASES,
  JUDGE_TYPE,
  QUESTION_TYPE_MAP,
  isJudgeType,
  toQuizCandidates,
} from '../packages/dsh-zhiyun-host-deeptutor/src/adapters/quiz.js';
import { createRunStore } from '../packages/dsh-zhiyun-host-deeptutor/src/run-store.js';

// ── 测试脚手架 ────────────────────────────────────────────────────────────────

/** 静默 logger：测试不该在 stdout 上刷中文告警。 */
const SILENT = { warn() {}, debug() {}, info() {}, error() {} };

/**
 * 假 Python 桥。
 *
 * 形状对齐 `src/runtime.js` 里 `PythonBridge` 的对外面（`request` / `onNotification`
 * / `state` / `info`），但完全不起子进程 —— 服务面必须能在没有 Python 的机器上单测。
 */
function createFakeBridge({ handlers = {}, state = 'ready' } = {}) {
  const listeners = new Set();
  const calls = [];
  const bridge = {
    state: () => state,
    info: () => ({ pid: 4321, startedAt: 1_700_000_000_000, restartCount: 0, idleTimeoutMs: 600_000 }),
    onNotification(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(method, params) {
      for (const listener of [...listeners]) listener(method, params);
    },
    async request(method, params) {
      calls.push({ method, params });
      const handler = handlers[method];
      // capabilities 是目录探测，任何桥都应该答（服务面/目录都在没准备时不能挂）。
      if (!handler && method === 'capabilities') return { capabilities: [] };
      if (!handler) throw new Error(`测试桥没有为 ${method} 准备处理器`);
      return handler(params, bridge);
    },
  };
  return { bridge, calls, emit: bridge.emit };
}

/** 极简能力目录桩：只回答 get/list，用于隔离服务面逻辑。 */
function createCatalogStub({ entries = {}, verified = new Set() } = {}) {
  const marked = [];
  return {
    marked,
    async list() {
      return Object.entries(entries).map(([name, entry]) => ({ name, ...entry }));
    },
    async get(name) {
      const entry = entries[name];
      if (!entry) return null;
      return { name, verified: verified.has(name), ...entry };
    },
    async markVerified(name, runId) {
      marked.push({ name, runId });
      verified.add(name);
    },
    isExposed: () => true,
    async dispose() {},
  };
}

/**
 * 全绿能力目录桩：任何能力名都返回五态皆真的条目，用于只关心 run 流程的用例。
 *
 * 故意不维护白名单：这些用例要验的是 run 生命周期，不该因为换了能力名就红。
 * 白名单只在需要验「某一层为假」的用例里显式构造。
 */
function readyCatalog() {
  const catalog = createCatalogStub({ entries: {} });
  catalog.get = async (name) => ({
    name,
    verified: false,
    upstream: true,
    depsAvailable: true,
    configured: true,
    exposed: true,
  });
  catalog.list = async () => [];
  return catalog;
}

const READY_CONFIG = Object.freeze({
  dataDir: 'C:\\tmp\\deeptutor',
  homeDir: 'C:\\tmp\\deeptutor\\home',
  runsDir: 'C:\\tmp\\deeptutor\\runs',
  vendorPath: 'C:\\tmp\\deeptutor\\vendor',
  python: { ok: true, path: 'C:\\py\\python.exe', version: '3.11.9', source: 'managed-venv' },
  deps: { installed: true, deeptutorVersion: '1.6.15' },
});

/** 造一份上游 `do_question` 结果信封（形状取自 pipeline.py `_build_result_payload`）。 */
function quizPayload(rows) {
  return {
    response: '已生成',
    mode: 'custom',
    summary: {
      success: true,
      requested: rows.length,
      completed: rows.length,
      results: rows.map((qaPair, index) => ({ qa_pair: qaPair, metadata: { taskId: `task_${index}` } })),
    },
  };
}

function conceptQuestion(overrides = {}) {
  return {
    question_id: 'q_concept',
    question: '水的标准沸点是 100 摄氏度。',
    question_type: 'concept',
    options: null,
    correct_answer: 'true',
    explanation: '标准大气压下成立。',
    difficulty: 'easy',
    concentration: '物理',
    ...overrides,
  };
}

function choiceQuestion(overrides = {}) {
  return {
    question_id: 'q_choice',
    question: '下列哪个数是质数？',
    question_type: 'choice',
    options: { A: '4', B: '5', C: '6', D: '8' },
    correct_answer: 'B',
    explanation: '5 只有 1 和自身两个因数。',
    difficulty: 'medium',
    concentration: '数学',
    ...overrides,
  };
}

/** 事件通知的统一形状：`turn.event` 报文里带 runId 与上游 StreamEvent 字段。 */
function turnEvent(runId, event) {
  return { runId, ...event };
}

// ── 0. apply 期永不抛错 ───────────────────────────────────────────────────────

test('createService 在完全没有协作者时也不抛错（apply 期不能拖垮工作台）', async () => {
  const service = createService({});
  assert.equal(typeof service.status, 'function');
  assert.equal(typeof service.dispose, 'function');
  // 缺协作者时要能如实报状态，而不是抛。
  const report = await service.status();
  assert.equal(typeof report.state, 'string');
  assert.ok(report.warnings.length > 0, '缺协作者时应当有告警');
  await service.dispose();
});

// ── 1. status() 的 7 个状态 ───────────────────────────────────────────────────

test('status：ready —— 解释器与依赖都已就绪', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    config: READY_CONFIG,
    logger: SILENT,
  });
  const report = await service.status();
  assert.equal(report.state, 'ready');
  assert.equal(report.python.version, '3.11.9');
  assert.equal(report.python.source, 'managed-venv');
  assert.equal(report.deeptutorVersion, '1.6.15');
  assert.equal(report.dataRoot, READY_CONFIG.dataDir);
  assert.equal(report.home, READY_CONFIG.homeDir);
  assert.equal(report.vendorPath, READY_CONFIG.vendorPath);
  assert.equal(report.process.pid, 4321);
  assert.equal(report.process.idleTimeoutMs, 600_000);
  // 上游指纹必须来自 upstream.lock.json，不能是 null（那是唯一事实来源）。
  assert.match(report.upstream.commit, /^[0-9a-f]{40}$/);
  assert.equal(report.upstream.version, '1.6.15');
  assert.match(report.upstream.archiveSha256, /^[0-9a-f]{64}$/);
  await service.dispose();
});

test('status：disabled —— 配置里关掉服务', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    config: { ...READY_CONFIG, disabled: true },
    logger: SILENT,
  });
  const report = await service.status();
  assert.equal(report.state, 'disabled');
  await service.dispose();
});

test('status：not-installed —— 找不到解释器', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    config: { ...READY_CONFIG, python: { ok: false, reason: '未找到 python3' } },
    logger: SILENT,
  });
  const report = await service.status();
  assert.equal(report.state, 'not-installed');
  assert.ok(report.warnings.some((w) => w.includes('未找到可用的 Python 解释器')));
  await service.dispose();
});

test('status：unsupported-python —— 版本落在 3.11–3.14 之外', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    // 3.9 与 3.15 都在区间外；这里用 3.9 这个最常见的"系统自带 Python"。
    config: { ...READY_CONFIG, python: { ok: false, path: 'C:\\py39\\python.exe', version: '3.9.13' } },
    logger: SILENT,
  });
  const report = await service.status();
  assert.equal(report.state, 'unsupported-python');
  assert.ok(report.warnings.some((w) => w.includes('3.9.13')));
  await service.dispose();
});

test('status：deps-missing —— vendor 依赖没装好', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    config: { ...READY_CONFIG, deps: { installed: false, reason: 'import deeptutor 失败' } },
    logger: SILENT,
  });
  const report = await service.status();
  assert.equal(report.state, 'deps-missing');
  await service.dispose();
});

test('status：crashed —— 上游子进程反复崩溃', async () => {
  const { bridge } = createFakeBridge({ state: 'crashed' });
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    config: READY_CONFIG,
    logger: SILENT,
  });
  assert.equal((await service.status()).state, 'crashed');
  await service.dispose();
});

test('status：starting —— 子进程还在启动', async () => {
  const { bridge } = createFakeBridge({ state: 'starting' });
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    config: READY_CONFIG,
    logger: SILENT,
  });
  assert.equal((await service.status()).state, 'starting');
  await service.dispose();
});

test('status：未探测时如实留 null 并进 warnings，不编造默认值', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    // python / deps 都是空对象 = 还没探测过。
    config: { dataDir: 'C:\\d', homeDir: 'C:\\d\\home', vendorPath: 'C:\\d\\vendor', python: {}, deps: {} },
    logger: SILENT,
  });
  const report = await service.status();
  assert.equal(report.state, 'ready');
  assert.equal(report.python.path, null);
  assert.equal(report.python.version, null);
  assert.equal(report.python.source, null);
  assert.equal(report.deeptutorVersion, null);
  assert.ok(report.warnings.some((w) => w.includes('尚未探测 Python 解释器')));
  assert.ok(report.warnings.some((w) => w.includes('尚未探测上游依赖')));
  await service.dispose();
});

test('status 报告的 state 一定落在契约的 7 个状态里', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: createCatalogStub({ entries: {} }),
    config: READY_CONFIG,
    logger: SILENT,
  });
  const allowed = ['ready', 'disabled', 'starting', 'not-installed', 'unsupported-python', 'deps-missing', 'crashed'];
  assert.ok(allowed.includes((await service.status()).state));
  await service.dispose();
});

// ── 2. 能力五态推导（含 math_animator 依赖缺失的真实反例） ────────────────────

test('五态顺序与上游 lock 里的 deferred extras 对得上', () => {
  assert.deepEqual([...FIVE_STATES], ['upstream', 'depsAvailable', 'configured', 'verified', 'exposed']);
  // math_animator 依赖 manim，而 manim 在 upstream.lock.json 的 extrasDeferred 里。
  assert.ok(DEFERRED_EXTRAS.includes('math-animator'));
});

test('五态：上游 locks 之外的能力一律从蓝图（内置静态表）取到', async () => {
  const catalog = createCapabilityCatalog({ logger: SILENT });
  const entries = await catalog.list();
  const names = entries.map((entry) => entry.name);
  for (const name of [
    'chat',
    'ask_questions',
    'deep_solve',
    'deep_question',
    'deep_research',
    'math_animator',
    'visualize',
    'mastery_path',
    'immersive_reading',
    'course_study',
    'audio_overview',
  ]) {
    assert.ok(names.includes(name), `11 个内置能力里应该有 ${name}`);
  }
  assert.equal(entries.length, 11);
  await catalog.dispose();
});

test('五态：math_animator 因缺 manim 判 depsAvailable=false 且给可解释原因', async () => {
  const catalog = createCapabilityCatalog({ logger: SILENT });
  const math = await catalog.get('math_animator');
  assert.equal(math.upstream, true);
  assert.equal(math.depsAvailable, false, 'manim 属于 deferred extras，默认没装');
  assert.equal(math.configured, true);
  assert.equal(math.exposed, true, 'exposed 默认放开，不该因为依赖缺失一起变灰');
  assert.equal(math.verified, false);
  assert.match(math.reason, /math-animator/);
  assert.notEqual(math.installHint, '');

  // 同一次目录里，deep_question 的依赖是齐的 —— 证明上面那条不是"全灭"。
  const quiz = await catalog.get('deep_question');
  assert.equal(quiz.depsAvailable, true);
  assert.equal(quiz.reason, '');
  await catalog.dispose();
});

test('五态：依赖探针报整体未安装时所有能力一起不可用', async () => {
  const catalog = createCapabilityCatalog({
    logger: SILENT,
    deps: { installed: false, missing: ['deeptutor'] },
  });
  const entries = await catalog.list();
  assert.equal(entries.length, 11);
  for (const entry of entries) {
    assert.equal(entry.depsAvailable, false, `${entry.name} 在整机依赖缺失时不该是可用的`);
    assert.match(entry.reason, /依赖/);
  }
  await catalog.dispose();
});

test('五态：extras 装好之后 math_animator 转为可用（探针说了算）', async () => {
  const catalog = createCapabilityCatalog({
    logger: SILENT,
    deps: { installed: true, installedExtras: ['server', 'math-animator'], missingExtras: [] },
  });
  const math = await catalog.get('math_animator');
  assert.equal(math.depsAvailable, true);
  assert.equal(math.reason, '');
  await catalog.dispose();
});

test('五态：configured / exposed 由配置决定，reason 说明是哪一层挡住', async () => {
  const catalog = createCapabilityCatalog({
    logger: SILENT,
    configured: { chat: false },
    expose: { math_animator: false },
  });
  const chat = await catalog.get('chat');
  assert.equal(chat.configured, false);
  assert.match(chat.reason, /缺少必需配置/);

  // math_animator 同时依赖缺失 + 未开放：explain 有短路，先报依赖（用户下一步该做的事）。
  const math = await catalog.get('math_animator');
  assert.equal(math.exposed, false);
  assert.match(math.reason, /math-animator/);
  await catalog.dispose();
});

test('五态：未知能力名返回 null（由服务面翻译成 E_CAPABILITY_UNAVAILABLE）', async () => {
  const catalog = createCapabilityCatalog({ logger: SILENT });
  assert.equal(await catalog.get('no_such_capability'), null);
  await catalog.dispose();
});

test('五态：verified 只认带真实 runId 的状态记录，手写 true 不算数', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deeptutor-verified-'));
  const stateFile = join(dir, 'capabilities-state.json');
  try {
    // 手写一份"置真"的记录：没有任何 runId —— 必须被整条丢弃。
    await writeFile(stateFile, JSON.stringify({ deep_question: true, math_animator: { verifiedAt: 'x' } }), 'utf8');
    const catalog = createCapabilityCatalog({ stateFile, logger: SILENT });
    assert.equal((await catalog.get('deep_question')).verified, false, '手写 true 不能把能力置为已验证');
    assert.equal((await catalog.get('math_animator')).verified, false, '缺 runId 的记录不能算验证');
    await catalog.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('五态：markVerified 必须给真实 runId，并落盘为唯一事实来源', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deeptutor-markverified-'));
  const stateFile = join(dir, 'capabilities-state.json');
  try {
    const catalog = createCapabilityCatalog({ stateFile, logger: SILENT });
    await assert.rejects(() => catalog.markVerified('chat', ''), (error) => {
      assert.equal(error.kind, 'E_PROTOCOL');
      assert.match(error.message, /真实运行 ID/);
      return true;
    });
    await catalog.markVerified('chat', 'run_abc');
    const raw = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(raw.chat.runId, 'run_abc');
    assert.equal(typeof raw.chat.verifiedAt, 'string');
    await catalog.dispose();

    // 新目录实例读到同一份文件 → verified 为真。
    const reopened = createCapabilityCatalog({ stateFile, logger: SILENT });
    assert.equal((await reopened.get('chat')).verified, true);
    await reopened.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── 3. 服务不可用时抛对错误种类 ───────────────────────────────────────────────

test('服务关闭后调用方法抛 E_DISABLED', async () => {
  const service = createService({ config: READY_CONFIG, logger: SILENT });
  await service.dispose();
  await assert.rejects(() => service.runs.start({ capability: 'chat', input: {} }), (error) => {
    assert.equal(error.kind, 'E_DISABLED');
    return true;
  });
});

test('未注入 Python 桥时抛 E_BRIDGE_UNAVAILABLE（而不是假装没装 Python）', async () => {
  const service = createService({
    catalog: readyCatalog(),
    config: { ...READY_CONFIG, python: {}, deps: {} },
    logger: SILENT,
  });
  await assert.rejects(() => service.runs.start({ capability: 'deep_question', input: {} }), (error) => {
    assert.equal(error.kind, 'E_BRIDGE_UNAVAILABLE');
    assert.match(error.message, /未注入 Python 桥/);
    return true;
  });
  await service.dispose();
});

test('解释器缺失时抛 E_PYTHON_MISSING', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: readyCatalog(),
    config: { ...READY_CONFIG, python: { ok: false, reason: '没有解释器' } },
    logger: SILENT,
  });
  await assert.rejects(() => service.runs.start({ capability: 'deep_question', input: {} }), (error) => {
    assert.equal(error.kind, 'E_PYTHON_MISSING');
    return true;
  });
  await service.dispose();
});

test('依赖未装时抛 E_DEPS_MISSING，消息里带 pip 指引', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({
    bridge,
    catalog: readyCatalog(),
    config: { ...READY_CONFIG, deps: { installed: false, reason: 'import deeptutor 失败' } },
    logger: SILENT,
  });
  await assert.rejects(() => service.runs.start({ capability: 'deep_question', input: {} }), (error) => {
    assert.equal(error.kind, 'E_DEPS_MISSING');
    assert.match(error.message, /requirements\/server\.txt/);
    return true;
  });
  await service.dispose();
});

test('能力不存在或某一层为假时抛 E_CAPABILITY_UNAVAILABLE 并带原因', async () => {
  const { bridge } = createFakeBridge();
  const catalog = createCatalogStub({
    entries: {
      chat: { upstream: true, depsAvailable: true, configured: true, exposed: true },
      math_animator: {
        upstream: true,
        depsAvailable: false,
        configured: true,
        exposed: true,
        reason: '缺少上游 extras：math-animator（默认安装不含）',
      },
    },
  });
  const service = createService({ bridge, catalog, config: READY_CONFIG, logger: SILENT });

  await assert.rejects(() => service.runs.start({ capability: 'nope', input: {} }), (error) => {
    assert.equal(error.kind, 'E_CAPABILITY_UNAVAILABLE');
    assert.match(error.message, /nope/);
    return true;
  });

  await assert.rejects(() => service.runs.start({ capability: 'math_animator', input: {} }), (error) => {
    assert.equal(error.kind, 'E_CAPABILITY_UNAVAILABLE');
    assert.equal(error.detail.layer, 'depsAvailable');
    assert.match(error.message, /math-animator/);
    return true;
  });
  await service.dispose();
});

// ── 4. 指纹与 cached 命中 ─────────────────────────────────────────────────────

test('指纹：同样的请求得到同样的指纹，命中已完成 run 返回 cached:true 且不再调上游', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deeptutor-fingerprint-'));
  const runsDir = join(dir, 'runs');
  const runStore = createRunStore({ runsDir, logger: SILENT });
  const result = quizPayload([conceptQuestion()]);

  const { bridge, calls } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_1', sessionId: 'sess_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result, usage: { input: 12, output: 34 } }),
    },
  });
  const catalog = readyCatalog();
  const service = createService({
    bridge,
    catalog,
    runStore,
    config: { ...READY_CONFIG, runsDir },
    logger: SILENT,
  });

  const request = { capability: 'deep_question', input: { topic: '大气压', count: 2 } };
  const first = await service.runs.start(request);
  assert.match(first.fingerprint, /^sha256:[0-9a-f]{64}$/);
  await service.runs.result(first.runId);

  const turnStarts = calls.filter((call) => call.method === 'turn.start').length;
  assert.equal(turnStarts, 1);

  // 同样的 capability + input + 资源 → 同一指纹 → 直接复用。
  const second = await service.runs.start(request);
  assert.equal(second.cached, true);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(second.runId, first.runId, '缓存命中应复用原始 runId');
  assert.equal(second.status, 'succeeded');
  assert.deepEqual(second.result, result);
  assert.equal(
    calls.filter((call) => call.method === 'turn.start').length,
    1,
    '指纹命中时绝不能再调一次上游',
  );

  // 换一个输入 → 指纹必须变，并且真的重新跑一次。
  const third = await service.runs.start({ capability: 'deep_question', input: { topic: '浮力', count: 2 } });
  assert.notEqual(third.fingerprint, first.fingerprint);
  assert.equal(third.cached, undefined);
  await service.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('指纹：资源版本变化会改变指纹（同一份资源不同 revision 不能算命中）', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: {}, usage: null }),
    },
  });
  const service = createService({
    bridge,
    catalog: readyCatalog(),
    config: READY_CONFIG,
    logger: SILENT,
  });

  const base = {
    capability: 'deep_question',
    input: { topic: '力学' },
    resourceHandles: [{ handleId: 'h1', resourceId: 'res_1', revision: 'sha256:aaa' }],
  };
  const a = await service.runs.start(base);
  await service.runs.result(a.runId);

  const b = await service.runs.start({
    ...base,
    resourceHandles: [{ handleId: 'h2', resourceId: 'res_1', revision: 'sha256:bbb' }],
  });
  assert.notEqual(b.fingerprint, a.fingerprint);
  assert.notEqual(b.cached, true);

  // 同一个 revision、只是 handleId 变了 → 指纹不变（handleId 是本次会话的句柄，不是内容身份）。
  const c = await service.runs.start({
    ...base,
    resourceHandles: [{ handleId: 'h3', resourceId: 'res_1', revision: 'sha256:aaa' }],
  });
  assert.equal(c.fingerprint, a.fingerprint);
  await service.dispose();
});

test('指纹：失败的 run 不登记缓存（半截结果不能被复用）', async () => {
  let attempt = 0;
  const { bridge, calls } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        attempt += 1;
        if (attempt === 1) {
          bridge.emit('turn.event', turnEvent(params.runId, { type: 'error', content: '上游炸了' }));
          return { turnId: 'turn_1' };
        }
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_2' };
      },
      'turn.result': async () => (attempt === 1
        ? { status: 'failed', result: null, error: { kind: 'E_UPSTREAM_ERROR', message: '上游炸了' } }
        : { status: 'succeeded', result: { ok: true } }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });

  const request = { capability: 'deep_question', input: { topic: '失败重试' } };
  const first = await service.runs.start(request);
  const failed = await service.runs.result(first.runId);
  assert.equal(failed.status, 'failed');

  const second = await service.runs.start(request);
  assert.notEqual(second.cached, true, '失败的 run 不能被指纹复用');
  assert.equal(calls.filter((call) => call.method === 'turn.start').length, 2);
  await service.dispose();
});

// ── 5. 事件流：sequence 单调、afterSeq 重放 ───────────────────────────────────

test('事件流：sequence 由 Node 单调分配，从 1 开始连续递增', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        // 上游自报的 seq 与 Node 的 sequence 是两回事：这里故意让它乱序 + 重复。
        for (const [index, type] of ['stage_start', 'content', 'progress', 'result', 'done'].entries()) {
          bridge.emit('turn.event', turnEvent(params.runId, {
            type,
            seq: index % 2 === 0 ? 99 : 7,
            stage: 'ideation',
            content: `第 ${index} 条`,
          }));
        }
        return { turnId: 'turn_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: {}, usage: { input: 1, output: 2 } }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const run = await service.runs.start({ capability: 'deep_question', input: { topic: 'x' } });
  await service.runs.result(run.runId);

  const seen = [];
  for await (const event of service.runs.events({ runId: run.runId })) seen.push(event);
  assert.equal(seen.length, 5);
  assert.deepEqual(seen.map((event) => event.sequence), [1, 2, 3, 4, 5]);
  // sequence 必须严格单调递增。
  for (let index = 1; index < seen.length; index += 1) {
    assert.ok(seen[index].sequence > seen[index - 1].sequence);
  }
  // 上游自报的 seq 原样保留在 upstreamSequence 里（99/7 乱序也不受影响），
  // 与 Node 分配的 sequence 是两个独立字段 —— 不能拿上游乱序值当进度。
  assert.deepEqual(seen.map((event) => event.upstreamSequence), [99, 7, 99, 7, 99]);
  assert.notDeepEqual(seen.map((event) => event.sequence), seen.map((event) => event.upstreamSequence));
  assert.deepEqual(seen.map((event) => event.kind), [
    'stage-start',
    'content',
    'progress',
    'result',
    'done',
  ]);
  await service.dispose();
});

test('事件流：afterSeq 重放只发之后的事件，且可重复重放', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        for (const type of ['stage_start', 'thinking', 'content', 'done']) {
          bridge.emit('turn.event', turnEvent(params.runId, { type, content: type }));
        }
        return { turnId: 'turn_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: {}, usage: null }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const run = await service.runs.start({ capability: 'chat', input: {} });
  await service.runs.result(run.runId);

  const tail = [];
  for await (const event of service.runs.events({ runId: run.runId, afterSeq: 2 })) tail.push(event);
  assert.deepEqual(tail.map((event) => event.sequence), [3, 4]);

  const all = [];
  for await (const event of service.runs.events({ runId: run.runId, afterSeq: 0 })) all.push(event);
  assert.deepEqual(all.map((event) => event.sequence), [1, 2, 3, 4]);

  // 重放是幂等的：再来一次还是同样的四条。
  const again = [];
  for await (const event of service.runs.events({ runId: run.runId, afterSeq: 0 })) again.push(event);
  assert.equal(again.length, 4);
  await service.dispose();
});

test('事件流：在飞 run 可以边产出边消费（不是等结束才一次性吐出）', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      // turn.start 立刻返回，事件稍后通过通知流动 —— 这正是契约 §4 的时序。
      'turn.start': async (params) => {
        setTimeout(() => bridge.emit('turn.event', turnEvent(params.runId, { type: 'stage_start', stage: 'ideation' })), 5);
        setTimeout(() => bridge.emit('turn.event', turnEvent(params.runId, { type: 'content', content: '第一段' })), 10);
        setTimeout(() => bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' })), 15);
        return { turnId: 'turn_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: {}, usage: null }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const run = await service.runs.start({ capability: 'chat', input: {} });

  const observed = [];
  for await (const event of service.runs.events({ runId: run.runId })) {
    observed.push({ kind: event.kind, atMs: Date.now() - run.startedAt });
    if (event.kind === 'done') break;
  }
  assert.deepEqual(observed.map((item) => item.kind), ['stage-start', 'content', 'done']);
  await service.dispose();
});

test('事件流：未知 runId 抛 E_PROTOCOL，不静默返回空流', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  await assert.rejects(async () => {
    for await (const _event of service.runs.events({ runId: 'run_nope' })) {
      assert.fail('不该收到任何事件');
    }
  }, (error) => {
    assert.equal(error.kind, 'E_PROTOCOL');
    return true;
  });
  await service.dispose();
});

// ── 6. 未映射的上游事件必须落 diagnostic 且不丢 ──────────────────────────────

test('未映射的上游事件类型落 diagnostic，内容与 metadata 原样保留', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, {
          type: 'brand_new_upstream_event',
          stage: 'ideation',
          content: '这是一个还没进映射表的上游事件',
          metadata: { nested: { keep: 'me' }, n: 1 },
        }));
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: {}, usage: null }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const run = await service.runs.start({ capability: 'chat', input: {} });
  await service.runs.result(run.runId);

  const seen = [];
  for await (const event of service.runs.events({ runId: run.runId })) seen.push(event);

  const diagnostic = seen.find((event) => event.upstreamType === 'brand_new_upstream_event');
  assert.ok(diagnostic, '未映射事件绝不能丢：必须留在流里');
  assert.equal(diagnostic.kind, 'diagnostic');
  assert.equal(diagnostic.upstreamType, 'brand_new_upstream_event');
  assert.equal(diagnostic.content, '这是一个还没进映射表的上游事件');
  assert.deepEqual(diagnostic.metadata, { nested: { keep: 'me' }, n: 1 });
  assert.equal(diagnostic.stage, 'ideation');
  // 事件条数 = 2（未映射那条 + done），证明没被过滤掉。
  assert.equal(seen.length, 2);
  await service.dispose();
});

test('未映射的上游事件同时进 diagnostics.ndjson（落盘证据）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deeptutor-diagnostics-'));
  const runsDir = join(dir, 'runs');
  const runStore = createRunStore({ runsDir, logger: SILENT });
  const { bridge } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'totally_unknown', content: 'x' }));
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: {}, usage: { input: 3, output: 4 } }),
    },
  });
  const service = createService({
    bridge,
    catalog: readyCatalog(),
    runStore,
    config: { ...READY_CONFIG, runsDir },
    logger: SILENT,
  });
  const run = await service.runs.start({ capability: 'chat', input: {} });
  await service.runs.result(run.runId);
  // 等落盘流关闭（finalize 里 close 是同步的，但 append 是异步的）。
  await new Promise((resolve) => setTimeout(resolve, 30));

  const diagnosticsRaw = await readFile(join(runStore.dir(run.runId), 'diagnostics.ndjson'), 'utf8');
  const rows = diagnosticsRaw.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(rows.some((row) => row.upstreamType === 'totally_unknown'));
  assert.ok(rows.some((row) => /不在契约/.test(row.reason ?? '')));

  // 五个证据文件都要在（契约 §12）。
  for (const name of ['request.json', 'events.ndjson', 'result.json', 'usage.json', 'diagnostics.ndjson']) {
    const content = await readFile(join(runStore.dir(run.runId), name), 'utf8');
    assert.ok(content.length > 0, `${name} 应该是非空证据文件`);
  }
  await service.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('事件：上游没给 counts 时留 null，绝不按已发事件数编造进度', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'progress', stage: 'generation' }));
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: {}, usage: null }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const run = await service.runs.start({ capability: 'deep_question', input: {} });
  await service.runs.result(run.runId);

  const progress = [];
  for await (const event of service.runs.events({ runId: run.runId })) {
    if (event.kind === 'progress') progress.push(event);
  }
  assert.equal(progress.length, 1);
  assert.deepEqual(progress[0].counts, { done: null, total: null });
  await service.dispose();
});

test('事件：上游给了 counts 就原样透传（不重算）', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'turn.start': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'progress', counts: { done: 3, total: 10 } }));
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_1' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: {}, usage: null }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const run = await service.runs.start({ capability: 'deep_question', input: {} });
  await service.runs.result(run.runId);
  for await (const event of service.runs.events({ runId: run.runId })) {
    if (event.kind === 'progress') assert.deepEqual(event.counts, { done: 3, total: 10 });
  }
  await service.dispose();
});

// ── 7. verified 只能由真实成功 run 触发 ──────────────────────────────────────

test('成功的 run 会把该能力标记为已验证（唯一置真路径）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deeptutor-verify-success-'));
  const stateFile = join(dir, 'capabilities-state.json');
  try {
    const { bridge } = createFakeBridge({
      handlers: {
        'turn.start': async (params) => {
          bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
          return { turnId: 'turn_1' };
        },
        'turn.result': async () => ({ status: 'succeeded', result: { ok: true }, usage: null }),
      },
    });
    const service = createService({
      bridge,
      catalog: createCapabilityCatalog({ stateFile, logger: SILENT }),
      config: READY_CONFIG,
      logger: SILENT,
    });
    const run = await service.runs.start({ capability: 'chat', input: {} });
    await service.runs.result(run.runId);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const raw = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(raw.chat.runId, run.runId, 'verified 必须记录真实 runId');
    await service.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('失败的 run 不会把能力标记为已验证', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deeptutor-verify-fail-'));
  const stateFile = join(dir, 'capabilities-state.json');
  try {
    const { bridge } = createFakeBridge({
      handlers: {
        'turn.start': async (params) => {
          bridge.emit('turn.event', turnEvent(params.runId, { type: 'error', content: '炸了' }));
          return { turnId: 'turn_1' };
        },
        'turn.result': async () => ({ status: 'failed', result: null, error: { kind: 'E_UPSTREAM_ERROR', message: '炸了' } }),
      },
    });
    const service = createService({
      bridge,
      catalog: createCapabilityCatalog({ stateFile, logger: SILENT }),
      config: READY_CONFIG,
      logger: SILENT,
    });
    const run = await service.runs.start({ capability: 'chat', input: {} });
    const final = await service.runs.result(run.runId);
    assert.equal(final.status, 'failed');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const catalog = createCapabilityCatalog({ stateFile, logger: SILENT });
    assert.equal((await catalog.get('chat')).verified, false);
    await catalog.dispose();
    await service.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── 8. 出题适配器（concept → judge 这条硬要求） ──────────────────────────────

test('题型映射：concept 是判断题 trueFalse，绝不是概念填空', () => {
  // 上游 pipeline.py:156 QuestionType 只有 6 个值；pipeline.py:1436-1445 把 concept
  // 的答案规范成 "true"/"false"，并用 concept_must_not_have_options /
  // concept_correct_answer_must_be_true_or_false 两条校验兜底。
  assert.equal(
    QUESTION_TYPE_MAP.concept,
    'trueFalse',
    'concept 在上游是判断题（答案只有 true/false），不是概念填空；映射错会让整批题按填空判据质检',
  );
  assert.equal(QUESTION_TYPE_MAP.concept, JUDGE_TYPE);
  assert.notEqual(QUESTION_TYPE_MAP.concept, 'cloze', 'cloze 是填空题，concept 不是');
});

test('题型映射：主流水线六个题型全覆盖且都落在智云词表内', () => {
  const mainPipeline = {
    choice: 'mcq',
    concept: 'trueFalse',
    fill_in_blank: 'cloze',
    short_answer: 'shortAnswer',
    written: 'shortAnswer',
    coding: 'shortAnswer',
  };
  for (const [upstream, expected] of Object.entries(mainPipeline)) {
    assert.equal(QUESTION_TYPE_MAP[upstream], expected, `${upstream} 应映射为 ${expected}`);
    assert.ok(
      ['cloze', 'mcq', 'trueFalse', 'shortAnswer'].includes(QUESTION_TYPE_MAP[upstream]),
      `${upstream} 映射结果必须在智云词表内`,
    );
  }
});

test('题型映射：刷题导入流水线那套也登记了，且多选不硬塞成单选', () => {
  // services/practice/importing.py:27 TYPES —— 另一条独立流水线。
  assert.equal(QUESTION_TYPE_MAP.single_choice, 'mcq');
  assert.equal(QUESTION_TYPE_MAP.true_false, 'trueFalse');
  assert.equal(QUESTION_TYPE_MAP.fill_blank, 'cloze');
  assert.equal(QUESTION_TYPE_MAP.short_answer, 'shortAnswer');
  // 智云词表没有多选题；硬映射成 mcq 会让质检按"唯一正确选项"放过多选。
  assert.equal(QUESTION_TYPE_MAP.multi_choice, 'unknown');
});

test('判断题别名归一：judge / true_false / tf 一律落到 trueFalse', () => {
  assert.equal(JUDGE_TYPE, 'trueFalse');
  for (const alias of ['judge', 'trueFalse', 'true_false', 'tf', '判断', '判断题', 'TrueFalse', 'TF']) {
    // 别名表的键一律小写，查表前必须先归一大小写（isJudgeType 内部就做了这件事）。
    assert.equal(JUDGE_ALIASES[alias.toLowerCase()], 'trueFalse', `别名 ${alias} 应归一为 trueFalse`);
    assert.equal(isJudgeType(alias), true, `isJudgeType(${alias}) 应为真`);
  }
  assert.equal(isJudgeType('mcq'), false);
  assert.equal(isJudgeType('concept'), false, 'concept 是上游原值，应通过映射表而非别名表归一');
});

test('toQuizCandidates：concept 题产出 trueFalse 候选，答案布尔化并保留 rawType', () => {
  const { questions, diagnostics } = toQuizCandidates({
    capabilityResult: quizPayload([
      conceptQuestion(),
      choiceQuestion(),
    ]),
    runId: 'run_q1',
    resourceRevision: 'sha256:res1',
  });

  assert.equal(questions.length, 2);
  assert.deepEqual(diagnostics, []);

  const [judge, choice] = questions;
  assert.equal(judge.type, 'trueFalse');
  assert.equal(judge.rawType, 'concept', '必须保留上游原值，方便归因');
  assert.equal(judge.answer, true, 'concept 的 "true" 要变成布尔 true');
  assert.equal(judge.typeVocabulary, 'strategies');
  assert.equal(judge.options, null, '判断题不该带选项');
  assert.equal(judge.stem, '水的标准沸点是 100 摄氏度。');
  assert.equal(judge.topic, '物理');

  assert.equal(choice.type, 'mcq');
  assert.equal(choice.rawType, 'choice');
  assert.equal(choice.answer, 'B');
  assert.deepEqual(choice.options, { A: '4', B: '5', C: '6', D: '8' });
});

test('toQuizCandidates：concept 题答案不是布尔语义时拒收并说明原因（不猜）', () => {
  const { questions, diagnostics } = toQuizCandidates({
    capabilityResult: quizPayload([conceptQuestion({ correct_answer: '不属于这个范畴' })]),
    runId: 'run_q2',
  });
  assert.equal(questions.length, 0);
  assert.ok(diagnostics.some((item) => item.kind === 'rejected' && /true\/false/.test(item.reason)));
  // 拒收也要说明"上游本应规范化"，而不是静默少几道题。
  assert.ok(diagnostics.some((item) => item.kind === 'all-rejected'));
});

test('toQuizCandidates：未知题型落 unknown 并进 diagnostics，不丢题也不猜', () => {
  const { questions, diagnostics } = toQuizCandidates({
    capabilityResult: quizPayload([
      conceptQuestion(),
      {
        question_id: 'q_weird',
        question: '这道题的类型没人认识',
        question_type: 'proof_by_induction',
        correct_answer: 'x',
        explanation: 'y',
      },
    ]),
    runId: 'run_q3',
  });
  assert.equal(questions.length, 1, '可映射那一道仍要产出');
  assert.equal(questions[0].type, 'trueFalse');
  const rejected = diagnostics.filter((item) => item.kind === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].rawType, 'proof_by_induction');
  assert.match(rejected[0].reason, /无法映射到智云词表/);
});

test('toQuizCandidates：多选题不被硬塞成单选（落 unknown 并注明原因）', () => {
  const { questions, diagnostics } = toQuizCandidates({
    capabilityResult: quizPayload([
      {
        question_id: 'q_multi',
        question: '下列哪些是质数？',
        question_type: 'multi_choice',
        options: { A: '2', B: '3', C: '4', D: '6' },
        correct_answer: 'AB',
        explanation: '2 和 3 是质数。',
      },
    ]),
    runId: 'run_q4',
  });
  assert.equal(questions.length, 0, '多选题不能落成 mcq —— 那样质检会按单选判据放过它');
  assert.ok(diagnostics.some((item) => item.rawType === 'multi_choice'));
});

test('toQuizCandidates：没有题目时明确报 no-questions，返回空而不抛', () => {
  const { questions, diagnostics } = toQuizCandidates({
    capabilityResult: { response: '抱歉，这次没生成出来', mode: 'followup', question_id: 'q0' },
    runId: 'run_q5',
  });
  assert.deepEqual(questions, []);
  assert.equal(diagnostics[0].kind, 'no-questions');
});

test('toQuizCandidates：能吃掉上游几种结果信封（summary.results[].qa_pair / questions / 裸数组）', () => {
  const nested = quizPayload([choiceQuestion()]);
  const flat = [conceptQuestion()];
  const withQuestions = { questions: [choiceQuestion({ question_id: 'q_x' })] };
  for (const payload of [nested, flat, withQuestions]) {
    const { questions } = toQuizCandidates({ capabilityResult: payload, runId: 'run_env' });
    assert.equal(questions.length, 1, `${JSON.stringify(payload).slice(0, 40)}… 应能解析出一道题`);
  }
});

test('toQuizCandidates：候选保留 rawOutput / modelSnapshot / anchors / taskId', () => {
  const anchors = [{ anchorId: 'a1', resourceId: 'res_1' }];
  const { questions } = toQuizCandidates({
    capabilityResult: quizPayload([choiceQuestion()]),
    runId: 'run_q6',
    resourceRevision: 'sha256:abc',
    resourceAnchors: anchors,
  });
  const [candidate] = questions;
  assert.equal(candidate.runId, 'run_q6');
  assert.equal(candidate.typeVocabulary, 'strategies');
  assert.equal(candidate.taskId, 'task_0');
  assert.equal(candidate.resourceRevision, 'sha256:abc');
  assert.deepEqual(candidate.anchors, anchors);
  assert.equal(candidate.rawOutput.question_type, 'choice', 'rawOutput 必须原样保留上游输出');
  assert.equal(candidate.modelSnapshot.taskId, undefined);
});

// ── 9. quiz.generate / reading.act / artifacts ───────────────────────────────

test('quiz.generate 返回可落盘的候选题目，被拒的进 diagnostics', async () => {
  const result = quizPayload([
    conceptQuestion(),
    choiceQuestion(),
    {
      question_id: 'q_bad',
      question: '题干在但类型不认识',
      question_type: 'mystery_type',
      correct_answer: 'z',
    },
  ]);
  const { bridge } = createFakeBridge({
    handlers: {
      'quiz.generate': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_q', sessionId: 'sess_q' };
      },
      'turn.result': async () => ({ status: 'succeeded', result, usage: { input: 10, output: 20 } }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const generated = await service.quiz.generate({ request: { topic: '物理', count: 2 } });

  assert.equal(generated.status, 'succeeded');
  assert.equal(generated.turnId, 'turn_q');
  assert.equal(generated.sessionId, 'sess_q');
  assert.equal(generated.questions.length, 2);
  assert.ok(generated.questions.every((question) => question.type === 'trueFalse' || question.type === 'mcq'));
  assert.ok(generated.diagnostics.some((item) => item.rawType === 'mystery_type'));
  assert.deepEqual(generated.usage, { input: 10, output: 20 });
  await service.dispose();
});

test('quiz.generate：上游失败时抛错而不是返回空题目数组，并带上 runId', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'quiz.generate': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'error', content: '上游模板全失败' }));
        return { turnId: 'turn_q' };
      },
      'turn.result': async () => ({ status: 'failed', result: null, error: { kind: 'E_UPSTREAM_ERROR', message: '上游模板全失败' } }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  await assert.rejects(() => service.quiz.generate({ request: { topic: '失败' } }), (error) => {
    assert.equal(error.kind, 'E_UPSTREAM_ERROR');
    assert.match(error.message, /上游出题失败/);
    assert.match(error.detail.runId, /^run_/, 'runId 必须在 detail 里，便于定位证据目录');
    return true;
  });
  await service.dispose();
});

test('quiz.generate：request.await === false 时只返回 RunRecord，不阻塞等结果', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'quiz.generate': async (params) => {
        setTimeout(() => bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' })), 10);
        return { turnId: 'turn_q' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: quizPayload([conceptQuestion()]), usage: null }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const started = await service.quiz.generate({ request: { topic: '异步' }, await: false });
  assert.equal(started.capability, 'deep_question');
  assert.equal(started.questions, undefined);
  assert.match(started.runId, /^run_/);
  // 事件流仍然可用。
  const events = [];
  for await (const event of service.runs.events({ runId: started.runId })) events.push(event);
  assert.ok(events.some((event) => event.kind === 'done'));
  await service.dispose();
});

test('reading.act 走 immersive_reading，失败时抛 DeepTutorError', async () => {
  const { bridge } = createFakeBridge({
    handlers: {
      'reading.act': async (params) => {
        bridge.emit('turn.event', turnEvent(params.runId, { type: 'done' }));
        return { turnId: 'turn_r' };
      },
      'turn.result': async () => ({ status: 'succeeded', result: { passages: [] }, usage: null }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const result = await service.reading.act({ request: { action: 'summarize' } });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.result, { passages: [] });
  await service.dispose();
});

test('artifacts.open 转发 artifactId 并归一返回形状', async () => {
  const { bridge, calls } = createFakeBridge({
    handlers: {
      'artifact.open': async () => ({ path: 'public_outputs/a.png', mimeType: 'image/png', size: 1024 }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const opened = await service.artifacts.open({ artifactId: 'art_1' });
  assert.deepEqual(opened, { path: 'public_outputs/a.png', mimeType: 'image/png', size: 1024, sourceAnchor: null });
  assert.equal(calls.find((call) => call.method === 'artifact.open').params.artifactId, 'art_1');
  await service.dispose();
});

test('artifacts.open 缺 artifactId 时抛 E_PROTOCOL', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  await assert.rejects(() => service.artifacts.open({}), (error) => {
    assert.equal(error.kind, 'E_PROTOCOL');
    return true;
  });
  await service.dispose();
});

// ── 10. 资源与 runs.reply ────────────────────────────────────────────────────

test('resources 未注入时 attach/get 抛 E_BRIDGE_UNAVAILABLE（不假装成功）', async () => {
  const { bridge } = createFakeBridge();
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  await assert.rejects(() => service.resources.attach({}), (error) => {
    assert.equal(error.kind, 'E_BRIDGE_UNAVAILABLE');
    return true;
  });
  assert.throws(() => service.resources.get('rh_x'), (error) => {
    assert.equal(error.kind, 'E_BRIDGE_UNAVAILABLE');
    return true;
  });
  await service.dispose();
});

test('resources.attach / get 透明转发给注入了的资源注册表', async () => {
  const handle = { handleId: 'rh_1', resourceId: 'res_1', revision: 'sha256:r1' };
  const resources = {
    async attach() {
      return handle;
    },
    async release() {},
    get(handleId) {
      return handleId === 'rh_1' ? handle : null;
    },
    async dispose() {},
  };
  const { bridge } = createFakeBridge();
  const service = createService({ bridge, resources, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  assert.deepEqual(await service.resources.attach({ resourceId: 'res_1' }), handle);
  assert.deepEqual(service.resources.get('rh_1'), handle);
  assert.equal(service.resources.get('nope'), null);
  await service.dispose();
});

test('runs.reply 转发到 turn.reply', async () => {
  const { bridge, calls } = createFakeBridge({
    handlers: {
      'turn.start': async () => ({ turnId: 'turn_1' }),
      'turn.reply': async () => ({ accepted: true }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const run = await service.runs.start({ capability: 'ask_questions', input: {} });
  const replied = await service.runs.reply({ runId: run.runId, requestId: 'req_1', answer: '南京' });
  assert.equal(replied.accepted, true);
  const replyCall = calls.find((call) => call.method === 'turn.reply');
  assert.equal(replyCall.params.runId, run.runId);
  assert.equal(replyCall.params.text, '南京');
  await service.dispose();
});

// ── 11. cancel 与 dispose ────────────────────────────────────────────────────

test('runs.cancel 把 run 收尾为 cancelled 并通知上游', async () => {
  const { bridge, calls } = createFakeBridge({
    handlers: {
      'turn.start': async () => ({ turnId: 'turn_1' }),
      'turn.cancel': async () => ({ cancelled: true }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const run = await service.runs.start({ capability: 'deep_research', input: {} });
  const cancelled = await service.runs.cancel(run.runId);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.acknowledged, true);
  assert.ok(calls.some((call) => call.method === 'turn.cancel'));

  const final = await service.runs.result(run.runId);
  assert.equal(final.status, 'cancelled');
  assert.equal(final.error.kind, 'E_CANCELLED');

  // 重复取消是空操作。
  assert.equal((await service.runs.cancel(run.runId)).cancelled, false);
  await service.dispose();
});

test('dispose 幂等：重复调用都成功，且中断所有在飞 run', async () => {
  const { bridge, calls } = createFakeBridge({
    handlers: {
      // 永不结束的 run：模拟用户关窗口时的在飞任务。
      'turn.start': async () => ({ turnId: 'turn_1' }),
      'turn.cancel': async () => ({ cancelled: true }),
    },
  });
  const service = createService({ bridge, catalog: readyCatalog(), config: READY_CONFIG, logger: SILENT });
  const runA = await service.runs.start({ capability: 'chat', input: { a: 1 } });
  const runB = await service.runs.start({ capability: 'chat', input: { b: 2 } });

  await service.dispose();
  // 第二次、第三次调用都不能抛。
  await service.dispose();
  await service.dispose();

  assert.equal(calls.filter((call) => call.method === 'turn.cancel').length, 2, '两个在飞 run 都要被中断');
  const finalA = await service.runs.result(runA.runId);
  const finalB = await service.runs.result(runB.runId);
  assert.equal(finalA.status, 'cancelled');
  assert.equal(finalB.status, 'cancelled');

  // 关闭后的事件流不该挂死：已取消的 run 会把自己缓冲的事件吐完然后正常结束。
  const drained = [];
  for await (const event of service.runs.events({ runId: runA.runId })) drained.push(event);
  assert.deepEqual(drained, [], '这个 run 没产出过事件，流应立即结束而不是永久阻塞');

  // 关闭后不能开新 run。
  await assert.rejects(() => service.runs.start({ capability: 'chat', input: {} }), (error) => {
    assert.equal(error.kind, 'E_DISABLED');
    return true;
  });
});

test('dispose 会调用协作者的清理方法；某个协作者抛错不影响其它清理', async () => {
  const disposed = [];
  const catalog = {
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async markVerified() {},
    isExposed: () => true,
    async dispose() {
      disposed.push('catalog');
      throw new Error('目录清理炸了'); // 故意失败
    },
  };
  const resources = {
    async attach() {},
    async release() {},
    get: () => null,
    async dispose() {
      disposed.push('resources');
    },
  };
  const runStore = {
    dir: () => '',
    async writeRequest() {},
    async appendEvent() {},
    async appendDiagnostic() {},
    async writeResult() {},
    async writeUsage() {},
    async readResult() {
      return null;
    },
    async readEvents() {
      return [];
    },
    close() {},
    closeAll() {
      disposed.push('runStore');
    },
  };
  const service = createService({
    catalog,
    resources,
    runStore,
    logger: SILENT,
    config: { ...READY_CONFIG, python: { ok: false } },
  });
  await service.dispose();
  assert.deepEqual(disposed, ['catalog', 'resources', 'runStore'], '一个协作者失败不能跳过其它清理');
});
