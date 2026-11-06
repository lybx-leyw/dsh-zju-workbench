/**
 * 一次带协议标签的流式调用：`runtime/agentic/labeled_step.py` 的搬运。
 *
 * 这是单轮往返的原语。给定一个流式客户端、可选的工具 schema、以及一套标签协议，
 * 它做这些事：
 *
 * 1. 在前几个 chunk 里认出 ```` ``LABEL`` ```` 前缀；
 * 2. **非终止标签**（`THINK` / `TOOL` / …）的标签后文本**实时**推进 reasoning
 *    子 trace；
 * 3. **终止标签**（`FINISH` / `PLAN` / `QUIZ` …）的标签后文本**缓冲**起来返回，
 *    由调用方决定要不要当正文发出去 —— 这样「FINISH+TOOL 混合」的回复不会
 *    在协议校验之前就把散文漏进答案区；
 * 4. 累积 `tool_calls` 分片。工具调用本身**不**决定动作标签：正文流仍然必须
 *    以调用方给的 `toolLabel` 开头，否则走调用方的协议修复路径；
 * 5. 推理模型在协议标签**之前**塞一段字面 `<think>...</think>` 时，识别它并
 *    把前导块实时路由进 reasoning 子 trace。
 *
 * # 两个必须复刻的细节（任务书点名了）
 *
 * **`finalMeta` 决定推流方式**：非 null → 每收到一个落在 `finalLabels` 里的片段
 * 就用 `stream.content(..., trace_kind:'llm_chunk')` 推出去，气泡逐字长；
 * null → 缓冲，等协议校验后由调用方自己推。**这是 explore 与 quiz 行为不同的
 * 唯一根源**：quiz 用 null，才不会把裸 JSON 刷屏。
 *
 * **`</think>` 可能被切在两个 chunk 之间**：前导区尾部最多扣住
 * `THINK_CLOSE_TAIL_GUARD = 24` 个字符不处理，等下一个 chunk 补齐了再判。
 * 不扣就会漏检 think 块结束，整段思考会被当成"还没结束的前导区"。
 *
 * # 协议违规不在这里抛错
 *
 * 认不出标签时返回 `LABEL_UNKNOWN`，由上层 loop 决定补一条 user 纠正再继续。
 * 在这里抛异常等于把"多花一轮"升级成"整轮报废"。
 */

import { LABEL_UNKNOWN, LABEL_PROBE_MAX_CHARS, classifyLabel, stripLabelProbePrefix } from './labels.js';
import { InlineThinkFilter, cleanThinkingTags } from './think.js';
import { fromChunkUsage, messageContentChars, recordStreamedUsage } from './usage-frame.js';

/** 推理模型的字面 `<think>` 前导块：**只**匹配（去空白后）缓冲区的开头。 */
const THINK_OPEN_PREFIX_RE = /^(?:`<\s*think(?:ing)?\b[^>]*>`|<\s*think(?:ing)?\b[^>]*>)/i;
const THINK_CLOSE_ANY_RE = /(?:`<\s*\/\s*think(?:ing)?\s*>`|<\s*\/\s*think(?:ing)?\s*>)/i;

/**
 * `</think>` 加上可选反引号/空白的余量。前导区尾部最多只扣这么多字符，
 * 这样被切开的闭合标签下一轮还认得出来。
 */
const THINK_CLOSE_TAIL_GUARD = 24;

/**
 * 供应商已经明确给了 `finish_reason` 之后，文本生成就结束了。有些 OpenAI 兼容
 * 网关会把 SSE 连接挂着等一个可选的 usage 尾帧：等一小会儿，然后本地关掉，
 * 让界面能及时收到 RESULT/DONE。
 */
export const USAGE_TRAILER_GRACE_TIMEOUT_MS = 1000;

/** 网关从不发 `finish_reason`、却已经给了终止标签答案然后干挂时的兜底。 */
export const FINAL_LABEL_IDLE_TIMEOUT_MS = 8000;

function mergeMeta(base, extra) {
  const merged = {};
  if (base) Object.assign(merged, base);
  if (extra) Object.assign(merged, extra);
  return merged;
}

