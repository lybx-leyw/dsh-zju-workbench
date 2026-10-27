/**
 * DeepTutor 宿主**服务面**（`ctx.zhiyunDeepTutor`）的实现。
 *
 * # 这个文件负责什么
 *
 * 契约 §11 的全部对外方法。它把「一次上游运行」包装成有身份（`runId`）、有指纹、
 * 有事件流、有落盘证据的对象，并且把上游发来的事件翻译成 §5 规定的对外形状。
 *
 * # 三条硬约束（写在这里是为了让后来的人不要"顺手优化"掉）
 *
 * 1. **`sequence` 只能由 Node 单调分配**，绝不能用"假定调用次数"伪造进度。
 *    上游没给 `counts` 时就报 `null`，不要拿 `已发出事件数` 冒充 `已完成题目数` ——
 *    那是假进度，用户会看到进度条在动但不知道在等什么。
 * 2. **`verified` 只能由真实成功的 run 写入**：本文件是唯一调用
 *    `catalog.markVerified()` 的地方，且只在 run 终态为 succeeded 时调用。
 *    没有任何配置项或方法可以手工把能力置为已验证。
 * 3. **`apply()` 期永不抛错**。`index.js` 在 `apply()` 里调 `createService()`，
 *    如果这里抛错会把整个工作台拖挂。所以构造函数不做任何 IO、不做任何探测；
 *    所有失败都推迟到方法调用时抛 `DeepTutorError`。
 *
 * # 为什么所有协作者都是参数注入
 *
 * `bridge` / `llmBridge` / `catalog` / `resources` / `runStore` 全部由 `index.js`
 * 传进来，测试用 stub 替换。本文件**不 import `./runtime.js` 的实例**，
 * 只 import 纯函数与常量，这样服务面可以在没有 Python 的机器上完整单测。
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  DIAGNOSTIC_KIND,
  DeepTutorError,
  ERROR_KINDS,
  METHODS,
  NOTIFICATIONS,
  RUN_MODES,
  STATUS_STATES,
  UPSTREAM_EVENT_TYPES,
  toEventKind,
} from './protocol.js';
import { stableJson } from './run-store.js';
import { ZHIYUN_QUESTION_TYPES, isJudgeType, toQuizCandidates } from './adapters/quiz.js';
import { FIVE_STATES } from './capabilities.js';

/** 默认空闲超时（契约 §2）。 */
const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
/** 默认最大重启次数（契约 §2）。 */
const DEFAULT_MAX_RESTARTS = 3;
/** 智云 core-quiz 能吃的题型。值域直接取自适配器，避免两处各写一份手抄表而漂移。 */
const QUIZ_ACCEPTED_TYPES = new Set(ZHIYUN_QUESTION_TYPES);

/**
 * 会挡路的五态层，按「挡住顺序」排列。`verified` 故意不在里面 ——
 * 未验证只代表「本机还没有成功证据」，不代表能力不可用。
 */
const BLOCKING_LAYERS = Object.freeze(FIVE_STATES.filter((layer) => layer !== 'verified'));

const RUN_STATUS = Object.freeze({
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** `upstream.lock.json` 是上游提交/版本/归档指纹的唯一事实来源，读一次缓存住。 */
let cachedLock = null;
async function readUpstreamLock(logger) {
  if (cachedLock) return cachedLock;
  try {
    const lockPath = fileURLToPath(new URL('../upstream.lock.json', import.meta.url));
    const parsed = JSON.parse(await readFile(lockPath, 'utf8'));
    const upstream = isRecord(parsed?.upstream) ? parsed.upstream : {};
    cachedLock = {
      commit: typeof upstream.commit === 'string' ? upstream.commit : null,
      version: typeof upstream.version === 'string' ? upstream.version : null,
      archiveSha256: typeof upstream.archive?.sha256 === 'string' ? upstream.archive.sha256 : null,
    };
  } catch (error) {
    logger?.warn?.('读取 upstream.lock.json 失败，status() 的上游信息将为空', error?.message ?? String(error));
    cachedLock = { commit: null, version: null, archiveSha256: null };
  }
  return cachedLock;
}

/** 稳定的 JSON 文本（键排序），用于指纹与摘要；函数与 undefined 会被丢弃。 */
function canonicalJson(value) {
  try {
    return stableJson(value).trimEnd();
  } catch {
    // 循环引用等异常输入不该让 run 起不来，退化成字符串表示。
    try {
      return JSON.stringify(String(value));
    } catch {
      return '';
    }
  }
}

function sha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** 把任意时间戳归一成毫秒 epoch。上游 `StreamEvent.timestamp` 可能是秒。 */
function toEpochMs(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 1e11 ms ≈ 1973 年；小于它说明给的是秒（或更小的单位）。
    return value > 0 && value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 解释器版本是否落在契约 §2 的 `>=3.11,<3.15` 区间。
 *
 * @returns {boolean|null} null = 版本字符串无法解析（不据此判定"不受支持"）
 */
function isPythonVersionSupported(version) {
  const raw = text(version);
  const match = /^(\d+)\.(\d+)/.exec(raw);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== 3) return major > 3;
  return minor >= 11 && minor < 15;
}

function snapshotLlm(llmBridge, config, options) {
  const candidates = [
    options?.llm,
    options?.llmSnapshot,
    config?.llm,
    config?.selection,
    typeof llmBridge?.selection === 'function' ? safeSelection(llmBridge) : llmBridge?.selection,
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate)) {
      return {
        provider: candidate.provider ?? null,
        model: candidate.model ?? null,
        temperature: candidate.temperature ?? null,
        maxTokens: candidate.maxTokens ?? candidate.max_tokens ?? null,
        reasoningEffort: candidate.reasoningEffort ?? candidate.reasoning_effort ?? null,
        mode: 'host',
      };
    }
  }
  return { provider: null, model: null, temperature: null, maxTokens: null, reasoningEffort: null, mode: 'host' };
}

function safeSelection(llmBridge) {
  try {
    return llmBridge.selection() ?? null;
  } catch {
    return null;
  }
}

/**
 * 服务面侧的候选题目下限校验。
 *
 * 这是**有意的重复**：`dsh-zhiyun-core-quiz/src/upstream.js#checkCandidate` 已经在
 * 引擎侧做了一遍同样的校验，但服务面是另一条入口（业务包可以直接 `ctx.zhiyunDeepTutor
 * .quiz.generate()`），两条入口必须给出同一个下限，否则"走引擎"和"直调服务面"会
 * 得到不同质量的题。判据与 core-quiz 保持一致：题型在词表内、题干非空、
 * 判断题答案是布尔语义。
 */
