/**
 * 上游封装占位 —— **未评审、未接入 profile、不可直接使用**。
 *
 * 本文件只声明「如果评审通过，上游以什么形状被扣在这里」，**不写实现**。
 * 与 `dsh-zhiyun-paper/src/upstream.js` 同一职责：把上游的边界（版本、入口、
 * 可调用面、已知缺陷）钉死在一个文件里，别处只许经此调用。
 *
 * ── 锁版策略 ────────────────────────────────────────────────────
 *
 *   `decimal.js` 写死 `10.6.0`（package.json 里**不带 `^`**），理由是
 *   本包的判定结果必须**可复现** —— 判分口径变了，历史错题归因就跟着变。
 *
 * ── 已知缺陷（本轮实测，必须在实现时绕开）──────────────────────
 *
 *   中文数词解析在 JS 生态里**普遍不可靠**，实测三条：
 *
 *   | 输入 | 真值 | Achuan-2/chinese_number_to_digits | spa5k/chinese-numbers-to-arabic |
 *   | --- | --- | --- | --- |
 *   | 一千二百万 | 12000000 | **1002000000** ✗ | 12000000 ✓ |
 *   | 十二亿三千四百万 | 1234000000 | **4204000000** ✗ | — |
 *   | 一亿二千万 | 120000000 | 120000000 ✓ | **1000020000000** ✗ |
 *
 *   两家各错一处、且错法相反 → **不能整库照搬**，也不能「两个都试、取其一致」。
 *   结论：中文数词支路**自写**（显式单位节点 + 按层级合并，用有理数算，
 *   `(1+"千2"+"百万")` 必须等于 12000000），上游只提供 `Decimal` 这一层。
 */

// TODO(评审后实现)：
//   import Decimal from 'decimal.js';
//   export const DECIMAL_VERSION = '10.6.0';
//   export function toDecimal(raw) { … }   // 只接受「已清洗」的纯数值串
//   export function equals(a, b) { … }     // Decimal#equals，任意精度

export const DECIMAL_VERSION = '10.6.0';

export function toDecimal() {
  throw new Error('dsh-radar-answer-equiv: upstream 占位，尚未实现');
}

export function equals() {
  throw new Error('dsh-radar-answer-equiv: upstream 占位，尚未实现');
}
