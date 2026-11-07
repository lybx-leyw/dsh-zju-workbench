// 上游封装占位（B 类 · 能力提取）
//
// 上游：Open-Source-Uniandes/Aula-Finder（MIT）
//   lib/time-state.ts   —— 「现在」→ 星期码 / HH:MM 的归一
//   lib/closures.ts     —— 校历闭馆：运营时段 → 节假日 → 特殊事件（楼栋/教室级）
//   lib/parse-courses.ts —— 课程段 → (楼栋, 教室, 星期, 起止) 的占用区间
//   lib/query-utils.ts  —— 占用区间 → 某时刻的「可用 / 占用 / 课间(<10min) / 受限」
//
// 本文件**不**搬运上游源码：上游是 TypeScript + Next.js（`"use client"`、`@/types` 别名），
// 直接 import 会把 Next 的路径别名带进来。评审通过后在这里**按语义重写**三个纯函数：
//
//   dayCode(date)              → 'MON'..'SUN'（本仓用英文码，不用上游西语单字母码）
//   isClosed(day, time, date)  → { isClosed, reason }   对齐 closures.ts 的三段判定顺序
//   roomStatus(room, at)       → 'FREE' | 'OCCUPIED' | 'TURNOVER' | 'RESTRICTED'
//
// 必须保留的上游语义（这是「强化」的理由）：
//   ① 课间切换阈值 **10 分钟** —— 不是简单的「空闲/占用」二分
//   ② 闭馆判定顺序：运营时段 → 节假日 → 特殊事件（顺序影响 reason 归因）
//   ③ 「受限」（实验室/需授权空间）是与「占用」**并列**的第四态，不是它的子集
//
// TODO：评审通过后补齐实现；当前仅声明形状，不提供任何可用行为。

/**
 * 校历闭馆判定（占位）。
 *
 * @returns {never}
 */
export function isClosed() {
  throw new Error('未实现：等待评审通过')
}

/**
 * 教室四态判定（占位）。
 *
 * @returns {never}
 */
export function roomStatus() {
  throw new Error('未实现：等待评审通过')
}