function acceptQuizCandidate(candidate) {
  if (!isRecord(candidate)) return { ok: false, reason: '候选题目不是对象' };
  const type = candidate.type;
  if (typeof type !== 'string' || type === '') return { ok: false, reason: '候选题目缺 type' };
  if (!QUIZ_ACCEPTED_TYPES.has(type)) {
    return { ok: false, reason: `题型 ${type} 不在智云词表内（上游原值 ${candidate.rawType ?? '未记录'}）` };
  }
  if (typeof candidate.stem !== 'string' || candidate.stem.trim() === '') {
    return { ok: false, reason: '候选题目缺题干' };
  }
  // 判断题用适配器的 isJudgeType 判定，而不是在这里再写一遍 `type === 'trueFalse'`：
  // 「什么算判断题」只在 quiz.js 里有一个答案。
  if (isJudgeType(type) && typeof candidate.answer !== 'boolean') {
    return { ok: false, reason: `判断题的答案是 ${JSON.stringify(candidate.answer)}，不是布尔语义` };
  }
  return { ok: true };
}

/**
 * 创建服务面对象。
 *
 * @param {object} options
 * @param {object} [options.bridge] PythonBridge（`request` / `onNotification` / `state`）
 * @param {object} [options.llmBridge] 模型桥（提供 selection 快照）
 * @param {object} [options.catalog] 能力目录（`createCapabilityCatalog` 的返回）
 * @param {object} [options.resources] 资源注册表（资源流负责；未落地时透明透传）
 * @param {object} [options.runStore] 运行落盘（`createRunStore` 的返回）
 * @param {object} [options.config] 由 `index.js` 显式传入的事实（见下）
 * @param {object} [options.logger]
 * @param {Promise<unknown>} [options.ready] 数据目录建好后的 Promise
 */
