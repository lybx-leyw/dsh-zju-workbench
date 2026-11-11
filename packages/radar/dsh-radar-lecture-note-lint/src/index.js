/**
 * dsh-radar-lecture-note-lint —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * # 为什么有这个包
 *
 * 本仓已有一条完整的「智云回放 → 讲义」链路：
 * `dsh-zhiyun-source-classroom`（数据源）→ `dsh-zhiyun-core-lecture`（PPT 知识树 → 逐点填充 → 书面语验收）
 * → `dsh-zhiyun-page-classroom`（课堂页）。
 *
 * 链路的最后一格是空的：**没人检查产出的 Markdown 能不能渲染**。
 * `core-lecture/src/register.js` 只验收「书面语」（课堂称呼、半截句、口语词比例），
 * 不关心 `$x$` 有没有闭合、表格列有没有被裸竖线截断。这两类问题不会让构建失败，
 * 只会让学生打开讲义时看到一屏乱码 —— 是最难被自动化发现的失败模式。
 *
 * # 集成定性：**强化式集成**
 *
 * - 仍是同一个面板：讲义仍在课堂页里出来，没有新增入口；
 * - 功能仍相似正交：`core-lecture` 管「内容对不对」，本包管「渲染得出来吗」；
 * - 底层多调了更优质实现：借用上游 11 条规则里我们**没有**的那几条。
 *
 * # 规则来源（不搬运源码）
 *
 * 规则清单来自 `chenqianyu486-sys/dsh-zju-lecture-note` 的 `zju_lecture/note_lint.py`（MIT）。
 * 本包**不引入该包**、**不复制其 Python 源**，只按其判据用 JS 重写。见 ATTRIBUTION.md。
 *
 * @module dsh-radar-lecture-note-lint
 */

/** 严重级：error = 一定会渲染崩；warn = 能渲染但违反约定。 */
export const ERROR = 'error';
export const WARN = 'warn';

/**
 * 规则表。**目前只登记 id，不实现** —— 骨架阶段不写逻辑。
 *
 * `owner` 字段标明这个规则在本仓是否**已有**等价实现：
 * - `new`  本仓没有，值得加（这是本包存在的理由）
 * - `dup`  本仓已有，加了就是重复无增益（评审时应删掉）
 */
export const RULES = Object.freeze([
  // —— 上游 11 条，逐条标注与本仓的关系 ——
  { id: 'display_not_isolated', level: ERROR, owner: 'new', note: '$$…$$ 前后必须有空行，否则被吞成行内' },
  { id: 'display_inline', level: ERROR, owner: 'new', note: '$$…$$ 出现在行中间' },
  { id: 'table_bare_pipe', level: ERROR, owner: 'new', note: '表格单元格里的公式含裸 |，列被截断' },
  { id: 'frac_no_brace', level: ERROR, owner: 'new', note: '\\frac12 / \\frac{1}2 缺花括号' },
  { id: 'dfrac_used', level: WARN, owner: 'new', note: '\\dfrac 在部分渲染器回退不一致' },
  { id: 'bare_imaginary_unit', level: WARN, owner: 'new', note: '裸 i 作虚数单位，要求 \\mathrm{i}' },
  { id: 'inline_math_unclosed', level: ERROR, owner: 'new', note: '行内公式未闭合' },
  { id: 'display_unclosed', level: ERROR, owner: 'new', note: '块级公式未闭合' },
  { id: 'details_single_line', level: ERROR, owner: 'new', note: '单行 <details> 折叠块渲染塌陷' },
  { id: 'summary_inline_content', level: WARN, owner: 'new', note: '<summary> 与正文同行' },
  { id: 'text_cmd_cjk', level: WARN, owner: 'new', note: '\\text{} 里装中文，各渲染器回退不同' },
]);

/**
 * 校验一段讲义 Markdown。
 *
 * TODO（评审通过后实现）：
 * 1. 逐行扫；维护「是否在块级公式内」的状态机（`$$` 开/合）。
 * 2. 行内公式用「否定环视」正则：`(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)`。
 * 3. 表格行里检查 `|` 是否落在 `$…$` 内部且未转义。
 * 4. 返回 `{ level, rule, line, excerpt, hint }[]`，**不抛异常**。
 *
 * 刻意不做：不修、不自动改正（上游另有一个 `fix_markdown`，那属于另一件事，需单独评审）。
 *
 * @param {string} _markdown
 * @param {{ file?: string }} [_options]
 * @returns {Array<{level: string, rule: string, line: number, excerpt: string, hint: string}>}
 */
export function lintNote(_markdown, _options = {}) {
  throw new Error(
    'dsh-radar-lecture-note-lint 是候选骨架：lintNote 尚未实现。' +
      '本包未被评审、未接入 profile、不可直接使用。',
  );
}

/**
 * 占位：把 lint 结果压成一段给 agent 看的话。
 *
 * TODO：评审通过后实现。要点 —— 只报前 N 条（上游取 20）、带行号与原文摘录，
 * 让 agent 能直接定位重写，而不是丢一句「讲义有问题」。
 *
 * @param {ReturnType<typeof lintNote>} _issues
 * @returns {string}
 */
export function formatReport(_issues) {
  throw new Error('dsh-radar-lecture-note-lint 是候选骨架：formatReport 尚未实现。');
}

/**
 * Cordis 插件入口占位。
 *
 * 刻意让 `apply` 抛错：**挂载即失败**，防止有人在未评审状态下把它接进 profile。
 * 与仓库里其它 radar 骨架保持同一口径。
 */
export function apply() {
  throw new Error(
    'dsh-radar-lecture-note-lint 是候选骨架：未评审、未接入 profile、不可直接使用。',
  );
}

export default { name: 'dsh-radar-lecture-note-lint', apply };
