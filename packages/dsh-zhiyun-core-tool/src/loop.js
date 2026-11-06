/**
 * 标签驱动的迭代调度器 —— 上游 `runtime/agentic/loop.py` 的 JS 对位。
 *
 * # 状态机（这是全包最需要看懂的地方）
 *
 * ```
 *                     ┌──────────────────────────────┐
 *                     │  iteration ∈ [0, maxIter)     │
 *                     └──────────────┬───────────────┘
 *                                    │
 *              guardContextWindow / beforeIteration
 *                                    │
 *                             runLabeledStep
 *                                    │
 *                        _protocolViolation?
 *                       ┌────────────┴────────────┐
 *                      yes                        no
 *                       │                          │
 *              emitRetryNotice                    │
 *              appendRepairMessages               │
 *                       │                          │
 *                    continue            ┌─────────┴──────────┬──────────────────┐
 *                                        │                    │                  │
 *                              label ∈ terminal      label == toolLabel   label ∈ intermediate
 *                                        │                    │                  │
 *                              validateTerminal            append assistant    (可选) emitFinal
 *                              ┌─────────┴───────┐           + dispatchTools      append assistant
 *                            violation        ok                 │                onIntermediate
 *                              │                │          ┌──────┴──────┐        feedback
 *                     retry + continue    emitFinal?    pause           terminate
 *                                          completed=true   │                │
 *                                          break      resolvePause      emitTerminator
 *                                                          │                │
 *                                                    resumed? ──否──► completed=false, break
 *                                                          │ 是
 *                                                       continue
 *                                        └──────────────────────────────────────┘
 *                                    │
 *                          （循环跑满 maxIter）
 *                                    ↓
 *                            forceFinalize
 *                            (finalText, completed, extraIterations)
 * ```
 *
 * # 四条不能动的东西
 *
 * 1. **协议是参数，不是常量。** 上游四个阶段各有一套 allowed/terminal/intermediate/
 *    final/toolLabel 矩阵（EXPLORE、PLAN、QUIZ、REPAIR），QUIZ 甚至没有标签。
 *    把"谁来终止"写死成一种，第二套就用不了。这里全部由 `protocol` 传入。
 * 2. **`streamBodyLive` 一开一关是刻意的。** 开：FINISH 的正文明珠逐 chunk 推给
 *    用户（explore 的探索前言）。关：FINISH 文本只作为返回值交给调用方解析
 *    （quiz 的 FINISH 是一坨裸 JSON，直接推给用户就是往脸上刷 JSON）。
 *    开着时**必须**跳过 `emitFinal`，否则正文被推两遍。
 * 3. **协议违规不终止，只修复。** 违反协议的一轮把模型的草稿留作 assistant 上下文，
 *    再补一条 user 纠正提示，然后继续。这是"多花一轮"与"整轮报废"的差别。
 * 4. **暂停优先于终止。** 暂停时不发终止事件：回合还活着，用户答完会继续，
 *    真答案那时才产生。
 *
 * # 终止条件（三种，互斥）
 *
 * - 终止标签命中 → `completed=true`，`finalLabel` 记下是哪一个；
 * - 工具要求终止（`terminate`）→ 用它的 content 当最终产物；
 * - 预算耗尽 → `forceFinalize`，它自己决定 `completed`（可能为 false）。
 * 暂停被用户拒绝恢复（`resolvePause` 返回 false）也算结束，但 `completed=false`。
 */

import { assistantMessage, assistantMessageWithToolCalls } from './messages.js';

export const LABEL_UNKNOWN = 'UNKNOWN';

/** 标签探测缓冲上限：超过还没匹配上就按 UNKNOWN 处理。 */
export const LABEL_PROBE_MAX_CHARS = 64;

/** 修复消息里保留的草稿长度。超出就截断，避免把一轮废话全塞回历史。 */
export const REPAIR_PREVIEW_CHARS = 500;

/**
 * 修复轮里草稿被截断时追加的标记（上游是带反斜杠的字面量 `\n...[truncated]`，
 * 这里保持同样的字符序列，否则复盘时对不上）。
 */
export const TRUNCATION_MARKER = '\\n...[truncated]';

