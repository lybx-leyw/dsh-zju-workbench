/**
 * Python `repr()` 的 JS 对位 —— 只实现工具文案里用得到的那部分。
 *
 * # 为什么非要有这个东西
 *
 * 上游这些错误文案是 f-string 里带 `!r` 的：
 *
 * ```python
 * f"Unknown filter {filter_mode!r}. Use one of: {', '.join(FILTERS)}."
 * ```
 *
 * `!r` 对字符串产出**单引号**（`'nope'`），而 JS 里最顺手的 `JSON.stringify`
 * 产出双引号（`"nope"`）。差一个引号看着无所谓，但这段文字是模型读的、
 * 而且它是**整个链路上唯一会原样出现在用户面前**的错误说明之一
 * （模型往往直接转述）。更实际的理由：一旦允许"反正差不多"，就没法再用
 * 「逐字比对」来防止文案漂移了 —— 而这正是本包唯一的质量闸门。
 *
 * # 实现范围
 *
 * Python 的 repr 规则本身很短，这里照搬字符串那一条：默认单引号，如果串里有
 * `'` 且没有 `"` 就改用双引号（避免无谓转义）。数字 / 布尔 / null / 数组 / 对象
 * 按 Python 的字面量写（`True` / `False` / `None`，不是 `true` / `false` / `null`）。
 *
 * 不实现的那部分（`\xNN` 转义、代理对、不可打印字符）在工具文案里出现不了：
 * 参数名与 id 都是模型从 schema 里抄的，题库分类名来自用户输入但会被
 * `_truncate`/长度限制挡住。真出现了也不会改变语义，只会让转义形式不同。
 */

/** Python 里 `repr()` 一个可打印字符串的结果。 */
export function reprString(value) {
  const text = String(value ?? '');
  // Python 的取舍：默认单引号；只有当串里既有单引号又没有双引号时才换双引号。
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = '';
  for (const char of text) {
    if (char === '\\') out += '\\\\';
    else if (char === quote) out += `\\${char}`;
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else out += char;
  }
  return `${quote}${out}${quote}`;
}

/** Python 里 `repr()` 一个任意值的结果（够用即可，见文件头）。 */
export function pyRepr(value) {
  if (typeof value === 'string') return reprString(value);
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => `${reprString(key)}: ${pyRepr(item)}`);
    return `{${entries.join(', ')}}`;
  }
  return reprString(value);
}
