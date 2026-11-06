/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 效法 `packages/dsh-radar-search-fuzzy/src/upstream.js`：
 * 本包不直接 import 上游，而是留一个**窄接口**（`loadUpstream()` + 三个翻译函数），
 * 把所有「上游长什么样、有什么怪癖」的知识关在这一个文件里。
 *
 * 这样做的三个理由：
 *   ① 单测里能注入假生成器（不装上游也能跑通上层逻辑）；
 *   ② 上游换版本 / 换实现时只改这一个文件；
 *   ③ 上游的坑（只认本地数组、不认毫秒时间戳、拒收未知字段、无 VTIMEZONE）
 *      只在这里消化，不散落到调用方。
 *
 * ⚠ 下面每个 `TODO` 都是**评审前必须由人拍板**的事，不是可以随手填的空。
 *   本轮已在沙箱里实跑过 `ics@3.12.1`，实测结论写在各自 TODO 里（见 README「实测」表）。
 */

/** 上游锁定凭据 —— 与 `package.json.dependencies` 必须逐字一致。 */
export const UPSTREAM_PACKAGE = 'ics';
export const UPSTREAM_VERSION = '3.12.1';
/** 供人工复核对照：仓库地址（npm 包的 `repository.url`）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/adamgibbons/ics';

/**
 * 上游的时间输入形状：**本地时间数组** `[年, 月, 日, 时, 分]`，月为 1–12。
 *
 * ⚠ 不是 `Date`、不是毫秒时间戳、不是 `'YYYY-MM-DDTHH:mm:ss+08:00'` 字符串。
 *   本仓课表条目的时间是 `startMs` / `endMs`（毫秒），**必须**先按 `Asia/Shanghai`
 *   拆成这个数组再交出去。拆错时区**不会报错**，只会把课表整体挪 8 小时 ——
 *   这是本包最容易犯、且最难被肉眼发现的错。
 */
export const UPSTREAM_SHAPE = '[year, month(1-12), day, hour, minute]（本地时间）';

/** 本仓「规划」页唯一的时区口径，与 `dsh-zhiyun-page-planning/src/time.js` 的 `ZONE` 同值。 */
export const LOCAL_ZONE = 'Asia/Shanghai';

/**
 * TODO-A · 加载上游，并确认导出形态。
 *
 *   实测（`npm i ics@3.12.1`，沙箱实跑）：
 *
 *   - 具名导出 5 个：`convertTimestampToArray` / `createEvent` / `createEvents` /
 *     `createEventsAsync` / `isValidURL`。**`createEvent` 是回调式** `(event, cb)`，
 *     返回 Promise 的调用**不会**生效（返回值是 `undefined`）；要么写 `createEventsAsync`，
 *     要么自己包一层 Promise。回调里 `err` 是 yup 的 `ValidationError`，
 *     真正有用的东西在 `err.errors`（字符串数组）里，`err.message` 只有最后一条。
 *   - 包形态：`main: ./dist/index.js`、`exports: { default: ./dist/index.js }`、
 *     **无 `module` / 无 `browser` 字段** → 是 CJS 产物，但有 `index.d.ts`。
 *     `grep` 遍 `dist/` **没有任何 `node:` 内置模块引用** → 可进前端 bundle。
 *   - 体积：`unpackedSize` 72,079 B；连依赖一起 esbuild `--bundle --minify`
 *     实测 **76,577 B（≈75 KB）**。其中大头是 yup（`property-expr` / `tiny-case` /
 *     `toposort` / `type-fest` 四个传递依赖）。**这是本包最主要的成本**，
 *     评审若认为「为生成一段文本引入一个校验库」不划算，应改判 🔵。
 *
 *   @returns {Promise<{ createEvent: Function, createEventsAsync: Function, version: string }>}
 */
export async function loadUpstream() {
  // 占位：评审通过后实现。
  //   const mod = await import('ics');
  //   return { createEvent: mod.createEvent, createEventsAsync: mod.createEventsAsync,
  //            version: UPSTREAM_VERSION };
  throw new Error('候选骨架：loadUpstream() 未实现（见 README，未评审）');
}

/**
 * TODO-B · 毫秒时间戳 → 上游要的「上海本地时间数组」。
 *
 *   为什么不用 `new Date(ms).getFullYear()`：那取的是**运行环境时区**。
 *   本仓服务端与客户端可能不在同一时区（用户把工作台跑在 UTC 容器里），
 *   结果就是「本地能跑、部署后课表整体偏 8 小时」。必须显式按 `LOCAL_ZONE` 取值 ——
 *   与 `page-today/src/agenda.js` 的 `clock()` 用 `Intl.DateTimeFormat({timeZone})`
 *   是同一个理由（那里已经踩过一次：分组取 UTC 日期、标签取上海时区）。
 *
 *   实测警告：直接把 `Date(ms).getUTC*()` 拆出来的数组当「本地时间」传，
 *   上游不报错，产出 `DTSTART` 会**早 8 小时**（实测 `08:00` 变成前一天 `08:00Z`）。
 *
 *   @param {number} ms  毫秒时间戳（本仓 `startMs` / `endMs` 的地盘）
 *   @returns {[number, number, number, number, number]} `[y, m(1-12), d, h, min]`
 */
