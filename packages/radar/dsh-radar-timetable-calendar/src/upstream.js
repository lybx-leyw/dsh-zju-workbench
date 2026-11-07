/**
 * 上游 `ecnu-timetable-calendar` 的**唯一**引用点 —— 上游凭据只在本文件出现一次。
 *
 * 本文件是占位：**不 import 上游代码**，只把「仓库 / 参考版本 / 许可证 / 可借鉴文件 / 已知坑」
 * 写死在这里，供评审者对照。评审通过后再实现 `normalizeText()` 等纯函数移植。
 *
 * ── 为什么没有 `UPSTREAM_PACKAGE` / `UPSTREAM_VERSION` ──────────────────
 *
 * 上游是**浏览器扩展**，`package.json` 里 `"private": true` → **未发布到 npm**，
 * 无法锁版引入。这与 A 类（原生 DSH 插件包，锁版挂载）本质不同：
 *
 *   A 类：`dependencies` 写死版本 → 锁版挂载 + 外围兼容层
 *   B 类：只能**源码级借鉴** → 必须在 ATTRIBUTION.md 记录来源与许可
 *
 * 因此本包归属 **B 类（其他 JS 项目）**，不是 A 类。
 */

/** 源码仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/marioMLLL/ecnu-timetable-calendar';

/**
 * 参考版本：`package.json` 的 `version` 字段为 `1.9.1`。
 *
 * 移植时请以该版本为基准；若上游后续升级，须重新核对 `parseWeekSpec()` 的边界行为。
 */
export const UPSTREAM_REVISION = '1.9.1';

/** 许可证：MIT（GitHub `spdx_id` = MIT，仓库 `LICENSE` 为完整 MIT 正文，2026 版权）。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 允许借鉴的**白名单文件**（仅此三处，其余一律不动）。
 *
 *   lib/schedule-core.js  —— 纯函数：`normalizeText()` / `parseWeekSpec()` / `parseApiTimetable()`
 *                            （UMD 包装，无 DOM 依赖，可直接搬纯函数）
 *   lib/mobile-payload.js —— 二维码导入的 lz-string 压缩思路（**仅思路**，本项目暂不需要）
 *   popup.js              —— `.ics` 属性写法：`VALARM` / `VTIMEZONE` / `TRANSP`（**仅思路**）
 *
 * **禁止搬运**：`content.js`、`api-hook.js`、`manifest.json`、`popup.html/css`、
 * `mobile/`、`vendor/` —— 这些是华师大专属的浏览器扩展外壳与品牌 UI，
 * 与浙大课表面板无关，搬了就是「简单集成」。
 */
export const UPSTREAM_ALLOWED_FILES = Object.freeze([
  'lib/schedule-core.js',
  'lib/mobile-payload.js',
  'popup.js',
]);

/**
 * TODO-A · 移植 `normalizeText(text)`。
 *
 *   上游实现（`lib/schedule-core.js`）做了六件事，缺一不可：
 *
 *     1. `\u00a0` → 半角空格（教务系统富文本常见不换行空格）
 *     2. 全角 `（` `）` → `(` `)`
 *     3. `～ — － 至` → `~`        ← **P0，浙大课表常见全角波浪号**
 *     4. `，` → `,`
 *     5. 连续空格 / Tab 折叠为一个空格
 *     6. 行首尾空白 trim，`\s*\n\s*` → `\n`
 *
 *   移植时**不要**顺手加 `toLowerCase()` —— 中文课名大小写无意义，但英文课名会被改坏。
 */

/**
 * TODO-B · 移植 `parseWeekSpec(spec)`。
 *
 *   上游关键顺序（照抄，不要「优化」）：
 *
 *     a. 先 `normalizeText(spec).replace(/第/g, '')`  —— **先剥「第」再切逗号**（P0）
 *     b. 按 `[,、]` 切段
 *     c. 每段先探 `单` / `双` → `parity = 1 / 0`
 *     d. 剥掉 `[()周单双]` 后匹配 `^\d{1,2}\s*[~-]\s*\d{1,2}$` 或 `^\d{1,2}$`
 *     e. 区间逐周 push，`week <= 30` 封顶（一学期上限），按 `parity` 过滤
 *
 *   ⚠ 上游的两处**已知不足**，移植时需在本项目侧补：
 *
 *     · 区间单调性未校验：`16~3` 会产出空数组且**不报错** → 应记录进 `unparsed[]`
 *     · 上限硬编码 30：浙大部分专业有夏季短学期（第 31+ 周）→ 应改为参数
 */

/**
 * TODO-C · 判断上游是否有可复用的「课表接口 → 课程对象」映射。
 *
 *   `parseApiTimetable()` 依赖华师大接口的 `lessons[].scheduleText.dateTimePlaceText.textZh`
 *   结构，**浙大教务接口结构不同**（`dsh-zhiyun-*` 侧已有自己的取数路径）。
 *
 *   结论：**只借鉴 `parseWeekSpec()` 这一层的字符串解析**，
 *   `parseApiTimetable()` **不移植** —— 移植了就是给错误的数据结构写适配层。
 */
export function loadUpstream() {
  // 占位：B 类无可锁版上游，此函数仅用于标注「移植点」。
  throw new Error(
    'dsh-radar-timetable-calendar：B 类候选，无可锁版上游；请直接移植纯函数（TODO-A/B），不要在此做动态加载。',
  );
}
