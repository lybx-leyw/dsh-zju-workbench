/**
 * 会话消息构造 —— 上游 `runtime/agentic/messages.py` 的 JS 对位。
 *
 * # 为什么 reasoning 必须跟着 assistant 轮走
 *
 * DeepSeek thinking 模式的 Chat Completions 要求：发起工具调用的那个 assistant
 * 轮，必须把该轮的 `reasoning_content` 原样带回来。Anthropic 更严 —— 扩展思考
 * 返回的是**带签名**的 thinking blocks，必须逐字重放。上游这两条都曾经漏写，
 * 结果是任何 thinking 模型的多轮工具调用第二轮直接被拒。
 *
 * 所以这里的每一处 `reasoningContent` / `thinkingBlocks` 都不是可选的语法糖。
 */

/**
 * 发起工具调用的 assistant 轮。
 *
 * - `content` 为空时写 `null`（OpenAI 要求 tool_calls 轮带 null 而不是缺字段）
 * - `arguments` 为空时写 `"{}"`（同样是为了 provider 侧解析）
 * - `extraContent` 原样透传：Gemini 的 OpenAI 兼容端点要求把每个 function call
 *   的不透明 thought signature 在下一轮发回去，别的 provider 只是忽略它。
 */
export function assistantMessageWithToolCalls(
  content,
  toolCalls,
  { reasoningContent = null, thinkingBlocks = null } = {},
) {
  const serializedCalls = (toolCalls ?? []).map((toolCall) => {
    const serialized = {
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments ? toolCall.arguments : '{}',
      },
    };
    const extraContent = toolCall.extra_content;
    if (extraContent && typeof extraContent === 'object' && Object.keys(extraContent).length > 0) {
      serialized.extra_content = extraContent;
    }
    return serialized;
  });

  const message = {
    role: 'assistant',
    content: content ? content : null,
    tool_calls: serializedCalls,
  };
  // OpenAI 兼容端点会拒收「content 与 tool_calls 同时为空」的 assistant 消息：
  //   400 Invalid assistant message: content or tool_calls must be set
  //
  // 真实触发路径（2026-10-30 dsa 3 题实跑复现）：思考模式下模型只吐
  // reasoning_content，正文为空；调用方仍进 TOOL 分支构消息，
  // content 变 null、tool_calls 是空数组 → 后续每次请求都 400，整批崩掉。
  // 上游 messages.py 把空串原样留下（content:""），有的端点认有的不认；
  // 这里统一补一个空白占位，保证消息至少有一个字段是有值的。
  if (serializedCalls.length === 0 && (message.content === null || message.content === '')) {
    message.content = ' ';
  }
  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (thinkingBlocks && thinkingBlocks.length > 0) message.thinking_blocks = thinkingBlocks;
  return message;
}

/** 纯文本 assistant 轮；带推理时一并带上。 */
export function assistantMessage(content, { reasoningContent = null, thinkingBlocks = null } = {}) {
  const message = { role: 'assistant', content };
  // 同 assistantMessageWithToolCalls 的理由：只有 reasoning_content 而正文为空时，
  // 这条消息在 OpenAI 兼容端点上会被判为非法（content 为空且无 tool_calls）。
  // 修复回合恰好会走到这里 —— 模型本轮只思考、没写正文。
  if (content === null || content === undefined || content === '') {
    message.content = reasoningContent || (thinkingBlocks && thinkingBlocks.length > 0) ? ' ' : content;
  }
  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (thinkingBlocks && thinkingBlocks.length > 0) message.thinking_blocks = thinkingBlocks;
  return message;
}

/**
 * 把"仅模型可见"的图片插到对应 tool 结果后面，**不改**历史。
 *
 * 图片是请求内的临时证据：一旦落进持久历史，它会被当成用户自己发的内容显示
 * 出来。所以只在发请求的那一刻拼进 `request_messages`。
 *
 * 位置很关键：provider 要求同一批 tool_calls 的所有 tool 回复都到齐之后才能出现
 * 新的 user 消息 —— 所以图片挂在**最后一条连续的 tool 消息**后面。
 */
export function withTransientModelMessages(messages, transient) {
  if (!transient || transient.length === 0) return messages;
  const anchored = new Map();
  for (const item of transient) {
    const toolCallId = item._after_tool_call_id;
    if (typeof toolCallId !== 'string' || toolCallId === '') continue;
    if (!anchored.has(toolCallId)) anchored.set(toolCallId, []);
    anchored.get(toolCallId).push({ role: 'user', content: item.content });
  }
  if (anchored.size === 0) return messages;

  const requestMessages = [];
  let pending = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    requestMessages.push(message);
    if (message.role === 'tool') {
      const key = String(message.tool_call_id ?? '');
      if (anchored.has(key)) {
        pending = pending.concat(anchored.get(key));
        anchored.delete(key);
      }
      const next = messages[index + 1];
      if (index + 1 === messages.length || !next || next.role !== 'tool') {
        requestMessages.push(...pending);
        pending = [];
      }
    }
  }
  return requestMessages;
}

function transientImageCount(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return 0;
  return content.filter((part) => part && typeof part === 'object' && part.type === 'image_url').length;
}

/**
 * 跨轮保留最近的有界图片证据。
 *
 * 上限 2 张：超过就从头丢。不设上限的话，一个读图很多轮的回合会把请求体撑爆。
 */
export function extendTransientModelMessages(transient, incoming, { maxImages = 2 } = {}) {
  if (incoming && incoming.length > 0) transient.push(...incoming);
  const total = () => transient.reduce((sum, item) => sum + transientImageCount(item), 0);
  while (transient.length > 0 && total() > maxImages) transient.shift();
}
