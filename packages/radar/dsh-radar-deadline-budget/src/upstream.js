/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 效法 `packages/dsh-radar-refs-import/src/upstream.js`：本包不直接 import 上游，
 * 而是留一个**窄接口**，把所有「上游长什么样、有什么怪癖」的知识关在这一个文件里。
 *
 * 这样做的三个理由：
 *   ① 单测里能注入假原语（不装上游也能跑通上层逻辑）；
 *   ② 上游换版本 / 换实现时只改这一个文件；
 *   ③ 上游的坑（npm 404、只覆盖「等距」周期）只在这里消化，不散落到调用方。
 *
 * ⚠ 下面每个 `TODO` 都是**评审前必须由人拍板**的事，不是可以随手填的空。
 *   本轮只做了**源码通读**（两个文件共 13.1 KB，全文读过），**没有**在沙箱里装上跑
 *   —— 因为 npm 上没有这个包（见 R1）。
 *
 * ── 上游是什么（通读后的结论，不是读 README 得到的产品描述）──────────
 *
 *   `@sifiso-guy/scheduler@0.1.0` 只导出**两个类 + 一个函数**：
 *
 *   | 导出 | 形状 | 做什么 |
 *   | --- | --- | --- |
 *   | `Deadline` | `new Deadline(dueDate: Date, description?)` | 只读值对象：`isOverdue(now)` / `msUntil(now)` / `toJSON()` / `static fromJSON` / `static compare(a,b)` |
 *   | `Interval` | `new Interval(startsAt: Date, everyMs: number)` | 等距重复：`occurrenceAt(i)` / `nextOccurrenceAfter(now)` / `countBetween(from,to)` / `occurrencesBetween(from,to,limit)` / `nextDeadline()` |
 *   | `validate` | `(x) => x != null` | 两行，无实义 |
 *
 *   它是**值对象层**，不是调度器：没有「把 N 个任务排进 M 天」的算法，
 *   没有可用时间、没有优先级、没有冲突消解。**别把「scheduler」这个名字当成能力。**
 */

/**
 * 上游包名与版本 —— 必须与 `package.json.dependencies` 逐字一致（评审通过、能解析之后）。
 *
 * ⚠ 当前 `package.json` 的 `dependencies` 是空的，因为 npm 上查不到这个包。
 */
export const UPSTREAM_PACKAGE = '@sifiso-guy/scheduler';

/** 仓库里 `package.json` 声明的版本号。**不是** npm 上的版本号（npm 上没有）。 */
export const UPSTREAM_VERSION = '0.1.0';

/** 供人工复核对照：仓库地址（`package.json.repository.url` 指向这里）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/SifisoScS/scheduler';

/** 许可证（GitHub `license.spdx_id` = MIT；仓库根 `LICENSE` 1,066 B；`package.json.license` = MIT）。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 作者（`package.json.author`）。 */
export const UPSTREAM_AUTHOR = 'Sifiso Cyprian Shezi';

/**
 * 上游在 ESM 下的**入口形状**。
 *
 *   `package.json` 的 `exports` 有三个子路径：`.` / `./deadline` / `./interval`，
 *   且 `sideEffects: false`、`files: ["dist"]`。所以：
 *
 *   - 想只要 `Deadline` 就 `import { Deadline } from '@sifiso-guy/scheduler/deadline'`，
 *     不要把整个 `.` 拉进来（虽然它也只有两个类）；
 *   - **打包形态只有 `dist/`**，源码不进包。若 npm 上永远不发，`dist/` 也不存在
 *     —— 这不是「版本旧」，是「根本没有可安装物」。
 */
export const UPSTREAM_EXPORTS = Object.freeze({
  root: '.',
  deadline: './deadline',
  interval: './interval',
});

/**
 * 本包从上游**只取两个语义**，其余一概不用。
 *
 *   | 本包需要 | 上游给的东西 |
 *   | --- | --- |
 *   | 「这一条还剩多久、过没过期」 | `Deadline.msUntil(now)` / `.isOverdue(now)`（负值即已过期，且**精确到毫秒**） |
 *   | 「本周还剩几个工作日/几节课」 | `Interval.countBetween(from, to)`（半开区间 `[from, to)`，**不物化数组**） |
 *
 *   刻意**不用**：
 *   - `occurrenceAt(i)` / `occurrencesBetween(...)` —— 会物化 `Date[]`；本包只数个数，
 *     `countBetween` 就够了。物化还会撞上上游的 `DEFAULT_LIMIT = 1000`（超限抛
 *     `RangeError`），一个跨学期窗口就能触发。
 *   - `Interval.nextDeadline()` —— 它会 `new Deadline(...)` 再包一层；本包的「下一次
 *     课」要带 `periods` / `location` / `weeks`，套一层 `Deadline` 反而丢字段。
 *   - `validate()` —— 两行 `x != null`，本仓自己判空更清楚。
 *   - `toJSON` / `fromJSON` —— 本包的持久化形状由本仓定（`ticks.js` / `plans.js` 已有格式），
 *     **不为上游的序列化契约让路**。
 */
export const TAKEN_SEMANTICS = Object.freeze(['deadline.msUntil', 'interval.countBetween']);

