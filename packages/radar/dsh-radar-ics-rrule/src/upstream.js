/**
 * 上游 `rrule` 的**唯一**引用点 —— 锁版凭据只在本文件出现一次。
 *
 * 本文件是占位：**不 import 上游本身**，只把「包名 / 版本 / 仓库 / 许可证 / 已知坑」
 * 写死在这里，供评审者对照。评审通过后再实现 `loadUpstream()`。
 *
 * 所有结论都在沙箱里对 `rrule@2.8.1` 实跑过（2026-10-26，Node 22.13.1）。
 * 见 `docs/ecosystem-radar/2026-10-26-r74.md` §3。
 */

/** npm 包名。 */
export const UPSTREAM_PACKAGE = 'rrule';

/** **锁版**（不带 `^`）：重复规则的边界行为直接决定用户日历里的事件位置，不容小版本漂移。 */
export const UPSTREAM_VERSION = '2.8.1';

/** 源码仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/jakubroztocil/rrule';

/** 许可证：BSD-3-Clause（GitHub `spdx_id` 与 npm `versions['2.8.1'].license` 两处一致）。 */
export const UPSTREAM_LICENSE = 'BSD-3-Clause';

/**
 * TODO-A · 加载上游，**必须用默认导入**。
 *
 *   实测（P1，接入即崩）：
 *     `import { RRule } from 'rrule'`   → SyntaxError: Named export 'RRule' not found
 *     `import pkg from 'rrule'`         → ✅
 *
 *   原因：`rrule@2.8.1` 的 `package.json` **没有 `exports` 字段**，只有 `main` 指向 CJS 产物。
 *   本仓所有包都是 `"type": "module"`，所以照抄官网示例的具名导入会在**加载期**抛错，
 *   而报错文本（"…is a CommonJS module…"）与「依赖没装上」高度相似，极易误诊。
 *
 *   实现时落成：
 *     const { RRule, RRuleSet, rrulestr } = (await import('rrule')).default;
 *   并把 `RRule` 作为 `return` 值的一部分，**不要**在别处再 import 一次。
 *
 * @returns {Promise<{ RRule: Function, RRuleSet: Function, rrulestr: Function }>}
 */
export async function loadUpstream() {
  throw new Error('dsh-radar-ics-rrule：候选骨架未实现（见 README 与 src/upstream.js 的 TODO-A）。不要接入 profile。');
}

/**
 * TODO-B · `Date#getDay()` → `rrule` 的 weekday 枚举（P0，静默错日期）。
 *
 *   实测：
 *     上海 2026-09-16 周三 08:00，dtstart = 2026-09-16T00:00Z
 *       byweekday: [3]        → options.byweekday = [3]  → BYDAY=TH → 展开 **2026-09-17 周四** ❌
 *       byweekday: [RRule.WE] → options.byweekday = [2]  → BYDAY=WE → 展开 2026-09-16 周三  ✅
 *
 *   两套口径不同**且不报错**：
 *     `rrule` 的 weekday：MO=0, TU=1, WE=2, TH=3, FR=4, SA=5, SU=6（RFC 5545 的 BYDAY 序）
 *     `Date#getDay()`   ：SU=0, MO=1, TU=2, WE=3, TH=4, FR=5, SA=6
 *
 *   实现时**不得透传数字**。用 `[RRule.SU, RRule.MO, …, RRule.SA][dow]` 映射，
 *   并**为这条写一个测试**：周三的 dtstart 必须展开出周三，而不是周四。
 *
 * @param {number} dow - `Date#getDay()` 的返回值（0=周日 … 6=周六）
 * @param {{ RRule: Function }} upstream - `loadUpstream()` 的返回值
 * @returns {unknown} `rrule` 认的 weekday 值
 */
export function weekdayOf(dow, upstream) {
  // 占位：评审通过后实现（见上面的映射表）。
  return undefined;
}

/**
 * TODO-C · 「组内是否恰好每 7 天一条」—— RRULE 能否替代逐日展开的**唯一**判据。
 *
 *   本仓课表条目（`dsh-zhiyun-source-classroom/src/models.js:66-71` `scheduleEntry`）
 *   只有 `{ courseId, subId, startMs, endMs, courseTitle, roomName, … }`，
 *   **没有周次 / 节次号 / 楼栋**；`page-today/src/agenda.js` 的 `projectAgenda()` 是逐日拍平的。
 *
 *   实测（4 周 × 每周 2 节 + 第 3 周 1 次调课到周六，共 9 条）：
 *     按 (courseId, 星期, 时分, 时长) 分组 → 3 组，`COUNT` 各为 4 / 4 / **1**
 *     条数守恒（9 = 9），**语义不守恒**：那个 `COUNT=1` 的组变成单次事件，
 *     丢了「它是本周三那节课的调课」这一事实。
 *
 *   还有更硬的：若停课**不连续**（第 8、12 周各停一次），`COUNT` 表达不了两次空洞，
 *   `BYDAY` 展开会把停课周也排上课 —— 用户日历上凭空多两节课。
 *
 *   因此：**组内必须严格每 7 天一条**才允许转 RRULE；否则**退回逐条**。
 *   一日一课、早八连排、单双周交替（间隔 14 天）都属于「不连续」，一律退回。
 *
 *   实现时落成：`contiguous(group)`，入参已按 `startMs` 升序，返回 `group.length === 1 ||
 *   每相邻两条 `next.startMs - prev.startMs === 7 * 86400000`（且时长相等）`。
 *
 * @param {{ startMs: number, endMs: number }[]} group
 * @returns {boolean}
 */
export function contiguous(group) {
  // 占位：评审通过后实现。
  return false;
}

/**
 * TODO-D · 与 `dsh-radar-ics-export` 的接线 —— **本包不独立承载页面**。
 *
 *   `ics-export` 的 `EVENT_FIELDS`（`src/index.js:79-82`）**刻意不含 `recurrenceRule`**，
 *   理由是「逐日展开后再加 RRULE 会重复生成」。这句结论对，但**理由要补**：
 *   RFC 5545 下，一个 `VEVENT` 若既有独立 `DTSTART` 又带 `RRULE`，客户端会把它当作
 *   「该序列的起点」，而不是「这是一个独立实例」——所以危险的是**同一份条目同时以
 *   「展开后的 N 条」和「带 RRULE 的 1 条」出现**，而不是「多传了一个字段」。
 *
 *   实现时必须**二选一**：
 *     - 该组 `contiguous(group) === true` → 只输出 **1 条** + `recurrenceRule`；
 *     - 否则 → 输出 **N 条**，且任何一条都带 `recurrenceRule: undefined`。
 *   绝不能「N 条 + 每条都挂同一个 RRULE」。
 *
 *   因此本包的 `apply()` **不应注册路由或插槽**，它只是 `ics-export` 的一个函数层。
 *   若评审判定 `ics-export` 不推进，**本包应一并驳回**。
 */
export const WIRING_NOTE = Symbol('见 TODO-D');
