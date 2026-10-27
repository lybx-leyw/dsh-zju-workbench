/**
 * DeepTutor 宿主桥协议常量。Node 侧与 Python 侧共用同一份定义：
 * python/deeptutor_bridge.py 中的常量必须与本文件逐字节一致（tests 会校验）。
 */
export const PROTOCOL_VERSION = 1;

/** Node → Python 请求方法（见 docs/contracts.md §4） */
export const METHODS = Object.freeze({
  ping: 'ping',
  status: 'status',
  capabilities: 'capabilities',
  turnStart: 'turn.start',
  turnAttach: 'turn.attach',
  turnCancel: 'turn.cancel',
  turnReply: 'turn.reply',
  turnResult: 'turn.result',
  quizGenerate: 'quiz.generate',
  readingAct: 'reading.act',
  artifactOpen: 'artifact.open',
  shutdown: 'shutdown',
});

/** Python → Node 反向请求方法（见 docs/contracts.md §3.2） */
export const CALLBACKS = Object.freeze({
  llmStream: 'llm.stream',
  llmComplete: 'llm.complete',
  quotaAcquire: 'quota.acquire',
  quotaRelease: 'quota.release',
});

/** Python → Node 通知方法（见 docs/contracts.md §3.3） */
export const NOTIFICATIONS = Object.freeze({
  turnEvent: 'turn.event',
  llmDelta: 'llm.delta',
  runResult: 'run.result',
  log: 'log',
});

/** 上游 deeptutor/core/stream.py StreamEventType 全量 15 值 → 产品 kind */
export const UPSTREAM_EVENT_TYPES = Object.freeze([
  'stage_start',
  'stage_end',
  'thinking',
  'observation',
  'content',
  'tool_call',
  'tool_result',
  'progress',
  'sources',
  'result',
  'error',
  'session',
  'session_meta',
  'done',
  'wait_for_input',
]);

export const EVENT_KIND_BY_UPSTREAM = Object.freeze({
  stage_start: 'stage-start',
  stage_end: 'stage-end',
  thinking: 'thinking',
  observation: 'observation',
  content: 'content',
  tool_call: 'tool-call',
  tool_result: 'tool-result',
  progress: 'progress',
  sources: 'sources',
  result: 'result',
  error: 'error',
  session: 'session',
  session_meta: 'session-meta',
  done: 'done',
  wait_for_input: 'wait-for-input',
});

/** 未登记的上游事件类型统一标记为 diagnostic，禁止静默丢弃（见契约 §5） */
export const DIAGNOSTIC_KIND = 'diagnostic';

export function toEventKind(upstreamType) {
  return EVENT_KIND_BY_UPSTREAM[upstreamType] ?? DIAGNOSTIC_KIND;
}

/** 错误 taxonomy（见契约 §9） */
export const ERROR_KINDS = Object.freeze([
  'E_DISABLED',
  'E_PYTHON_MISSING',
  'E_PYTHON_VERSION',
  'E_DEPS_MISSING',
  'E_BRIDGE_UNAVAILABLE',
  'E_CAPABILITY_UNAVAILABLE',
  'E_UPSTREAM_ERROR',
  'E_TIMEOUT',
  'E_CANCELLED',
  'E_PROTOCOL',
  'E_QUOTA',
  // 本地自身的问题，既不是上游出错，也不是环境缺件：
  // - E_INTERNAL：我们自己的代码走到了不该到的状态（注入缺失、契约被违反）。
  // - E_RESOURCE_INVALID：调用方交来的学习资源不符合 schema，是我们拒绝的，
  //   不是上游失败 —— 混进 E_UPSTREAM_ERROR 会让重试逻辑去重试一个永远失败的请求。
  'E_INTERNAL',
  'E_RESOURCE_INVALID',
]);

/** status().state 枚举（见契约 §7） */
export const STATUS_STATES = Object.freeze([
  'ready',
  'disabled',
  'starting',
  'not-installed',
  'unsupported-python',
  'deps-missing',
  'crashed',
]);

/** 运行模式（见契约 §8）：两种模式必须分别评测，禁止互相冒充 */
export const RUN_MODES = Object.freeze({
  upstreamNative: 'upstream-native',
  integratedParallel: 'integrated-parallel',
});

export class DeepTutorError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'DeepTutorError';
    this.kind = ERROR_KINDS.includes(kind) ? kind : 'E_UPSTREAM_ERROR';
    if (detail !== undefined) this.detail = detail;
  }

  toJSON() {
    return { kind: this.kind, message: this.message, ...(this.detail === undefined ? {} : { detail: this.detail }) };
  }
}

export function protocolError(message, detail) {
  return new DeepTutorError('E_PROTOCOL', message, detail);
}
