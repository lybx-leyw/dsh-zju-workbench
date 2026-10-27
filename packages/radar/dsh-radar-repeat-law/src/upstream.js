/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 效法 `packages/dsh-radar-ics-export/src/upstream.js` 与 `dsh-radar-deadline-budget/src/upstream.js`：
 * 本包不直接 import 上游，而是留一个**窄接口**，把所有「上游长什么样、有什么怪癖」
 * 的知识关在这一个文件里。
 *
 * 为什么必须这样：本包要用的只是上游 250 行里的**三个纯函数**，但上游是一个
 * **双面插件**（node half + `dsh.client`），顺手 `import` 它的包根就会把
 * 侧栏按钮、全宽浮层、设置卡一起注册进工作台。把「取哪一段」写死在这里，
 * 是为了让评审能一眼看出**边界在哪**。
 *
 * ⚠ 本轮做的是**源码通读 + 沙箱实跑**（`node --experimental-strip-types` 直接跑
 *   上游的 `src/core/repeat.ts`，配两个 12 行的桩模块），**没有**把整个 tarball
 *   装进本仓。能跑通不等于能打包进浏览器 —— 见 R1。
 */

/**
 * 上游包名与版本 —— 与 `package.json.dependencies` 逐字一致，**写死不用 `^`**。
 */
export const UPSTREAM_PACKAGE = '@magma27/dsh-calendar';

/** npm `dist-tags.latest` = `0.1.7`（2026-10-01 发布，本轮实查）。 */
export const UPSTREAM_VERSION = '0.1.7';

/** 供人工复核对照。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/MAGMA27/dsh-calendar';

/** 许可证：GitHub `license.spdx_id = Apache-2.0`；仓库根 `LICENSE` 11,338 B **逐字读过的 Apache-2.0 全文**。 */
export const UPSTREAM_LICENSE = 'Apache-2.0';

/** npm 包声明的 license 同为 `Apache-2.0`（两处一致）。 */
export const UPSTREAM_NPM_LICENSE = 'Apache-2.0';

/** 作者 / 维护者（`package.json` 内 `publishConfig.access = public`，仓库 owner `MAGMA27`）。 */
export const UPSTREAM_AUTHOR = 'MAGMA27';

/**
 * 上游「是什么 / 不是什么」（通读 1.5 MB 包内 `src/` 后的结论）。
 *
 *   是：一个**宿主权威**的日历 + 待办插件。任务台账在 node 半边（`host-ledger.ts`），
 *       浏览器半边只是同源异步视图；重复规则以「模板 + 物料化副本」建模。
 *   不是：一个可被别的插件调用的「重复规则库」。它没有对外承诺任何 API，
 *       `core/repeat.ts` 是**内部模块**，只是恰好纯函数、没有 IO。
 *
 * → 本包对它的定位是「**取一段纯函数**」，不是「接一个服务」。
 */
export const UPSTREAM_NATURE = Object.freeze({
  kind: 'dual-face-plugin',
  uiRegistrations: Object.freeze(['shell.overlay', 'sidebar.footer.action', 'settings.plugins.tab']),
  hostServicesInjected: Object.freeze([]),
  reusableModule: 'src/core/repeat.ts',
  promiseOfApi: false,
});

/**
 * 本包真正要用的导出（其 `src/core/repeat.ts` 实测导出 17 个符号，这里只要 5 个）。
 *
 * 每一个都写了「为什么是它」，因为上游的同名函数很容易被误用
 * （例如 `repeatDatesBetween` 的区间是**闭区间**，多给一天就多一条副本）。
 */
export const UPSTREAM_EXPORTS = Object.freeze({
  /** `(rule, dateMs) => boolean` —— 日粒度匹配：weekly 的 weekday 过滤 + 假日跳过。**语义正确，但假日的定义不能照搬**（R2）。 */
  matchesRepeat: 'rule × day → boolean',
  /** `(rule, fromDayMs, toDayMs) => number[]` —— **[from, to] 闭区间**，两端都含（R3）。 */
  repeatDatesBetween: 'rule × range → dateStartMs[]',
  /** `(rule, fromMs) => number | undefined` —— 严格大于 `fromMs` 的下一个匹配日，上限 2 年。 */
  nextRepeatDate: 'rule × from → dateStartMs | undefined',
  /** `(tasks, templateId, now) => { tasks, prunedIds }` —— 规则收窄时剪掉不再匹配的副本，并同步 `materialized` 记账。 */
  alignSeries: 'tasks × templateId → tasks',
  /** 60 天前瞻；`host-scheduler` 每次 tick 调 `materializeRepeats(now, REPEAT_HORIZON_DAYS)`。 */
  REPEAT_HORIZON_DAYS: 'number (60)',
});

