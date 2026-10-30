/**
 * 协议标签解析：`runtime/agentic/labels.py` 的搬运。
 *
 * agentic 引擎用 ```` ``LABEL`` ```` + 正文 的协议驱动模型：提示词要求每条回复
 * 第一行是一个**双反引号包裹**的标签，之后才是内容。这一层负责在流式过程中
 * 尽早认出这个标签，并把「标签之后」的文本路由到正确的通道。
 *
 * # 为什么要容忍那么多写法
 *
 * 只有一条规则是硬的：**标签必须出现在前导区**（前面只能有空白 / 零宽字符 /
 * `<think>` 前置块）。除此之外：
 *
 * - 单反引号 / 三反引号都接受（模型对"两个反引号"的复现不稳定）；
 * - 裸标签 + 分隔符也接受（有些模型直接丢反引号；协议标签全是大写 token，
 *   裸形式在那种情况下不歧义）；
 * - 标签后**没有空格**也要接受（markdown 的内联代码在视觉上已经分隔了，
 *   ```` ```FINISH```你好 ```` 是真实出现过的形状）。
 *
 * 反过来，两种必须**拒绝**：
 *
 * - ```` FINISH``` ```` —— 过闭合 / 还在流的包裹，多出来的反引号是正文里
 *   不该有的字符（继续等下一个 chunk 就能分辨）；
 * - `FINISHED` 这种「以标签开头但其实是别的词」—— 所以裸形式后面必须跟
 *   分隔符。
 *
 * # 流式与终结两种模式
 *
 * `final: false` 必须**严格**：一个未闭合的 ```` ```SECTION ```` 或过宽的闭合
 * 都有可能被下一个 chunk 补全，此时下结论就是把正文切错。
 * `final: true` 表示调用方已经知道没有后续 chunk 了，可以接受 `FINISH` 这种
 * 没有尾随分隔符的精确裸标签。
 */

/** 认不出标签时的占位。调用方据此走协议修复。 */
export const LABEL_UNKNOWN = 'UNKNOWN';

/** 前导区最多探这么多字符；超了还没标签就判 UNKNOWN。 */
export const LABEL_PROBE_MAX_CHARS = 64;

const INVISIBLE_PREFIX_CHARS = '\ufeff\u200b\u200c\u200d';

/** 标签之后可以"吃掉"的分隔字符。 */
export const LABEL_SEPARATOR_CHARS = '\n\r \t:：-–—';

const LEADING_SEPARATOR_RE = new RegExp(
  `^[${[...LABEL_SEPARATOR_CHARS]
    .map((ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, '0')}`)
    .join('')}]+`,
);

function stripLeadingSeparators(text) {
  return text.replace(LEADING_SEPARATOR_RE, '');
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 探标签前先剥掉前导空白与零宽字符（两种要反复剥，顺序会互相暴露）。 */
export function stripLabelProbePrefix(buffer) {
  let stripped = String(buffer ?? '');
  let previous = null;
  while (stripped !== previous) {
    previous = stripped;
    stripped = stripped.replace(/^\s+/, '').replace(new RegExp(`^[${INVISIBLE_PREFIX_CHARS}]+`), '');
  }
  return stripped;
}

/**
 * 从前导缓冲里认出开头的 ```` ``LABEL`` ````。
 *
 * @returns `[label, afterText]` 或 `null`（缓冲太短 / 还是部分前缀）
 */
export function classifyLabel(buffer, { allowedLabels = [], final = false } = {}) {
  const stripped = stripLabelProbePrefix(buffer);
  for (const label of allowedLabels) {
    const escaped = escapeRegExp(label);
    const wrapped = new RegExp(`^(\`+)\\s*${escaped}\\s*\\1([\\s\\S]*)$`).exec(stripped);
    if (wrapped) {
      const after = wrapped[2];
      // 拒绝过闭合 / 还在流的包裹（例如 FINISH```），否则多出来的反引号
      // 会漏进被路由的正文里。非反引号的尾巴是真正文 —— 哪怕模型忘了分隔符。
      if (after && after[0] === '`') continue;
      return [label, stripLeadingSeparators(after)];
    }
    if (stripped.startsWith(label)) {
      const tail = stripped.slice(label.length);
      // 裸标签兜底：只有紧跟清晰分隔符才算，避免把以 FINISHED 开头的正文误判。
      // 空尾巴在流式下是歧义的（可能下一个 chunk 就是分隔符），继续缓冲；
      // 流结束时（final=true）才接受。
      if (tail && LABEL_SEPARATOR_CHARS.includes(tail[0])) {
        return [label, stripLeadingSeparators(tail)];
      }
      if (final && !tail) return [label, ''];
    }
  }
  return null;
}

/**
 * 重读一条**已经结束**的回复，抢救可恢复的标签写法。
 *
 * 流式探针（`final: false`）必须严格：未闭合的 ```` ```SECTION ```` 或过宽的
 * 闭合 ```` ``FINISH````` ```` 在有下一个 chunk 时都无法定论。等调用方确认流
 * 结束了，这些包裹一个**精确的**允许标签的围栏就可以接受。
 *
 * 不按正文结构发明标签 —— 报告标题的恢复属于报告写入器，它知道自己要的是第几节。
 */
export function recoverFinishedLabel(buffer, { allowedLabels = [] } = {}) {
  const parsed = classifyLabel(buffer, { allowedLabels, final: true });
  if (parsed !== null) return parsed;

  const stripped = stripLabelProbePrefix(buffer);
  const boundary = `\`${LABEL_SEPARATOR_CHARS}`;
  for (const label of allowedLabels) {
    const match = new RegExp(`^(\`+)\\s*${escapeRegExp(label)}([\\s\\S]*)$`).exec(stripped);
    if (!match) continue;
    let after = match[2];
    // SECTIONAL 不能被当成 SECTION；标签后必须是结尾、分隔符或反引号。
    if (after && !boundary.includes(after[0])) continue;
    // 丢掉同一行的闭合围栏（任意长度）：未闭合 = 没有；过宽 / 不匹配 = 多余的
    // 反引号。**下一行**的代码围栏是正文，必须留下。
    after = after.replace(/^[ \t]*`+/, '');
    return [label, stripLeadingSeparators(after)];
  }
  return null;
}

/**
 * 正文里出现的标签（第二行及以后、行首的标签）。
 *
 * 协议要求每条回复只带一个标签（第一行）。正文后面再冒一个标签是值得纠的
 * 违规；而 "next I should use ``TOOL``" 这种行内提及**不是**动作标签，
 * 不能触发修复循环。
 */
export function findInlineLabels(text, { allowedLabels = [] } = {}) {
  if (!allowedLabels.length) return [];
  const raw = String(text ?? '');
  if (raw === '') return [];
  const pattern = allowedLabels.map(escapeRegExp).join('|');
  const separators = [...LABEL_SEPARATOR_CHARS]
    .map((ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, '0')}`)
    .join('');
  const found = [];
  const wrappedRe = new RegExp(`^[^\\S\\r\\n]*(\`+)\\s*(${pattern})\\s*\\1(?=$|[${separators}])`, 'gm');
  for (const match of raw.matchAll(wrappedRe)) found.push(match[2]);
  const bareRe = new RegExp(`^[^\\S\\r\\n]*(${pattern})(?=$|[${separators}])`, 'gm');
  for (const match of raw.matchAll(bareRe)) found.push(match[1]);
  return found;
}