/**
 * OpenAI 兼容的 `delta.tool_calls` 累加器。
 *
 * 三条规则，都是 provider 的：
 * - `id` / `name` 在携带它们的那一帧上**完整**到达（可能每帧重复）。**赋值，不拼接**。
 * - `arguments` 是**分片**，必须拼接。
 * - provider 扩展（Gemini 的 `extra_content.google.thought_signature`）完整到达，
 *   必须原样保留，下一轮工具调用要发回去。
 *
 * 把完整字段当分片拼接就是 #937：某个 router 每帧重发 `id`，它涨到 47241 字符，
 * 越过 provider 自己 64 字符的上限，整轮 HTTP 400；同一次拼接还把 `name` 变成
 * `toolnametoolnametoolname`，任何注册表都解析不了。
 */
export class ToolCallAccumulator {
  constructor() {
    this.parts = new Map();
  }

  /** 折进一个 tool-call 分片；返回它贡献的字符数（只有 name + arguments 计入）。 */
  feed(delta) {
    const index = Number.isInteger(delta?.index) ? delta.index : 0;
    const part = this.parts.get(index) ?? { id: '', name: '', arguments: '' };
    if (delta?.id) part.id = String(delta.id);
    if (delta?.extra_content && typeof delta.extra_content === 'object'
      && Object.keys(delta.extra_content).length > 0) {
      part.extra_content = delta.extra_content;
    }
    // 两种形状都吃：SDK 的 `{function:{name,arguments}}`，以及本包契约 chunk 扁平化的
    // `{name, argumentsDelta}` / `{name, arguments}`。上游只面对 SDK 形状，但这里的
    // 入口同时接 `createLlmClient` 的产物，把归一放在累加器里比在每个调用点各写一遍稳。
    const fn = delta?.function ?? null;
    const name = fn?.name ?? delta?.name;
    const args = fn?.arguments ?? delta?.argumentsDelta ?? delta?.arguments;
    let chars = 0;
    if (name) {
      part.name = String(name);
      chars += String(name).length;
    }
    if (args) {
      part.arguments += String(args);
      chars += String(args).length;
    }
    this.parts.set(index, part);
    return chars;
  }

  /** 某个 provider index 正在折进的那一份（还没有则 undefined）。 */
  partAt(index) {
    return this.parts.get(Number(index));
  }

  /** 全部累积结果，按 provider index 升序，**不过滤**。 */
  ordered() {
    return [...this.parts.keys()].sort((a, b) => a - b).map((key) => this.parts.get(key));
  }

  /** 可派发的调用：只有具名的，补上默认值。 */
  collected() {
    const calls = [];
    for (const index of [...this.parts.keys()].sort((a, b) => a - b)) {
      const part = this.parts.get(index);
      if (!part?.name) continue;
      const call = {
        id: part.id || `call_${index}`,
        name: part.name,
        arguments: part.arguments || '{}',
      };
      if (part.extra_content && Object.keys(part.extra_content).length > 0) {
        call.extra_content = part.extra_content;
      }
      calls.push(call);
    }
    return calls;
  }
}

/**
 * 跑一次 labeled step。
 *
 * @param {object} options
 * @param {object} options.client - 流式客户端。两种形状都吃：
 *   `{prepareCall(config) → {stream(opts)}}`（本包 `createLlmClient` 的产物），
 *   或 OpenAI SDK 形状 `{chat:{completions:{create(kwargs)}}}`。
 * @param {string} [options.model]
 * @param {Array} options.messages - 历史消息（已被 loop 维护成线格式）
 * @param {object} [options.completionKwargs] - `{temperature, max_tokens, ...}`
 * @param {Array|null} [options.toolSchemas]
 * @param {string[]} options.allowedLabels
 * @param {Set|string[]} options.finalLabels
 * @param {string|null} [options.toolLabel]
 * @param {object|null} [options.stream] - 流总线（`content` / `thinking` / `progress`）
 * @param {string} [options.source]
 * @param {string} [options.stage]
 * @param {object} [options.iterMeta]
 * @param {object|null} [options.finalMeta] - 非 null 时终止标签正文逐 chunk 推流
 * @param {object|null} [options.usage] - UsageTracker
 * @param {boolean} [options.eagerSubTrace]
 * @param {string|null} [options.binding]
 * @param {AbortSignal|null} [options.signal]
 * @returns {Promise<{label:string,text:string,toolCalls:Array,reasoningContent:string,
 *   thinkingBlocks:Array,finishReason:string|null,streamIdleTimeout:boolean,
 *   reasoningOnly:boolean}>}
 */
