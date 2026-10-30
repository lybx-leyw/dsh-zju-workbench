/**
 * 流总线 —— 上游 `runtime/stream_bus.py` 的 JS 对位。
 *
 * # 顺序保证（这是本模块存在的理由）
 *
 * 一个回合里，事件顺序**就是**前端的呈现顺序，所以：
 *
 * 1. `emit` 是单点串行的：先 assign seq，再进 history，最后投递给订阅者。
 *    三者发生在同一个同步段里，不存在"订阅者先看到事件、history 里还没有"的窗口。
 * 2. `subscribe({afterSeq})` 先注册队列、**再**在同一同步段里快照 replay 范围。
 *    反过来的话，replay 期间 emit 的事件会既走 history 迭代又走队列，投递两次。
 * 3. seq 只在 `assignSeq:true` 的总线上分配，从 1 开始；直接调用者拿到的永远是 0，
 *    所以"0 保持 0"是对外的契约，不能拿它当"还没发过事件"。
 *
 * # 哪些事件可以合并
 *
 * 合并只允许发生在**同一条子 trace 的同类增量**上（见 `COALESCABLE_EVENT_TYPES`）：
 * 同一 `source`/`stage`/`call_id` 的 `content`、`thinking`、`observation` 是逐
 * token 的正文增量，合并后语义不变（拼起来就是全文），HTTP 压缩掉的字节也只是
 * 同样的信息。
 *
 * 其余一律不许合并：
 * - `tool_call` / `tool_result`：一次调用一张卡，合并会让两个工具挤进一行，
 *   `tool_call_id` 丢失，配不上对。
 * - `sources` / `result` / `error` / `stage_start` / `stage_end`：状态转移，
 *   合并会抹掉中间态，前端的面板折叠与"重跑"判定都依赖它们。
 * - `wait_for_input`：是一个阻塞点，合并等于把两次等待压成一次。
 */

import { StreamEventType, createStreamEvent, eventToJson } from './stream.js';
import { mergeTraceMetadata } from './trace.js';

/** 可以安全合并的增量事件类型。 */
export const COALESCABLE_EVENT_TYPES = Object.freeze([
  StreamEventType.CONTENT,
  StreamEventType.THINKING,
  StreamEventType.OBSERVATION,
]);

export function isCoalescableEventType(type) {
  return COALESCABLE_EVENT_TYPES.includes(type);
}

function coalesceKey(event) {
  const callId = event.metadata && typeof event.metadata.call_id === 'string' ? event.metadata.call_id : '';
  return [event.type, event.source, event.stage, callId].join('\u0000');
}

/**
 * 把相邻可合并的事件拼成一条。
 *
 * 只合并**连续**的同类事件：中间插了一个 `tool_call` 就断开，因为顺序有意义。
 * 返回新数组，不改入参（快照不应改写总线内部状态）。
 */
export function coalesceEvents(events) {
  const out = [];
  for (const event of events) {
    const previous = out.length > 0 ? out[out.length - 1] : null;
    if (
      previous &&
      isCoalescableEventType(event.type) &&
      previous.type === event.type &&
      coalesceKey(previous) === coalesceKey(event)
    ) {
      out[out.length - 1] = { ...previous, content: previous.content + event.content };
      continue;
    }
    out.push(event);
  }
  return out;
}

class Subscriber {
  #buffer = [];
  #waiter = null;
  #closed = false;

  push(event) {
    if (this.#closed) return;
    if (this.#waiter) {
      const resolve = this.#waiter;
      this.#waiter = null;
      resolve({ value: event, done: false });
      return;
    }
    this.#buffer.push(event);
  }

  end() {
    this.#closed = true;
    if (this.#waiter) {
      const resolve = this.#waiter;
      this.#waiter = null;
      resolve({ value: undefined, done: true });
    }
  }

  next() {
    if (this.#buffer.length > 0) return Promise.resolve({ value: this.#buffer.shift(), done: false });
    if (this.#closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.#waiter = resolve;
    });
  }
}

export class StreamBus {
  #subscribers = [];
  #inputListeners = [];
  #closed = false;
  #history = [];
  #maxHistory;
  #assignSeq;
  #nextSeq = 1;
  #listeners = new Set();

  constructor({ maxHistory = null, assignSeq = false } = {}) {
    this.#maxHistory = maxHistory === null || maxHistory === undefined ? null : Number(maxHistory);
    this.#assignSeq = assignSeq === true;
  }

