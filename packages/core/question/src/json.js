/**
 * 两套 JSON 解析器 —— 上游 `utils/json_parser.py` 与 `pipeline.py:1384-1404`。
 *
 * # 为什么不能合并成一套
 *
 * | 用途 | 上游实现 | 特点 |
 * |---|---|---|
 * | plan | `parse_json_response` | 先整体 `json.loads` → fenced 提取 → `<think>` 剥离 → **最长可解码值** → json-repair 兜底 |
 * | quiz / repair | `_parse_quiz_payload` | 单段 fenced 提取 → `json.loads` → 从首个 `{` `raw_decode`（只取第一个） |
 *
 * 合并的两种方向都会坏（PIPELINE-SPEC §6 T9）：
 * - 统一成强解析器：quiz 的坏 JSON 会被 repair **猜**出一个对象，于是畸形题面被当成
 *   正常题收下，`repair` 流程根本不会被触发；
 * - 统一成弱解析器：plan 更容易解析失败，直接撞上 T5 的 `plan_unusable` 硬失败。
 *
 * 这里的两份实现刻意**不共享**中间结果，只共享一个 `rawDecodePrefix` 辅助函数。
 */

/** 解析失败时 `parse_json_response` 的兜底返回。 */
const UNSET = Symbol('unset');

/**
 * 从 `text` 的 `start` 位置尝试解一个 JSON 值的**结束位置**。
 *
 * 这是 `JSONDecoder.raw_decode` 的最小等价物：只做括号配对扫描（字符串内不配对、
 * 转义不打断），扫到完整闭合就返回结束下标；扫不通返回 -1。真正的语法校验交给
 * `JSON.parse` —— 它比手写状态机可靠，而且我们只需要"切片边界"这一个信息。
 */
function rawDecodeEnd(text, start) {
  const first = text[start];
  if (first !== '{' && first !== '[') return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** `raw_decode`：从 `start` 起解出第一个完整 JSON 值，失败返回 null。 */
export function rawDecodeAt(text, start) {
  const end = rawDecodeEnd(text, start);
  if (end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end));
  } catch {
    return null;
  }
}

/** 第一个 `{` 或 `[` 的位置。 */
function firstOpener(text, from = 0) {
  const brace = text.indexOf('{', from);
  const bracket = text.indexOf('[', from);
  if (brace === -1) return bracket;
  if (bracket === -1) return brace;
  return Math.min(brace, bracket);
}

/**
 * `_decode_longest_json_value`（json_parser.py:34-66）。
 *
 * 从每个候选起点解一个值，**保留消费字节最多的那个**。这是为了绕开 #673/#692：
 * 推理前言里常带一小段 schema 示例（比如 `{"name": ...}`），`raw_decode` 会先命中
 * 它。长度比较把真正的载荷挑出来。
 */
export function decodeLongestJsonValue(text) {
  let best = UNSET;
  let bestLength = 0;
  let pos = 0;
  for (;;) {
    const start = firstOpener(text, pos);
    if (start === -1) return best;
    const end = rawDecodeEnd(text, start);
    if (end === -1) {
      // 从失败点继续：失败区间里的开括号只能解出它的一部分，交给 repair 处理。
      pos = start + 1;
      if (pos >= text.length) return best;
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(text.slice(start, end));
    } catch {
      pos = start + 1;
      if (pos >= text.length) return best;
      continue;
    }
    const consumed = end - start;
    if (consumed > bestLength) {
      best = parsed;
      bestLength = consumed;
    }
    pos = end;
  }
}

/**
 * json-repair 的**最小可用替代**（上游那条路径由 `json_repair` 库提供）。
 *
 * 只覆盖 LLM 常见的四种坏法：尾部逗号、注释、单引号、未加引号的键。
 * **刻意不猜语义**：修不好就返回 null，让调用方走 `fallback`。
 * 猜得越狠，坏 JSON 越容易被当成"合法载荷"收下——那正是 T9 警告的方向。
 */
export function repairJsonText(text) {
  let out = String(text ?? '');
  // 去 // 与 /* */ 注释（字符串内的不动：够用即可，这里只处理行首/空白后的注释）
  out = out.replace(/(^|[\s,{[])\/\/[^\n]*/g, '$1');
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  // 尾随逗号
  out = out.replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * `parse_json_response`（json_parser.py:69-181）—— **plan 专用强解析器**。
 *
 * 顺序不能换：
 *   1. 先整段 `JSON.parse`（合法 JSON 字符串值里可能自带 fenced 代码块，#825）；
 *   2. 再提 fenced block 重试；
 *   3. 再剥 `<think>` 重试（只在前面都失败时，绝不改写已合法的 JSON）；
 *   4. 再取最长可解码值（#692）；
 *   5. 最后 json-repair 兜底；
 *   6. 全失败 → `fallback`（调用方传 `{}`）。
 */
export function parseJsonResponse(response, { fallback = {} } = {}) {
  if (!response || !String(response).trim()) return fallback;
  const text = String(response);
  try {
    return JSON.parse(text);
  } catch {
    // 继续
  }

  let extracted = text;
  if (text.includes('```')) {
    const match = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(text);
    if (match) extracted = match[1].trim();
  }
  try {
    return JSON.parse(extracted);
  } catch {
    // 继续
  }

  if (extracted.toLowerCase().includes('<think')) {
    let cleaned = extracted.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/^\s*<think\b[^>]*>[\s\S]*?(?=[{[])/i, '');
    cleaned = cleaned.trim();
    if (cleaned !== extracted.trim()) {
      if (!cleaned) return fallback;
      try {
        return JSON.parse(cleaned);
      } catch {
        extracted = cleaned;
      }
    }
  }

  const decoded = decodeLongestJsonValue(extracted);
  if (decoded !== UNSET) return decoded;

  const repaired = repairJsonText(extracted);
  if (repaired !== null) return repaired;
  return fallback;
}

/**
 * `_parse_quiz_payload`（pipeline.py:1384-1404）—— **quiz / repair 专用弱解析器**。
 *
 * 三步，缺一不可，也**不能**多加：
 *   1. 只取**第一段** fenced block（`re.DOTALL` 的非贪婪匹配）；
 *   2. `json.loads` 成功且是 dict 才算数（数组/标量 → `{}`）；
 *   3. 失败则从**第一个 `{`** 起 `raw_decode` 取第一个完整对象——不用结尾花括号切片，
 *      否则后面的散文会被一起吃进来。
 *
 * 没有 `<think>` 剥离、没有 repair、没有"最长值挑选"。返回 `{}` 表示"解析失败"，
 * 上层靠 `{}` 为假来保留原稿（§6 T7）。
 */
export function parseQuizPayload(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return {};
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // 继续
  }
  const start = text.indexOf('{');
  if (start === -1) return {};
  const parsed = rawDecodeAt(text, start);
  if (parsed === null) return {};
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}
