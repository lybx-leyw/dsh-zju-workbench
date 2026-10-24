/**
 * dsh-radar-ics-export —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**，
 * 只从 `./upstream.js` 取锁版凭据（那一个文件负责「上游长什么样」）。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 锁版引入 `ics@3.12.1`（adamgibbons/ics，ISC，★787），给「规划」页补一个
 * **导出 .ics** 的动作，把两样已经算好的东西序列化成 RFC 5545 日历：
 *
 *   (a) 课表：`page-today/src/agenda.js` 的 `projectAgenda()` 已经交出
 *       `{ startMs, endMs, courseTitle, day }` 的**逐日平铺事件**；
 *   (b) 截止时间：`page-planning/src/plans.js` 的卡片与 `time.js` 的 `urgencyOf()`
 *       已经有 `due`（`YYYY-MM-DDTHH:mm:ss+08:00`）与紧迫度。
 *
 * 两者都已经在页面上，只是**出不去**。用户在手机日历里看不到自己的课表。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 不新增导航项。「规划」页已有的时间轴 / 待办列表
 *      原样不动，只是在页头多一个「导出日历」按钮；课表仍是「今天」页那份数据。
 *   2. **仍是相似正交的功能** —— 现有回答「**我接下来要做什么**」（站内浏览、按紧迫度分组）；
 *      新增回答「**我怎么在自己的日历里看到它**」（离开工作台、进入系统日历）。
 *      同一份数据、同一域、不同问题，不重叠。
 *   3. **底层多调了更优质实现** —— 本仓**没有任何 iCalendar 能力**（见下方「已核实的缺口」），
 *      而 RFC 5545 的折行（75 octet）、转义（`,` `;` `\` 与换行）、`DTSTAMP`、`VALARM`、
 *      时区形式这些细节**手写极易出错且难以发现**；上游已把这层做掉。
 *
 * ── 已核实的缺口（本轮读码，不是猜）────────────────────────────
 *
 * 全仓 grep `ical|\.ics|rrule|vevent`（排除 `packages/dsh-radar-*`）：
 * 命中的 13 个文件里，**没有一处是日历** —— `tree.js` 命中的是 `verticalRule`
 * （`kTreeHeaderRuleMinRatio`），其余是 `physical` / `vertical` 之类子串。
 * 结论：**iCalendar 序列化在本仓是零实现**，不是「实现得不够好」，是「没有」。
 *
 * ── 边界（写在这里，免得实现时越界）────────────────────────────
 *
 *   - **不新增页面、不改动「今天」页的 `projectAgenda` 语义**。导出只读，不写。
 *   - **不做双向同步**（不解析 .ics 回灌）。那是 `rrule` / `node-ical` 的方向，
 *     需要先有「外部日历 → 本仓」的冲突合并策略，属独立议题。
 *   - **不发明截止时间**。`plans.js` 已明确「原文没写就留 null，不许推测」；
 *     导出时 `due` 为 null 的卡片**不生成事件**（不做「全天事件」兜底去猜）。
 *   - **不导出个人隐私字段**：`sourceTitle` 原文、笔记正文一律不进 `DESCRIPTION`；
 *     只写标题、时间、课程名。日历会被同步到手机、云盘，是最容易泄露的一处。
 *   - **不改上游源码**（本包只锁版调用）。
 *
 * ── 三条已实测的硬约束 ─────────────────────────────────────────
 *
 *   R1. **UID 必须确定性生成**。上游默认每条随机 UID；本仓课表条目没有 id
 *       → 必须由 `(学期, courseTitle, startMs)` 派生。否则每次导出都在用户日历里
 *       新增一整套重复事件。见 `upstream.js` 的 `stableUid()`。
 *   R2. **时区只能选 UTC 或浮动**。上游不支持 VTIMEZONE（传 `timezone` 直接报错）。
 *       建议 UTC，理由与代价见 `upstream.js` 的 TODO-D；**这条要产品拍板**。
 *   R3. **毫秒必须显式按 `Asia/Shanghai` 拆**，不能用 `Date.getUTC*()`。
 *       实测错误写法会把课表整体挪 8 小时，且**不报错**。见 `toLocalParts()`。
 */

// 锁版凭据只从 `./upstream.js` 取 —— 骨架不在别处再写一遍版本号（否则会漂移）。
import { UPSTREAM_PACKAGE, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from './upstream.js';

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-ics-export';

/** 让凭据在本模块可见（测试钉住三者与 `package.json` 一致）。 */
export const upstream = Object.freeze({
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  repository: UPSTREAM_REPOSITORY,
});

/**
 * 上游接受的事件字段**白名单**（R3 的落点：多一个字段上游就整条拒绝）。
 *
 * 只列本包真正要用的，**刻意不含**：`description`（防泄露）、`url`、`attendees`、
 * `organizer`、`recurrenceRule`（课表已由 `projectAgenda` 逐日展开，
 * 再加 RRULE 会与展开后的实例**重复生成**）。
 */
export const EVENT_FIELDS = Object.freeze([
  'title', 'start', 'end', 'startInputType', 'startOutputType',
  'uid', 'calName', 'busyStatus', 'categories', 'alarms', 'classification',
]);

/** 导出档 —— 两档分开做，先做 read-only 的那档。 */
export const EXPORT_MODES = Object.freeze({
  /** 只导出课表节次（数据最全、最稳定，`startMs/endMs` 永远存在）。 */
  timetable: 'timetable',
  /** 只导出有明确 `due` 的待办卡片（`due` 为 null 的一律跳过，不猜）。 */
  deadlines: 'deadlines',
});

/**
 * 生成一段 .ics 文本。
 *
 * TODO-1 · 实现时按这个顺序落：
 *   1. **入参归一**：只接受本仓形状（`{ mode, termKey, items, calName }`），
 *      逐条映射到 `EVENT_FIELDS` 白名单 —— 其余字段**丢弃**，不要尝试透传。
 *   2. **时间**：`toLocalParts(startMs)` → `timeShape(ms, 'utc')`（R3 + R2）。
 *   3. **UID**：`stableUid({ termKey, courseTitle, startMs })`（R1）。
 *   4. **校验失败**：上游回调里的 `err.errors` 是字符串数组，**必须原样上抛**，
 *      不许吞掉半份结果 —— 与 `plans.js`「半份卡片比没有卡片更难发现」同一原则。
 *   5. **空集合**：`items` 为空时**不要**生成一个只有 `VCALENDAR` 头的文件，
 *      应返回明确的 `{ ok: false, reason: 'empty' }`，让 UI 说「没有可导出的内容」。
 *
 * @param {{ mode: 'timetable'|'deadlines', termKey: string, items: object[], calName?: string }} input
 * @returns {Promise<{ ok: boolean, text?: string, reason?: string, skipped?: number }>}
 */
export async function buildCalendar(input) {
  // 占位：评审通过后实现。
  throw new Error('候选骨架：buildCalendar() 未实现（见 README，未评审）');
}

export async function apply(ctx, config = {}) {
  // 占位：**不要**在这里注册路由、也不要在这里改任何页面包。
  // 评审通过后的正确落点是：
  //   ① 本包只导出纯函数 `buildCalendar()`（无副作用、无 IO），由宿主或页面调用；
  //   ② 「规划」页页头加一个「导出日历」动作，调用 ①，用 `Blob` + `a[download]` 落地；
  //   ③ 若要走服务端，则是 `dsh-zhiyun-host-*` 的活，不在本骨架范围。
  // 三条都是改别的包，不属于本骨架；本骨架只负责把上游封装成窄接口。
  throw new Error('候选骨架：apply() 未实现（见 README，未评审）');
}
