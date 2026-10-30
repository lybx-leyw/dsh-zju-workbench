/**
 * `kb_files` —— 讲义清单元数据（有多少知识点、它们叫什么、某个在不在）。
 *
 * # 为什么是「知识点」而不是「文件」
 *
 * 上游这个工具列的是知识库里的**磁盘文件**。本仓的讲义是一份内存结构，
 * 没有文件这一层；最接近的对应物是「一个知识点一条记录」：
 * - 数量问题（"这份讲义有多少节"）只能靠清单回答，检索回答不了 ——
 *   这正是上游写这个工具的理由（`manifest.py` 文件头：检索说不出集合有多大）；
 * - 名字问题（"有没有讲 X 的那节"）同样只能靠清单；
 * - 而 `read_source` 需要一份 id 清单才能被正确使用。
 *
 * 所以 id 直接复用 `read_source` 的 topic id（`t1-2` 这类），一份清单两个用途。
 *
 * # 渲染文案照抄上游
 *
 * `manifest.py` 的 `_REPORT_TEXT` / `_qualifier` / `_UNAVAILABLE_LABELS` 全部逐字搬
 * （存在 `data/upstream.json` 里）。理由：这段文字是模型读的，它决定了模型
 * 下一句怎么向用户描述"有多少文档"。汉化改写会改变模型对清单权威性的判断——
 * 上游那段 authority 文案（"一律以本清单为准，它是权威事实"）是刻意写给模型的。
 *
 * 差异只有一处：上游的 `qualifier` 会拼上 provider 与索引状态
 * （`(llamaindex, index ready)`）。本地讲义没有 provider 也没有索引状态，
 * 拼一个假的"索引就绪"是在骗模型，所以 qualifier 留空 —— 形状不变，
 * 文案里没有不存在的状态。
 */
import { UPSTREAM_DATA } from './definitions.js';

const REPORT = UPSTREAM_DATA.manifestText.report;
const LIMITS = UPSTREAM_DATA.manifestText.limits;

