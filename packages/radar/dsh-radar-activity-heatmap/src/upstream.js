// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 上游封装占位 —— 效法 packages/dsh-zhiyun-host-paper/src/upstream.js 的组织方式。
//
// 本文件**不含任何上游源码**，仅预留「把 react-activity-calendar 包成本仓可用组件」的接缝。
// 上游全部实现来自 react-activity-calendar（MIT），锁版 3.2.1。
//
// 设计原则（与 dsh-zhiyun-host-paper/src/upstream.js 一致）：
//   - 上游只被本文件 import，其余代码只依赖本文件导出的稳定接口；
//   - 上游 API 变更时，改动收敛在本文件内；
//   - 绝不复制上游实现进来（尤其**不要**学 `fishdev20/shadcn-heatmap` 的 copy-paste 范式）。
//
// 上游实测面（2026-10-24 直查 registry.npmjs.org，非镜像）：
//   version          3.2.1
//   license          MIT
//   type             module
//   exports          { ".": "./build/index.js", "./tooltips.css": "./build/tooltips.css" }
//   peerDependencies { react: "^18.0.0 || ^19.0.0" }
//   dependencies     { date-fns: "^4.2.1", "@floating-ui/react": "^0.27.19" }
//   modified         2026-07-07
//
// ⚠ 本仓锁的是 **CommonJS / esbuild CJS 产物**（`build.mjs` 的 `format: 'cjs'`），
//   上游是 ESM 且 `type: module`。esbuild 能处理，但**必须在 TODO-B-1 里实测**，
//   不要假设它会顺滑。
//
// TODO（采用前必须完成）：
//   1. 确认 3.2.1 的导出符号：默认导出是组件还是命名导出？`Activity` 的数据形状是
//      `{ date: 'YYYY-MM-DD', count: number, level: 0..4 }` 吗？`level` 是自动推还是要求调用方给？
//   2. `level` 的语义是本包要断的事：本仓的「一天做几道题」没有天然 0..4 分档，
//      映射规则（按当日最大值等比？按学期分位？）应当**写在这里并导出**，
//      这样「格子颜色怎么来的」只有一处定义。
//   3. 上游若要 `theme`（颜色）配置，一律取 `dsh-zhiyun-shell-ui` 的设计令牌，
//      **不要**在包内写死色值 —— 本仓换主题时热力图必须跟着换。
//   4. 失败降级：数据源读不出来时渲染**一行说明**，不要让「个人」页整体空白
//      （本仓已有先例：`Zhiyun` 各页面在数据缺失时给可读提示，而不是抛错）。

/** 上游在 npm 上的包名（与 `package.json` 的依赖键逐字符相同）。 */
export const UPSTREAM_PACKAGE = 'react-activity-calendar';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同（不用 `^`）。 */
export const UPSTREAM_VERSION = '3.2.1';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/grubersjoe/react-activity-calendar';

/** 上游许可证：MIT。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游的传递依赖（**本骨架唯一的真实成本**）。
 *
 * 这两个包会撞本仓 `tests/build-seeds.test.mjs` 的「零 node_modules 进包」断言 ——
 * 三种走法见 `src/index.js` 的 TODO-B-1，**裁决前不要接进 profile**。
 */
export const UPSTREAM_RUNTIME_DEPS = Object.freeze([
  'date-fns@^4.2.1',
  '@floating-ui/react@^0.27.19',
]);

// TODO: 上游加载与组件封装（示意，未实现）
// import ActivityCalendar from 'react-activity-calendar';
// export function ActivityHeatmap({ entries }) { /* entries -> Activity[] -> <ActivityCalendar/> */ }
//
// TODO: 日粒度聚合（纯函数，应在本地实现并测）
// export function toDailyCounts(attempts, sessions, { timeZone: 'Asia/Shanghai' }) { /* … */ }