export async function runLabeledStep({
  client,
  model = null,
  messages = [],
  completionKwargs = {},
  toolSchemas = null,
  allowedLabels = [],
  finalLabels = [],
  toolLabel = null,
  stream = null,
  source = '',
  stage = '',
  iterMeta = {},
  finalMeta = null,
  usage = null,
  eagerSubTrace = false,
  binding = null,
  signal = null,
} = {}) {
  const finalSet = finalLabels instanceof Set ? finalLabels : new Set(finalLabels ?? []);
  let label = null;
  let labelBuf = '';
  let inPreludeThink = false;
  // 前导区里被扣住的那一小段尾巴，用来检测被切开的 `</think>`。
  let preludeTail = '';
  let sawPreLabelThink = false;
  // 一个标签都没来过 → 下面的 LABEL_UNKNOWN 是**我们**的判断，不是模型的。
  let neverLabelled = false;
  // 标签后出现过内联 `<think>` 块 → 返回值必须过 cleanThinkingTags。
  let sawPostLabelThink = false;
  let subTraceOpened = false;
  const contentAcc = [];
  // 推理模型在协议标签**之后**开 `<think>` 同样常见；前导区由上面的状态机管，
  // 标签后的正文由这个切分器管。
  const postLabelThink = new InlineThinkFilter();
  const toolAcc = new ToolCallAccumulator();
  // 留给下一轮 assistant 消息重放用，不是给显示用的。
  const reasoningAcc = [];
  let thinkingBlocks = [];
  let usageSeen = null;
  let outputCharsSeen = 0;
  let finishReasonSeen = null;
  let usageTrailerWaited = false;
  let streamIdleTimeout = false;

  const emit = (method, text, meta) => {
    if (!stream || typeof stream[method] !== 'function' || !text) return Promise.resolve();
    return stream[method](text, { source, stage, metadata: mergeMeta(meta, { trace_kind: 'llm_chunk' }) });
  };

  async function openSubTrace() {
    if (subTraceOpened) return;
    if (stream && typeof stream.progress === 'function') {
      await stream.progress(iterMeta?.label ?? '', {
        source,
        stage,
        metadata: mergeMeta(iterMeta, { trace_kind: 'call_status', call_state: 'running' }),
      });
    }
    subTraceOpened = true;
  }

  /**
   * 路由终止标签的片段，把内联推理挡在外面。
   *
   * 如果直接当 content 流出去，标签后的 `<think>` 块会把模型的私密思考放进
   * 回复里 —— 而最后的 `cleanThinkingTags` 又会把它从返回值里删掉，于是它
   * 实时到达了读者、事后却哪儿都不存在。送进前导区用的同一个 reasoning 子 trace，
   * 回复干净、推理可查。
   */
  async function emitFinalSegments(segments) {
    for (const [kind, segment] of segments) {
      if (!segment) continue;
      if (kind === 'thinking') {
        await openSubTrace();
        await emit('thinking', segment, iterMeta);
        continue;
      }
      await emit('content', segment, finalMeta);
    }
  }

  /**
   * 路由标签后的片段。
   *
   * - 终止标签正文：缓冲。若给了 `finalMeta`，**同时**实时发一个 content 事件，
   *   气泡逐字长（`llm_final_response`），内联 `<think>` 块分流到 reasoning trace。
   * - 非终止标签：流进 reasoning 子 trace。
   */
  async function emitText(text) {
    if (!text) return;
    outputCharsSeen += text.length;
    contentAcc.push(text);
    if (finalSet.has(label)) {
      if (finalMeta !== null && finalMeta !== undefined) {
        const segments = postLabelThink.feed(text);
        // 只要出现过标签后的 `<think>`，返回文本就必须过一遍 cleanThinkingTags
        // —— 否则内联推理会以原始标签的形式留在正文里。
        if (segments.some(([kind]) => kind === 'thinking')) sawPostLabelThink = true;
        await emitFinalSegments(segments);
      }
      return;
    }
    await openSubTrace();
    await emit('thinking', text, iterMeta);
  }

  /** 前导区 `<think>` 的正文：进 reasoning 子 trace，同时留进 contentAcc。 */
  async function emitPreludeContent(text) {
    if (!text) return;
    outputCharsSeen += text.length;
    contentAcc.push(text);
    await openSubTrace();
    await emit('thinking', text, iterMeta);
  }

  /** `<think>` / `</think>` 标记：实时进 trace，也记进 contentAcc（后续统一剥掉）。 */
  async function emitPreludeMarker(tagText) {
    if (!tagText) return;
    outputCharsSeen += tagText.length;
    contentAcc.push(tagText);
    await openSubTrace();
    await emit('thinking', tagText, iterMeta);
  }

  /** 流在 think 块中途结束：把剩余推理推出去，再补一个合成的闭合标记。 */
  async function closePreludeArtificially() {
    if (preludeTail) {
      await emitPreludeContent(preludeTail);
      preludeTail = '';
    }
    await emitPreludeMarker('</think>');
    inPreludeThink = false;
  }

  /**
   * `inPreludeThink` 期间扫描 `preludeTail` 找 `</think>`。
   * 找到 → 前面的内容实时推出去、闭合标记也推、标签后的部分交回 `labelBuf`
   * 让标签探测继续；没找到 → 只推安全的部分，尾部扣住 guard 窗口。
   */
  async function drainPreludeOrClose() {
    const match = THINK_CLOSE_ANY_RE.exec(preludeTail);
    if (!match) {
      if (preludeTail.length > THINK_CLOSE_TAIL_GUARD) {
        const split = preludeTail.length - THINK_CLOSE_TAIL_GUARD;
        const safe = preludeTail.slice(0, split);
        preludeTail = preludeTail.slice(split);
        await emitPreludeContent(safe);
      }
      return;
    }
    const before = preludeTail.slice(0, match.index);
    if (before) await emitPreludeContent(before);
    await emitPreludeMarker(match[0]);
    inPreludeThink = false;
    labelBuf = preludeTail.slice(match.index + match[0].length);
    preludeTail = '';
  }

  /**
   * 驱动一个 chunk 的前导状态机。
   *
   * 一个 chunk 可能同时携带整段前导块、协议标签、**以及**标签后的正文，所以这里
   * 循环直到标签被解析出来、或者没有可判定的输入为止。
   */
  async function ingestPreLabel(text) {
    if (inPreludeThink) preludeTail += text;
    else if (text) labelBuf += text;

    for (;;) {
      if (inPreludeThink) {
        await drainPreludeOrClose();
        if (inPreludeThink) return; // 等 `</think>`
        // 闭合标签已消费；labelBuf 现在是前导块之后剩下的部分，继续探测标签。
      }

      const stripped = stripLabelProbePrefix(labelBuf);
      const openMatch = THINK_OPEN_PREFIX_RE.exec(stripped);
      if (openMatch) {
        const leadingLen = labelBuf.length - stripped.length;
        // 前导空白原样保留 —— 最后的 cleanThinkingTags 会统一收边。
        if (leadingLen) contentAcc.push(labelBuf.slice(0, leadingLen));
        inPreludeThink = true;
        sawPreLabelThink = true;
        preludeTail = stripped.slice(openMatch[0].length);
        labelBuf = '';
        // 把 `<think>` 标记实时推出去，reasoning 子 trace 立刻可见；顺带把
        // 子 trace 卡片打开，短前导块（≤24 字符）也能在 guard 窗口刷新前有活动。
        await emitPreludeMarker(openMatch[0]);
        continue;
      }

      const parsed = classifyLabel(labelBuf, { allowedLabels });
      if (parsed !== null) {
        [label] = parsed;
        labelBuf = '';
        await emitText(parsed[1]);
        return;
      }

      if (labelBuf.length > LABEL_PROBE_MAX_CHARS) {
        // 探测窗口耗尽仍无协议标签。推理 trace 不是动作标签，落到 LABEL_UNKNOWN
        // 交给调用方修复。
        label = LABEL_UNKNOWN;
        const flushed = labelBuf;
        labelBuf = '';
        await emitText(flushed);
        return;
      }

      return; // 没有更多输入就无法再判定
    }
  }

  if (eagerSubTrace) {
    // 在流开始**之前**打开子 trace 卡片：面板立刻显示"进行中"，
    // 而不是等第一个 chunk（time-to-first-token 往往 0.5–3s）。
    await openSubTrace();
  }

  const events = openEvents({
    client, model, messages, completionKwargs, toolSchemas, usage, signal, binding,
  });

  const iterator = events[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timeout = null;
      if (finishReasonSeen) {
        if (usage !== null && usageSeen === null && !usageTrailerWaited) {
          timeout = USAGE_TRAILER_GRACE_TIMEOUT_MS;
          usageTrailerWaited = true;
        } else {
          break;
        }
      } else if (finalSet.has(label) && contentAcc.length) {
        timeout = FINAL_LABEL_IDLE_TIMEOUT_MS;
      }

      let next;
      try {
        next = await nextWithTimeout(iterator, timeout);
      } catch (error) {
        if (error?.code !== 'LLM_STEP_TIMEOUT') throw error;
        // 对聊天界面来说已经算终局：模型要么给了终止标签答案，要么给了明确的
        // finish_reason，只是网关抱着连接不放。
        if (finishReasonSeen || finalSet.has(label)) {
          if (!finishReasonSeen) streamIdleTimeout = true;
          break;
        }
        throw error;
      }
      if (next.done) break;
      const event = next.value;

      switch (event.kind) {
        case 'usage': {
          if (event.usage) usageSeen = event.usage;
          continue;
        }
        case 'finish': {
          // 先记 reason，再判失败：`error` / `aborted` 必须**抛**出去。
          //
          // 为什么不靠事件流自己 throw：终止帧是最后一条事件，消费循环看到
          // `finishReasonSeen` 就会 break（不再 next()），生成器里那个 throw
          // 永远不会执行。失败判断必须落在**收到帧的这一刻**。
          if (event.reason) finishReasonSeen = String(event.reason);
          if (event.reason === 'error') {
            const failure = event.failure ?? {};
            const error = new Error(String(failure.message ?? '模型调用失败'));
            error.code = failure.code ?? 'LLM_FAILED';
            error.status = failure.status;
            throw error;
          }
          if (event.reason === 'aborted') {
            const error = new Error('模型调用被取消');
            error.code = 'ABORTED';
            throw error;
          }
          continue;
        }
        case 'blocks': {
          // Anthropic 的带签名 thinking 块：签名是它下一轮可重放的全部理由。
          if (Array.isArray(event.blocks) && event.blocks.length) {
            thinkingBlocks = event.blocks.filter((block) => block && typeof block === 'object').map((block) => ({ ...block }));
          }
          continue;
        }
        case 'reasoning': {
          // 每一轮都累积，不只前导块：provider 要的是整轮推理回传，
          // 而 trace 界面有没有展示它是个显示问题。
          reasoningAcc.push(event.text);
          if (label === null) {
            outputCharsSeen += event.text.length;
            sawPreLabelThink = true;
            await openSubTrace();
            await emit('thinking', event.text, iterMeta);
          }
          continue;
        }
        case 'text': {
          if (label === null) await ingestPreLabel(event.text);
          else await emitText(event.text);
          continue;
        }
        case 'tool-call': {
          outputCharsSeen += toolAcc.feed(event.delta);
          continue;
        }
        default:
          continue;
      }
    }
  } finally {
    try {
      await iterator.return?.();
    } catch {
      /* 关闭失败不影响已经产出的结果 */
    }
  }

  // 流结束时还在缓冲标签。决定怎么收场：
  // 推理 trace（reasoning_content 或内联 <think>）不是动作标签；正式正文流没给
  // 标签，就落到 LABEL_UNKNOWN 让调用方修复。
  if (label === null) {
    if (inPreludeThink) {
      // 流在前导块中途结束 —— 把剩下的推理推出去，让用户看到模型产出了什么，
      // 再合成一个闭合。
      await closePreludeArtificially();
    }
    const finalParsed = classifyLabel(labelBuf, { allowedLabels, final: true });
    if (finalParsed !== null) {
      [label] = finalParsed;
      labelBuf = '';
      await emitText(finalParsed[1]);
    }
    if (label === null) {
      label = LABEL_UNKNOWN;
      neverLabelled = true;
    }
    if (labelBuf) {
      await emitText(labelBuf);
      labelBuf = '';
    }
  }

  if (finalMeta !== null && finalMeta !== undefined) {
    // 释放切分器还在等的半截标签。
    await emitFinalSegments(postLabelThink.flush());
  }

  recordStreamedUsage(usage, usageSeen, {
    inputChars: (messages ?? []).reduce((sum, message) => sum + messageContentChars(message), 0),
    outputChars: outputCharsSeen,
  });

  if (subTraceOpened && stream && typeof stream.progress === 'function') {
    await stream.progress('', {
      source,
      stage,
      metadata: mergeMeta(iterMeta, { trace_kind: 'call_status', call_state: 'complete' }),
    });
  }

  let text = contentAcc.join('');
  // 推理 trace 已经流进 trace 通道；返回值里的正式正文不该再带内联的 provider
  // 标记或前导私密思考。
  if (binding || sawPreLabelThink || sawPostLabelThink) text = cleanThinkingTags(text);

  const orderedToolCalls = toolAcc.ordered().filter((call) => call.name);
  const reasoningContent = reasoningAcc.join('');

  return {
    label,
    text,
    toolCalls: orderedToolCalls,
    reasoningContent,
    thinkingBlocks,
    finishReason: finishReasonSeen,
    streamIdleTimeout,
    // 工具调用算"到达答案"：这一轮行动了，只是没有叙述。只有"除了思考什么
    // 都没产出"的回合才值得再问一遍。
    reasoningOnly: neverLabelled
      && !text
      && orderedToolCalls.length === 0
      && Boolean(reasoningContent || sawPreLabelThink),
  };
}