export function createService({
  bridge = null,
  llmBridge = null,
  catalog = null,
  resources = null,
  runStore = null,
  config = {},
  logger = {},
  ready = null,
} = {}) {
  const settings = isRecord(config) ? config : {};
  const llmBridgeRef = llmBridge;
  const catalogRef = catalog;
  const resourcesRef = resources;
  const runStoreRef = runStore;

  /** @type {Map<string, RunState>} 在飞或本次进程内完成过的 run */
  const runs = new Map();
  /** @type {Map<string, string>} fingerprint -> runId（命中即复用，不重复消费上游） */
  const fingerprintIndex = new Map();

  let disposed = false;
  let disposePromise = null;
  let unsubscribeBridge = null;
  /** 单调递增的 runId 尾号，避免同一毫秒内撞号。 */
  let runCounter = 0;

  function warn(message, detail) {
    logger.warn?.(message, detail);
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────

  /**
   * 订阅桥通知。`bridge.onNotification(cb)` 的回调形状在不同实现里可能是
   * `(method, params)` 或单个报文对象，两种都接住 —— 这里不猜实现细节，
   * 只保证服务面能收到 turn.event / run.result。
   */
  function subscribeBridge() {
    if (typeof bridge?.onNotification !== 'function') return;
    const handler = (a, b) => {
      const method = typeof a === 'string' ? a : (a?.method ?? b?.method ?? '');
      const params = typeof a === 'string' ? (b ?? {}) : (a?.params ?? b?.params ?? a ?? {});
      try {
        onBridgeNotification(String(method), isRecord(params) ? params : {});
      } catch (error) {
        warn('处理桥通知时出错（已忽略，避免拖挂事件循环）', error?.message ?? String(error));
      }
    };
    try {
      const off = bridge.onNotification(handler);
      if (typeof off === 'function') unsubscribeBridge = off;
    } catch (error) {
      warn('订阅桥通知失败，事件流将只能靠 turn.result 轮询', error?.message ?? String(error));
    }
  }

  function onBridgeNotification(method, params) {
    if (disposed) return;
    if (method === NOTIFICATIONS.turnEvent) {
      ingestUpstreamEvent(params);
      return;
    }
    if (method === NOTIFICATIONS.runResult) {
      const run = runs.get(text(params.runId));
      if (!run) return;
      finalize(run, {
        status: normalizeRunStatus(params.status),
        result: params.result ?? null,
        usage: params.usage ?? null,
        error: params.error ?? null,
      });
      return;
    }
    if (method === NOTIFICATIONS.llmDelta) return;
    if (method === NOTIFICATIONS.log) {
      const level = text(params.level) || 'info';
      const message = text(params.message);
      if (level === 'error' || level === 'warn') warn(`上游日志：${message}`, params.fields);
    }
  }

  function normalizeRunStatus(value) {
    const raw = text(value).toLowerCase();
    if (raw === RUN_STATUS.succeeded || raw === 'success' || raw === 'ok' || raw === 'done') return RUN_STATUS.succeeded;
    if (raw === RUN_STATUS.cancelled || raw === 'canceled') return RUN_STATUS.cancelled;
    if (raw === RUN_STATUS.failed || raw === 'error') return RUN_STATUS.failed;
    return RUN_STATUS.failed;
  }

  // ── 状态推导 ────────────────────────────────────────────────────────────

  function readBridgeState() {
    if (!bridge) return null;
    if (typeof bridge.state === 'function') {
      try {
        const value = bridge.state();
        return typeof value === 'string' ? value : (value?.state ?? null);
      } catch {
        return null;
      }
    }
    if (typeof bridge.state === 'string') return bridge.state;
    return null;
  }

  /**
   * 服务状态推导（契约 §7 的 7 个状态）。
   *
   * `config.python` / `config.deps` 是 `resolvePython()` / `probeVendorDeps()`
   * 的结果，**允许为空对象**（还没探测过）。空对象时如实退化到「未探测」，
   * 不假装 ready、也不假装 not-installed。
   */
  function deriveState(warnings) {
    if (settings.disabled === true || settings.enabled === false) {
      warnings.push('服务已在配置中关闭（config.disabled），所有方法都会抛 E_DISABLED');
      return 'disabled';
    }
    const python = isRecord(settings.python) ? settings.python : {};
    if (python.ok === false) {
      // 解释器不可用时区分「版本不对」与「根本没有」：前者用户装 3.11 就行，
      // 后者用户得先装 Python。两件事的下一步动作完全不同，不能混成一句。
      const versionSupported = isPythonVersionSupported(python.version);
      if (python.supported === false || python.compatible === false || versionSupported === false) {
        warnings.push(`Python 版本不受支持：当前 ${python.version ?? '未知'}，需要 3.11–3.14`);
        return 'unsupported-python';
      }
      warnings.push(`未找到可用的 Python 解释器：${text(python.reason) || '请先安装 Python 3.11+'}`);
      return 'not-installed';
    }
    const deps = isRecord(settings.deps) ? settings.deps : {};
    if (deps.installed === false) {
      warnings.push(`上游依赖未就绪：${text(deps.reason) || '请安装 deeptutor 的运行依赖'}`);
      return 'deps-missing';
    }
    const bridgeState = readBridgeState();
    if (bridgeState === 'crashed') {
      warnings.push(`上游子进程已崩溃（重启 ${DEFAULT_MAX_RESTARTS} 次仍失败）`);
      return 'crashed';
    }
    if (bridgeState === 'starting') return 'starting';
    // `stopped` / `idle` 都是「进程没起但可以随时按需起」，对调用方等价于可用，
    // 落到最后统一返回 ready。这里显式列出来是为了让"为什么 stopped 也算 ready"
    // 有据可查（runtime.js 的 PythonBridge 只会产生 ready/starting/stopped/crashed）。
    if (!bridge || typeof bridge.request !== 'function') {
      warnings.push('未注入 Python 桥，无法调用上游');
      return 'not-installed';
    }
    if (!isRecord(settings.python) || Object.keys(settings.python).length === 0) {
      warnings.push('尚未探测 Python 解释器（config.python 为空），本报告不含解释器事实');
    }
    if (!isRecord(settings.deps) || Object.keys(settings.deps).length === 0) {
      warnings.push('尚未探测上游依赖（config.deps 为空），本报告不含依赖事实');
    }
    return 'ready';
  }

  /** 某个服务状态对应的错误（不可用时用于方法入口抛错）。 */
  function errorForState(state) {
    switch (state) {
      case 'disabled':
        return new DeepTutorError('E_DISABLED', 'DeepTutor 宿主服务未启用，请在插件设置中开启 zhiyun-deeptutor');
      case 'unsupported-python':
        return new DeepTutorError(
          'E_PYTHON_VERSION',
          `Python 版本不受支持，需要 3.11–3.14（当前 ${text(settings.python?.version) || '未知'}）`,
          { path: settings.python?.path ?? null, version: settings.python?.version ?? null },
        );
      case 'not-installed':
        // 两种成因要分开说：桥没注入是**装配错误**（插件接线坏了），解释器缺失是
        // **环境问题**（用户没装 Python）。混成一句会让接线 bug 伪装成"请安装 Python"。
        if (!bridge || typeof bridge.request !== 'function') {
          return new DeepTutorError('E_BRIDGE_UNAVAILABLE', '未注入 Python 桥（zhiyun-deeptutor 的 bridge 协作者缺失），无法调用上游');
        }
        return new DeepTutorError(
          'E_PYTHON_MISSING',
          '未找到可用的 Python 解释器，请安装 Python 3.11+ 或在设置中指定解释器路径',
        );
      case 'deps-missing':
        // reason 只说明"探测时看到了什么"，用户真正需要的是下一步命令。两段都保留：
        // 只看 reason 会不知道要装什么，只看命令会不知道为什么突然缺了。
        return new DeepTutorError(
          'E_DEPS_MISSING',
          `DeepTutor 运行依赖未安装：${text(settings.deps?.reason) || '缺少 vendor/deeptutor 声明的运行依赖'}；`
            + '请用 3.11–3.14 的解释器安装 vendor/deeptutor/requirements/server.txt 里的依赖',
          { missing: asArray(settings.deps?.missing) },
        );
      case 'crashed':
        return new DeepTutorError('E_BRIDGE_UNAVAILABLE', '上游子进程已崩溃，请重启工作台或等待自动恢复');
      case 'starting':
        return new DeepTutorError('E_BRIDGE_UNAVAILABLE', '上游子进程正在启动，请稍后重试');
      default:
        return null;
    }
  }

  /** 方法入口的统一可用性断言。不可用时抛 DeepTutorError（契约 §11）。 */
  function assertUsable() {
    if (disposed) throw new DeepTutorError('E_DISABLED', 'DeepTutor 宿主服务已关闭，请重启工作台');
    const warnings = [];
    const state = deriveState(warnings);
    const error = errorForState(state);
    if (error) throw error;
  }

  // ── run 状态机 ──────────────────────────────────────────────────────────

  /**
   * @typedef {object} RunState
   * @property {object} record     RunRecord（契约 §8）
   * @property {object[]} events   已产出的对外事件（下标 i 的 sequence === i+1）
   * @property {number} nextSeq   下一个要分配的 sequence
   * @property {Set<string>} seenDiagnostics 去重用的诊断指纹
   * @property {boolean} settled  是否已到终态
   * @property {string} status
   * @property {unknown} result
   * @property {unknown} usage
   * @property {unknown} error
   * @property {Array<Function>} waiters 事件/终态变化的等待者
   * @property {{promise: Promise<object>, resolve: Function}} done
   * @property {AbortController} controller
   * @property {{questions: object[], diagnostics: object[]}|null} adapted 出题适配缓存
   */

  function createRunState(record, extra) {
    let resolveDone;
    const donePromise = new Promise((resolve) => {
      resolveDone = resolve;
    });
    return {
      record,
      events: [],
      nextSeq: 1,
      seenDiagnostics: new Set(),
      settled: false,
      status: RUN_STATUS.running,
      result: null,
      usage: null,
      error: null,
      waiters: [],
      done: { promise: donePromise, resolve: resolveDone },
      controller: new AbortController(),
      adapted: null,
      turnId: extra.turnId ?? null,
      sessionId: extra.sessionId ?? null,
      method: extra.method ?? null,
    };
  }

  function wakeWaiters(run) {
    const waiters = run.waiters;
    run.waiters = [];
    for (const resolve of waiters) {
      try {
        resolve();
      } catch {
        // 等待者自身的错误不该影响其他等待者。
      }
    }
  }

  function waitForChange(run) {
    if (run.settled) return Promise.resolve();
    return new Promise((resolve) => run.waiters.push(resolve));
  }

  /** 分配一个对外事件（`sequence` 由 Node 单调分配，绝不伪造）。 */
  function emitEvent(run, raw) {
    const upstreamType = text(raw?.upstreamType ?? raw?.type ?? raw?.upstream_type);
    const declaredKind = text(raw?.kind);
    // §5 的映射是 **Node 的职责**：上游给了什么类型就映射什么类型；没给类型才退到
    // 桥已映射的 kind；两者都没有就是 diagnostic。未知类型一律 diagnostic 且不丢弃。
    const kind = upstreamType
      ? toEventKind(upstreamType)
      : (declaredKind || DIAGNOSTIC_KIND);
    const isUnknownUpstreamType = upstreamType !== '' && !UPSTREAM_EVENT_TYPES.includes(upstreamType);
    const counts = isRecord(raw?.counts) ? raw.counts : null;
    const usage = isRecord(raw?.usage) ? raw.usage : null;
    const sequence = run.nextSeq;
    run.nextSeq += 1;
    const event = {
      runId: run.record.runId,
      sequence,
      upstreamSequence: Number.isFinite(raw?.upstreamSequence)
        ? raw.upstreamSequence
        : (Number.isFinite(raw?.seq) ? raw.seq : null),
      kind: isUnknownUpstreamType ? DIAGNOSTIC_KIND : kind,
      upstreamType: upstreamType || null,
      stage: text(raw?.stage) || null,
      taskId: raw?.taskId ?? raw?.task_id ?? null,
      // counts **只透传上游给的**：没给就是 null，绝不按"已发事件数"编造进度。
      counts: {
        done: Number.isFinite(counts?.done) ? counts.done : null,
        total: Number.isFinite(counts?.total) ? counts.total : null,
      },
      elapsedMs: Number.isFinite(raw?.elapsedMs)
        ? raw.elapsedMs
        : (Number.isFinite(raw?.elapsed_ms) ? raw.elapsed_ms : Math.max(0, Date.now() - run.record.startedAt)),
      usage: {
        input: Number.isFinite(usage?.input) ? usage.input : 0,
        output: Number.isFinite(usage?.output) ? usage.output : 0,
      },
      resourceRevision: raw?.resourceRevision ?? run.record.resourceRevisions?.[0]?.revision ?? null,
      content: raw?.content ?? null,
      metadata: isRecord(raw?.metadata) ? raw.metadata : {},
      at: toEpochMs(raw?.at ?? raw?.timestamp, Date.now()),
    };
    run.events.push(event);
    runStoreRef?.appendEvent?.(run.record.runId, event)?.catch?.(() => {});
    if (event.kind === DIAGNOSTIC_KIND) {
      // 未映射事件必须留证据：事件流里不丢，diagnostics.ndjson 里也留一条。
      recordDiagnostic(run, {
        kind: DIAGNOSTIC_KIND,
        runId: run.record.runId,
        sequence: event.sequence,
        upstreamType: event.upstreamType,
        stage: event.stage,
        reason: event.upstreamType
          ? `上游事件类型 ${event.upstreamType} 不在契约 §5 的 15 种映射表内，已按 diagnostic 原样保留`
          : '上游事件缺少 type 字段，已按 diagnostic 原样保留',
        metadata: event.metadata,
      });
    }
    wakeWaiters(run);
    if (event.kind === 'done' || event.kind === 'result' || event.kind === 'error') {
      // 上游说结束了（含 error：报错也是一种结束），但终态快照还得单独取一次（幂等）。
      // error 事件也必须收尾 —— 否则调用方 await runs.result() 会永久挂起。
      void completeFromBridge(run);
    }
    return event;
  }

  function recordDiagnostic(run, entry) {
    const key = text(entry.reason) + '|' + (entry.sequence ?? '') + '|' + (entry.upstreamType ?? '');
    if (run.seenDiagnostics.has(key)) return;
    run.seenDiagnostics.add(key);
    runStoreRef?.appendDiagnostic?.(run.record.runId, entry)?.catch?.(() => {});
  }

  function ingestUpstreamEvent(params) {
    const nested = isRecord(params?.event) ? params.event : null;
    const raw = nested ?? params;
    const runId = text(params?.runId ?? nested?.runId ?? raw?.runId ?? raw?.run_id);
    const run = runs.get(runId);
    if (!run) {
      // 未知 runId 的事件：留一条告警，绝不静默吞掉（可能暴露 runId 传递缺陷）。
      warn('收到未知 runId 的上游事件，已忽略', { runId: runId || null, upstreamType: raw?.type ?? null });
      return;
    }
    emitEvent(run, raw);
  }

  /** 收到 done/result 后向桥取终态快照（幂等，失败则按上游错误收尾）。 */
  async function completeFromBridge(run) {
    if (run.settled) return;
    if (typeof bridge?.request !== 'function') return;
    try {
      const snapshot = await bridge.request(METHODS.turnResult, { runId: run.record.runId });
      if (run.settled) return;
      finalize(run, {
        status: normalizeRunStatus(snapshot?.status),
        result: snapshot?.result ?? null,
        usage: snapshot?.usage ?? null,
        error: snapshot?.error ?? null,
      });
    } catch (error) {
      if (run.settled) return;
      finalize(run, {
        status: RUN_STATUS.failed,
        result: null,
        usage: null,
        error: toErrorPayload(error),
      });
    }
  }

  function toErrorPayload(error) {
    if (error instanceof DeepTutorError) return { kind: error.kind, message: error.message, detail: error.detail ?? null };
    return {
      kind: ERROR_KINDS.includes(error?.kind) ? error.kind : 'E_UPSTREAM_ERROR',
      message: text(error?.message) || '上游运行失败',
      detail: error?.detail ?? null,
    };
  }

  /**
   * 收尾：落盘、写 verified、登记指纹、唤醒等待者。**幂等**。
   *
   * 只有 succeeded 才 `markVerified` —— 这是 verified 唯一的置真路径。
   */
  function finalize(run, { status, result, usage, error }) {
    if (run.settled) return;
    run.settled = true;
    run.status = status;
    run.result = result ?? null;
    run.usage = usage ?? null;
    run.error = status === RUN_STATUS.succeeded ? null : (error ?? {
      kind: 'E_UPSTREAM_ERROR',
      message: `上游运行以 ${status} 结束`,
      detail: null,
    });

    const runId = run.record.runId;
    // Upstream may finish the question before its background title callback.
    // Keep this run's dispatcher until service disposal so late calls still
    // share the selected worker pool instead of silently escaping its quota.
    const envelope = {
      runId,
      capability: run.record.capability,
      status,
      result: run.result,
      usage: run.usage,
      error: run.error,
      fingerprint: run.record.fingerprint,
      upstreamCommit:run.record.upstreamCommit??null,
      finishedAt: Date.now(),
      resourceRevision:run.record.resourceRevisions?.[0]?.revision??null,
      ...(status===RUN_STATUS.succeeded&&producesQuestions(run.record.capability)?adaptQuizPayload(run,run.result):{}),
    };
    run.persistence=Promise.resolve(runStoreRef?.writeResult?.(runId,envelope)).catch(error=>{run.persistenceError=error;});
    if (usage) runStoreRef?.writeUsage?.(runId, usage)?.catch?.(() => {});
    runStoreRef?.close?.(runId);

    if (status === RUN_STATUS.succeeded) {
      fingerprintIndex.set(run.record.fingerprint, runId);
      const capability = run.record.capability;
      if (capability && typeof catalogRef?.markVerified === 'function') {
        // markVerified 的失败不该把成功的 run 变成失败：结果已经拿到了。
        Promise.resolve(catalogRef.markVerified(capability, runId)).catch((error) => {
          warn('标记能力为已验证失败（run 结果不受影响）', error?.message ?? String(error));
        });
      }
    } else if (run.error) {
      recordDiagnostic(run, { kind: 'run-failure', runId, error: run.error, at: Date.now() });
    }

    wakeWaiters(run);
    run.done.resolve({
      runId,
      status: run.status,
      result: run.result,
      usage: run.usage,
      error: run.error,
      fingerprint: run.record.fingerprint,
      resourceRevision: run.record.resourceRevisions?.[0]?.revision ?? null,
    });
  }

  // ── 资源句柄归一 ────────────────────────────────────────────────────────

  function normalizeHandles(input) {
    const handles = [];
    for (const item of asArray(input)) {
      if (isRecord(item) && (text(item.handleId) || text(item.resourceId))) {
        handles.push({
          handleId: text(item.handleId) || null,
          resourceId: text(item.resourceId) || null,
          revision: text(item.revision) || null,
        });
        continue;
      }
      if (typeof item === 'string' && item.trim() !== '') {
        // 允许直接传 handleId：资源注册表在的话还原成完整句柄。
        let resolved = null;
        try {
          resolved = resourcesRef?.get?.(item.trim()) ?? null;
        } catch {
          resolved = null;
        }
        handles.push({
          handleId: item.trim(),
          resourceId: text(resolved?.resourceId) || null,
          revision: text(resolved?.revision) || null,
        });
      }
    }
    return handles;
  }

  // ── 指纹 ────────────────────────────────────────────────────────────────

  function buildFingerprint({ record, upstreamCommit, strategy, questionHistoryVersion }) {
    const resourceRevisions = asArray(record.resourceHandles)
      .map((handle) => ({ resourceId: handle.resourceId ?? null, revision: handle.revision ?? null }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    const input = {
      resourceRevisions,
      upstreamCommit: upstreamCommit ?? null,
      llmConfigDigest: sha256(canonicalJson(record.llm)),
      strategy: strategy ?? null,
      questionHistoryVersion: questionHistoryVersion ?? null,
      requestDigest: sha256(canonicalJson({ capability: record.capability, input: record.input })),
      execution:record.execution??null,
      scope:record.quota.scope,
      options:record.options??{},
      mode:record.mode,
    };
    return { fingerprint: sha256(canonicalJson(input)), input };
  }

  async function lookupCachedRun(fingerprint) {
    const known = fingerprintIndex.get(fingerprint);
    if (!known){const stored=await runStoreRef?.findCompleted?.(fingerprint);return stored?{record:{runId:stored.runId,capability:stored.capability,fingerprint},result:stored.result,usage:stored.usage}:null;}
    const run = runs.get(known);
    if (run?.settled && run.status === RUN_STATUS.succeeded) {
      return {
        record: run.record,
        result: run.result,
        usage: run.usage,
      };
    }
    const stored = await runStoreRef?.readResult?.(known);
    if (isRecord(stored) && stored.status === RUN_STATUS.succeeded) {
      return {
        record: { runId: known, capability: stored.capability ?? null, fingerprint },
        result: stored.result ?? null,
        usage: stored.usage ?? null,
      };
    }
    return null;
  }

  // ── 启动一次 run（三入口共用） ──────────────────────────────────────────

  function newRunId() {
    runCounter += 1;
    const random = Math.random().toString(16).slice(2, 10);
    return `run_${Date.now().toString(36)}_${runCounter.toString(36)}_${random}`;
  }

  /**
   * @param {object} params
   * @param {string} params.capability
   * @param {Array} [params.resourceHandles]
   * @param {unknown} [params.input]
   * @param {object} [params.options]
   * @param {string} [params.scope]
   * @param {string} [params.method] 上游方法名（turn.start / quiz.generate / reading.act）
   * @param {object} params.upstreamParams 除 runId 外要发给上游的参数
   * @param {string} [params.mode]
   * @param {boolean} [params.requireCapability] 是否强制校验五态（语义化入口强制）
   */
  async function startRun({
    capability,
    resourceHandles = [],
    input = null,
    options = {},
    scope = null,
    method = METHODS.turnStart,
    upstreamParams = {},
    modelDispatch = null,
    mode = RUN_MODES.upstreamNative,
    requireCapability = true,
  }) {
    if(typeof bridge?.state==='function'&&bridge.state()==='starting')await bridge.start?.();
    assertUsable();
    if (ready) await Promise.resolve(ready).catch(() => {});

    const name = text(capability);
    if (name === '') {
      throw new DeepTutorError('E_CAPABILITY_UNAVAILABLE', '启动上游运行必须指定 capability', { capability });
    }

    if (requireCapability && typeof catalogRef?.get === 'function') {
      const entry = await catalogRef.get(name).catch(() => null);
      if (!entry) {
        throw new DeepTutorError('E_CAPABILITY_UNAVAILABLE', `上游没有名为 ${name} 的能力`, { capability: name });
      }
      // 五态的推导顺序就是「先挡哪一层」的顺序：上游在不在 > 依赖够不够 > 配置 >
      // 是否对外暴露。verified 不参与判断（它只表示"本机还没有成功证据"）。
      const blocked = BLOCKING_LAYERS.find((layer) => entry[layer] === false);
      if (blocked) {
        const reason = text(entry.reason) || text(entry.installHint) || '';
        throw new DeepTutorError(
          'E_CAPABILITY_UNAVAILABLE',
          `能力 ${name} 在「${blocked}」这一层不可用${reason ? `：${reason}` : ''}`,
          { capability: name, layer: blocked, reason },
        );
      }
    }

    const handles = normalizeHandles(resourceHandles);
    const payloads=[];
    if(resourcesRef?.payload)for(const handle of handles){
      const payload=await resourcesRef.payload(handle.handleId);
      const account=payload.accountScope?.accountId;
      if(account&&String(scope??'')!==String(account))throw new DeepTutorError('E_RESOURCE_INVALID','讲义资源不属于当前账号');
      if(payload.revision!==handle.revision||payload.resourceId!==handle.resourceId)throw new DeepTutorError('E_RESOURCE_INVALID','讲义资源版本或身份不匹配');
      payloads.push(payload);
    }
    const effectiveParams={...upstreamParams};
    if(payloads.length){effectiveParams.resources=payloads;if(isRecord(effectiveParams.request))effectiveParams.request={...effectiveParams.request,resources:payloads};}
    const llm = snapshotLlm(llmBridgeRef, settings, options);
    const record = {
      runId: newRunId(),
      mode: text(options.mode) || text(settings.mode) || mode,
      capability: name,
      resourceHandles: handles,
      input: input ?? null,
      llm,
      fingerprint: '',
      options:structuredClone(options),
      execution:{...effectiveParams,...(isRecord(effectiveParams.request)?{request:{...effectiveParams.request,resources:handles.map(({resourceId,revision})=>({resourceId,revision}))}}:{}),resources:handles.map(({resourceId,revision})=>({resourceId,revision}))},
      resourceAnchors:payloads.flatMap(payload=>Object.values(payload.anchorIndex??{}).map(anchor=>({...anchor,resourceId:payload.resourceId,revision:payload.revision}))),
      quota: {
        workers: positiveInteger(options.workers ?? settings.workers, 1),
        scope: text(scope) || text(settings.defaultScope) || 'default',
      },
      startedAt: Date.now(),
    };

    const lock = await readUpstreamLock(logger);
    record.upstreamCommit=lock.commit;
    const strategy = options.strategy ?? (isRecord(input) ? input.strategy : null) ?? null;
    const questionHistoryVersion = options.questionHistoryVersion
      ?? (isRecord(input) ? input.questionHistoryVersion : null)
      ?? null;
    const built = buildFingerprint({
      record,
      upstreamCommit: lock.commit,
      strategy,
      questionHistoryVersion,
    });
    record.fingerprint = built.fingerprint;
    record.resourceRevisions = built.input.resourceRevisions;

    // 指纹命中已完成 run：直接复用旧结果，**不重复调用上游**（契约 §8）。
    const cached = await lookupCachedRun(record.fingerprint);
    if (cached) {
      logger.debug?.('运行指纹命中已完成 run，复用旧结果', { fingerprint: record.fingerprint, runId: cached.record.runId });
      return {
        ...(cached.record ?? {}),
        runId: cached.record.runId,
        capability: name,
        fingerprint: record.fingerprint,
        cached: true,
        status: RUN_STATUS.succeeded,
        result: cached.result,
        usage: cached.usage,
      };
    }

    const run = createRunState(record, { method });
    runs.set(record.runId, run);
    llmBridgeRef?.registerRun?.(record.runId,options.workerSelection??[{provider:llm.provider,model:llm.model,workers:record.quota.workers}],modelDispatch);

    await runStoreRef?.writeRequest?.(record.runId, {
      runId: record.runId,
      record,
      upstream: { method, params: effectiveParams },
    })?.catch?.(() => {});

    if (typeof bridge?.request !== 'function') {
      finalize(run, {
        status: RUN_STATUS.failed,
        result: null,
        usage: null,
        error: { kind: 'E_BRIDGE_UNAVAILABLE', message: '未注入 Python 桥，无法启动上游运行', detail: null },
      });
      throw new DeepTutorError('E_BRIDGE_UNAVAILABLE', '未注入 Python 桥，无法启动上游运行');
    }

    try {
      const response = await bridge.request(method, { runId: record.runId, ...effectiveParams, llm:{...llm,accountScope:record.quota.scope} }, {
        signal: run.controller.signal,
      });
      run.turnId = text(response?.turnId) || null;
      run.sessionId = text(response?.sessionId) || null;
      record.turnId = run.turnId;
      record.sessionId = run.sessionId;
      record.workspaceId = text(response?.workspaceId) || null;
    } catch (error) {
      const payload = toErrorPayload(error);
      finalize(run, { status: RUN_STATUS.failed, result: null, usage: null, error: payload });
      if (error instanceof DeepTutorError) throw error;
      throw new DeepTutorError(
        ERROR_KINDS.includes(payload.kind) ? payload.kind : 'E_UPSTREAM_ERROR',
        `启动上游运行失败：${payload.message}`,
        { runId: record.runId },
      );
    }

    return { ...record, turnId: run.turnId, sessionId: run.sessionId };
  }

  // ── 出题结果适配（runs.result 与 quiz.generate 共用） ────────────────────

  function adaptQuizPayload(run, payload) {
    if (run.adapted) return run.adapted;
    const adapted = toQuizCandidates({
      capabilityResult: payload,
      runId: run.record.runId,
      resourceRevision: run.record.resourceRevisions?.[0]?.revision ?? null,
      resourceAnchors: run.record.resourceAnchors??[],
    });
    run.adapted = adapted;
    for (const entry of adapted.diagnostics) recordDiagnostic(run, { ...entry, runId: run.record.runId });
    return adapted;
  }

  /** 哪些能力产出的是题目，需要在 `runs.result()` 里附带结构化 `questions`。 */
  function producesQuestions(capability) {
    return capability === 'deep_question';
  }

  function requireRun(runId) {
    const key = text(runId);
    if (key === '') throw new DeepTutorError('E_PROTOCOL', '缺少 runId 参数');
    const run = runs.get(key);
    if (!run) throw new DeepTutorError('E_PROTOCOL', `未知的 runId：${key}`, { runId: key });
    return run;
  }

  // ── 对外方法 ────────────────────────────────────────────────────────────

  async function status() {
    const warnings = [];
    let state = 'ready';
    try {
      state = deriveState(warnings);
    } catch (error) {
      warnings.push(`状态推导失败：${error?.message ?? String(error)}`);
      state = 'crashed';
    }
    if (!STATUS_STATES.includes(state)) {
      warnings.push(`推导出的状态 ${state} 不在契约状态集内，已按 crashed 上报`);
      state = 'crashed';
    }
    const lock = await readUpstreamLock(logger);
    const python = isRecord(settings.python) ? settings.python : {};
    const deps = isRecord(settings.deps) ? settings.deps : {};

    let capabilities = [];
    if (typeof catalogRef?.list === 'function') {
      try {
        capabilities = await catalogRef.list();
      } catch (error) {
        warnings.push(`读取能力目录失败：${error?.message ?? String(error)}`);
      }
    } else {
      warnings.push('未注入能力目录，capabilities 为空');
    }

    const processInfo = readProcessInfo();
    return {
      state,
      deeptutorVersion: text(deps.deeptutorVersion) || null,
      python: {
        path: text(python.path) || null,
        version: text(python.version) || null,
        source: text(python.source) || null,
      },
      home: text(settings.homeDir) || null,
      dataRoot: text(settings.dataDir) || null,
      vendorPath: text(settings.vendorPath) || null,
      upstream: {
        commit: lock.commit,
        version: lock.version,
        archiveSha256: lock.archiveSha256,
      },
      process: processInfo,
      capabilities,
      warnings,
    };
  }

  function readProcessInfo() {
    const fallback = {
      pid: null,
      startedAt: null,
      restartCount: 0,
      idleTimeoutMs: positiveInteger(settings.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS),
    };
    if (!bridge) return fallback;
    let info = null;
    try {
      info = typeof bridge.info === 'function' ? bridge.info() : (isRecord(bridge.info) ? bridge.info : null);
    } catch {
      info = null;
    }
    if (!isRecord(info)) {
      if (typeof bridge.pid === 'number') fallback.pid = bridge.pid;
      if (typeof bridge.startedAt === 'number') fallback.startedAt = bridge.startedAt;
      if (typeof bridge.restartCount === 'number') fallback.restartCount = bridge.restartCount;
      return fallback;
    }
    return {
      pid: Number.isFinite(info.pid) ? info.pid : null,
      startedAt: Number.isFinite(info.startedAt) ? info.startedAt : null,
      restartCount: Number.isFinite(info.restartCount) ? info.restartCount : 0,
      idleTimeoutMs: positiveInteger(info.idleTimeoutMs, positiveInteger(settings.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS)),
    };
  }

  async function capabilities() {
    if (disposed) throw new DeepTutorError('E_DISABLED', 'DeepTutor 宿主服务已关闭，请重启工作台');
    if (typeof catalogRef?.list !== 'function') {
      throw new DeepTutorError('E_CAPABILITY_UNAVAILABLE', '未注入能力目录，无法列出能力');
    }
    return catalogRef.list();
  }

  function requireResources() {
    if (!resourcesRef || typeof resourcesRef.attach !== 'function') {
      throw new DeepTutorError(
        'E_BRIDGE_UNAVAILABLE',
        '资源注册表未注入（zhiyun-deeptutor 的 resources 协作者缺失），无法 attach 学习资源',
      );
    }
    return resourcesRef;
  }

  // ── runs ────────────────────────────────────────────────────────────────

  async function startRunRequest(request = {}) {
    const options = isRecord(request.options) ? request.options : {};
    const input = isRecord(request.input) ? request.input : (request.input ?? null);
    const content = typeof request.input === 'string'
      ? request.input
      : text(isRecord(input) ? (input.content ?? input.text ?? input.prompt) : '');
    const capability = text(request.capability);
    const handles = normalizeHandles(request.resourceHandles);
    const upstreamParams = {
      capability,
      content,
      sessionId: text(request.sessionId) || text(options.sessionId) || null,
      workspaceId: text(request.workspaceId) || text(options.workspaceId) || null,
      language: text(request.language) || text(options.language) || null,
      config: isRecord(options.config) ? options.config : (isRecord(input?.config) ? input.config : {}),
      llm: snapshotLlm(llmBridgeRef, settings, options),
      resources: handles,
    };
    return startRun({
      capability,
      resourceHandles: handles,
      input,
      options,
      scope: request.scope,
      method: METHODS.turnStart,
      upstreamParams,
      modelDispatch:request.modelDispatch,
      requireCapability: true,
    });
  }

  /**
   * 事件流（`AsyncIterable`）。
   *
   * 支持 `afterSeq` 重放：只发 `sequence > afterSeq` 的事件。内存缓冲失效时
   * （比如服务重启过）退回读 `events.ndjson`，同样按 `afterSeq` 过滤。
   */
  async function* eventsStream({ runId, afterSeq = 0 } = {}) {
    const key = text(runId);
    if (key === '') throw new DeepTutorError('E_PROTOCOL', '缺少 runId 参数');
    const run = runs.get(key);
    if (!run) {
      const persisted = await runStoreRef?.readEvents?.(key);
      const rows = asArray(persisted).filter((event) => (event?.sequence ?? 0) > afterSeq);
      if (!rows.length) throw new DeepTutorError('E_PROTOCOL', `未知的 runId：${key}`, { runId: key });
      for (const event of rows) yield event;
      return;
    }

    let cursor = Math.max(0, Number.isFinite(afterSeq) ? afterSeq : 0);
    for (;;) {
      while (cursor < run.events.length) {
        const event = run.events[cursor];
        cursor += 1;
        if (event.sequence > afterSeq) yield event;
      }
      if (run.settled) {
        // 终态之后再排一次，防止 settle 与最后一次 emit 之间还有残留。
        while (cursor < run.events.length) {
          const event = run.events[cursor];
          cursor += 1;
          if (event.sequence > afterSeq) yield event;
        }
        return;
      }
      await waitForChange(run);
    }
  }

  async function cancelRun(runId) {
    const key = text(runId);
    if (key === '') {
      throw new DeepTutorError('E_PROTOCOL', '缺少 runId 参数');
    }
    const run = runs.get(key);
    if (!run) return { cancelled: false };
    if (run.settled) return { cancelled: false, status: run.status };
    llmBridgeRef?.cancelRun?.(key);

    try {
      run.controller.abort();
    } catch {
      // AbortController.abort() 自身不该抛；防御一下。
    }
    let acknowledged = false;
    if (typeof bridge?.request === 'function') {
      try {
        const response = await bridge.request(METHODS.turnCancel, { runId: key });
        acknowledged = response?.cancelled === true;
      } catch (error) {
        // 取消是尽力而为：取消失败不能盖住"用户已取消"这个事实。
        warn('向上游发送取消请求失败', error?.message ?? String(error));
      }
    }
    finalize(run, {
      status: RUN_STATUS.cancelled,
      result: null,
      usage: null,
      error: { kind: 'E_CANCELLED', message: '运行已被取消', detail: null },
    });
    return { cancelled: true, acknowledged };
  }

  async function replyRun({ runId, requestId = null, answer = null, text: replyText = null } = {}) {
    assertUsable();
    const run = requireRun(runId);
    if (typeof bridge?.request !== 'function') {
      throw new DeepTutorError('E_BRIDGE_UNAVAILABLE', '未注入 Python 桥，无法回复上游提问');
    }
    const payload = { runId: run.record.runId };
    if (Array.isArray(answer?.answers)) {
      payload.answers = answer.answers;
    } else if (isRecord(answer) || Array.isArray(answer)) {
      payload.answers = answer;
    } else if (answer !== null && answer !== undefined) {
      payload.text = typeof answer === 'string' ? answer : canonicalJson(answer);
    }
    if (replyText !== null && replyText !== undefined) payload.text = String(replyText);
    if (requestId !== null) payload.requestId = requestId;
    const response = await bridge.request(METHODS.turnReply, payload);
    return { accepted: response?.accepted === true, requestId, runId: run.record.runId };
  }

  /**
   * 终态结果。**会等待 run 到终态**（可能很久），这是刻意设计：
   * core-quiz 的上游引擎是「先消费事件流、再取结果」，如果这里对在飞 run 立刻
   * 返回 null，那条链路会拿到空结果却不报错。
   */
  async function resultOf(runId) {
    const key = text(runId);
    if (key === '') throw new DeepTutorError('E_PROTOCOL', '缺少 runId 参数');
    const run = runs.get(key);
    if (!run) {
      const stored = await runStoreRef?.readResult?.(key);
      if (isRecord(stored)) {
        return {
          runId: key,
          status: stored.status ?? null,
          result: stored.result ?? null,
          usage: stored.usage ?? null,
          error: stored.error ?? null,
          fingerprint: stored.fingerprint ?? null,
          upstreamCommit:stored.upstreamCommit??null,
          resourceRevision: stored.resourceRevision??null,
          diagnostics: stored.diagnostics??[],
          questions: stored.questions,
        };
      }
      throw new DeepTutorError('E_PROTOCOL', `未知的 runId：${key}`, { runId: key });
    }
    const final = await run.done.promise;
    await run.persistence;
    if(run.persistenceError)throw new DeepTutorError('E_INTERNAL','上游结果未能保存到磁盘，请检查可用空间后重试');
    const out = {
      runId: key,
      capability: run.record.capability,
      status: final.status,
      result: final.result,
      usage: final.usage,
      error: final.error,
      fingerprint: final.fingerprint,
      upstreamCommit:run.record.upstreamCommit??null,
      resourceRevision: final.resourceRevision,
      diagnostics: [],
    };
    if (producesQuestions(run.record.capability) && final.result) {
      const adapted = adaptQuizPayload(run, final.result);
      out.questions = adapted.questions;
      out.diagnostics = adapted.diagnostics;
    }
    return out;
  }

  // ── quiz / reading ──────────────────────────────────────────────────────

  async function generateQuiz(request = {}) {
    assertUsable();
    const options = isRecord(request.options) ? request.options : {};
    const handles = normalizeHandles(request.resourceHandles);
    const quizRequest = isRecord(request.request) ? request.request : (isRecord(request.input) ? request.input : {});
    const started = await startRun({
      capability: text(request.capability) || 'deep_question',
      resourceHandles: handles,
      input: quizRequest,
      options,
      scope: request.scope,
      method: METHODS.quizGenerate,
      upstreamParams: { request: quizRequest },
      modelDispatch:request.modelDispatch,
      requireCapability: true,
    });

    if (started.cached) return started;
    // `await: false` 是流式场景：调用方自己消费 runs.events 与 runs.result。
    if (request.await === false) return started;

    const run = requireRun(started.runId);
    const final = await run.done.promise;
    if (final.status !== RUN_STATUS.succeeded) {
      const error = run.error ?? {};
      throw new DeepTutorError(
        ERROR_KINDS.includes(error.kind) ? error.kind : 'E_UPSTREAM_ERROR',
        `上游出题失败：${text(error.message) || final.status}`,
        { runId: started.runId, status: final.status, diagnostics: run.adapted?.diagnostics ?? [] },
      );
    }

    const adapted = adaptQuizPayload(run, final.result);
    const questions = [];
    const diagnostics = [...adapted.diagnostics];
    for (const candidate of adapted.questions) {
      const verdict = acceptQuizCandidate(candidate);
      if (verdict.ok) questions.push(candidate);
      else {
        diagnostics.push({
          kind: 'rejected',
          severity: 'error',
          runId: started.runId,
          reason: verdict.reason,
          rawType: candidate?.rawType ?? null,
          questionId: candidate?.questionId ?? null,
        });
      }
    }

    if (!questions.length) {
      throw new DeepTutorError(
        'E_UPSTREAM_ERROR',
        `上游没有产出可用的题目（证据目录：runs/${started.runId}）`,
        { runId: started.runId, diagnostics },
      );
    }

    return {
      runId: started.runId,
      turnId: started.turnId ?? null,
      sessionId: started.sessionId ?? null,
      status: final.status,
      result: final.result,
      usage: final.usage,
      fingerprint: final.fingerprint,
      resourceRevision: final.resourceRevision,
      questions,
      diagnostics,
    };
  }

  async function actReading(request = {}) {
    assertUsable();
    const options = isRecord(request.options) ? request.options : {};
    const handles = normalizeHandles(request.resourceHandles);
    const readingRequest = isRecord(request.request) ? request.request : (isRecord(request.input) ? request.input : {});
    const started = await startRun({
      capability: text(request.capability) || 'immersive_reading',
      resourceHandles: handles,
      input: readingRequest,
      options,
      scope: request.scope,
      method: METHODS.readingAct,
      upstreamParams: { request: readingRequest },
      requireCapability: true,
    });
    if (started.cached) return started;
    if (request.await === false) return started;

    const run = requireRun(started.runId);
    const final = await run.done.promise;
    if (final.status !== RUN_STATUS.succeeded) {
      const error = run.error ?? {};
      throw new DeepTutorError(
        ERROR_KINDS.includes(error.kind) ? error.kind : 'E_UPSTREAM_ERROR',
        `上游阅读动作失败：${text(error.message) || final.status}`,
        { runId: started.runId, status: final.status },
      );
    }
    return {
      runId: started.runId,
      turnId: started.turnId ?? null,
      sessionId: started.sessionId ?? null,
      status: final.status,
      result: final.result,
      usage: final.usage,
      fingerprint: final.fingerprint,
      resourceRevision: final.resourceRevision,
    };
  }

  async function openArtifact(handle = {}) {
    assertUsable();
    if (typeof bridge?.request !== 'function') {
      throw new DeepTutorError('E_BRIDGE_UNAVAILABLE', '未注入 Python 桥，无法打开产物');
    }
    const artifactId = text(handle?.artifactId) || text(handle?.id) || text(handle);
    if (artifactId === '') {
      throw new DeepTutorError('E_PROTOCOL', '打开产物必须提供 artifactId');
    }
    const response = await bridge.request(METHODS.artifactOpen, { artifactId });
    return {
      path: text(response?.path) || null,
      mimeType: text(response?.mimeType) || null,
      size: Number.isFinite(response?.size) ? response.size : null,
      sourceAnchor: response?.sourceAnchor ?? null,
    };
  }

  // ── 关闭 ────────────────────────────────────────────────────────────────

  /** 幂等关闭：中断所有在飞 run，然后释放协作者。重复调用返回同一个 Promise。 */
  function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;
    disposePromise = (async () => {
      // 1) 中断所有在飞 run（先 abort 信号，再逐个取消上游）。
      const pending = [...runs.values()].filter((run) => !run.settled);
      await Promise.allSettled(pending.map(async (run) => {
        try {
          run.controller.abort();
        } catch {
          // 忽略
        }
        return cancelRun(run.record.runId);
      }));

      // 2) 退订桥通知。
      if (typeof unsubscribeBridge === 'function') {
        try {
          unsubscribeBridge();
        } catch {
          // 忽略
        }
        unsubscribeBridge = null;
      }

      // 3) 依次释放协作者；任何一个失败都不影响其它协作者的清理。
      await Promise.allSettled([...runs.values()].map(run=>run.persistence));
      const cleanups = [
        ['能力目录', () => catalogRef?.dispose?.()],
        ['资源注册表', () => resourcesRef?.dispose?.()],
        ['运行落盘', () => runStoreRef?.closeAll?.()],
      ];
      for (const [label, cleanup] of cleanups) {
        try {
          await cleanup();
        } catch (error) {
          warn(`关闭${label}时出错（已忽略）`, error?.message ?? String(error));
        }
      }
      // 4) 指纹索引没有跨 dispose 的意义（服务已不可用，不会再命中缓存），清掉。
      // 但**不清 runs**：关窗时在飞 run 刚被取消，调用方仍可能来取一次终态结果；
      // 把记录清掉会让 runs.result() 从"已取消"变成"未知 runId"，掩盖真实发生过的事。
      fingerprintIndex.clear();
    })();
    return disposePromise;
  }

  subscribeBridge();

  return {
    status,
    capabilities,
    resources: {
      async attach(bundle) {
        return requireResources().attach(bundle);
      },
      async release(handleId) {
        return requireResources().release(handleId);
      },
      get(handleId) {
        if (!resourcesRef || typeof resourcesRef.get !== 'function') {
          throw new DeepTutorError(
            'E_BRIDGE_UNAVAILABLE',
            '资源注册表未注入（zhiyun-deeptutor 的 resources 协作者缺失），无法读取资源句柄',
          );
        }
        return resourcesRef.get(handleId);
      },
    },
    runs: {
      start: startRunRequest,
      events: eventsStream,
      cancel: cancelRun,
      reply: replyRun,
      result: resultOf,
    },
    quiz: { generate: generateQuiz },
    reading: { act: actReading },
    artifacts: { open: openArtifact },
    dispose,
  };
}

export default { createService };
