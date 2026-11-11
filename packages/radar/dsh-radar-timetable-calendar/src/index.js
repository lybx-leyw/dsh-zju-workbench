/**
 * dsh-radar-timetable-calendar —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 把「第 3~16 周（双）、星期三、第 3~4 节」这类**教学周语义**换算成真实日期，
 * 并输出标准 `VALARM` / `VTIMEZONE` 属性，交给课表面板的 `.ics` 导出使用。
 *
 * ── 为什么是「强化式集成」而不是「新功能」────────────────────────────
 *
 *   1. **仍是同一个面板** —— 不新增导航项 / 插槽 / 路由。只向 `dsh-radar-ics-export`
 *      暴露一个 `normalizeWeekSpec()` 与 `calendarProps()`，由其在 `buildCalendar()` 内调用。
 *   2. **功能仍相似正交** —— 仍是「把课表带走」，不改做双向同步、不改做订阅源、
 *      不做华师大专属的浏览器扩展 UI。
 *   3. **底层多调了更优质实现** —— 上游 `lib/schedule-core.js` 对
 *      「连续周 / 逗号列表 / 单双周 / `第X周` 前缀」的解析已覆盖校园教务系统真实脏数据，
 *      比本项目现有逐条手写解析更完整；`popup.js` 里对 `VALARM` + `VTIMEZONE`
 *      的写法也是可直接对照的成熟产出。
 *
 * ── 上游的可移植性：**B 类，非 DSH 插件** ─────────────────────────────
 *
 * 上游是**浏览器扩展**（`chrome MV3`，原生 HTML/CSS/JS，无 bundler），
 * **不是** DSH 插件包，**没有** `dsh.bundle.patch`，**也无法从 npm 锁版**
 * （`package.json` 里 `"private": true`）。
 *
 * 所以本包只能**源码级借鉴**（许可证 MIT，允许），不能像 A 类那样 `dependencies` 锁版。
 * 借鉴范围严格限定为 `lib/schedule-core.js` 的**纯函数**部分：
 * `normalizeText()` / `parseWeekSpec()`；以及 `popup.js` 中的 `.ics` 属性写法 **思路**。
 * **不搬运**任何 DOM 代码、`content.js`、`api-hook.js`、`manifest.json` 与品牌 UI。
 *
 * ── 不能做错的四件事 ─────────────────────────────────────────────────
 *
 *   P0 · **`第X周` 前缀必须剥掉再切逗号** —— 上游 `parseWeekSpec()` 先 `replace(/第/g,'')`。
 *        若不剥，「第3~16周」这一段在按 `,` 切分后仍带「第」，正则匹配失败 → **静默丢课**。
 *   P0 · **`~` 的同义字符必须归一** —— 上游把 `～ — － 至` 全归一成 `~`。
 *        浙大教务常见全角 `～`，不归一则整学期课表一条都解析不出来。
 *   P1 · **单双周与周范围必须同时生效** —— 「3~16周(双)」要产出 4,6,8,…,16，
 *        不是 3~16 全部，也不是「单双标记被丢弃」。
 *   P1 · **周日两种写法** —— `日` 与 `天` 都映射到 7（上游 `dayMap` 已覆盖），
 *        漏一个就会丢周日的课。
 *
 * 上游：https://github.com/marioMLLL/ecnu-timetable-calendar · MIT · ★8 · 2026-09 仍在维护
 * 本包**未评审、未接入 profile、不可直接使用**。
 */

import { UPSTREAM_REPOSITORY, UPSTREAM_REVISION } from './upstream.js';

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-timetable-calendar';

/** 上游凭据（B 类：无 npm 包，只有仓库 + 参考提交）。 */
export const upstream = Object.freeze({
  repository: UPSTREAM_REPOSITORY,
  revision: UPSTREAM_REVISION,
});

/**
 * 插件入口。**占位**：评审通过前，挂载即抛错。
 */
export function apply() {
  throw new Error(
    'dsh-radar-timetable-calendar：候选骨架未实现（见 README 与 src/upstream.js 的 TODO-A..C）。不要接入 profile。',
  );
}

/**
 * 把教务系统的周次描述归一成升序去重的周号数组。
 *
 * TODO-1 · 实现顺序（每步都别跳）：
 *
 *   1. **归一文本**：全角括号 → 半角、`～—－至` → `~`、全角逗号 → `,`（TODO-A `normalizeText`）。
 *   2. **剥 `第`**：整段 `replace(/第/g,'')`，再做逗号切分。**先剥后切**，顺序反了会静默丢课（P0）。
 *   3. **逐段解析**：`3~16` 展开为区间；`3~16(双)` 按 `week % 2 === 0` 过滤；
 *      `5` 单点；无法解析的段落**不要沉默**，记入 `unparsed[]` 让调用方决定是否告警。
 *   4. **收尾**：去重 → 过滤 `week > 0` → 升序。
 *
 * @param {string} spec - 例如 `第3~16周(双)` 或 `1-8,10-16周`
 * @returns {{ weeks: number[], unparsed: string[] }} `weeks` 升序去重；`unparsed` 为未识别的原始段
 */
export function normalizeWeekSpec(spec) {
  // 占位：评审通过后实现。
  throw new Error('dsh-radar-timetable-calendar：候选骨架未实现（TODO-1）。不要接入 profile。');
}

/**
 * 生成 `.ics` 需要的稳定属性片段。
 *
 * TODO-2 · 只负责「属性怎么写」，不负责「什么时候导出」：
 *   - `VALARM`：`TRIGGER:-PT{n}M` + `ACTION:DISPLAY`
 *   - `VTIMEZONE`：`TZID=Asia/Shanghai` 的 `STANDARD` 块（**不要**用 UTC 偏移硬编码）
 *   - 忙碌状态：`TRANSP:OPAQUE`
 *
 * ⚠ 与 `dsh-radar-ics-export` / `dsh-radar-ics-rrule` 的**边界**：
 *   `DTSTART` / `DTEND` 的拼装归 `ics-export`；`RRULE` 归 `ics-rrule`；
 *   本包只补 `VALARM` / `VTIMEZONE`。三者各改一半必然打架。
 *
 * @param {{ reminderMinutes?: number, timezone?: string }} options
 * @returns {string[]} 逐行的 ICS 属性
 */
export function calendarProps(options) {
  // 占位：评审通过后实现。
  throw new Error('dsh-radar-timetable-calendar：候选骨架未实现（TODO-2）。不要接入 profile。');
}
