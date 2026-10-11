/**
 * 页面侧对「会话流」的理解：把 SSE 帧变成气泡。
 *
 * 上游 `/paper-reader/api/session/follow` 推的是宿主原生的 `SessionFollowFrame`
 * （历史快照 + 增量事件 + 实时流三路混在一个通道里）。这个文件是**唯一**
 * 认识它形状的地方 —— 页面其他部分只看到 `{messages, live, error}`。
 *
 * 为什么不直接用现成的 React 组件渲染对话：`ui-subagent` 那套（retain +
 * SessionProvider + `renderFactorySlot('conversation.content')`）只能在
 * session-scope 的插槽绑定里用，而我们要的是一个**页面内的抽屉**（root scope）。
 * 走那条路要伪造 scope 绑定，比按事件形状自己摊平更脆。
 *
 * 三种帧的语义（宿主 `api/session-controller` 的公开类型）：
 *
 *   - `snapshot`：连上时的历史（`records[i] = { type:'event', event }`），消息整条内联。
 *   - `event`：新的持久事件。user/assistant 消息从这里来。
 *   - `assistant-stream`：正在生成的那一轮的增量（`chunk` 的 `chunk` 字段是
 *     `JsonValue`，线上没有类型，只能按 `StreamChunk` 的判别式自己窄化）。
 *
 * 关于「实时文本 vs 最终文本」：实时增量到 `end` 之后**不立刻丢弃** ——
 * 真实的对话 UI 也是这样（保留到对应的持久消息到达，再被权威文本替换），
 * 否则气泡会出现「说完 → 清空 → 零点几秒后重新出现」的闪烁。
 */

/** 空状态。冻结，避免调用方手滑改到共享对象。 */
export const EMPTY_FEED = Object.freeze({ messages: Object.freeze([]), live: null });

const TEXT_BLOCK = 'text';

function blocksToText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === TEXT_BLOCK && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/** 帧里的 `data` 在线上都是 `JsonValue`，边界处一次窄化不可避免，也都集中在这里。 */
function eventToMessage(event) {
  if (!event || typeof event !== 'object') return null;
  const data = event.data;

  if (event.type === 'user/message') {
    // user/message 的 data **就是** message 本身（与 assistant 不同，它不包一层）。
    const text = blocksToText(data?.content);
    if (!text.trim()) return null;
    return { id: data?.id ?? `u:${event.seq}`, role: 'user', text, seq: event.seq ?? null };
  }

  if (event.type === 'assistant/message') {
    const message = data?.message;
    const text = blocksToText(message?.content);
    if (!text.trim()) return null;
    return {
      id: message?.id ?? `a:${event.seq}`,
      role: 'assistant',
      text,
      turn: data?.turn ?? null,
      step: data?.step ?? null,
      seq: event.seq ?? null,
    };
  }

  return null;
}

function appendMessage(messages, message) {
  if (messages.some((item) => item.id === message.id)) return messages;
  return [...messages, message];
}

/** 实时 chunk 里只有两种带可见文本。`reasoning-delta` 是推理，不是回答。 */
function liveTextOf(chunk) {
  if (!chunk || typeof chunk !== 'object') return null;
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') return { kind: 'delta', text: chunk.text };
  if (chunk.type === 'block-end' && chunk.block?.type === TEXT_BLOCK && typeof chunk.block.text === 'string') {
    return { kind: 'replace', text: chunk.block.text };
  }
  return null;
}

/**
 * 应用一帧，返回新的状态对象（永不改入参）。
 *
 * @param feed - `{ messages, live }`，初始用 `EMPTY_FEED`。
 * @param frame - 上游 SSE 的一帧（`onmessage` 的 JSON 或 `event: meta` 的负载）。
 */
export function applyFrame(feed, frame) {
  if (!frame || typeof frame !== 'object') return feed;

  if (frame.type === 'snapshot') {
    let messages = feed.messages;
    for (const record of frame.records ?? []) {
      if (record?.type !== 'event') continue;
      const message = eventToMessage(record.event);
      if (message) messages = appendMessage(messages, message);
    }
    return messages === feed.messages ? feed : { ...feed, messages };
  }

  if (frame.type === 'event') {
    const message = eventToMessage(frame.event);
    if (!message) return feed;
    const messages = appendMessage(feed.messages, message);
    if (messages === feed.messages) return feed;
    // 权威消息到了：这一轮的实时气泡到此为止，避免同一条回答显示两遍。
    const settled = message.role === 'assistant' && feed.live !== null
      && (message.turn === null || feed.live.turn === null || message.turn >= feed.live.turn);
    return { messages, live: settled ? null : feed.live };
  }

  if (frame.type === 'assistant-stream') {
    const inner = frame.frame;
    if (!inner || typeof inner !== 'object') return feed;

    if (inner.type === 'start') {
      return { ...feed, live: { attemptId: inner.attemptId, turn: inner.turn ?? null, step: inner.step ?? null, text: '' } };
    }
    if (inner.type === 'chunk') {
      // 断言：没有 start 就收到 chunk（断线重连、或帧丢弃）也要能显示，
      // 否则用户看到的是「AI 什么都不说」。
      const base = feed.live && feed.live.attemptId === inner.attemptId
        ? feed.live
        : { attemptId: inner.attemptId, turn: null, step: null, text: '' };
      const piece = liveTextOf(inner.chunk);
      if (!piece) return feed;
      const text = piece.kind === 'replace' ? piece.text : base.text + piece.text;
      return { ...feed, live: { ...base, text } };
    }
    if (inner.type === 'end') {
      // 提交了：保留文本等权威消息来替换；放弃/中断：立刻清掉，否则会挂着一句没说完的话。
      if (inner.outcome?.kind === 'committed') return feed;
      return { ...feed, live: null };
    }
    return feed;
  }

  return feed;
}

/** 把历史记录数组一次摊平（测试与「回填」用）。 */
export function messagesFromRecords(records) {
  let messages = [];
  for (const record of records ?? []) {
    if (record?.type !== 'event') continue;
    const message = eventToMessage(record.event);
    if (message) messages = appendMessage(messages, message);
  }
  return messages;
}

/** 有正在生成的一轮（无论是否已经吐字）。页面用它决定是否显示「思考中」。 */
export function hasLiveAttempt(feed) {
  return feed.live !== null;
}
