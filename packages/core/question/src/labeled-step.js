/**
 * 一次流式模型调用 + 标签路由。
 *
 * 上游对应：`runtime/agentic/labeled_step.py`（665 行）。本文件只做**纯 JS 兜底**：
 * 当注入的 `llm` 自带 `runLabeledStep` 时，pipeline 优先用它（core-llm 那边实现得更全，
 * 包含 `<think>` 前置状态机、usage 尾帧宽限、provider 降级重试）；没有时才走这里。
 *
 * # 两条不能省的行为
 *
 * 1. **`finalMeta` 两态推流。** `finalMeta` 非空 = 终止标签的正文明珠逐 chunk 推给
 *    用户（explore 的探索前言）；为空 = 正文只作返回值（quiz 的 FINISH 是一坨裸 JSON，
 *    直接推给用户就是往脸上刷 JSON）。
 * 2. **标签探测失败要退化成 `UNKNOWN`，不能抛。** 上游靠这个值触发协议修复轮；
 *    抛异常会让"模型少写两个反引号"变成整轮报废。
 */

/** 与上游 `labels.py` 同值。 */
export const LABEL_UNKNOWN = 'UNKNOWN';
export const LABEL_PROBE_MAX_CHARS = 64;
export const LABEL_SEPARATOR_CHARS = '\n\r \t:：-–—';

/**
 * 分隔符的字符类正文。
 *
 * `-` 必须转义：直接塞进 `[...]` 会被当成范围（`:：-–` 是倒序范围，运行期抛
 * `SyntaxError: Range out of order in character class`）—— 那意味着第一次探测
 * 标签就炸，整条出题链一步都走不出去。
 */
const SEPARATOR_CLASS = ':：\\-–—\\n\\r \\t';
const INVISIBLE = /[\ufeff\u200b\u200c\u200d]/g;

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `strip_label_probe_prefix`：去前导空白与零宽字符。 */
export function stripLabelProbePrefix(buffer) {
  return String(buffer ?? '').replace(INVISIBLE, '').replace(/^\s+/, '');
}

/**
 * `classify_label`：从缓冲里认出开头的一个 ``LABEL``。
 *
 * 接受优先形式（双反引号包裹）、单/三反引号变体，以及裸标签（后面必须跟分隔符，
 * 免得把 `FINISHED` 当成 `FINISH`）。
 */
export function classifyLabel(buffer, { allowedLabels = [], final = false } = {}) {
  const stripped = stripLabelProbePrefix(buffer);
  for (const label of allowedLabels) {
    const escaped = escapeRegExp(label);
    const wrapped = new RegExp(`^(\`+)\\s*${escaped}\\s*\\1([\\s\\S]*)$`).exec(stripped);
    if (wrapped) {
      const after = wrapped[2];
      // 过宽/仍在流的包裹（``FINISH```）不接受，免得把多余反引号漏进正文。
      if (after && after[0] === '`') continue;
      return [label, after.replace(new RegExp(`^[${SEPARATOR_CLASS}]+`), '')];
    }
    if (stripped.startsWith(label)) {
      const tail = stripped.slice(label.length);
      if (tail && LABEL_SEPARATOR_CHARS.includes(tail[0])) {
        return [label, tail.replace(new RegExp(`^[${SEPARATOR_CLASS}]+`), '')];
      }
      if (final && !tail) return [label, ''];
    }
  }
  return null;
}

/** 正文里（第二行起行首）出现的标签 —— 一次回复只允许一个标签。 */
export function findInlineLabels(text, { allowedLabels = [] } = {}) {
  if (!allowedLabels.length) return [];
  const raw = String(text ?? '');
  if (!raw) return [];
  const pattern = allowedLabels.map(escapeRegExp).join('|');
  const separators = SEPARATOR_CLASS;
  const found = [];
  const wrappedRe = new RegExp(
    `^[^\\S\\r\\n]*(\`+)\\s*(${pattern})\\s*\\1(?=$|[${separators}])`,
    'gm',
  );
  for (const match of raw.matchAll(wrappedRe)) found.push(match[2]);
  const bareRe = new RegExp(`^[^\\S\\r\\n]*(${pattern})(?=$|[${separators}])`, 'gm');
  for (const match of raw.matchAll(bareRe)) found.push(match[1]);
  return found;
}

/**
 * 兜底版的 `run_labeled_step`。
 *
 * 事件协议（core-llm 契约）：
 * `{type:'text-delta',text}` / `{type:'tool-call-delta',index,id,name,argumentsDelta}`
 * / `{type:'usage'}` / `{type:'finish',reason:{kind}}`。
 *
 * @returns {Promise<{label,text,toolCalls,finishReason,reasoningContent,reasoningOnly}>}
 */