/**
 * 默认迭代上限。**调用方应当显式传值**：上游的 explore 是 8、单题 quiz 是 5，
 * 而整卷的模型调用预算是 `10 + 2 + 9N`（N = 题数）。这里给一个足够大的兜底，
 * 只是为了让"忘了传"不至于变成"只能跑一轮"。
 */
export const DEFAULT_MAX_ITERATIONS = 32;

/**
 * 出题流水线整卷的模型调用预算：explore(≤8) + plan(1) + 每题(quiz ≤5 + repair ≤2)。
 * 写成函数是为了让集成测试能直接拿它对账，而不是在各处散落魔数。
 */
export function pipelineModelCallBudget(questionCount) {
  const n = Math.max(0, Number(questionCount) || 0);
  return 10 + 2 + 9 * n;
}

/** 一次循环运行的结局。 */
export function createLoopOutcome({
  finalLabel = '',
  finalText = '',
  iterations = 0,
  sources = [],
  messages = [],
  completed = false,
} = {}) {
  return { finalLabel, finalText, iterations, sources, messages, completed };
}

const LABEL_SEPARATOR_CHARS = '\n\r \t:：-–—';

/**
 * 分隔符的字符类正文。
 *
 * 不能直接 `escapeRegExp(LABEL_SEPARATOR_CHARS)` 拼进 `[...]`：`-` 未被转义时
 * 夹在中间会构成区间（`：-–` 是倒序区间，正则直接抛 Range out of order）。
 * 所以逐字符转成 `\uXXXX` 形式，字符类里就只剩字面量了。
 */
const LABEL_SEPARATOR_CLASS = [...LABEL_SEPARATOR_CHARS]
  .map((ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, '0')}`)
  .join('');

const LEADING_SEPARATOR_RE = new RegExp(`^[${LABEL_SEPARATOR_CLASS}]+`);

function stripLeadingSeparators(text) {
  return text.replace(LEADING_SEPARATOR_RE, '');
}
const REPAIR_MESSAGE_TRUNCATE = REPAIR_PREVIEW_CHARS;

function normalizeProtocol(protocol) {
  if (!protocol || typeof protocol !== 'object') {
    throw new Error('runAgenticLoop requires a protocol');
  }
  const allowed = [...(protocol.allowed ?? [])];
  if (allowed.length === 0) throw new Error('protocol.allowed must not be empty');
  return {
    allowed,
    terminal: new Set(protocol.terminal ?? []),
    intermediate: new Set(protocol.intermediate ?? []),
    final: new Set(protocol.final ?? []),
    toolLabel: protocol.toolLabel ?? null,
  };
}

/**
 * 标签识别 —— **唯一实现在 core-llm**，这里只做转发。
 *
 * 为什么不再保留第二份：core-llm 的 `runLabeledStep` 用自己那份判断「本次回复属于
 * 哪个标签」，core-tool 的循环用这份判断「这个标签是否违规」。两份只要有一处
 * accepted 形状不同（比如单反引号收不收、裸标签后跟什么分隔符算数），就会出现
 * 「step 认出了 FINISH、loop 却说协议违规」→ 补纠正消息 → 再来一遍 → 无限循环，
 * 而且不报错、只是把模型调用预算烧光。
 *
 * 曾经两份是逐字相同的独立拷贝，靠 17 个边界用例的对拍测试保平安。
 * 对拍能发现不一致，但挡不住「有人只改了一份且没跑对拍」。所以改成单一来源。
 *
 * 转发时保留 fallback：core-llm 未安装时退回本包的历史实现，
 * 这样 core-tool 仍可独立使用（它的测试不依赖 core-llm）。
 */
let _classifyLabelImpl = null;

/** 注入标签实现（core-llm 加载后调用；不调用则用下面的 fallback）。 */
export function bindLabelClassifier(fn) {
  if (typeof fn !== 'function') throw new TypeError('bindLabelClassifier 需要一个函数');
  _classifyLabelImpl = fn;
}

export function classifyLabel(buffer, options = {}) {
  if (_classifyLabelImpl) return _classifyLabelImpl(buffer, options);
  return fallbackClassifyLabel(buffer, options);
}

function fallbackClassifyLabel(buffer, { allowedLabels = [], final = false } = {}) {
  let stripped = String(buffer ?? '');
  let previous = null;
  while (stripped !== previous) {
    previous = stripped;
    stripped = stripped.replace(/^\s+/, '').replace(/^[\ufeff\u200b\u200c\u200d]+/, '');
  }
  for (const label of allowedLabels) {
    const escaped = escapeRegExp(label);
    const wrapped = new RegExp(`^(\`+)\\s*${escaped}\\s*\\1([\\s\\S]*)$`).exec(stripped);
    if (wrapped) {
      const after = wrapped[2];
      // 避免接受一个"过闭合 / 还在流"的包裹（例如 FINISH```），
      // 把多出来的反引号漏进被路由的正文里。非反引号的尾巴是真正文。
      if (after && after[0] === '`') continue;
      return [label, stripLeadingSeparators(after)];
    }
    if (stripped.startsWith(label)) {
      const tail = stripped.slice(label.length);
      // 裸标签兜底：只有紧跟清晰分隔符才算，避免把以 FINISHED 开头的正文误判。
      if (tail && LABEL_SEPARATOR_CHARS.includes(tail[0])) {
        return [label, stripLeadingSeparators(tail)];
      }
      if (final && !tail) return [label, ''];
    }
  }
  return null;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 正文里出现的标签（第二行及以后、行首的标签）。
 *
 * 协议要求每条回复只带一个标签。正文里再冒出一个标签是值得纠的违规；
 * 而 "next I should use ``TOOL``" 这种行内提及**不是**动作标签，不能触发修复循环。
 */
