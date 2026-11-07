/**
 * 【候选骨架·未评审】上游 `foliate-js@1.0.1` 的封装占位。
 *
 * 为什么单独一层：上游 README 明说「API 不稳定，随时会变」，
 * 所以宿主侧**只允许通过本文件**接触 foliate-js —— 将来上游改接口，
 * 要改的只有这一个文件，而不是散在页面各处的 import。
 *
 * 锁版事实（本轮 npm 实测，非 README 自述）：
 *   - 只有一个版本 `1.0.1`，锁死无歧义；
 *   - `exports` 为通配 `"./*.js"` ⇒ `import 'foliate-js/view.js'` 是官方允许的深导入；
 *   - 解压依赖 `vendor/zip.js` / `vendor/fflate.js` 已随包发布，不走 npm devDep；
 *   - 运行时依赖仅 `construct-style-sheets-polyfill`，整包 476 KB。
 *
 * TODO(评审后)：
 *   - `openBook(source, { mime })`：优先用 `epub.js` 的 `EPUB` 类直接开，避免整站 `view.js`；
 *   - `renderTo(el)`：把 paginator 装进 iframe 文档；
 *   - `progress()` / `toc()`：给笔记页右栏一份目录（与 PDF 阅读器的右栏对齐）。
 *
 * 注意：不要在这里做任何「格式嗅探 + 转发到 PDF 分支」的逻辑 ——
 * PDF 已有自己的阅读器，本包只管 EPUB/MOBI/FB2。
 */

export const UPSTREAM = 'foliate-js';
export const UPSTREAM_VERSION = '1.0.1';

/**
 * 占位：上游视图加载器。
 * @returns {Promise<never>}
 */
export async function loadView() {
  throw new Error('skeleton: loadView 未实现（候选骨架，未评审）');
}