/** 上游 `RepeatRule` 的取值域 —— 与本仓**不同**，别硬映射。 */
export const UPSTREAM_RULE_SHAPE = Object.freeze({
  kind: Object.freeze(['daily', 'weekly']),
  weekdays: 'number[] (0=Sun..6=Sat, weekly 必填)',
  skipHolidays: 'boolean',
  triggerAgent: 'boolean',
  triggerAt: 'HH:MM',
  /** 上游**没有**的东西，而本仓有： */
  missingInUpstream: Object.freeze(['every (N 的间隔)', 'month', 'anchor: due|done', 'term/holiday calendar']),
});

/**
 * 已实测的硬约束 —— 每条都附了实跑读数，供评审复核（脚本见 README「实测」）。
 */
export const UPSTREAM_GAPS = Object.freeze({
  /** R1：`exports` 只有 5 个子路径，`lib/core/repeat.js` 没有独立出口。 */
  R1: 'npm 包 exports = [".", "./src/*", "./client", "./invariant", "./package.json"]；`lib/core/repeat.js` 不可按子路径取，只能走 `./src/*`（TS 源码）或从包根连带 UI 一起载入',
  /** R2：假日定义 = 周末 OR 写死的表，无调休补班。 */
  R2: 'skipHolidays = isWeekend(d) || PUBLIC_HOLIDAYS.has(dayKey(d))；`PUBLIC_HOLIDAYS` 是 2025 官方 + 2026 预计的**写死表**，2027 起为空 → 越用越偏',
  /** R3：闭区间。 */
  R3: 'repeatDatesBetween(rule, 2026-10-26, 2026-10-26+61d) → **62** 个日期（闭区间，非 61）',
  /** R4：模板日期不占位。 */
  R4: 'buildRepeatCopy(tpl, startOfDay(tpl.startAt), …) 产出与模板**同日同刻**的副本（startAt 逐字相同）—— 上游靠 `cursor = addDays(max(today, startOfDay), 1)` 规避，本仓若「按日期记账」就没有这层保护了',
  /** R5：无 every。 */
  R5: 'kind 只有 daily / weekly；本仓「每两周」「每三月」「按完成日推进」在上游**无法表达**',
  /** R6：调休。 */
  R6: '2026-10-10（周六、法定补班日）→ isWeekend=true → matchesRepeat(每天任务, skipHolidays:true) = **false**（被跳过）',
});

/**
 * 取上游那一段纯函数的方式。
 *
 * TODO-0 · **阻塞项**：R1 决定了这里写不出来。三条路，评审选一条：
 *
 *   A. `import { … } from '@magma27/dsh-calendar/src/core/repeat.ts'`
 *      → 本仓构建链必须能吃 TS（当前 `packages/*` 编译产物是 JS，未见 TS loader）。
 *   B. 从包根 `import` 上游的 `lib/index.js`，只取它 re-export 的部分
 *      → 但包根会连带注册 `shell.overlay` / `sidebar.footer.action` / `settings.plugins.tab`
 *        三处 UI（见 `UPSTREAM_NATURE.uiRegistrations`）→ **与判据①冲突**，基本等于整包接入。
 *   C. 放弃上游，本仓自写「记账 + 回链 + 三问」≈ 60 行
 *      → 那就不是强化式集成，本骨架应删除。
 *
 * @returns {Promise<object>} 上游模块的窄接口（只含 `UPSTREAM_EXPORTS` 的键）
 */
export async function loadUpstream() {
  throw new Error('候选骨架：loadUpstream() 未实现（TODO-0 阻塞，见 README R1）');
}

/**
 * 把本仓的 `{ every, unit, anchor }` 翻译成上游能接受的**部分**规则。
 *
 * TODO-1 · 只翻译能无损表达的那一档：
 *   `unit: 'day', every: 1` → `{ kind: 'daily' }`；
 *   `unit: 'week', every: 1` → `{ kind: 'weekly', weekdays: [本仓的due是星期几] }`。
 *   其余（`every > 1`、`month`、`anchor: 'done'`）**必须原样保留在本仓**，
 *   上游只是「日匹配器」，本仓仍是规则的唯一真源。
 *
 * @param {{ every: number, unit: 'day'|'week'|'month', anchor: 'due'|'done' }} rule
 * @returns {{ translatable: boolean, upstream?: object, keepLocal: string[] }}
 */
export function toUpstreamRule(rule) {
  void rule;
  throw new Error('候选骨架：toUpstreamRule() 未实现（见 README，未评审）');
}

/**
 * 上游错误 → 本仓 `localError(code, message)` 的口径。
 *
 * TODO-2 · 上游是 TS + 直接 `throw new Error(...)`，没有错误码；本仓有
 *   `INVALID_INPUT` 一类稳定码（`local.js` 的 `localError`）。这一层不能省：
 *   页面对不同码给不同文案（`client.jsx` 的 `errorText`）。
 */
export function translateUpstreamError(error) {
  void error;
  throw new Error('候选骨架：translateUpstreamError() 未实现（见 README，未评审）');
}
