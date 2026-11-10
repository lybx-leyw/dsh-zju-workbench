/**
 * 按用户给的中文名在候选里**唯一定位**一条记录。
 *
 * # 为什么不是「取第一个匹配」
 *
 * 「计算机」在培养方案列表里能同时命中「计算机科学与技术」「计算机科学与技术（求是科学班）」；
 * 在选课里「高等数学」能命中三四个教学班。取第一个的后果不是报错，而是**给出了一个
 * 看似正常、但用户没要的答案** —— 选课场景下这尤其危险：用户以为自己在提交甲班，
 * 实际提交的是乙班，而且两边都不报错。
 *
 * 所以这里保留消歧义：恰好一条才返回，否则抛出带候选的 `NEEDS_DISAMBIGUATION`，
 * 让调用方（或用户）明确选。
 *
 * # 归一化
 *
 * 全角/半角、大小写、多余空白都折叠掉再比。中文页面上「（Ⅰ）」和「(Ⅰ)」是同一门课，
 * 不折叠的话精确匹配永远不中，每次都退化成模糊匹配。
 *
 * 逻辑照搬上游 `vendor/zju-assistant/core/zju/lib/core/match.ts` 的 `uniqueMatch`，
 * 只把 `NeedsUser` 换成 `ClassroomError('NEEDS_DISAMBIGUATION')`。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

/**
 * 归一化一个名称（用于比较，不用于显示）。
 *
 * @param {unknown} value - 原值。
 * @returns {string} 归一化结果。
 */
export function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 在候选里唯一定位一条。
 *
 * 先找精确匹配（归一化后相等）；有精确匹配就只在精确匹配里判唯一，
 * 否则退到「包含」匹配。两者都不唯一时抛错并附上前 12 个候选。
 *
 * @template T
 * @param {T[]} rows - 候选。
 * @param {string} query - 用户给的名字/代码。
 * @param {(row: T) => string[]} names - 一条记录有哪些可比较的名字。
 * @param {(row: T) => unknown} describe - 候选怎么展示给用户。
 * @param {string} label - 报错时的名词（「培养方案」「课程」…）。
 * @returns {T} 唯一命中的那一条。
 * @throws {ClassroomError} `INVALID_ARGUMENT` —— 没给名字；`NEEDS_DISAMBIGUATION` —— 命中多条或没有。
 */
export function uniqueMatch(rows, query, names, describe, label) {
  const wanted = normalizeName(query);
  if (!wanted) throw new ClassroomError('INVALID_ARGUMENT', `需要${label}名称。`);
  const exact = rows.filter((row) => names(row).some((name) => normalizeName(name) === wanted));
  const matches = exact.length
    ? exact
    : rows.filter((row) => names(row).some((name) => normalizeName(name).includes(wanted)));
  if (matches.length === 1) return matches[0];
  throw new ClassroomError(
    'NEEDS_DISAMBIGUATION',
    matches.length
      ? `${label}「${query}」命中了 ${matches.length} 条，请说得更具体一些。`
      : `没有找到${label}「${query}」。`,
    { candidates: (matches.length ? matches : rows).slice(0, 12).map(describe) },
  );
}
