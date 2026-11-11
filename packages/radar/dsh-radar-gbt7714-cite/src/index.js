/**
 * dsh-radar-gbt7714-cite —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**，
 * 只从 `./upstream.js` 取锁版凭据（那一个文件负责「上游长什么样」）。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 锁版引入 `citeproc@2.4.63`（juris-m/citeproc-js 的 CommonJS 发行版）
 * 与 `@retorquere/bibtex-parser@13.0.11`（Better BibTeX 的解析器），
 * 给「笔记」页的**正文编辑态**补一条**参考文献表**链路：
 *
 *   笔记里已经写了 `[1]` `[2]` 这样的角标 → 用户在正文末尾要一张**参考文献表** →
 *   把条目（BibTeX 片段 / 手填字段 / 库内已引文献）排成 GB/T 7714-2015 的条目文本
 *   → **复制**进正文。不新增页面、不新增导航项、不新增第二种编辑形态。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 落点是 `dsh-zhiyun-page-notes` 的**既有**正文编辑态
 *      （`client.jsx` 里那个 `textarea`）与**既有**的 Markdown 阅读态
 *      （宿主的 `MarkdownText`）。不新增页面、不新增导航项。
 *   2. **仍是相似正交的功能** —— 现有：**正文本身**（写什么、怎么被反链）。
 *      新增：**正文末尾的文献著录**（那一串条目按国标排成什么样）。
 *      同一面板、同一份文本、不同问题。
 *   3. **底层多调了更优质实现** —— 本仓**完全没有** CSL 渲染能力，也**没有**
 *      BibTeX 解析能力（见 README「已核实的缺口」）。GB/T 7714-2015 的著录规则
 *      （文献类型标识 `[J]`/`[C]`/`[M]`、`et-al-min=4`、卷期页码的分隔符、
 *      `[J/OL]` 的载体标识）全在 CSL 样式文件里，手写等于重新实现一个 CSL 子集。
 *
 * ── 已知的坑（评审请先看这里，都是本轮实跑出来的）─────────────────
 *
 *   · `citeproc` 是 CJS，ESM 项目里必须 `import pkg from 'citeproc'` 再取 `.Engine`；
 *     **没有** `Cite` 这个导出（网上大量示例写的是 `new CSL.Engine`，不是 `new Cite`）。
 *   · `engine.updateItems()` 传**字符串 id 数组**，不要传对象数组（传对象会得到
 *     `"[object Object]"`，随后 `retrieveItem` 静默拿不到条目）。
 *   · CSL-JSON 的 `type` 必须是 `article-journal`；写成 `article` 会被国标样式
 *     判成**预印本**并输出 `[A]`（样式文件第 131 行注释明说 `article 为预印本`）。
 *   · `@retorquere/bibtex-parser` 是 **WASM**：Node 侧要先 `init({ module_or_path })`
 *     喂字节（默认走 `fetch`，Node 里会 `fetch failed`），且字段里的 `pages`
 *     已被归一化成 en-dash `–`，而样式声明 `page-range-format="expanded"`
 *     只认 `-`，不换会把 `1023-1038` 渲染成 `023-1038`。
 *   · **中英混排**：该样式固定输出「等」，英文条目也会写成 `LEE Z, SMITH J A, 等`。
 *     这不是 bug 而是该样式**有意为之**（正文第 433 行注释：CSL-M 多语言功能默认关闭）。
 *     若要与学校模板一致，必须在**条目级**分流 locale，见 README「未解的一条」。
 *
 * ── 接入点（评审通过后才改）────────────────────────────────────
 *
 *   `packages/dsh-zhiyun-page-notes/src/client.jsx`
 *     · 正文编辑态 = 一个 `<textarea>`（约 1103 行注释提及），插件按钮与现有
 *       「编辑 / 阅读」开关同排，不新开工具栏；
 *     · 文本写入只能走 `textarea.value + input 事件`（受控组件），不要直改
 *       DOM 再绕过 React 状态 —— 笔记页的自动保存挂在 `onChange` 上。
 */
export const PACKAGE = 'dsh-radar-gbt7714-cite';

/** 候选骨架不实现任何行为；调用即抛错，避免被误当成可用插件。 */
function notImplemented(name) {
  throw new Error(
    `[${PACKAGE}] 「${name}」尚未实现：这是候选骨架，未评审、未接入 profile、不可直接使用。`,
  );
}

/**
 * 条目 → GB/T 7714-2015 条目文本。
 *
 * TODO(评审) 逐条落实：
 *   1. 输入统一成 CSL-JSON（BibTeX 走 `upstream.parseBibtex()`，手填走字段表单）；
 *   2. `type` 归一：`@article` → `article-journal`，`@inproceedings` → `paper-conference`，
 *      `@book` → `book`，`@phdthesis` → `thesis`，其余 → `document`（会输出 `[Z]`）；
 *   3. `page` 里的 `–` / `—` 统一成 `-`，`page-first` 同步；
 *   4. 调用 `upstream.renderBibliography()`，去掉条目里的 `<div>` 包裹与外层缩进；
 *   5. 返回 `{ ok: true, lines: string[] }`，失败返回 `{ ok: false, reason }`
 *      —— **不要抛错**，正文写入路径要能原样回滚。
 *
 * @param {object[]} items 已归一成 CSL-JSON 的条目
 * @returns {{ok: boolean, lines?: string[], reason?: string}}
 */
export function formatBibliography(items) {
  void items;
  return notImplemented('formatBibliography');
}

/**
 * 把生成的条目文本接到正文末尾（**不覆盖**已有参考文献段）。
 *
 * TODO(评审) 逐条落实：
 *   1. 识别正文里是否已有 `## 参考文献` 段（标题文本可配）；有则**追加**到该段末尾，
 *      无则在文末新建，编号沿用已有的最大序号 + 1；
 *   2. 通过受控 `textarea` 的 `value` 写回并触发 `input`，不要直改 DOM；
 *   3. 写回前存一份撤销快照，供「撤销」按钮回退；
 *   4. 这一步**不联网、不调模型**，纯本地字符串操作。
 *
 * @param {{text: string, lines: string[]}} input
 * @returns {{text: string}} 新正文
 */
export function appendToBody(input) {
  void input;
  return notImplemented('appendToBody');
}
