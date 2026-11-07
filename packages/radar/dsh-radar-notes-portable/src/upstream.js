// 候选骨架：未评审、未接入 profile、不可直接使用。
//
// 上游封装占位。锁版：marked@18.1.3（MIT）、highlight.js@11.12.0（BSD-3-Clause）。
// **均未在本包内 parse 真实数据** —— 下面的结论全部来自沙箱 `npm i` + `node` 实测，
// 实测脚本形状见 README §三，可原样复跑。

/**
 * @typedef {object} PortableDoc
 * @property {string} html         完整单文件 HTML（含内联样式与字体）
 * @property {number} bytes        UTF-8 字节数
 * @property {string[]} warnings   渲染期降级记录（未闭合公式、缺图、未知语言…）
 */

/**
 * 把 markdown 转成单文件 HTML 的**唯一正确顺序**。
 *
 * # 为什么不是「marked + katex 扩展」
 *
 * 实测（marked 18.1.3）：一旦给 marked 注册 `$...$` / `$$...$$` 的自定义 extension，
 * **行内 `$$E=mc^2$$` 会被整段吞到下一个 `$$`**，并把后面的中文一起塞进 KaTeX，
 * 得到一个 `katex-error` 红字块（实测输出：`E=mc^2$$ 行内。`）——
 * 因为 marked 的 block tokenizer 与 inline tokenizer 会争抢同一段 `$`。
 *
 * 正确做法是**先保护、后解析、再还原**：
 *   ① 围栏代码整块摘出（代码里的 `$100` 必须原样保留，实测通过）；
 *   ② `$$…$$` 独占一整行才算块级公式；
 *   ③ 行内 `$…$` 要求前后都不是数字（否则「价格 $5 和 $6」会被配对成公式）；
 *   ④ 剩下的交给 marked，最后按占位符还原成 KaTeX 产物。
 *
 * # 实测踩过的第二个坑
 *
 * 第一版把 KaTeX 产物直接当占位文本交给 marked，结果块级公式被包进 `<p>`：
 * `<p>段落一 <div class="math-display">…</div> 行内。</p>` —— `<div>` 不能出现在 `<p>` 里，
 * 浏览器会替他闭合，打印/分页就乱了。还原时必须把**独占一段的块占位**连同外层
 * `<p>` 一起替换掉（实测 `<p>` 包裹 = false）。
 *
 * @param {string} markdown
 * @param {{title?: string, assets?: Map<string, Uint8Array>}} [options]
 * @returns {Promise<PortableDoc>}
 */
export function markdownToPortableHtml(markdown, options) {
  void markdown; void options;
  throw new Error('dsh-radar-notes-portable: 候选骨架未实现（未评审、未接入 profile）');
}

/**
 * 生成可离线打开的 CSS：KaTeX 样式 + 打印分页规则。
 *
 * # 体积实测（2026-11-05，沙箱）
 *
 * `katex@0.16.25` 的 `katex.min.css` 引用 **60 个**字体文件（woff2/woff/ttf 三套），
 * 全量 **1.03 MB**，base64 后 **≈1.37 MB**。只内联 woff2 一档可降到约 1/3。
 * 不做子集化 —— 子集化需要 FontTools/字体服务，超出「锁版 + 外围兼容层」的范围。
 *
 * # 许可前提（判据②）
 *
 * **KaTeX 的字体不能在 MIT 标题下再分发**（其 `fonts/` 有单独的 SIL OFL 声明）。
 * 因此单文件 HTML 内联字体时，**必须在文件底部或 `<meta name="license">` 处
 * 附上 KaTeX 的 LICENSE 与 OFL 声明**，否则本包不能合入。这一条已写进 README §五。
 *
 * @param {{inlineFonts?: boolean}} [options]
 * @returns {Promise<string>}
 */
export function portableCss(options) {
  void options;
  throw new Error('dsh-radar-notes-portable: 候选骨架未实现（未评审、未接入 profile）');
}
