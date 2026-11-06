/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 效法 `packages/dsh-radar-repeat-law/src/upstream.js`：把所有「上游长什么样、
 * 有什么怪癖」关在这一个文件里，让评审一眼看出边界。
 *
 * ⚠ 本轮做的是 **npm tarball 实物核对 + esbuild 实打包量体积 + 沙箱里跑上游的
 *   日期模块**；**没有**在浏览器里真渲染过一个格子（无 DOM 环境）。见 README「未做」。
 */

/**
 * 上游包名与版本 —— 与 `package.json.dependencies` 逐字一致，**写死不用 `^`**。
 *
 * ⚠ 为什么**不是** `7.1.3`（本轮的 `dist-tags.latest`）：
 *   v7 的 `fullcalendar@7.1.3` 实测 **4.1 MB** 解包内容、`dependencies` 含
 *   `preact` 与 `@full-ui/headless-calendar`，且 README 自述「connectors 自包含、
 *   不再需要 core」—— 那是一整套渲染框架的换代，不是一次网格算法的替换。
 *   本包只需要「月视图的日期网格」，v5 是**零依赖、可 UMD 直接进包**的最小形态。
 *   → 锁 v5 是**刻意降版**，不是漏查 `latest`。这一点必须由评审确认。
 */
export const UPSTREAM_PACKAGE = 'fullcalendar';

/** `dist-tags.latest`（2026-10-16 实查 `registry.npmjs.org/fullcalendar`）。 */
export const UPSTREAM_VERSION = '5.11.5';

/** 供人工复核对照。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/fullcalendar/fullcalendar';

/** 许可证：npm `package.json.license = "MIT"`；GitHub `license.spdx_id = MIT`；包内 `LICENSE.txt` 存在。三处一致。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 作者 / 维护者。 */
export const UPSTREAM_AUTHOR = 'Adam Shaw (fullcalendar.io)';

/**
 * v5.11.5 的**形状**（本轮逐条实测，不是读 README 得来的）：
 *
 * | 项 | 值 | 怎么核的 |
 * | --- | --- | --- |
 * | `main` | `main.js`（**UMD**，挂 `globalThis.FullCalendar`） | 包内文件首尾各读 300 B |
 * | `jsdelivr` | `main.min.js` | `package.json` 逐字 |
 * | `dependencies` | **{}** | `package.json` |
 * | `peerDependencies` | **{}** | `package.json` |
 * | 包内 `.js` 文件数 | **328** | `find | wc -l`（含 locales/） |
 * | 解包体积 | **1.5 MB** | `du -sh` |
 * | 样式 | `main.css` / `main.min.css`（**必须**由接入方自己引入，包不自动带） | 目录列表 |
 * | TypeScript 类型 | **无**（v5 是 JS；v6 起才随包发 `.d.ts`） | 目录列表无 `*.d.ts` |
 *
 * ⚠ **`main.js` 不能 `import { Calendar }`**（UMD 无 ESM 导出，esbuild 会警告
 * `import-is-undefined`）。正确用法是 `import 'fullcalendar/main.min.js'` 然后读
 * `globalThis.FullCalendar`，或者直接走 `<script>`。本包 `src/upstream.js` 的
 * `loadCalendarClass()` 就是按前者写的 —— 这是**接入约定**，不是可选项。
 */
export const UPSTREAM_SHAPE = Object.freeze({
  moduleFormat: 'umd-global',
  hasEsmExports: false,
  dependencies: 0,
  unpackedDiB: 1.5,
  shipsCss: true,
  shipsTypes: false,
});

/**
 * 本包**只看**月视图的四种时间单位（v5 的四种 `Duration` 实现之一）。
 *
 * 选择 `dayGridMonth` 的理由：它就是「7 列 × N 行、首尾补格」这一个几何问题，
 * 与本仓 `time.js:buildMonthCalendar()` 要算的东西**逐项一一对应**（见 README 对照表）。
 * 不选 `timeGrid*`（日内时刻轴）、不选 `list*`（列表视图）—— 那两处本仓没有对应物，
 * 接进来就是**新功能**，不是强化。
 */
export const UPSTREAM_VIEW = 'dayGridMonth';

/**
 * 取上游的 `Calendar` 构造函数（**占位，未实现**）。
 *
 * TODO-0 · 评审通过后按下列形状实现（约 12 行）：
 *   ① `await import('fullcalendar/main.min.js')`（side-effect import，不要解构）；
 *   ② 读 `globalThis.FullCalendar?.Calendar`；
 *   ③ 读不到就 `throw new Error('UPSTREAM_NOT_LOADED')` —— **不静默降级**。
 *      （对照：本仓 r57 记过 `dsh-kb-rag` 的「静默降级」形态，那是要避免的反面。）
 *
 * @returns {Function} 上游 `Calendar` 类
 */
export async function loadCalendarClass() {
  throw new Error('候选骨架：loadCalendarClass() 未实现（见 README，未评审）');
}

/**
 * 把上游抛的字符串错误翻成有 code 的错误（**占位，未实现**）。
 *
 * 上游 `Calendar` 构造参数错误时是 `throw new Error('...')`，没有 code、没有字段。
 * 本仓的 `localError(code, message)` 是带 code 的 —— 两者不能直接混用，
 * 否则上层 `catch` 无法区分「参数错」与「渲染错」。
 *
 * @param {unknown} err
 * @returns {Error & { code: string }}
 */
export function translateUpstreamError(err) {
  void err;
  throw new Error('候选骨架：translateUpstreamError() 未实现（见 README，未评审）');
}
