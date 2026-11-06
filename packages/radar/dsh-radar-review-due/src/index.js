// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 本包不提供 UI、不提供存储，只提供**一个纯函数**：
//   给定「题库题目 + 作答历史 + 现在几点」→ 返回「今天该复习哪几道，按什么顺序」。
//
// 为什么只做这一件事：本仓的复习队列（`dsh-zhiyun-core-quiz/src/store.js:501`）
// 是 `items.filter(q => q.status === accepted)` —— **按采纳顺序返回，没有时间维度**。
// 补时间维度只需要一个排序器，不需要第二个页面、第二个存储、第二套交互。
// 这正是「强化式集成」而非「新增功能」的分界线。

import { createScheduler, newCard, review, isDue } from './upstream.js';

export const name = 'dsh-radar-review-due';

/** 未评审：`apply()` 只登记服务，不订阅任何槽位、不渲染任何东西。 */
export function apply(ctx) {
  ctx.logger?.info?.('[dsh-radar-review-due] 候选骨架，未评审；未接入任何槽位');
}

/**
 * 从作答历史重建卡片状态。
 *
 * @param {object}   map      题目 id → 卡片记录（可来自任何存储；本包不落盘）
 * @param {string}   questionId
 * @param {Array}    attempts  该题的作答历史，按时间升序，元素形如
 *                             `{ at, verdict }`（verdict ∈ correct|partial|incorrect）
 * @param {Function} scheduler 复用同一个调度器实例，避免每次重建参数
 * @returns {object} 卡片记录
 */
export function replay(map, questionId, attempts, scheduler = createScheduler()) {
  let record = map[questionId] ?? null;
  // ⚠️ 游标必须是「**已经重放到的最后一次作答**」，不是卡片的 `due`。
  //    实测踩到的坑：`Again` 会把卡打回 `state=3`（重学）并给 `due = 作答时刻 + 10min`，
  //    即 `due` **晚于**作答时刻；若拿 `due` 当游标，下一段真实历史会被误判成乱序而整段丢掉。
  let cursor = record?.lastReview ? new Date(record.lastReview) : null;

  for (const attempt of attempts) {
    const at = new Date(attempt.at);
    if (Number.isNaN(at.getTime())) continue;
    // 历史乱序时**跳过而不是回滚**：回滚需要逐条 log，本包未持有 log。
    if (cursor && at < cursor) continue;
    // 无自评（verdict 缺失/非法）→ **不产生复习事件**，也不推进游标。
    const base = record ?? newCard(at);
    const next = review(scheduler, base, at, attempt.verdict);
    if (!next) continue;
    record = next.card;
    cursor = at;
  }
  return record;
}

/**
 * 复习队列：**到期在前，未到期按到期时间升序，从没做过题的垫后**。
 *
 * 三个刻意的选择：
 * 1. **不做「今天新卡上限」**。Anki 的 new/due 分离（`generate.js:1087`
 *    `computeBacklog` 已经把两者分开算了）是为了防雪崩；本包只排序，不截断 ——
 *    截断策略属于产品决策，不该藏在排序器里。
 * 2. **没有卡片记录的题返回 `due: null` 并排在最后**，不臆造一个「现在到期」。
 * 3. **不稳定排序**：同 `due` 的题保持输入顺序，宿主可控。
 *
 * @param {Array}  questions  形如 `[{ id }]`
 * @param {object} map        题目 id → 卡片记录
 * @param {string|Date} asOf  评估时刻（**必传**，不从 `Date.now()` 偷取）
 */
export function reviewQueue(questions, map, asOf) {
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime())) throw new TypeError('asOf 不是合法时刻');

  const withDue = [];
  const fresh = [];
  for (const q of questions) {
    const record = map[q.id];
    if (!record) { fresh.push({ id: q.id, due: null, state: 'new' }); continue; }
    withDue.push({
      id: q.id,
      due: record.due,
      state: isDue(record, at) ? 'due' : 'scheduled',
      overdueMs: Math.max(0, at - Date.parse(record.due)),
    });
  }

  withDue.sort((a, b) => (a.overdueMs === b.overdueMs ? 0 : b.overdueMs - a.overdueMs));
  return [...withDue, ...fresh];
}

/** 只取到期的（宿主若要「先清到期」，直接调用这个）。 */
export function dueOnly(questions, map, asOf) {
  return reviewQueue(questions, map, asOf).filter((item) => item.state === 'due');
}

export {
  UPSTREAM, UPSTREAM_VERSION, SELF_VERDICT_TO_GRADE, mappingIsCalibrated,
  createScheduler, newCard, review, isDue,
} from './upstream.js';