/**
 * 上游**明确不覆盖**的三件事 —— 也是本包必须留在外面的部分。
 *
 *   1. **墙钟周期**：`Interval` 的 `everyMs` 是**常数毫秒**，即「等距」。
 *      课表是「每周同一天同一节」，节次之间**不等距**：
 *
 *      ```
 *      实测（packages/dsh-zhiyun-source-zdbk/src/parse.js 的 PERIOD_TIMES）：
 *      第1→2节 08:00→08:50 = 50 分
 *      第2→3节 08:50→10:00 = 70 分（大课间）
 *      第5→6节 11:40→13:25 = 105 分（午休）
 *      → 13 个节次之间共 3 种不同间隔 {50, 70, 105}，12 处不等距
 *      ```
 *
 *      所以「一周 7 天 = 604800000 ms」可以表达「每周同一时刻」，
 *      但**表达不了「第 3 节是 10:00」** —— 那是 `PERIOD_TIMES` 的事，不是 `everyMs` 的事。
 *   2. **可用时间（capacity）**：上游没有「这一天能学多久」的概念。
 *   3. **冲突与取舍**：上游没有多任务排序，也没有「做不完怎么办」。
 *
 *   → 本包的定位是**上游只做值对象，其余本仓自己做**；不得把上游说成「排程引擎」。
 */
export const UPSTREAM_GAPS = Object.freeze(['wall-clock-recurrence', 'capacity', 'conflict-resolution']);

/**
 * 加载上游。评审通过后按下面的顺序落。
 *
 * TODO-0 · **阻塞项：先解决「有没有可安装物」**（R1）。
 *   本轮实测 `https://registry.npmjs.org/@sifiso-guy%2Fscheduler` → `{"error":"Not Found"}`。
 *   三条路，代价不同，必须由人拍板：
 *
 *   | 方案 | 做法 | 代价 |
 *   | --- | --- | --- |
 *   | A. 等上游发 npm | 什么都不做，等作者 `npm publish` | 零成本；但**本包在这之前无法存在** |
 *   | B. vendor 两个 `.ts` 文件 | 把 `src/deadline/index.ts` + `src/interval/index.ts`（13.1 KB）拷进本仓 | 需保留 MIT 版权头并把作者写进根 `ATTRIBUTION.md`；此后**上游更新要手动跟** |
 *   | C. 自写 | 本仓自己写两个 40 行的值对象 | 零依赖、无版权问题；但放弃「引入外部实现」这件事本身 |
 *
 *   ⚠ **本轮不出结论**。但要注意：本包要用的只有 `msUntil` 与 `countBetween` 两个语义，
 *   自写成本约 30 行 —— 这正是判 🟡 而非 🟢 的核心原因（见 README「为什么不是 🟢」）。
 *
 * @returns {Promise<{ Deadline: Function, Interval: Function }>} 上游两个类
 */
export async function loadUpstream() {
  // TODO-0 未拍板前**不写 import 语句**：写了就会在评审阶段把「未决定」伪装成「已确定」。
  throw new Error('候选骨架：loadUpstream() 未实现（TODO-0 阻塞，见 README，未评审）');
}

/**
 * 把本仓的一条「待办 / 计划卡」翻成上游原语。
 *
 * TODO-1 · 关键约束：**`due` 为 null 的条目不能构造 `Deadline`**。
 *   上游构造函数 `assertValidDate()` 对非 `Date` 直接 `throw new Error('Invalid dueDate: must be a valid Date object.')`。
 *   而本仓的 `due: null` 是**正常且常见**的值（`plans.js:178` 注释：「原文没写时间」）。
 *   → 必须先按 `due == null` 分流，null 那一支**完全不进上游**。
 *
 * @param {{ due?: string|null, title?: string }} row - 本仓的待办 / 卡片行。
 * @returns {{ kind: 'deadline', at: Date } | { kind: 'none' }} 分流结果
 */
export function toUpstreamDeadline(row) {
  throw new Error('候选骨架：toUpstreamDeadline() 未实现（见 README，未评审）');
}

/**
 * 把课表的一段窗口翻成上游 `Interval` —— **只在「同一节课每周重复」这一个维度上用**。
 *
 * TODO-2 · 已知限制，写清楚免得被误用：
 *   `Interval` 能表达「每周一 08:00 有一次」，但**不能表达**：
 *   - 单双周（本仓 `parse.js:341` 的 `weeks: 'odd' | 'even'`）→ 需要两个 Interval 错开一周；
 *   - 节次不等距（见 `UPSTREAM_GAPS` 第 1 条）；
 *   - 学期边界（`terms` 字段）→ `countBetween(from, to)` 的 `to` 由调用方截到学期末。
 *
 * @param {{ weekday: number, time: string|null, weeks: string }} session - 一条课表记录。
 * @returns {{ startsAt: Date, everyMs: number }} 构造 `Interval` 的参数
 */
export function toUpstreamInterval(session) {
  throw new Error('候选骨架：toUpstreamInterval() 未实现（见 README，未评审）');
}

/**
 * 上游错误码 → 本仓文案。**不许把上游英文原文直接弹给用户。**
 *
 * TODO-3 · 上游抛三类错（通读 `src/deadline/index.ts` + `src/interval/index.ts` 得到）：
 *   - `Error('Invalid dueDate: must be a valid Date object.')` —— 入参不是 Date / 是 Invalid Date
 *   - `Error('Invalid everyMs: must be a positive integer number of milliseconds.')`
 *   - `RangeError('Range contains N occurrences, above the limit of M. …')`
 *
 *   前两类在本包是**编程错误**（不该出现在用户路径上，应该修代码而不是改文案）；
 *   第三类是可预期的（窗口太宽），文案应是「时间范围太大，换小一点」。
 *
 * @param {unknown} error
 * @returns {{ code: string, message: string }}
 */
export function translateUpstreamError(error) {
  throw new Error('候选骨架：translateUpstreamError() 未实现（见 README，未评审）');
}
