/**
 * 提示词查表与语言指令。
 *
 * 上游对应：`services/prompt/language.py`、`services/config/loader.py:parse_language`、
 * `agents/question/pipeline.py:2009-2022`（`_t`）。
 *
 * # 为什么 `_t` 必须保留三态
 *
 * 上游的 `_t` **静默降级**：key 拼错拿到空串、format 失败拿到未格式化原文。
 * 看起来像 bug，其实是刻意的：
 *   1. 提示词缺失不能让整轮崩掉（崩溃时用户看到的是 500，而不是"题出得差"）；
 *   2. format 失败返回原文，会让 `{num_questions}` 这种占位符**原样发给模型**——
 *      这不优雅，但它是上游真实行为，改掉就改变了模型看到的内容。
 * JS 侧最危险的两个错误实现是「抛错」和「返回 key 名」：前者把降级变成崩溃，
 * 后者喂给模型的是 `explore.system` 这种垃圾。见 PIPELINE-SPEC §6 T2。
 */

import zhPrompts from './prompts/pipeline.js';
import enPrompts from './prompts-en/pipeline.js';

/** `parse_language`（loader.py:171-199）：空值默认 **zh**，不是 en。 */
export function parseLanguage(language) {
  if (typeof language !== 'string' || !language.trim()) return 'zh';
  const code = normalizeLanguage(language);
  if (code === 'en' || code === 'english') return 'en';
  if (code === 'zh' || code === 'chinese' || code === 'cn') return 'zh';
  return code;
}

/** `normalize_language`（language.py）：空值默认 **en**（与 parseLanguage 不同，别混）。 */
export function normalizeLanguage(language) {
  return (language || 'en').toString().trim().toLowerCase() || 'en';
}

const LANGUAGE_LABELS = {
  zh: '中文（简体）',
  'zh-cn': '中文（简体）',
  'zh-tw': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
  uk: 'Українська',
  pt: 'Português',
  it: 'Italiano',
  ar: 'العربية',
  pl: 'Polski',
  ms: 'Bahasa Melayu',
};

export function languageLabel(language) {
  const code = normalizeLanguage(language);
  if (LANGUAGE_LABELS[code]) return LANGUAGE_LABELS[code];
  const base = code.split('-')[0];
  return LANGUAGE_LABELS[base] ?? (language || 'English');
}

const OVERRIDE_ZH =
  '以上是默认输出语言；若用户在对话中明确要求改用其他语言作答，' +
  '则以用户当次的要求为准，并在本次对话中延续该语言。';
const OVERRIDE_EN =
  'This is the default output language, not a restriction on the reader: if ' +
  'the user explicitly asks you to answer in another language, honour that ' +
  'request and keep to it for the rest of the conversation.';

/**
 * `language_directive`（language.py）。
 *
 * 出题流水线四个阶段全部用 **strict**（`allowUserOverride=false`）：
 * book/quiz/research 这类"没有用户在回路里提问"的产物不加那句"用户可以改语言"，
 * 否则模型会把题干写成用户在对话里随口说的语言。
 */
export function languageDirective(language, { allowUserOverride = false } = {}) {
  const code = normalizeLanguage(language);
  const label = languageLabel(code);
  if (code.startsWith('zh')) {
    const body =
      '\n\n[语言要求 / Language] ' +
      `请严格使用${label}撰写所有面向读者的文本（标题、正文、解释、提示、过渡句、` +
      '题干、选项等），即使参考资料、JSON 字段名或英文术语出现在 prompt 中也' +
      '不得切换语言；保留必要的专有名词原文（如人名、产品名、公式中的变量符号' +
      `等）即可，其余一律使用${label}。`;
    return allowUserOverride ? `${body} ${OVERRIDE_ZH}` : body;
  }
  if (code === 'en') {
    const body =
      '\n\n[Language] Write ALL reader-facing text (titles, prose, ' +
      'explanations, hints, transitions, quiz stems, options, etc.) in ' +
      'English. Do NOT switch languages even if the source material, ' +
      'JSON keys, or examples in this prompt are in another language. ' +
      'Keep proper nouns (people, products, formula symbols) in their ' +
      'original form.';
    return allowUserOverride ? `${body} ${OVERRIDE_EN}` : body;
  }
  const body =
    `\n\n[Language] Write ALL reader-facing text strictly in ${label}. ` +
    'Do NOT switch languages even if the source material, JSON keys, or ' +
    'examples in this prompt are in a different language. Keep proper ' +
    'nouns (people, products, formula symbols) in their original form.';
  return allowUserOverride ? `${body} ${OVERRIDE_EN}` : body;
}

