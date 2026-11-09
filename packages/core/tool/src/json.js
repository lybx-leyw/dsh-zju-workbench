/**
 * 工具参数解析 —— 上游 `utils/json_parser.py` 在**工具参数**这条路径上的对位。
 *
 * # 为什么不能直接 JSON.parse
 *
 * 模型给出的 `arguments` 不是我们生成的 JSON，而是它手写的字符串：可能被
 * ``` 围栏包着、可能前面垫一段 `<think>` 推理、可能整体为空串、可能缺逗号。
 * 上游为此走了一条 5 级降级链，调度器只用到其中"拿一个对象"的部分。
 *
 * # 关键语义：**永远返回对象，不抛**
 *
 * 上游调用是 `parse_json_response(tc.get("arguments") or "{}", fallback={})`，
 * 然后 `if not isinstance(tool_args, dict): tool_args = {}`。也就是说解析失败
 * 等同于"模型没给参数"，接下来由 arg guard 判定缺了哪个必填参数并回灌 ——
 * 这条路径必须走得通，否则非法参数会变成异常中断整轮，而不是让模型自我修正。
 */

const FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)```/;
const THINK_RE = /<think\b[^>]*>[\s\S]*?<\/think>/gi;
const LEADING_THINK_RE = /^\s*<think\b[^>]*>[\s\S]*?(?=[{[])/i;

/** 从 `start` 位置起把能解析出的最长 JSON 值找出来（跳过中间的散文）。 */
function decodeLongestJsonValue(text) {
  let best;
  let bestLength = 0;
  let pos = 0;
  for (;;) {
    const brace = text.indexOf('{', pos);
    const bracket = text.indexOf('[', pos);
    let start;
    if (brace === -1 && bracket === -1) return { found: bestLength > 0, value: best };
    if (brace === -1) start = bracket;
    else if (bracket === -1) start = brace;
    else start = Math.min(brace, bracket);

    // JSON.parse 不支持"从中间解析"，用括号配对切一个候选窗口再试。
    const candidate = sliceBalanced(text, start);
    if (candidate === null) {
      pos = start + 1;
      continue;
    }
    try {
      const value = JSON.parse(candidate);
      if (candidate.length > bestLength) {
        best = value;
        bestLength = candidate.length;
      }
      pos = start + candidate.length;
    } catch {
      // 候选窗口不合法（例如散文里的 `{`）：继续往后找下一个起点
      pos = start + 1;
    }
  }
}

/** 从一个括号起点切出配平的最外层片段；配不上返回 null。 */
function sliceBalanced(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 最小修复：去掉尾随逗号、把裸换行塞回字符串里。只在最后一级用。 */
function repairJsonish(text) {
  let out = text.replace(/,\s*([}\]])/g, '$1');
  out = out.replace(/[\u0000-\u001f]+/g, (match) => match.replace(/[\n\r\t]/g, '\\n'));
  return out;
}

/**
 * 解析工具参数。
 *
 * @param {unknown} raw      模型给的 `arguments`（字符串或已经是对象）
 * @param {object} [fallback] 全部失败时返回的值（默认 `{}`）
 * @returns {any}
 */
export function parseToolArguments(raw, fallback = {}) {
  if (raw !== null && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return fallback;
  if (raw.trim() === '') return fallback;

  // 1. 整串就是合法 JSON —— 先试它。合法 JSON 的字符串值里可以合法地包含
  //    ``` 围栏的源码，先剥围栏会把这种合法输入改坏。
  try {
    return JSON.parse(raw);
  } catch {
    /* 继续降级 */
  }

  // 2. ``` 围栏里的内容
  let extracted = raw;
  const fenced = FENCE_RE.exec(raw);
  if (fenced) extracted = fenced[1].trim();
  try {
    return JSON.parse(extracted);
  } catch {
    /* 继续降级 */
  }

  // 3. 剥掉推理前言。放在后面做，是为了不重写已经合法的 JSON。
  if (/<think/i.test(extracted)) {
    let cleaned = extracted.replace(THINK_RE, '');
    cleaned = cleaned.replace(LEADING_THINK_RE, '').trim();
    if (cleaned !== '') {
      if (cleaned !== extracted.trim()) {
        try {
          return JSON.parse(cleaned);
        } catch {
          extracted = cleaned;
        }
      }
    } else {
      // 整段只有推理，没有 JSON 载荷
      return fallback;
    }
  }

  // 4. 散文里夹 JSON：取能解析的最长值（推理前言里的 schema 示例不能盖过真载荷）
  const longest = decodeLongestJsonValue(extracted);
  if (longest.found) return longest.value;

  // 5. 最小修复
  try {
    return JSON.parse(repairJsonish(extracted));
  } catch {
    return fallback;
  }
}

/**
 * 工具参数解析的落地版本：**保证得到普通对象**。
 *
 * 上游在 `_prepare_tool_args` 里做完 `parse_json_response` 之后立刻
 * `if not isinstance(tool_args, dict): tool_args = {}` —— 数组、字符串、null
 * 一律当空参数。这样 arg guard 能按"缺参数"处理，而不是让 `spread` 一个数组
 * 之类的怪值炸到执行层。
 */
export function parseToolArgumentsObject(raw) {
  const value = parseToolArguments(raw, {});
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}
