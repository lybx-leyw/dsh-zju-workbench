/**
 * 用量帧的最小工具集。
 *
 * # 为什么不直接搬 core-llm 的 usage.js
 *
 * core-llm 的 `usage.js`（360 行）主要是 `UsageTracker` 类：价格表、成本估算、
 * 按模型回落定价。那是「客户端自己算账」的职责 —— 宿主已经做了这件事
 * （`dsh-llm` 的 `_usage` 与 `usage` getter）。
 *
 * 本包只需要三个纯函数：把各种方言的 usage 帧归一、估算消息字符数、
 * 把一次流式调用的用量记进调用方的 tracker。都是**形状转换**，与计价无关。
 *
 * 命名上刻意不叫 `core-llm`：那个名字会让人以为这是一套 LLM 客户端，
 * 实际上宿主 `dsh-llm` 才是唯一的客户端。
 */

/** 契约 chunk 的 `{input,output,total}` → OpenAI `prompt_tokens` 方言。 */
export function fromChunkUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  // 已经是 OpenAI 方言，原样返回
  if ('prompt_tokens' in usage || 'completion_tokens' in usage) return usage;
  const input = Number(usage.input ?? 0);
  const output = Number(usage.output ?? 0);
  const total = Number(usage.total ?? input + output);
  if (!input && !output && !total) return null;
  return { prompt_tokens: input, completion_tokens: output, total_tokens: total };
}

/** 一条消息的可见字符数（图片 base64 不算进去，否则估算会爆）。 */
export function messageContentChars(message) {
  const content = message?.content;
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    // 只统计文本块；image / attachment 这类按块计一个字符，
    // 它们的体积由宿主自己计量，不该混进 prompt 字符估算。
    if (block.type === 'text' && typeof block.text === 'string') chars += block.text.length;
    else chars += 1;
  }
  return chars;
}

/**
 * 把一次流式调用的用量记进调用方的 tracker。
 *
 * `tracker` 只需实现可选的 `add(prompt, completion, total)` 或
 * `record(usage)` —— 本包不绑定任何具体的 tracker 实现。
 * tracker 为空时静默跳过：计量是增强，不该让流水线因为缺它而失败。
 */
export function recordStreamedUsage(tracker, usageFrame, { inputChars = 0, outputChars = 0 } = {}) {
  if (!tracker) return;
  const normalized = fromChunkUsage(usageFrame);
  if (normalized) {
    const prompt = normalized.prompt_tokens ?? 0;
    const completion = normalized.completion_tokens ?? 0;
    const total = normalized.total_tokens ?? prompt + completion;
    if (typeof tracker.add === 'function') { tracker.add(prompt, completion, total); return; }
    if (typeof tracker.record === 'function') { tracker.record(normalized); return; }
    return;
  }
  // 供应商没报 usage：用字符数粗估（与上游 chars/3.5 同口径）。
  if (inputChars || outputChars) {
    const prompt = Math.round(inputChars / 3.5);
    const completion = Math.round(outputChars / 3.5);
    if (typeof tracker.add === 'function') tracker.add(prompt, completion, prompt + completion);
  }
}
