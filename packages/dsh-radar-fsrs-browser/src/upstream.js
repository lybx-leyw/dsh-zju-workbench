// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 上游封装占位 —— 效法 packages/dsh-zhiyun-host-paper/src/upstream.js 的组织方式。
//
// 本文件**不含任何上游源码**，仅预留「把 fsrs-browser 的能力包成本仓可用接口」的接缝。
// 上游全部实现来自 fsrs-browser（BSD-3-Clause），锁版 6.6.0。
//
// 设计原则（与 dsh-zhiyun-host-paper/src/upstream.js 一致）：
//   - 上游只被本文件 import，其余代码只依赖本文件导出的稳定接口；
//   - 上游 API 变更时，改动收敛在本文件内；
//   - 绝不复制上游实现进来。
//
// TODO（采用前必须完成）：
//   1. 确认 fsrs-browser 6.6.0 的导出符号（见上游 fsrs_browser.d.ts），
//      在本文件内做一次「上游 → 本仓」的命名映射。
//   2. 确认 WASM 资产在宿主（Electron/Web 打包）下的加载方式：
//      是否需要把 .wasm 作为静态资源随包发布；失败时应有可读的降级错误。
//   3. 初始化失败（WASM 不可用）时的降级策略：回退到纯 TS 算法实现，
//      而不是让「学习」页整体不可用 —— 这是本方案必须验证的健壮性前提。

// export const UPSTREAM = {
//   name: 'fsrs-browser',
//   version: '6.6.0',
//   license: 'BSD-3-Clause',
//   repository: 'https://github.com/open-spaced-repetition/fsrs-browser',
// };

// TODO: 上游加载与降级
// export async function loadUpstream() { /* 动态 import + WASM 初始化 + 失败降级 */ }