  /** 已发出的最大 seq；未开 assignSeq 时恒为 0。 */
  get latestSeq() {
    return this.#assignSeq ? this.#nextSeq - 1 : 0;
  }

  get closed() {
    return this.#closed;
  }

  /** 只读历史副本 —— 外部改它不能影响总线。 */
  get history() {
    return [...this.#history];
  }

  get events() {
    return [...this.#history];
  }

  /**
   * 最终 RESULT 的显式完成声明。
   *
   * "能力函数正常返回"不等于"它要做的事做完了"。旧能力不带这个字段时返回 null，
   * 由消费者沿用原有生命周期；嵌套的 / 工具结果里的 RESULT 不算能力 RESULT。
   */
  get resultCompletion() {
    for (let i = this.#history.length - 1; i >= 0; i -= 1) {
      const event = this.#history[i];
      if (event.type !== StreamEventType.RESULT) continue;
      const completed = event.metadata?.completed;
      return typeof completed === 'boolean' ? completed : null;
    }
    return null;
  }

  /**
   * 订阅。先注册队列再快照 replay 范围，避免重复投递。
   * @returns {AsyncGenerator<object>} 产出到总线关闭为止
   */
  async *subscribe({ afterSeq = 0 } = {}) {
    const subscriber = new Subscriber();
    this.#subscribers.push(subscriber);
    const replay = [...this.#history];
    try {
      for (const event of replay) {
        if (this.#assignSeq && event.seq <= afterSeq) continue;
        yield event;
      }
      if (this.#closed) return;
      for (;;) {
        const step = await subscriber.next();
        if (step.done) return;
        yield step.value;
      }
    } finally {
      const index = this.#subscribers.indexOf(subscriber);
      if (index !== -1) this.#subscribers.splice(index, 1);
    }
  }

  /** 生产端：唯一入口。seq 分配 → 入历史 → 投递，同一个同步段完成。 */
  async emit(event) {
    if (this.#closed) return;
    if (this.#assignSeq) {
      event.seq = this.#nextSeq;
      this.#nextSeq += 1;
    }
    this.#history.push(event);
    if (this.#maxHistory !== null && this.#history.length > this.#maxHistory) {
      this.#history.splice(0, this.#history.length - this.#maxHistory);
    }
    for (const subscriber of [...this.#subscribers]) subscriber.push(event);
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // 观察者自己的异常不能打断事件流
      }
    }
  }

  /** 同步观察者：给 CLI 渲染 / 测试断言用，不参与背压。 */
  onEvent(listener) {
    if (typeof listener !== 'function') return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  markClosed() {
    if (this.#closed) return;
    this.#closed = true;
    for (const subscriber of [...this.#subscribers]) subscriber.end();
    for (const listener of [...this.#inputListeners]) listener.end();
    this.#inputListeners = [];
  }

  async close() {
    this.markClosed();
  }

  // ---- 生产端便捷方法（与上游同名） ----

  async stageStart(name, { source = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({ type: StreamEventType.STAGE_START, source, stage: name, metadata: metadata ?? {} }),
    );
  }

  async stageEnd(name, { source = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({ type: StreamEventType.STAGE_END, source, stage: name, metadata: metadata ?? {} }),
    );
  }

  /**
   * 阶段块：保证 `stage_end` 一定发（含异常路径）。
   * JS 没有 async context manager，用回调表达等价语义。
   */
  async runStage(name, { source = '', metadata = undefined } = {}, fn) {
    await this.stageStart(name, { source, metadata });
    try {
      return await fn();
    } finally {
      await this.stageEnd(name, { source, metadata });
    }
  }

  async content(text, { source = '', stage = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({ type: StreamEventType.CONTENT, source, stage, content: text, metadata: metadata ?? {} }),
    );
  }

  async thinking(text, { source = '', stage = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({ type: StreamEventType.THINKING, source, stage, content: text, metadata: metadata ?? {} }),
    );
  }

  async observation(text, { source = '', stage = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({ type: StreamEventType.OBSERVATION, source, stage, content: text, metadata: metadata ?? {} }),
    );
  }

  async toolCall(toolName, args, { source = '', stage = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({
        type: StreamEventType.TOOL_CALL,
        source,
        stage,
        content: toolName,
        metadata: mergeTraceMetadata({ args }, metadata),
      }),
    );
  }

  async toolResult(toolName, result, { source = '', stage = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({
        type: StreamEventType.TOOL_RESULT,
        source,
        stage,
        content: result,
        metadata: mergeTraceMetadata({ tool: toolName }, metadata),
      }),
    );
  }

  async progress(message, { current = 0, total = 0, source = '', stage = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({
        type: StreamEventType.PROGRESS,
        source,
        stage,
        content: message,
        metadata: mergeTraceMetadata({ current, total }, metadata),
      }),
    );
  }

  async sources(sources, { source = '', stage = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({
        type: StreamEventType.SOURCES,
        source,
        stage,
        metadata: mergeTraceMetadata({ sources }, metadata),
      }),
    );
  }

  async result(data, { source = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({
        type: StreamEventType.RESULT,
        source,
        metadata: mergeTraceMetadata(data, metadata),
      }),
    );
  }

  async error(message, { source = '', stage = '', metadata = undefined } = {}) {
    await this.emit(
      createStreamEvent({
        type: StreamEventType.ERROR,
        source,
        stage,
        content: message,
        metadata: metadata ?? {},
      }),
    );
  }

  /**
   * 暂停并向客户端要输入。
   *
   * `timeout` 传 null（默认）= 无限等交互式客户端；无头 / CLI 入口传有限值。
   * 超时返回空串 —— 上游就是空串而不是抛错，调用方据此走"用户没答"的分支。
   */
  async waitForInput(prompt, { source = '', stage = '', timeout = null } = {}) {
    await this.emit(
      createStreamEvent({ type: StreamEventType.WAIT_FOR_INPUT, source, stage, content: prompt }),
    );
    let listener;
    const promise = new Promise((resolve) => {
      listener = { resolve, end: () => resolve('') };
    });
    this.#inputListeners.push(listener);
    try {
      if (timeout === null || timeout === undefined) return await promise;
      let timer;
      const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => resolve(''), Math.max(0, Number(timeout)) * 1000);
        if (typeof timer.unref === 'function') timer.unref();
      });
      try {
        return await Promise.race([promise, timedOut]);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      const index = this.#inputListeners.indexOf(listener);
      if (index !== -1) this.#inputListeners.splice(index, 1);
    }
  }

  /** 前端 / WS 收到用户输入后投递。只投给当前等待者，投完即清。 */
  submitInput(content) {
    const listeners = this.#inputListeners;
    this.#inputListeners = [];
    for (const listener of listeners) listener.resolve(String(content ?? ''));
  }

  /**
   * 已发布的回答正文快照（不改动事件、不订阅、不等待未来输出）。
   *
   * 推理、来源、工具结果都不是助手解释。call_id 级别的可见性以最后一条显式
   * `answer_visible` 为准；`finish_rejected` 的事件一律剔除 —— 被拒的收尾
   * 文本不能在最终答案里露出来。
   */
  publicContentSnapshot({ source, stage }) {
    const visibility = new Map();
    for (const event of this.#history) {
      if (event.source !== source || event.stage !== stage) continue;
      if (event.type !== StreamEventType.CONTENT && event.type !== StreamEventType.PROGRESS) continue;
      const callId = event.metadata?.call_id;
      if (typeof callId !== 'string' || callId === '') continue;
      if (event.metadata?.finish_rejected === true) visibility.set(callId, false);
      else if (typeof event.metadata?.answer_visible === 'boolean') {
        visibility.set(callId, event.metadata.answer_visible);
      }
    }
    return this.#history
      .filter(
        (event) =>
          event.type === StreamEventType.CONTENT &&
          event.source === source &&
          event.stage === stage &&
          event.content &&
          event.metadata?.answer_visible !== false &&
          event.metadata?.finish_rejected !== true &&
          (typeof event.metadata?.call_id !== 'string' ||
            visibility.get(event.metadata.call_id) !== false),
      )
      .map((event) => [event.seq, event.timestamp, event.content]);
  }

  static eventToJson(event) {
    return eventToJson(event);
  }
}

export function createStreamBus(options = {}) {
  return new StreamBus(options);
}

// ---- 跨模块的 per-turn 总线登记（`user_input` 路由用） ----

const busRegistry = new Map();

export function registerBus(turnId, bus) {
  busRegistry.set(String(turnId), bus);
}

export function unregisterBus(turnId) {
  busRegistry.delete(String(turnId));
}

export function getBus(turnId) {
  return busRegistry.get(String(turnId)) ?? null;
}