export function toLocalParts(ms) {
  // 占位：评审通过后实现。
  //   const parts = new Intl.DateTimeFormat('en-CA', {
  //     timeZone: LOCAL_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  //     hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  //   }).formatToParts(new Date(ms));
  //   const pick = (t) => Number(parts.find((p) => p.type === t)?.value);
  //   return [pick('year'), pick('month'), pick('day'), pick('hour'), pick('minute')];
  throw new Error('候选骨架：toLocalParts() 未实现（见 README，未评审）');
}

/**
 * TODO-C · 课程条目 → 稳定的 UID。
 *
 *   **这是本包最关键的一条约束。**
 *
 *   本仓课表条目（`page-today/src/agenda.js` 的 `projectAgenda`）是**逐日展开**的
 *   平铺对象 `{ startMs, endMs, courseTitle, day, ... }`，**没有稳定 id**
 *   （`source-campus` 里 `row.id` 是另一条链路的字段，课表条目上没有）。
 *
 *   而 `ics` 的默认行为是**每条事件随机生成 UID**（实测 `aXPsYcWAV4xBuUE_N_2JP`）。
 *   日历客户端靠 UID 判断「这是不是同一件事」：UID 每次导出都变，
 *   用户每导出一次，日历里就会**多出一整套重复事件**，且无法撤销。
 *
 *   → 必须由调用方传入**确定性** UID：对 `(学期 key, courseTitle, startMs)` 做哈希，
 *     **绝不能**包含导出时刻、随机数或数组下标。实测：显式传 `uid` 后两次生成逐字相同。
 *
 *   ⚠ 另一个坑：课程改名 / 调课时间会产生**新 UID**，旧事件留在日历里。这是可接受的
 *     （删不掉别人的日历事件），但 UI 必须提示「改了时间会多出一条，需手动删除旧的」，
 *     不许静默。
 *
 *   @param {{ termKey: string, courseTitle: string, startMs: number }} item
 *   @returns {string} 形如 `<hash>@dsh-zhiyun`
 */
export function stableUid(item) {
  throw new Error('候选骨架：stableUid() 未实现（见 README，未评审）');
}

/**
 * TODO-D · 时区输出策略 —— **必须由人拍板**。
 *
 *   实测 `ics@3.12.1` 只有两条路，**没有第三条**：
 *
 *   | 组合 | 产出 | 后果 |
 *   | --- | --- | --- |
 *   | `startInputType:'local'` + `startOutputType:'local'` | `DTSTART:20261026T080000` | **浮动时间**，无 `TZID`。导入到别的时区会「按当地 8 点」显示 → 对交换生 / 出差的用户是错的 |
 *   | `startInputType:'local'` + `startOutputType:'utc'` | `DTSTART:20261026T000000Z` | 时刻**是对的**，但显示为 UTC，部分客户端会显示成「凌晨」；且**不写 VTIMEZONE** |
 *   | 传 `timezone: 'Asia/Shanghai'` | **报错** `this field has unspecified keys: timezone` | 上游不支持 VTIMEZONE |
 *
 *   本包的建议：**走 UTC**（第二条）。理由是「时刻正确」优先于「显示好看」，
 *   且 RFC 5545 明确 UTC 形式无需 VTIMEZONE。**若产品要求必须在日历里显示北京时间**，
 *   则 `ics` 不满足需求，需换 `ical-generator@11.1.2`（MIT，支持 `timezone` 参数）
 *   或 `node-ical` —— 属于**换上游**，不在本骨架范围内。
 *
 *   @param {number} ms
 *   @param {'utc'|'local'} mode
 *   @returns {{ parts: number[], inputType: 'local', outputType: 'utc'|'local' }}
 */
export function timeShape(ms, mode) {
  throw new Error('候选骨架：timeShape() 未实现（见 README，未评审）');
}

/**
 * TODO-E · 未知字段会被**整条拒绝**。
 *
 *   实测：多传一个 `id` → `ValidationError: this field has unspecified keys: id`，
 *   **整条事件生成失败**，不是被忽略。yup schema 是 `noUnknown()` 的。
 *
 *   所以调用方**不能**直接把本仓的条目对象（含 `day` / `courseTitle` / `startMs` 等）
 *   摊平传进去，必须先映射成上游认识的字段白名单。建议在 `src/index.js` 里
 *   显式列出这个白名单，多一个字段都不传。
 */
export const UNKNOWN_KEYS_ARE_REJECTED = true;