/** `iterator.next()` 带超时；超时抛一个可识别的错误。 */
async function nextWithTimeout(iterator, timeoutMs) {
  if (timeoutMs === null || timeoutMs === undefined) return iterator.next();
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('labeled step 等待下一个 chunk 超时');
      error.code = 'LLM_STEP_TIMEOUT';
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([iterator.next(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 统一两种客户端形状，吐规范化事件流。
 *
 * 事件：`{kind:'text'|'reasoning'|'tool-call'|'usage'|'finish'|'blocks'}`。
 * 在这里做归一，让上面的状态机只面对一种形状 —— 否则每加一个 provider 方言
 * 都得改状态机。
 */
async function* openEvents({ client, model, messages, completionKwargs, toolSchemas, usage, signal, binding }) {
  if (client && typeof client.prepareCall === 'function') {
    // 本包 createLlmClient 的形状：config 用 camelCase，chunk 用契约类型。
    const config = {
      model: model ?? undefined,
      temperature: completionKwargs?.temperature ?? null,
      maxTokens: completionKwargs?.max_tokens ?? completionKwargs?.maxTokens ?? null,
      reasoningEffort: completionKwargs?.reasoning_effort ?? completionKwargs?.reasoningEffort ?? null,
      ...(completionKwargs?.stop ? { stop: completionKwargs.stop } : {}),
    };
    const prepared = await client.prepareCall(config, signal);
    const options = {
      messages,
      signal,
      ...(Array.isArray(toolSchemas) && toolSchemas.length ? { tools: toolSchemas, toolChoice: 'auto' } : {}),
    };
    for await (const chunk of prepared.stream(options)) {
      switch (chunk?.type) {
        case 'text-delta':
          if (chunk.text) yield { kind: 'text', text: String(chunk.text) };
          break;
        case 'reasoning-delta':
          if (chunk.text) yield { kind: 'reasoning', text: String(chunk.text) };
          break;
        case 'tool-call-delta':
          yield {
            kind: 'tool-call',
            delta: {
              index: chunk.index,
              id: chunk.id,
              name: chunk.name,
              arguments: chunk.argumentsDelta,
            },
          };
          break;
        case 'usage':
          if (chunk.usage) yield { kind: 'usage', usage: fromChunkUsage(chunk.usage) ?? chunk.usage };
          break;
        case 'finish':
          if (chunk.reason?.kind) {
            yield { kind: 'finish', reason: chunk.reason.kind, failure: chunk.reason.failure ?? null };
          }
          break;
        default:
          break;
      }
    }
    return;
  }

  // OpenAI SDK 形状（上游 labeled_step.py 直接用的就是它）。
  if (!client?.chat?.completions?.create) {
    throw new Error('runLabeledStep 需要 client.prepareCall 或 client.chat.completions.create');
  }
  const kwargs = {
    model,
    messages,
    stream: true,
    ...completionKwargs,
  };
  // 传了 usage 且调用方没显式设置时自动加 —— 这是拿到流式用量的唯一途径。
  let autoStreamOptionsAdded = false;
  if (usage !== null && usage !== undefined && !('stream_options' in kwargs)) {
    kwargs.stream_options = { include_usage: true };
    autoStreamOptionsAdded = true;
  }
  if (Array.isArray(toolSchemas) && toolSchemas.length) {
    kwargs.tools = toolSchemas;
    kwargs.tool_choice = 'auto';
  }

  let responseStream;
  try {
    responseStream = await client.chat.completions.create(kwargs);
  } catch (error) {
    if (autoStreamOptionsAdded && isUnsupportedParameter(error, 'stream_options')) {
      const retry = { ...kwargs };
      delete retry.stream_options;
      responseStream = await client.chat.completions.create(retry);
    } else if (Array.isArray(toolSchemas) && toolSchemas.length && isToolSchemaUnsupported(error)) {
      const retry = { ...kwargs };
      delete retry.tools;
      delete retry.tool_choice;
      responseStream = await client.chat.completions.create(retry);
    } else {
      throw error;
    }
  }

  try {
    for await (const chunk of responseStream) {
      if (chunk?.usage) yield { kind: 'usage', usage: chunk.usage };
      const choices = chunk?.choices ?? [];
      if (!choices.length) continue;
      const choice = choices[0];
      if (choice?.finish_reason) yield { kind: 'finish', reason: choice.finish_reason };
      const signed = choice?.provider_specific_fields?.thinking_blocks;
      if (Array.isArray(signed) && signed.length) yield { kind: 'blocks', blocks: signed };
      const delta = choice?.delta;
      if (!delta) continue;
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) yield { kind: 'reasoning', text: String(reasoning) };
      if (delta.content) yield { kind: 'text', text: String(delta.content) };
      for (const toolDelta of delta.tool_calls ?? []) {
        yield {
          kind: 'tool-call',
          delta: {
            index: toolDelta.index,
            id: toolDelta.id,
            name: toolDelta.function?.name,
            arguments: toolDelta.function?.arguments,
            extra_content: toolDelta.extra_content,
          },
        };
      }
    }
  } finally {
    const close = responseStream?.close;
    if (typeof close === 'function') {
      try {
        await close.call(responseStream);
      } catch {
        /* 关闭失败不影响结果 */
      }
    }
  }
}

function errorText(error) {
  return String(error?.body ?? error?.doc ?? error?.response?.text ?? error?.message ?? error ?? '').toLowerCase();
}

function isUnsupportedParameter(error, parameter) {
  const text = errorText(error);
  if (!text.includes(parameter)) return false;
  return ['stream options', 'unknown parameter', 'unrecognized request argument', 'unsupported parameter',
    'extra inputs are not permitted', 'unexpected keyword'].some((marker) => text.includes(marker));
}

function isToolSchemaUnsupported(error) {
  const text = errorText(error);
  if (['function_declaration', 'function declaration', 'function_declarations', 'tool_choice',
    'parameters.properties', 'unsupported parameter: tools', 'unknown parameter: tools',
    "unknown parameter 'tools'", 'unknown parameter "tools"', 'tools is not supported',
    'tools are not supported', 'does not support tools', 'does not support function calling',
    'function calling is not supported', 'tool use is not supported',
    'tool calling is not supported'].some((marker) => text.includes(marker))) {
    return true;
  }
  return /404[_ ]not[_ ]found/.test(text)
    && ['tool schema', 'function schema', 'function declaration', 'function_declaration',
      'function calling', 'tool calling', 'tool_choice'].some((marker) => text.includes(marker));
}
