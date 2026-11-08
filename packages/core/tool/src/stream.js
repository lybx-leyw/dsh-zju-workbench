/**
 * 流事件协议 —— 上游 `core/stream.py` 的 JS 对位。
 *
 * 事件类型是一份**封闭**清单：消费端（Web trace 面板、CLI 渲染、WS 推送）
 * 按它分支。新增类型要先想清楚每个消费端怎么渲染，否则事件会被静默丢掉。
 */

export const StreamEventType = Object.freeze({
  STAGE_START: 'stage_start',
  STAGE_END: 'stage_end',
  THINKING: 'thinking',
  OBSERVATION: 'observation',
  CONTENT: 'content',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  PROGRESS: 'progress',
  SOURCES: 'sources',
  RESULT: 'result',
  ERROR: 'error',
  SESSION: 'session',
  SESSION_META: 'session_meta',
  DONE: 'done',
  WAIT_FOR_INPUT: 'wait_for_input',
});

const KNOWN_TYPES = new Set(Object.values(StreamEventType));

export function isStreamEventType(value) {
  return KNOWN_TYPES.has(value);
}

/**
 * 构造一个事件。
 *
 * `seq` 默认 0：只有开了 `assignSeq` 的总线才会赋值（上游同款）。
 * 直接调用者（无总线）拿到的就是 0，快照里"0 保持 0"。
 */
export function createStreamEvent({
  type,
  source = '',
  stage = '',
  content = '',
  metadata = {},
  sessionId = '',
  turnId = '',
  seq = 0,
  timestamp = undefined,
} = {}) {
  if (!isStreamEventType(type)) {
    throw new Error(`Unknown stream event type: ${String(type)}`);
  }
  return {
    type,
    source: String(source ?? ''),
    stage: String(stage ?? ''),
    content: String(content ?? ''),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    session_id: String(sessionId ?? ''),
    turn_id: String(turnId ?? ''),
    seq: Number(seq) || 0,
    // 秒级浮点，与上游 `time.time()` 一致（不是毫秒）
    timestamp: timestamp === undefined ? Date.now() / 1000 : Number(timestamp),
  };
}

/** 序列化成单行 JSON（NDJSON）。`ensure_ascii=False` 的中文直出效果。 */
export function eventToJson(event) {
  return JSON.stringify(eventToDict(event));
}

export function eventToDict(event) {
  return {
    type: event.type,
    source: event.source,
    stage: event.stage,
    content: event.content,
    metadata: event.metadata,
    session_id: event.session_id,
    turn_id: event.turn_id,
    seq: event.seq,
    timestamp: event.timestamp,
  };
}