/** 与上游 `_lang()` 同口径：`zh*` 走中文，其余走英文。 */
export function normalizeLanguage(language) {
  return String(language ?? 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * 名字过滤，与上游 `_filter_names()` 逐字同逻辑：
 * 含 `*?[` 时按 glob（**大小写不敏感**，且同时匹配全名与末段），否则按子串。
 */
export function filterNames(names, pattern) {
  const raw = String(pattern ?? '').trim();
  if (!raw) return [...names];
  if (/[*?[]/.test(raw)) {
    const lowered = raw.toLowerCase();
    return names.filter((name) => globMatch(name.toLowerCase(), lowered)
      || globMatch(name.toLowerCase().split('/').pop() ?? '', lowered));
  }
  const needle = raw.toLowerCase();
  return names.filter((name) => name.toLowerCase().includes(needle));
}

/**
 * 最小 glob：只支持 `*`（任意串）、`?`（单字符）、`[...]`（字符组）。
 *
 * 上游用 `fnmatch`。Node 内置没有 fnmatch，而为一个 `*.pdf` 引第三方依赖
 * 违反「不新增依赖」。所以自己实现这三种元字符 —— `manifest.py` 的注释明确说
 * pattern 的用途就是「通配符或子串」，这三种覆盖了实际用得到的全部形状；
 * 遇到 `fnmatch` 的边角语法（`[!abc]` 之外的转义）按普通字符处理，宁可匹配不到。
 */
export function globMatch(text, pattern) {
  const regex = globToRegExp(pattern);
  return regex.test(text);
}

function globToRegExp(pattern) {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else if (char === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        source += '\\[';
        continue;
      }
      const body = pattern.slice(i + 1, close);
      const negated = body.startsWith('!');
      const inner = (negated ? body.slice(1) : body).replace(/[\\^\]]/g, '\\$&');
      source += negated ? `[^${inner}]` : `[${inner}]`;
      i = close;
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`, 'u');
}

/**
 * `limit` 归一，与上游 `_kb_files_limit()` 逐条对齐：
 * 不是整数 / ≤0 → 默认值；超上限 → 上限（**不报错**，模型给的数不该让调用失败）。
 *
 * 「不是整数」的判据要用 Python 的 `int()` 语义，不能用 `parseInt`：
 * `int("42.5")` 抛 ValueError（→ 默认值），而 `parseInt("42.5")` 静默给 42。
 * 一个把坏参数当好的归一函数，会让"模型传了 42.5"这种可观测的异常变成
 * 一个看起来完全正常的 42 —— 之后没人知道它曾经坏过。
 */
export function normalizeLimit(raw) {
  if (raw === null || raw === undefined) return LIMITS.default;
  let requested;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return LIMITS.default;
    requested = Math.trunc(raw); // Python int(3.9) == 3
  } else if (typeof raw === 'boolean') {
    requested = raw ? 1 : 0; // Python int(True) == 1
  } else {
    const text = String(raw).trim();
    // Python int() 收前后空白与正负号，但不收小数、不收科学计数法。
    requested = /^[+-]?\d+$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
  }
  if (!Number.isFinite(requested) || requested <= 0) return LIMITS.default;
  return Math.min(requested, LIMITS.max);
}

function humanSize(size) {
  if (!(size > 0)) return '';
  if (size < 1024) return `${size} B`;
  let value = size;
  for (const unit of ['KB', 'MB', 'GB']) {
    value /= 1024;
    if (value < 1024) return `${value.toFixed(1)} ${unit}`;
  }
  return `${value.toFixed(1)} TB`;
}

/**
 * 渲染清单报告，逐字对齐上游 `render_manifest_report()`。
 *
 * @param {object} manifest `{name, total, matched, documents:[{name,size}], pattern}`
 * @param {string} language
 */
export function renderManifestReport(manifest, { language = 'en' } = {}) {
  const lang = normalizeLanguage(language);
  const text = REPORT[lang];
  const total = manifest.total_is_lower_bound ? `${manifest.total}+` : String(manifest.total);
  const plural = manifest.total === 1 ? '' : 's';

  if (!manifest.total) {
    return format(text.empty, { name: manifest.name, qualifier: '' });
  }

  const lines = [format(text.heading, {
    name: manifest.name,
    qualifier: '',
    total,
    plural: lang === 'zh' ? '' : plural,
  })];
  if (manifest.pattern) {
    if (!manifest.matched) {
      lines.push(format(text.no_match, { pattern: manifest.pattern }));
      return lines.join('\n');
    }
    lines.push(format(text.matched, { pattern: manifest.pattern, count: manifest.matched }));
  }
  const omitted = Math.max(0, manifest.matched - manifest.documents.length);
  if (omitted) {
    lines.push(format(text.omitted, { shown: manifest.documents.length, omitted }));
  }
  manifest.documents.forEach((document, index) => {
    const size = humanSize(document.size);
    lines.push(`${index + 1}. ${document.name}${size ? ` (${size})` : ''}`);
  });
  return lines.join('\n');
}

/** 上游用 `str.format`；这里只替换已知占位符，正文里的花括号原样保留。 */
function format(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

/**
 * @param {object} options
 * @param {{outline: Array<{id: string, name: string}>, counts: object}} options.index
 */
export function createKbFilesHandler({ index } = {}) {
  return async function kbFilesHandler(args = {}, ctx = {}) {
    const outline = Array.isArray(index?.outline) ? index.outline : [];
    const pattern = String(args.pattern ?? '').trim();
    const language = normalizeLanguage(args.language ?? ctx?.language ?? ctx?.context?.language);
    const limit = normalizeLimit(args.limit);

    const allNames = outline.map((entry) => entry.name);
    const matchedNames = filterNames(allNames, pattern);
    const kept = matchedNames.slice(0, limit);
    const byName = new Map(outline.map((entry) => [entry.name, entry]));

    const report = renderManifestReport({
      name: String(args.kb_name ?? '').trim() || 'lecture',
      total: allNames.length,
      matched: matchedNames.length,
      documents: kept.map((name) => ({ name, size: 0 })),
      pattern,
    }, { language });

    return {
      ok: true,
      result: {
        content: report,
        metadata: {
          kb_name: String(args.kb_name ?? '').trim() || 'lecture',
          total: allNames.length,
          matched: matchedNames.length,
          listed: kept.map((name) => byName.get(name)?.id ?? name),
          omitted: Math.max(0, matchedNames.length - kept.length),
          pattern,
        },
      },
    };
  };
}
