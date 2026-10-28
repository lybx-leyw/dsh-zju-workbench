/**
 * dsh-radar-week-parser —— **候选骨架的上游行为规格**。
 *
 * ⚠ 本文件**不含上游任何源码**，只把「上游做了什么、边界在哪、我们不打算照抄哪部分」
 *   写成可评审的文字与签名。评审通过后由本仓**自写实现**，不复制。
 *
 * ── 上游是谁 ─────────────────────────────────────────────────────────
 *
 *   [shou-graduate-calendar-exporter](https://github.com/wowhao333/shou-graduate-calendar-exporter)
 *   · **MIT** ✅（`LICENSE` 首行实核 `MIT License`）
 *   · v0.1.1 · 纯 ESM · 37 KB · `core/` 仅 `schedule.js`(319 行) + `exporters.js`(135 行)
 *   · Chrome MV3 扩展 + Tampermonkey 脚本，面向「上海海洋大学研究生」课表导出
 *   · ★0（单人项目，创建 2026-09-17，最后 push 2026-09-20）
 *
 * ── 我们只借两个纯函数（其余全部不借，理由见 README §3.2） ──────────────
 *
 *   ① `parseWeeks(text)`      —— 「`1-8,10-16周(单)`」→ `[1,3,5,7,10,12,14,16]`
 *   ② `inferWeekOneMonday()`  —— 由多个 (首日, 周次, 星期) 三元组**投票**反推第 1 周周一
 *
 * ── 不借的部分（重要，防止后续评审者整包引入） ──────────────────────────
 *
 *   · `exporters.js` 的 `foldIcsLine()` —— 按 75 字节折行。本仓
 *     `dsh-radar-ics-export/src/index.js:28` 已写明该约束，且已选定用上游 `ics` 库处理。
 *   · `exporters.js` 的手写 `TZID:Asia/Shanghai` + `VTIMEZONE` —— 本仓
 *     `dsh-radar-ics-export/src/upstream.js:126-130` 已实测「上游 `ics` 传 `timezone` 直接报错」，
 *     并已判定「UTC / 浮动二选一」**属产品拍板事项**，不是代码问题。**不要用上游手写版绕过。**
 *   · `stableUid()` / `stableHash()` —— 本仓 TODO-C 的规格更严
 *     （`(termKey, courseTitle, startMs)` 三元组，绝不含导出时刻/下标）。
 *   · `findConflicts()` —— 本仓 `dsh-zhiyun-page-today/src/agenda.js` 已有同日投影。
 *
 * ── 为什么本仓「真的缺」这两格（三条实证） ──────────────────────────────
 *
 *   1. `packages/dsh-zhiyun-source-xxt/src/parse.js:372`
 *      → `weeks: lesson.weeks ?? null`，**平台原样透传，形态未定**。
 *   2. `packages/dsh-zhiyun-source-zdbk/src/parse.js:297,343`
 *      → `@property {'all'|'odd'|'even'} weeks`，**只有单双周，没有「第几到第几周」**。
 *   3. `packages/radar/dsh-radar-ics-rrule/src/index.js` README
 *      → 自述「本仓课表条目**没有周次 / 节次号**」，RRULE 因此只能保守退回逐条。
 *
 *   → 三个源三种周次形态，**中间缺一层归一化**。这就是本包的全部价值。
 *
 * ── 上游行为规格（照抄语义，不照抄代码） ────────────────────────────────
 *
 *   `parseWeeks(text)`：
 *     · 单双周识别：字符串含「单」→ 只留奇数周；含「双」→ 只留偶数周；都没有 → 全留。
 *       **注意上游把「单」优先于「双」**（`含单 ? 1 : 含双 ? 0 : null`），
 *       遇到「单双周均有」这类脏数据会静默判为单周 —— **本仓须改为显式报错或返回 both**。
 *     · 标点归一：`－ — – ~ ～ 至` → `-`；`， 、 ； ;` → `,`；删除 `第` `周`。
 *     · 区间：`a-b` 展开为 `[min..max]`（**容错倒序**，`6-2` 当 `2-6`）。
 *     · 过滤：仅保留 `(0, 60]` 内的整数；结果去重升序。
 *
 *   `inferWeekOneMonday(blocks)`：
 *     · 对每个 block（含 `firstDate` 且 `weeks` 非空、且 `firstDate` 的星期与 block 的
 *       `weekday` 一致 —— 不一致说明数据脏，**直接跳过**）：
 *         `candidate = firstDate - ((minWeek - 1) * 7 + (weekday - 1))` 天
 *     · 对 candidate 计票，返回 `{ date, confidence, candidates }`，
 *       排序：票数降序 → 日期字典序升序。
 *     · **置信度是核心**：票数低就不能用。本仓必须定阈值（上游没定，只是返回票数）。
 *
 * ── 本包在链路里的位置 ────────────────────────────────────────────────
 *
 *   source-xxt / source-zdbk / tongge（原始课表）
 *        │  weeks 形态各异（字符串 / 'odd'|'even'|'all' / 掩码）
 *        ▼
 *   【本包】normalizeWeeks()  ── 统一成 number[] ──┐
 *   【本包】inferFirstMonday() ── 第 1 周周一 ────┤
 *        ▼                                        │
 *   dsh-radar-ics-export.buildCalendar()  ◄───────┘
 *        ▼
 *   dsh-radar-ics-rrule.recurrenceRuleFor()  ← 仍由锁版 rrule@2.8.1 生成 RRULE
 *
 *   ⚠ **本包不生成 RRULE**，也不替换 `ics-rrule`。二者是**串联**，不是替代。
 *     若把本包理解为 RRULE 方案，属误读。
 */

