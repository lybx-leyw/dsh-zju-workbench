// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 上游封装：ts-fsrs 5.4.2（MIT）。**只做薄封装，不复制任何上游源码**。
// API 表面已于 2026-10-28 用 npm pack 实包核对（见 README「已核实事实」）：
//   - `fsrs(params)` 返回调度器
//   - `createEmptyCard(now?)` 建一张空卡
//   - `f.next(card, now, grade)` → `{ card, log }`，`card` 带 `due` / `state` / `reps` / `lapses`
//   - `f.repeat(card, now)` → 四档预览（本骨架**不用**，见下文 why）
//   - `Rating` 取值：Manual=0 / Again=1 / Hard=2 / Good=3 / Easy=4（`Grade` 排除 Manual）

import { fsrs, createEmptyCard, Rating, generatorParameters } from 'ts-fsrs';

export const UPSTREAM = 'ts-fsrs';
export const UPSTREAM_VERSION = '5.4.2';

/**
 * 本仓三档自评（`dsh-zhiyun-core-study/src/question-bank.js:257` 实文）
 * → FSRS 四档评分的映射。
 *
 * ⚠️ 这不是「配置项」，是**必须由人拍板的产品判断**。实测两种候选映射在
 * 同一作答序列 `掌握了 / 部分掌握 / 需要复习 / 掌握了` 上的结果：
 *
 *   序列：correct, partial, incorrect, correct（新卡起算）
 *   方案 A（correct→Good, partial→Hard, incorrect→Again）
 *       → 0d, 0d, 0d, 0d      ← **全部塌回同日**：Hard 落在学习步内不进天级间隔，
 *                                反复「部分掌握」等于永远学不完，是一个**静默的坏**
 *   方案 B（correct→Easy, partial→Good, incorrect→Again）
 *       → 8d, 39d, 0d, 5d     ← **出现倒挂**：partial(39d) > correct(8d)，
 *                                与「越不确定间隔越短」的常识相反
 *
 * 结论：**两方案都不可直接采用**。默认取 A（保守：宁短勿长），并在
 * `mappingIsCalibrated: false` 上明示「未标定」。标定前不放量。
 */
export const SELF_VERDICT_TO_GRADE = Object.freeze({
  correct: Rating.Good,
  partial: Rating.Hard,
  incorrect: Rating.Again,
});

export const mappingIsCalibrated = false;

/** 建一个关闭 fuzz 的调度器（fuzz 会让同一输入两次跑出不同间隔，不利于复核）。 */
export function createScheduler({ enableFuzz = false } = {}) {
  return fsrs(generatorParameters({ enable_fuzz: enableFuzz }));
}

/** 新建一张卡，并把 FSRS 的字段压成宿主可持久化的最小面。 */
export function newCard(at) {
  return toRecord(createEmptyCard(at));
}

/** 评分；`selfVerdict` 非法时**返回 null 而不是猜**（与 store.js 的 fsrsRating 同一条纪律）。 */
export function review(scheduler, record, at, selfVerdict) {
  const grade = SELF_VERDICT_TO_GRADE[selfVerdict];
  if (grade === undefined) return null;
  const { card, log } = scheduler.next(fromRecord(record), at, grade);
  return { card: toRecord(card), log: { grade, due: log.due } };
}

export function isDue(record, at) {
  const due = Date.parse(record.due);
  return !Number.isNaN(due) && due <= Date.parse(at);
}

/**
 * 只暴露本骨架真正用到的字段。
 *
 * ⚠️ `reps` / `lapses` 不是为了展示，是为了**审计映射**：若映射错位，
 * `lapses` 会在本该「越练越熟」的科目上持续攀升 —— 这是能被人看见的信号。
 * ⚠️ `state` 与 `learning_steps` **不能丢**：FSRS 的长短时记忆区分靠它们，
 * 丢掉后回灌 `fromRecord` 会把「还在学习步里的卡」当成已达到稳定态的卡。
 */
function toRecord(card) {
  return {
    due: new Date(card.due).toISOString(),
    stability: card.stability ?? null,
    difficulty: card.difficulty ?? null,
    scheduledDays: card.scheduled_days ?? 0,
    learningSteps: card.learning_steps ?? 0,
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    state: card.state ?? 0,
    lastReview: card.last_review ? new Date(card.last_review).toISOString() : null,
  };
}

function fromRecord(record) {
  return {
    due: new Date(record.due),
    stability: record.stability ?? 0,
    difficulty: record.difficulty ?? 0,
    elapsed_days: 0,
    scheduled_days: record.scheduledDays ?? 0,
    learning_steps: record.learningSteps ?? 0,
    reps: record.reps ?? 0,
    lapses: record.lapses ?? 0,
    state: record.state ?? 0,
    last_review: record.lastReview ? new Date(record.lastReview) : undefined,
  };
}