/** `append_language_directive`：先 rstrip 再加空行，空提示词则只留指令。 */
export function appendLanguageDirective(systemPrompt, language, options = {}) {
  const base = String(systemPrompt ?? '').replace(/\s+$/, '');
  const directive = languageDirective(language, options).trim();
  if (!base) return directive;
  return `${base}\n\n${directive}`;
}

/** 按语言取提示词包；未知语言回落中文（仓库现有产物都是 zh）。 */
export function loadPrompts(language) {
  return parseLanguage(language) === 'en' ? enPrompts : zhPrompts;
}

class FormatFailure extends Error {}

/**
 * 复刻 Python `str.format(**kwargs)` 的**成功/失败边界**（值不追求逐字节等价）。
 *
 * 关键点：
 * - `{{` / `}}` 是转义，渲染成单花括号（YAML 里的 JSON 示例就靠这个还原）；
 * - 任何**单个**未转义 `{...}` 若不是一个 kwargs 里存在的字段名，Python 抛
 *   `KeyError` / `IndexError` / `ValueError` —— 于是 `_t` 整段回退原文；
 * - 位置参数 `{0}`、空字段 `{}`、带方括号的字段都会失败。
 */
export function pythonFormat(template, kwargs = {}) {
  let out = '';
  let i = 0;
  const text = String(template);
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      if (text[i + 1] === '{') {
        out += '{';
        i += 2;
        continue;
      }
      const close = text.indexOf('}', i + 1);
      if (close === -1) throw new FormatFailure('unclosed field');
      const field = text.slice(i + 1, close);
      const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:![rsa])?(?::[\s\S]*)?$/.exec(field);
      if (!match) throw new FormatFailure('no replacement field');
      const name = match[1];
      if (!Object.hasOwn(kwargs, name)) throw new FormatFailure('missing key');
      out += String(kwargs[name]);
      i = close + 1;
      continue;
    }
    if (ch === '}') {
      if (text[i + 1] === '}') {
        out += '}';
        i += 2;
        continue;
      }
      throw new FormatFailure('single close brace');
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 造一个 `_t(key, default = "", kwargs = {})`。
 *
 * 三态（顺序不能变）：
 *   1. 路径不存在 / 中间不是对象 / 叶不是字符串 → `default`；
 *   2. 没传 kwargs → **不格式化**，原样返回（protocol/notices/empty/trace 全是字面量）；
 *   3. 传了 kwargs → 格式化；失败**返回未格式化原文**（不是 default，不是抛错）。
 */
export function createTranslator(prompts = {}) {
  return function t(key, defaultValue = '', kwargs = {}) {
    let value = prompts;
    for (const part of String(key).split('.')) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return defaultValue;
      if (!Object.hasOwn(value, part)) return defaultValue;
      value = value[part];
    }
    if (typeof value !== 'string') return defaultValue;
    const kwargsList = kwargs && typeof kwargs === 'object' ? Object.keys(kwargs) : [];
    if (kwargsList.length === 0) return value;
    try {
      return pythonFormat(value, kwargs);
    } catch {
      // 故意的降级：占位符原样发给模型，而不是清空或抛错。
      return value;
    }
  };
}