/** 上游仓库标识（用于 ATTRIBUTION 与评审追溯）。 */
export const UPSTREAM_REPOSITORY = 'wowhao333/shou-graduate-calendar-exporter';

/** 上游许可证（**MIT** ✅，`LICENSE` 首行实核）。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游被借用的文件（仅 `core/schedule.js`，且仅两个函数）。 */
export const UPSTREAM_FILES_READ = Object.freeze([
  'core/schedule.js',
  'core/exporters.js',
  'README.md',
  'LICENSE',
  'package.json',
]);

/**
 * 上游单双周判定的已知缺陷 —— 本仓**必须修正**，不可照搬。
 *
 * 上游实现里 `含"单" ? 1 : 含"双" ? 0 : null` 意味着
 * 「周一(单),周三(双)」这类混写会**静默判为单周**，丢掉双周课。
 * 本仓应返回显式的 `parity: 'odd' | 'even' | 'both' | 'mixed-error'`。
 */
export const UPSTREAM_PARITY_DEFECT = Object.freeze({
  symptom: '混写「单」「双」时静默截断为单周',
  mitigation: '本仓 normalizeWeeks() 返回结构化 parity；mixed 时由调用方决定报错或全留',
});

/**
 * TODO-A · 周次字符串 → `number[]`（升序去重）。
 *
 * 规格见本文件头「上游行为规格 · parseWeeks」。**须修正上游的单双周缺陷。**
 *
 * @param {string | number[] | null | undefined} input 原始 weeks 字段（形态因来源而异）
 * @param {{ maxWeek?: number }} [options] 默认 `maxWeek: 20`（浙大常规学期上限；上游用 60 过宽）
 * @returns {{ weeks: number[], parity: 'odd' | 'even' | 'both', raw: string }}
 */
export function normalizeWeeks(input, options = {}) {
  throw new Error('候选骨架：normalizeWeeks() 未实现（见 README，未评审）');
}

/**
 * TODO-B · 由多个课时块投票反推「第 1 周周一」。
 *
 * @param {Array<{ firstDate: string, weekday: number, weeks: number[] }>} blocks
 * @param {{ minVotes?: number }} [options] 低于 `minVotes` 返回 `confidence: 'low'`
 * @returns {{ date: string, votes: number, confidence: 'high' | 'low', candidates: Record<string, number> }}
 */
export function inferFirstMonday(blocks, options = {}) {
  throw new Error('候选骨架：inferFirstMonday() 未实现（见 README，未评审）');
}

/**
 * TODO-C · `zdbk` 的 `'all'|'odd'|'even'` + 学期周数 → 周次数组。
 *
 * 这是本仓**自有**来源，上游无对应实现（上游只有字符串解析）。
 * 说明本包不是「把上游搬过来」，而是「以上游为参照，补齐三源归一」。
 *
 * @param {'all' | 'odd' | 'even'} parity
 * @param {number} totalWeeks
 * @returns {number[]}
 */
export function fromParity(parity, totalWeeks) {
  throw new Error('候选骨架：fromParity() 未实现（见 README，未评审）');
}
