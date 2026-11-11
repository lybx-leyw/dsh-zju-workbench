/**
 * 上游封装占位 —— **锁版**：`citeproc@2.4.63` + `@retorquere/bibtex-parser@13.0.11`。
 *
 * 评审通过前这里**不 import 上游**（骨架不下载依赖、不参与构建）。
 * 下面记录的是「上游长什么样」以及本轮实跑得到的事实，
 * 评审时照着写即可；不要凭 README 猜 API。
 *
 * ── 上游身份 ────────────────────────────────────────────────────
 *
 *   citeproc@2.4.63
 *     · npm 字段 `license: "CPAL-1.0 OR AGPL-1.0"`（与 GitHub `Juris-M/citeproc-js`
 *       的 NOASSERTION 同源：双许可混合写法）。
 *     · 单文件 `citeproc_commonjs.js`，967 KB，**零运行时依赖**。
 *     · 导出里**没有** `Cite`；有 `Engine` / `getAmbiguousCite` / `SITE_FIELDS` 等。
 *
 *   @retorquere/bibtex-parser@13.0.11
 *     · npm 字段 `license: "ISC"`，GitHub `retorquere/bibtex-parser` 为 MIT。
 *     · GitHub ★31，**2026-11-02 仍在推送**（活的最勤的 BibTeX 解析器之一，
 *       它同时是 Zotero Better BibTeX 的导入解析器）。
 *     · `type: module`，入口是 **WASM**：`init()` 默认 `fetch` 同包内 `.wasm`，
 *       **Node 里必须先 `init({ module_or_path: <bytes> })`**。
 *     · 默认导出与 `./js` 子路径是**两套**（WASM / 纯 JS），行为不完全一致，
 *       接入前要定死走哪一套。
 *
 * ── 样式与 locale 从哪来 ────────────────────────────────────────
 *
 *   样式：`citation-style-language/styles` 的
 *     `china-national-standard-gb-t-7714-2015-numeric.csl`（15.5 KB）
 *     · 注意**文件名不是** `chinese-gb7714-2015-numeric.csl`（那个是 404）。
 *     · 样式 `<rights>` 为 `CC BY-SA 3.0` —— **与本仓 MIT 不同**，属「数据/资源」
 *       而非代码；引用它需要在 ATTRIBUTION 里写清，且分发时要保留原许可。
 *   locale：`citation-style-language/locales` 的 `locales-zh-CN.xml`（18.6 KB，CC BY-SA 3.0）。
 *
 * ── 本轮实跑结果（Node 22 + 上述三件套，原样照抄）─────────────────
 *
 *   type = article-journal，4 位中文作者、有卷期页：
 *     [1]张三, 李四, 王五, 等. 基于深度学习的课堂注意力分析[J]. 计算机学报, 2023, 46(5): 1023-1038.
 *   type = article-journal + DOI：
 *     [1]张三, 李四, 王五, 等. 基于深度学习的课堂注意力分析[J/OL]. 计算机学报, 2023, 46(5): 1023-1038. DOI:10.11897/SP.J.1016.2023.01023.
 *   type = book + edition：
 *     [1]KNUTH D E. The art of computer programming, volume 1[M]. 3 版. Addison-Wesley, 1997.
 *   type = article（错误用法）：
 *     [1]张三, 李四, 王五, 等. 基于深度学习的课堂注意力分析[A/OL]//计算机学报. 2023: 1023-1038.
 *     —— `[A]` + 换成 `//` 分隔，形态完全变了，且**没有任何报错**。
 *   正文引用（numeric）：
 *     <sup>[1–3]</sup>
 *   英文 4 作者（本条是**已知缺陷**，不是期望行为）：
 *     [1]LEE Z, SMITH J A, BROWN M, 等. Retrieval-augmented generation for course notes[J]. ...
 */

/** 锁版凭据。评审通过、真正安装依赖后才 import 上游。 */
export const UPSTREAM = Object.freeze({
  citeproc: '2.4.63',
  bibtexParser: '13.0.11',
  style: {
    id: 'china-national-standard-gb-t-7714-2015-numeric',
    repo: 'citation-style-language/styles',
    bytes: 15530,
    rights: 'CC BY-SA 3.0',
  },
  locale: {
    id: 'locales-zh-CN.xml',
    repo: 'citation-style-language/locales',
    bytes: 18641,
    rights: 'CC BY-SA 3.0',
  },
});

function notReady(name) {
  throw new Error(
    `[dsh-radar-gbt7714-cite] upstream.${name}() 未实现：骨架不安装依赖，评审通过后才落地。`,
  );
}

/**
 * 载入 CSL 引擎。
 *
 * TODO(评审)：
 *   ```js
 *   import pkg from 'citeproc';               // CJS，必须走 default
 *   const { Engine } = pkg;
 *   const engine = new Engine(sys, styleXml, 'zh-CN');
 *   ```
 *   `sys.retrieveLocale = (lang) => …` 要**同时**能吐 `zh-CN` 与 `en-US`
 *   （中英混排的修复点，见 README「未解的一条」）。
 *
 * @returns {never} 骨架阶段直接抛错
 */
export function createEngine() {
  return notReady('createEngine');
}

/**
 * BibTeX 文本 → CSL-JSON 数组。
 *
 * TODO(评审)：
 *   1. `await init({ module_or_path: bytes })` —— 字节从包内 `.wasm` 读，**不要 fetch**；
 *   2. `parse(bib)` 返回 `{ entries: [{ key, type, fields }] }`，字段名是 **`type`**
 *      不是 `entryType`；
 *   3. `fields.pages` 已被归一化成 `–`，转 CSL 时要换回 `-`；
 *   4. `type` 映射必须显式：`article → article-journal`（否则 `[A]`）；
 *   5. 返回结构照 `CSL_JSON_KEYS` 收敛，多余字段一律丢弃（不搬运上游结构）。
 *
 * @param {string} bibtext
 * @returns {object[]}
 */
export function parseBibtex(bibtext) {
  void bibtext;
  return notReady('parseBibtex');
}

/**
 * CSL-JSON → GB/T 7714-2015 条目行。
 *
 * @param {object[]} items
 * @returns {string[]}
 */
export function renderBibliography(items) {
  void items;
  return notReady('renderBibliography');
}

/** 本包只用得到的 CSL-JSON 字段；其余字段不进本仓（避免把上游结构漏进数据层）。 */
export const CSL_JSON_KEYS = Object.freeze([
  'id', 'type', 'title', 'author', 'container-title', 'collection-title',
  'volume', 'issue', 'page', 'page-first', 'publisher', 'publisher-place',
  'issued', 'accessed', 'DOI', 'URL', 'edition', 'language',
]);
