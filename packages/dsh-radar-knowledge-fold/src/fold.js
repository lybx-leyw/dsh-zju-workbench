/**
 * 检索用规范化 —— **占位实现**，只用于让本骨架的测试可跑、可对照，**不是交付代码**。
 *
 * ⚠ 候选骨架：未评审、未接入 profile、不可直接使用。
 *
 * 为什么一个「零新依赖」的骨架还要写代码：
 *   第四十四轮之前的教训是「骨架写了业务逻辑 = 评审被代码牵着走」。本文件不写检索、
 *   不写排序、不写存储，只写**规范化这一个纯函数**，目的是把 TODO 1 中「口径要与
 *   `dsh-zhiyun-quiz/src/quality.js` 一致」这句话变成**可执行的对照**：
 *   `fold()` 的期望值由 quality.js 的 `foldFullWidth` + `normalizeForMatch` 语义直接推出，
 *   若 JS 原生 `String.prototype.normalize('NFKC')` 与那条手写循环在**全部 BMP 全角段**
 *   上逐字符一致，就可以用一行替代一个 8 行的手写函数（评审决策点，见 TODO 2）。
 *
 * 明确**不做**的事（都属于评审后的实现范围）：
 *   - 不 import `dsh-zhiyun-quiz`（跨包依赖 `src/` 内部文件是反模式，见 TODO 1）；
 *   - 不做切词、不做 BM25、不做排序（第四十一/四十四轮已判：`search()` 的问题在
 *     「写法容错」，不在「分词」）；
 *   - 不读磁盘、不注册任何 ctx 服务。
 */

/**
 * 把一段文本折成「检索比较用」的形式。
 *
 * 语义来源（本仓既有口径，见 `packages/dsh-zhiyun-quiz/src/quality.js:109-118,166-168`）：
 *   1. U+3000 全角空格 → 普通空格
 *   2. U+FF01..U+FF5E 全角 ASCII → 减 0xFEE0 得半角
 *   3. 小写化
 *   4. 去掉所有空白
 *
 * 本实现用 `normalize('NFKC')` 覆盖 1、2（NFKC 对这两段的结果与减 0xFEE0 相同），
 * 再走 3、4。**差异面**：NFKC 还会折叠上标、罗马数字、连字、部分朝韩兼容字等，
 * 比手写循环**更宽** —— 这是评审要裁的点（更宽会不会造成误命中），不是本骨架的结论。
 *
 * @param {string} s
 * @returns {string}
 */
export function fold(s) {
  if (typeof s !== 'string') throw new TypeError('fold() 只接受字符串');
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/**
 * 判断 `needle` 是否出现在 `haystack` 里，**两边都折过**。
 *
 * 这就是本骨架对 `service.js:282` 那行 `fragment.text.includes(needle)` 的**全部**改动意图：
 *   - 现状：`fragment.text.includes(needle)` —— 只对原文一侧「原样」比较；
 *   - 目标：`fold(fragment.text).includes(fold(needle))`。
 *
 * 注意：折过之后 `indexOf` 的下标**不再对应原文偏移**，所以本函数只回答「有没有」。
 * 若「知识」页要拿命中位置去高亮原文，必须另做映射（TODO 4），不能拿折后下标直接用。
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {boolean}
 */
export function containsFolded(haystack, needle) {
  const n = fold(needle);
  if (n === '') return false; // 空检索词不许退化成「全都命中」，与 service.js 的空串门禁同一条原则
  return fold(haystack).includes(n);
}