export function findInlineLabels(text, { allowedLabels = [] } = {}) {
  if (allowedLabels.length === 0) return [];
  const raw = String(text ?? '');
  if (raw === '') return [];
  const pattern = allowedLabels.map(escapeRegExp).join('|');
  const separators = LABEL_SEPARATOR_CLASS;
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
 * 把一次 labeled step 的结果对着协议分类。
 *
 * 返回违规键（与宿主 repair-message 的词表对应），合规返回 `null`。
 */
export function protocolViolation(step, protocol) {
  const label = String(step?.label ?? '');
  if (label === LABEL_UNKNOWN) return 'missing_label';
  if (findInlineLabels(step.text, { allowedLabels: protocol.allowed }).length > 0) {
    return 'multiple_labels';
  }
  if (protocol.toolLabel !== null) {
    const toolCalls = step.toolCalls ?? [];
    if (label === protocol.toolLabel && toolCalls.length === 0) return 'tool_without_calls';
    if (label !== protocol.toolLabel && toolCalls.length > 0) {
      // 违规键带上真实标签，宿主才能渲染准确的修复文案。
      // 老键 think_with_tools / finish_with_tools 仍会产生，但新的标签词表
      // （例如 chat 的 PAUSE —— intermediate + final）拿到自己的 {label}_with_tools。
      return `${label.toLowerCase()}_with_tools`;
    }
  }
  return null;
}

async function emitRetryNotice(stream, source, stage, host, violation) {
  if (!stream) return;
  await stream.progress(host.protocolRetryNotice(), {
    source,
    stage,
    metadata: { trace_kind: 'warning', protocol_violation: violation },
  });
}

/**
 * 把模型未按协议产出的草稿留作 assistant 上下文，再补一条纠正提示。
 *
 * 收整个 step 而不是它的文本，是因为这一轮的推理也要跟着草稿走：修复轮仍然是一轮，
 * thinking 模型的 provider 会拒一段丢了推理的历史。
 */
export function appendRepairMessages({ messages, step, violation, host }) {
  let clipped = String(step?.text ?? '').trim();
  const reasoning = step?.reasoningContent ?? null;
  const thinkingBlocks = step?.thinkingBlocks ?? null;
  const hasThinking = Boolean(reasoning) || (thinkingBlocks && thinkingBlocks.length > 0);
  if (clipped || hasThinking) {
    if (clipped.length > REPAIR_MESSAGE_TRUNCATE) {
      clipped = `${clipped.slice(0, REPAIR_MESSAGE_TRUNCATE).replace(/\s+$/, '')}${TRUNCATION_MARKER}`;
    }
    messages.push(
      assistantMessage(clipped, { reasoningContent: reasoning, thinkingBlocks }),
    );
  }
  messages.push({ role: 'user', content: host.protocolRepairMessage(violation) });
  return messages;
}

/**
 * 跑一个标签驱动的 LLM 循环，直到终止标签命中或用尽迭代预算。
 *
 * `initialMessages` **原地**被修改，并通过 `outcome.messages` 返回，调用方可以
 * 之后检视 / 复用完整历史（explore 阶段的探索轨迹就是从这里切出来的）。
 *
 * @param {object} options
 * @param {object} options.protocol           {allowed, terminal, intermediate, final, toolLabel}
 * @param {number} [options.maxIterations]
 * @param {boolean} [options.streamBodyLive]  true 时终止标签正文已由 step 直接推流，
 *                                            循环跳过 emitFinal
 * @param {object} options.host               能力层钩子（见下）
 *
 * host 需要实现（缺了就有对应降级，不强制全实现）：
 * - `guardContextWindow(messages)`            可选，裁剪超窗消息
 * - `beforeIteration({messages, iteration, maxIterations})` 可选
 * - `buildIterationTraceMeta(iteration)`      → `[iterMeta, finalMeta]`
 * - `dispatchTools({iteration, toolCalls})`   → DispatchOutcome
 * - `resolvePause(dispatch)`                  → boolean（true 表示继续）
 * - `emitTerminator(payload)`                 可选
 * - `emitFinal(text, finalMeta)`              可选
 * - `validateTerminal(label, text)`           可选，返回违规键或 null
 * - `protocolRetryNotice()` / `protocolRepairMessage(violation)`
 * - `forceFinalize({messages, startIteration})` → [finalText, completed, extraIterations]
 * - `onIntermediate(label, text)`             可选，返回非空串会作为 user 反馈注入
 */
export async function runAgenticLoop({
  initialMessages,
  protocol: rawProtocol,
  runLabeledStep,
  stream = null,
  source = '',
  stage = '',
  maxIterations = DEFAULT_MAX_ITERATIONS,
  host,
  streamBodyLive = false,
  eagerSubTrace = false,
} = {}) {
  if (typeof runLabeledStep !== 'function') {
    throw new Error('runAgenticLoop requires a runLabeledStep function');
  }
  if (!host || typeof host !== 'object') {
    throw new Error('runAgenticLoop requires a host');
  }
  const protocol = normalizeProtocol(rawProtocol);
  const messages = initialMessages;
  const transientModelMessages = [];
  const aggregatedSources = [];
  let finalText = '';
  let finalLabelSeen = '';
  let completed = false;
  let iterationsRun = 0;
  const maxIter = Math.max(1, Math.trunc(Number(maxIterations) || 0));
  let exhausted = true;

  for (let iteration = 0; iteration < maxIter; iteration += 1) {
    const withTransient = () => messages; // 图片等仅模型可见的消息由 host 在请求时拼

    if (typeof host.guardContextWindow === 'function') {
      await host.guardContextWindow(withTransient());
    }
    if (typeof host.beforeIteration === 'function') {
      await host.beforeIteration({ messages, iteration, maxIterations: maxIter });
    }
    const [iterMeta, finalMeta] = host.buildIterationTraceMeta(iteration);

    const step = await runLabeledStep({
      messages,
      protocol,
      iterMeta,
      // 与上游 loop.py:257 逐字对齐：`final_meta if stream_body_live else None`。
      //
      // 语义是「finalMeta 非 null 才逐 chunk 推流」，所以：
      //   streamBodyLive=true  → 传 finalMeta（explore 的正文逐字长）
      //   streamBodyLive=false → 传 null（quiz 的裸 JSON 缓冲，不刷屏）
      //
      // ⚠️ 这里曾经写反成 `streamBodyLive ? null : finalMeta`，导致 explore 阶段
      // finalMeta 被置空 → 不推流；而下面的 emitFinal 抑制又是按正确方向写的
      // → 也不补发。结果是【两边都不发，用户盯着空白等到最后】。
      // 这类 bug 不抛错、现有测试也覆盖不到，只有端到端看界面才会发现。
      finalMeta: streamBodyLive ? finalMeta : null,
      eagerSubTrace,
    });
    iterationsRun += 1;

    const violation = protocolViolation(step, protocol);
    if (violation !== null) {
      await emitRetryNotice(stream, source, stage, host, violation);
      appendRepairMessages({ messages, step, violation, host });
      continue;
    }

    if (protocol.terminal.has(step.label)) {
      if (typeof host.validateTerminal === 'function') {
        const terminalViolation = await host.validateTerminal(step.label, step.text);
        if (terminalViolation) {
          await emitRetryNotice(stream, source, stage, host, terminalViolation);
          appendRepairMessages({
            messages,
            step,
            violation: terminalViolation,
            host,
          });
          continue;
        }
      }
      if (protocol.final.has(step.label) && !streamBodyLive && typeof host.emitFinal === 'function') {
        // 正文已由 runLabeledStep 逐 chunk 推出去时，这里再调一次就是把同一段
        // 文本往用户气泡里灌第二遍。
        await host.emitFinal(step.text, finalMeta);
      }
      finalText = step.text;
      finalLabelSeen = step.label;
      completed = true;
      exhausted = false;
      break;
    }

    if (protocol.toolLabel !== null && step.label === protocol.toolLabel) {
      // 推理跟着这一轮一起进历史。thinking 模型的 provider 要求发起工具调用的
      // assistant 轮带上该轮自己的推理，少了它任何 thinking 回合的第二轮直接被拒。
      messages.push(
        assistantMessageWithToolCalls(step.text, step.toolCalls, {
          reasoningContent: step.reasoningContent ?? null,
          thinkingBlocks: step.thinkingBlocks ?? null,
        }),
      );
      const outcome = await host.dispatchTools({
        iteration,
        toolCalls: step.toolCalls,
      });
      aggregatedSources.push(...(outcome.sources ?? []));
      messages.push(...(outcome.toolMessages ?? []));
      if (typeof host.extendTransientModelMessages === 'function') {
        host.extendTransientModelMessages(transientModelMessages, outcome.modelMessages ?? []);
      }
      if (outcome.pause) {
        if (typeof host.resolvePause !== 'function') {
          // 没有暂停通道就等于用户不可能回答：终止而不是假装还活着。
          completed = false;
          exhausted = false;
          break;
        }
        const resumed = await host.resolvePause(outcome);
        if (!resumed) {
          completed = false;
          exhausted = false;
          break;
        }
        continue;
      }
      if (outcome.terminate) {
        if (typeof host.emitTerminator === 'function') {
          await host.emitTerminator(outcome.terminatePayload);
        }
        finalText = outcome.terminatePayload?.content ?? '';
        completed = true;
        exhausted = false;
        break;
      }
      continue;
    }

    if (protocol.intermediate.has(step.label)) {
      // 中间标签也可以被标成 final：意思是"把这段正文推进用户气泡，但别结束回合"
      // （chat 的 PAUSE）。文本同时留作 assistant 上下文，下一轮才看得见已经说过什么。
      if (protocol.final.has(step.label) && step.text && !streamBodyLive && typeof host.emitFinal === 'function') {
        await host.emitFinal(step.text, finalMeta);
      }
      if (step.text) {
        messages.push(
          assistantMessage(step.text, {
            reasoningContent: step.reasoningContent ?? null,
            thinkingBlocks: step.thinkingBlocks ?? null,
          }),
        );
      }
      if (typeof host.onIntermediate === 'function') {
        const feedback = await host.onIntermediate(step.label, step.text);
        if (feedback) messages.push({ role: 'user', content: feedback });
      }
      continue;
    }

    // 兜底：任何未覆盖的标签值都不终止，修复后重试。
    await emitRetryNotice(stream, source, stage, host, 'unknown_action');
    appendRepairMessages({ messages, step, violation: 'unknown_action', host });
    continue;
  }

  if (exhausted) {
    // 预算跑满时交给宿主决定怎么收场：上游会追加一条"强制收尾"的 user 消息，
    // 再用一个只允许 FINISH 的协议重试有限次，失败则返回兜底文案。
    const [finishText, didFinish, extraCalls] = await host.forceFinalize({
      messages,
      startIteration: maxIter,
    });
    iterationsRun += Number(extraCalls) || 0;
    finalText = finishText;
    completed = Boolean(didFinish);
  }

  return createLoopOutcome({
    finalLabel: finalLabelSeen,
    finalText,
    iterations: iterationsRun,
    sources: aggregatedSources,
    messages,
    completed,
  });
}
