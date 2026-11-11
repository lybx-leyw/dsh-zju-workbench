/**
 * dsh-radar-board-latex —— 候选骨架（未评审 · 未接入 profile · 不可直接使用）
 *
 * 补的是**一个已存在的渲染末端**，不是新功能：
 *
 *   packages/dsh-zhiyun-core-classroom-stage/src/client.jsx:246-252
 *     if (element.type === 'latex') {
 *       return <div className="zyc-stage-board-el zyc-stage-board-latex">{element.latex}</div>;
 *     }
 *
 * 同产品里 slide 侧是好的（`dsh-zhiyun-classroom-renderer/src/view/slide.jsx:238`
 * 走 `katex.renderToString`），白板侧却把 `element.latex` 当纯文本吐出来，
 * 靠 `style.css:103` 的 `font-family: "Cambria Math", serif` 假装是公式。
 *
 * # 接入前必须先回答一个问题
 *
 * `wb_draw_latex` 的 `latex` 字段里，模型写的是 `\frac{a}{b}` 还是 `frac(a, b)`？
 *
 *   - 全是 **LaTeX**  → 本包**作废**。仓库已有 `katex@0.16.38`
 *                       （`dsh-zhiyun-classroom-renderer/package.json:35`），
 *                       改成 `katex.renderToString(..., { throwOnError: false })` 即可，零新依赖。
 *   - 出现 **Typst**  → 本包成立，锁 `kern-typ@0.2.0`（npm 名带 `-typ`，`kern` 被 redis 客户端占用）。
 *
 * 依据：`docs/ecosystem-radar/2026-11-06-09.md` §3.2.1 与 §7.1。
 */

export const name = 'radar-board-latex';

/** 白板上一个 `type: 'latex'` 元素。字段名与 ledger.js:421-431 / :474-483 对齐。 */
const ELEMENT_SHAPE = Object.freeze({
  id: 'string',
  type: "'latex'",
  left: 'number',
  top: 'number',
  width: 'number',
  height: 'number',
  latex: 'string',
  color: 'string',
  fixedRatio: 'boolean',
});

/**
 * 把一个白板 latex 元素渲成 HTML 字符串。
 *
 * @param {{ latex?: string, width?: number, height?: number }} _element 账本里的元素
 * @param {{ displayMode?: boolean, syntax?: 'latex' | 'typst' }} [_options]
 * @returns {string} 内联 HTML
 */
export function renderBoardFormula(_element, _options = {}) {
  // TODO(评审后实现)：
  //   1. 语法判别 —— 这是本包**不可省**的一步。
  //      kern-typ 吃 LaTeX 输入时**不抛 ParseError**，会静默渲成一张 `kern-eqarray` 错表
  //      （2026-11-06 沙箱实测：`renderToString('\\\\frac{a}{b}')` → `<mtable class="kern-eqarray kern-aligned">`）。
  //      没有判别，就是把「看得见的源码」换成「看不见的错公式」。
  //   2. typst 分支 → `kernTyp.renderToString(src, { displayMode, output: 'htmlAndMathml', throwOnError: false })`
  //   3. latex 分支 → `katex.renderToString(src, { displayMode, throwOnError: false, strict: 'ignore' })`
  //   4. 两路都失败 → 回落 escapeHtml(src)，与 slide.jsx 同一策略（一个公式坏了不该让整块白板白掉）
  throw new Error(
    'dsh-radar-board-latex：候选骨架，未实现。先判定 wb_draw_latex 的实际语法，再决定接 kern-typ 还是直接用 katex。',
  );
}

/**
 * 插件入口。
 *
 * 骨架阶段**不做任何事** —— 不注册插槽、不劫持渲染、不碰账本。
 * 真正的接入点是替换 `client.jsx` 里 `BoardElement` 的 `type === 'latex'` 分支，
 * 那属于评审通过后的产品改动，不在本包内完成。
 */
export function apply() {
  // TODO(评审后实现)：由 evaluator 决定是「替换 BoardElement 的 latex 分支」还是「提供可注入的 renderer 覆盖」。
}

export const shape = ELEMENT_SHAPE;
