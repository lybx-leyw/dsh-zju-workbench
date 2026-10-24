/**
 * **token 估算**：斩杀线与"已处理多少"都以它为单位。
 *
 * # 为什么不按块数
 *
 * 块数表示"几段"。12 块可能是 800 token，也可能是 5000 token —— 完全不是
 * 同一个量。按块数定斩杀线，就得先保证"每块 token 一致"，那反而要把本来
 * 长短不一的块强行切齐，更复杂而且失真。
 *
 * # 为什么不真的调 tokenizer
 *
 * 这一步只用于**分块决策**（要不要长成叶树、切几支），误差 ±10% 不影响结论，
 * 却要跑在每一次解析里。所以采用一个稳定的**启发式**：
 *   · 中日韩字符 ≈ 1 token / 字
 *   · ASCII 词 ≈ 1 token / 4 字符
 *   · 空白与标点按 0.3 计入
 *
 * ⚠️ 它是**估算**，不要拿它去算钱：计费用真实的 usage，不在这里猜。
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const SPACE = /\s/;

/**
 * 估算一段文本的 token 数。
 *
 * @param {string} text
 * @returns {number} 整数（0 表示空）
 */
export function tokensOf(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  let cjk = 0, ascii = 0, space = 0, other = 0;
  for (const ch of s) {
    if (CJK.test(ch)) cjk++;
    else if (SPACE.test(ch)) space++;
    else if (ch.codePointAt(0) < 128) ascii++;
    else other++;
  }
  // ASCII 按 4 字符 ≈ 1 token；其它符号（公式、全角标点）按 0.6 计。
  return Math.max(1, Math.round(cjk + ascii / 4 + other * 0.6 + space * 0.3));
}

/** 一组文本的 token 合计。 */
export function tokensOfAll(texts) {
  let total = 0;
  for (const t of texts ?? []) total += tokensOf(t);
  return total;
}

/** 人可读的 token 数（1.2k / 320）。 */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(Math.round(v));
}
