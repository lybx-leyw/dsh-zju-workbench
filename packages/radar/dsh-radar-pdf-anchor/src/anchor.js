/**
 * 锚点的编码 / 重锚定（候选骨架 · **空壳，未实现**）。
 *
 * 两个函数都直接抛错，评审据此可以判断「这个包到底还没写什么」。
 * 实现口径见 `README.md`「从上游拿到的」与 `src/index.js` 的 `TODO(评审) 2`。
 *
 * # 为什么预留这两个名字
 *
 * 上游（`react-pdf-highlighter` / `dsh-paperforge`）都只有「编码」，没有「重锚定」——
 * 它们把 `rects` 当真相。本包反过来：**字符区间是真相，rects 是可再生缓存**。
 * 名字先定下来，是为了防止实现时又滑回「存 rect 就行」的惯性。
 */

/**
 * 选区 → 可持久化锚点。
 *
 * @param {{ pageNo: number, charStart: number, charEnd: number,
 *           rects: string, color?: string, note?: string }} input
 *   `rects`：逐行合并后的 `'x0,y0,x1,y1;x0,y0,x1,y1'`（0–1 归一化，四位小数）。
 *   `charStart/charEnd`：该页文本层里的字符偏移起止。
 * @returns {{ id: string, pageNo: number, charStart: number, charEnd: number,
 *             rects: string, color: string, note: string, createdAt: number }}
 * @throws 骨架未实现。
 */
export function encodeAnchor(input) {
  throw new Error('dsh-radar-pdf-anchor: 候选骨架，encodeAnchor 未实现');
}

/**
 * 锚点 → 本次渲染可用的 rects；锚点失效时返回 `stale: true` 而**不猜位置**。
 *
 * @param {{ pageNo: number, charStart: number, charEnd: number, rects: string }} anchor
 * @param {{ text: string, rects: Array<{left:number,top:number,right:number,bottom:number}>,
 *           width: number, height: number }} textLayer
 * @returns {{ rects: string, stale: boolean }}
 * @throws 骨架未实现。
 */
export function resolveAnchor(anchor, textLayer) {
  throw new Error('dsh-radar-pdf-anchor: 候选骨架，resolveAnchor 未实现');
}
