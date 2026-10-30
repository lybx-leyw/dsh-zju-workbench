/**
 * `InlineThinkFilter` + `cleanThinkingTags`：`runtime/agentic/think_stream.py` 与
 * `services/llm/utils.py` 的搬运。
 *
 * # 为什么必须在**流式**过程中切
 *
 * 推理模型把思考写在哪里并不统一：有的走 `delta.reasoning_content` 专用通道，
 * 有的（Qwen thinking、经某些代理的 DeepSeek-R1、不少本地构建）直接写进
 * content 通道，外面套 `<think>...</think>`。
 *
 * 第二类如果不在切分点处理，下游**每一个**消费者都是错的：用户气泡里出现模型
 * 的私密草稿、落盘的消息里留着它、loop 的终止检测把思考当成答案。所以切分放在
 * 这里，把思考路由到 trace 通道 —— 读者想看的自己去展开。
 *
 * 原始文本（含标签）仍然原样回到 LLM 会话里，因为那是模型期望看到的 transcript。
 */

const THINK_OPEN_RE = /<\s*think(?:ing)?\b[^>]*>/i;
const THINK_CLOSE_RE = /<\s*\/\s*think(?:ing)?\s*>/i;

/** 最长的、值得为它等下一个 chunk 的半截标签（例如 `</thinking` 加余量）。 */
const TAG_HOLDBACK_CHARS = 24;

/**
 * 增量式 `<think>` 切分器。
 *
 * `feed()` 返回 `[kind, text]` 片段，`kind` ∈ `{'content','thinking'}`。
 * 它可能**扣住**一个半截的尾标签：`"</thin"` 后面紧跟 `">"` 才是闭合标签，
 * 这时候先吐出去就等于把标签切碎，导致闭合永远检测不到。
 *
 * `flush()` 在流结束时释放扣住的部分。
 */
export class InlineThinkFilter {
  constructor() {
    this.buffer = '';
    this.inThink = false;
  }

  kind() {
    return this.inThink ? 'thinking' : 'content';
  }

  feed(chunk) {
    this.buffer += String(chunk ?? '');
    const segments = [];
    for (;;) {
      const pattern = this.inThink ? THINK_CLOSE_RE : THINK_OPEN_RE;
      const match = pattern.exec(this.buffer);
      if (!match) break;
      if (match.index > 0) segments.push([this.kind(), this.buffer.slice(0, match.index)]);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.inThink = !this.inThink;
    }
    // 扣住可能的半截标签：最后一个 `<` 之后既没有 `>` 又足够短，就当它是
    // 还没到齐的标签开头。
    let emitUpto = this.buffer.length;
    const tagStart = this.buffer.lastIndexOf('<');
    if (tagStart !== -1
      && this.buffer.length - tagStart <= TAG_HOLDBACK_CHARS
      && !this.buffer.slice(tagStart).includes('>')) {
      emitUpto = tagStart;
    }
    if (emitUpto > 0) {
      segments.push([this.kind(), this.buffer.slice(0, emitUpto)]);
      this.buffer = this.buffer.slice(emitUpto);
    }
    return segments;
  }

  flush() {
    if (!this.buffer) return [];
    const segments = [[this.kind(), this.buffer]];
    this.buffer = '';
    return segments;
  }
}

/** 一次性切分一整段文本（非流式执行器用）。 */
export function splitInlineThink(text) {
  const filter = new InlineThinkFilter();
  return [...filter.feed(text), ...filter.flush()];
}

/**
 * 去掉正文里的 `<think>` 块。
 *
 * 三个正则分别处理：已闭合块、**未闭合块**（请求在推理中途被中断时会出现，
 * 绝不能把半个草稿露给读者）、只剩孤立闭合标签的情况。
 *
 * 匹配时允许标签两侧各有一个可选反引号：某些网关会把 `<think>` 包成行内代码。
 */
export function cleanThinkingTags(content) {
  if (!content) return '';
  const closed = /`?<\s*(think(?:ing)?)\b[^>]*>`?[\s\S]*?`?<\s*\/\s*\1\s*>`?/gi;
  let cleaned = String(content).replace(closed, '');
  const unclosed = /`?<\s*think(?:ing)?\b[^>]*>`?[\s\S]*$/i;
  cleaned = cleaned.replace(unclosed, '');
  cleaned = cleaned.replace(/`?<\s*\/\s*think(?:ing)?\s*>`?/gi, '');
  return cleaned.trim();
}