export async function runLabeledStep({
  llm,
  config = {},
  messages,
  toolSchemas = null,
  allowedLabels = [],
  finalLabels = [],
  toolLabel = null,
  stream = null,
  source = '',
  stage = '',
  iterMeta = {},
  finalMeta = null,
  signal = null,
  reasoningEffort = null,
} = {}) {
  if (!llm || typeof llm.prepareCall !== 'function') {
    throw new Error('runDeepQuestion 需要 llm.prepareCall(config)');
  }
  const call = await llm.prepareCall({
    ...config,
    // 降思考重问（plan / repair 的 reasoning_only 分支）必须传下去：
    // 少了这一行，重问用的还是同一档思考，等于把同一轮再跑一遍。
    ...(reasoningEffort ? { reasoningEffort } : {}),
    messages,
    tools: toolSchemas ?? undefined,
    toolChoice: toolSchemas ? 'auto' : undefined,
  });
  const finalSet = new Set(finalLabels);

  let label = null;
  let probe = '';
  let reasoningOnlyProbe = '';
  let sawReasoning = false;
  let textAcc = '';
  const toolCallMap = new Map();
  let finishReason = null;
  let subTraceOpened = false;

  const openSubTrace = async () => {
    if (subTraceOpened || !stream || typeof stream.progress !== 'function') return;
    subTraceOpened = true;
    await stream.progress(iterMeta?.label ?? '', {
      source,
      stage,
      metadata: { ...iterMeta, trace_kind: 'call_status', call_state: 'running' },
    });
  };

  const emitThinking = async (chunk) => {
    if (!stream || typeof stream.thinking !== 'function') return;
    await openSubTrace();
    await stream.thinking(chunk, {
      source,
      stage,
      metadata: { ...iterMeta, trace_kind: 'llm_chunk' },
    });
  };

  const emitContent = async (chunk) => {
    if (!stream || typeof stream.content !== 'function') return;
    await stream.content(chunk, {
      source,
      stage,
      metadata: { ...(finalMeta ?? iterMeta), trace_kind: 'llm_chunk' },
    });
  };

  /** 路由一段正文：终止标签 → 缓冲（必要时同时推流）；其余 → 推理子 trace。 */
  const route = async (chunk) => {
    if (!chunk) return;
    if (label !== null && finalSet.has(label)) {
      textAcc += chunk;
      if (finalMeta !== null) await emitContent(chunk);
      return;
    }
    textAcc += chunk;
    await emitThinking(chunk);
  };

  /**
   * 处理到达的正文增量。
   *
   * 标签**只**在开头出现；未解析前进入 probe 缓冲。probe 超过上限还没认出来，
   * 就按上游的 LABEL_UNKNOWN 处理（整段正文原样保留，交给协议修复轮）。
   * 前置 `<think>...</think>` 前奏是推理模型的常见形态：剥进 reasoning 后继续探测，
   * 这样 `</think>`` ``FINISH`` 这种紧贴写法不会被反引号吃掉。
   */
  const ingest = async (raw) => {
    let chunk = raw;
    if (label === null) {
      if (!probe) {
        const open = /^(?:`<\s*think(?:ing)?\b[^>]*>`|<\s*think(?:ing)?\b[^>]*>)/i.exec(
          stripLabelProbePrefix(chunk),
        );
        if (open) {
          // 前奏开始：把整段当推理，直到看到 </think>。
          reasoningOnlyProbe += chunk;
          sawReasoning = true;
          await emitThinking(chunk);
          const close = /(?:`<\s*\/\s*think(?:ing)?\s*>`|<\s*\/\s*think(?:ing)?\s*>)/i.exec(chunk);
          if (close) {
            chunk = chunk.slice(close.index + close[0].length);
          } else {
            return;
          }
        } else if (reasoningOnlyProbe) {
          reasoningOnlyProbe += chunk;
          await emitThinking(chunk);
          const close = /(?:`<\s*\/\s*think(?:ing)?\s*>`|<\s*\/\s*think(?:ing)?\s*>)/i.exec(chunk);
          if (close) chunk = chunk.slice(close.index + close[0].length);
          else return;
        }
      }
      probe += chunk;
      const parsed = classifyLabel(probe, { allowedLabels });
      if (parsed === null) {
        const strippedProbe = stripLabelProbePrefix(probe);
        if (strippedProbe.length > LABEL_PROBE_MAX_CHARS) {
          // 探测超限：上游同样放弃，正文原样保留。
          label = LABEL_UNKNOWN;
          const rest = probe;
          probe = '';
          await route(rest);
        }
        return;
      }
      label = parsed[0];
      const after = parsed[1];
      probe = '';
      await route(after);
      return;
    }
    await route(chunk);
  };

  const streamed = call.stream({ messages, tools: toolSchemas ?? undefined, signal });
  for await (const event of streamed) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'text-delta') {
      await ingest(String(event.text ?? ''));
    } else if (event.type === 'tool-call-delta') {
      const index = Number(event.index ?? 0);
      const entry = toolCallMap.get(index) ?? { id: '', name: '', arguments: '' };
      if (event.id) entry.id = String(event.id);
      if (event.name) entry.name = String(event.name);
      if (event.argumentsDelta) entry.arguments += String(event.argumentsDelta);
      toolCallMap.set(index, entry);
    } else if (event.type === 'finish') {
      finishReason = event.reason?.kind ?? null;
    }
  }

  // 流结束时再判一次：模型可能把整个标签+正文一次吐完，也可能一行都没给。
  if (label === null) {
    const parsed = classifyLabel(probe, { allowedLabels, final: true });
    if (parsed !== null) {
      label = parsed[0];
      await route(parsed[1]);
    } else {
      const rest = probe;
      probe = '';
      label = LABEL_UNKNOWN;
      if (rest) await route(rest);
    }
  } else if (probe) {
    await route(probe);
  }

  const toolCalls = [...toolCallMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, entry]) => ({
      index,
      id: entry.id || `call-${index}`,
      name: entry.name,
      arguments: entry.arguments || '{}',
    }));

  // `reasoning_only`：一轮全用在思考上、没有产出标签也没有正文。
  // plan / repair 靠它决定「降思考再问一次」；没有它，#1318 会静默发一份 0 题。
  const reasoningOnly = label === LABEL_UNKNOWN && textAcc.trim() === '' && sawReasoning;

  return {
    label: label ?? LABEL_UNKNOWN,
    text: textAcc,
    toolCalls,
    finishReason,
    reasoningContent: reasoningOnlyProbe,
    reasoningOnly,
    toolLabel,
  };
}
