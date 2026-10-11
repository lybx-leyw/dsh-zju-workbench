/**
 * 页面侧对「会话流」的理解：把 SSE 帧变成气泡。
 *
 * 上游 `/paper-reader/api/session/follow` 推的是宿主原生的 `SessionFollowFrame`
 * （历史快照 + 增量事件 + 实时流三路混在一个通道里）。这个文件是**唯一**
 * 认识它形状的地方 —— 页面其他部分只看到 `{messages, live, turnError, contextCount}`。
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

/**
 * 空状态。冻结，避免调用方手滑改到共享对象。
 *
 * `contextCount`：被折叠掉的工作台上下文条数（见 `isInjectedContext`）。
 * `turnError`：这一轮**答不出来**的原因（`turn/end` 的 error 原因），与传输层
 * 的 `phase:'error'` 不是一回事 —— 一个是「模型没配好」，一个是「连接断了」。
 */
export const EMPTY_FEED = Object.freeze({ messages: Object.freeze([]), live: null, turnError: null, contextCount: 0 });

const TEXT_BLOCK = 'text';

function blocksToText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === TEXT_BLOCK && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * 这条 `user/message` 是不是**工作台自己注入的上下文**，而不是用户说的话。
 *
 * 依据是宿主自己的判据：`.ref/packages/client/ui-chat/src/client/conversation-nodes/message.ts`
 * 里 `if (event.data.source.kind !== 'user')` 就把它当 context 节点渲染（折叠的
 * 提示条），只有 `kind === 'user'` 才是真正的用户输入（steering 也是 user
 * source，由 inbox 认领决定）。
 *
 * 不这么滤会怎样：宿主的运行时上下文、`AGENTS.md`、以及**技能目录**
 * （实测一条 111727 字符）全都以 `user/message` 的形式进日志，抽屉会把它们
 * 当聊天气泡铺满整个面板。
 *
 * `source` 缺失时**当作真消息**：真实日志里 source 必填，但测试与旧数据可能
 * 没有，宁可多显示一条也不能把用户的提问吞掉。
 */
export function isInjectedContext(event) {
  if (!event || event.type !== 'user/message') return false;
  const source = event.data?.source;
  if (!source || typeof source !== 'object') return false;
  return source.kind !== 'user';
}

/** 帧里的 `data` 在线上都是 `JsonValue`，边界处一次窄化不可避免，也都集中在这里。 */
function eventToMessage(event) {
  if (!event || typeof event !== 'object') return null;
  const data = event.data;

  if (event.type === 'user/message') {
    // user/message 的 data **就是** message 本身（与 assistant 不同，它不包一层）。
    if (isInjectedContext(event)) return null;
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

/**
 * 一轮/一步结束（无论成功还是失败）时，那条 `live` 气泡必须收掉。
 *
 * 不这么做会怎样（实测）：没有模型凭证时，本轮**根本不产生** `assistant/message`
 * ——失败只记成一条 durable `assistant/attempt`（finish reason = error），随后
 * `step/end`、`turn/end`。`live` 于是永远停在 `text:''`，用户看到三个点
 * 一直转，像是还在回答。
 *
 * 前一轮的结束事件不能收掉后一轮正在生成的气泡，所以按 turn 比大小。
 */
function settleLive(live, turn) {
  if (live === null) return null;
  if (typeof turn !== 'number') return null;
  if (typeof live.turn !== 'number') return null;
  return turn >= live.turn ? null : live;
}

/** 只留「为什么答不出来」这一句，别把整个 failure 对象塞进气泡。 */
function turnErrorMessage(reason) {
  if (!reason || typeof reason !== 'object') return null;
  if (reason.kind !== 'error') return null;
  const failure = reason.error;
  const message = failure && typeof failure === 'object' ? failure.message : null;
  return typeof message === 'string' && message.trim() ? message.trim() : '这一轮没能生成回答。';
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
    let seen = 0;
    for (const record of frame.records ?? []) {
      if (record?.type !== 'event') continue;
      if (isInjectedContext(record.event)) seen += 1;
      const message = eventToMessage(record.event);
      if (message) messages = appendMessage(messages, message);
    }
    // 重连会重推同一份快照，所以 contextCount 取最大值而不是累加。
    const nextCount = Math.max(feed.contextCount, seen);
    if (messages === feed.messages && nextCount === feed.contextCount) return feed;
    return { ...feed, messages, contextCount: nextCount };
  }

  if (frame.type === 'event') {
    const event = frame.event;

    // 一轮/一步收尾：答不出来时把原因如实说出来，并收掉空转的实时气泡。
    if (event?.type === 'turn/end') {
      const turnError = turnErrorMessage(event.data?.reason);
      const live = settleLive(feed.live, event.data?.turn);
      if (live === feed.live && turnError === null) return feed;
      return { ...feed, live, turnError: turnError ?? null };
    }
    if (event?.type === 'step/end') {
      const live = settleLive(feed.live, event.data?.turn);
      return live === feed.live ? feed : { ...feed, live };
    }

    const injected = isInjectedContext(event);
    const message = eventToMessage(event);
    if (!message) {
      // 注入的上下文不显示，但要让抽屉知道「这里折叠了东西」，否则用户
      // 看到的是「我问了，助手一句话都没有」而不知道上下文被藏起来了。
      if (injected) return { ...feed, contextCount: feed.contextCount + 1 };
      return feed;
    }
    const messages = appendMessage(feed.messages, message);
    if (messages === feed.messages) return feed;
    // 权威消息到了：这一轮的实时气泡到此为止，避免同一条回答显示两遍。
    const settled = message.role === 'assistant' && feed.live !== null
      && (message.turn === null || feed.live.turn === null || message.turn >= feed.live.turn);
    // 新的一轮开始了，上一轮的错误提示让位。
    return { messages, live: settled ? null : feed.live, turnError: null, contextCount: feed.contextCount };
  }

  if (frame.type === 'assistant-stream') {
    const inner = frame.frame;
    if (!inner || typeof inner !== 'object') return feed;

    if (inner.type === 'start') {
      return { ...feed, turnError: null, live: { attemptId: inner.attemptId, turn: inner.turn ?? null, step: inner.step ?? null, text: '' } };
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
