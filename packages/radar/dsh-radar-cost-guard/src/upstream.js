/**
 * 上游 `@tomjerrygit/dsh-cost-guard@0.1.0` 的封装占位（A 类骨架）。
 *
 * # 只封装「什么」，不复制「怎么做」
 *
 * 上游把「读用量」「算钱」「改设置」「切模型」「起 HTTP 路由」「注册侧边栏面板」
 * 全写在同一个 `index.js`（20 KB）里。本骨架只打算复用其中**两件纯事**：
 *
 *   1. `collectUsage` 的归一化口径：
 *      `inputMiss = uncachedInputTokens + cacheWriteTokens`、
 *      `inputHit  = cacheReadTokens`、`output = outputTokens`；
 *   2. `costOf(tokens, pricing)`：按「每百万 token 单价」折算，保留 6 位小数。
 *
 * 这两件事都是**形状转换与算术**，与宿主生命周期无关，可以直接对照重写；
 * 其余部分（路由、面板、设置页、省钱模式、模型发现）**不接管** ——
 * 它们是上游作为一个独立侧边栏插件的自我实现，接进来就是「重复且无增益」。
 *
 * # 许可证
 *
 * MIT（仓内 `LICENSE` 首行 `MIT License / Copyright (c) 2026 TomJerryGit`，
 * npm `0.1.0` 的 `license` 字段同为 MIT，2026-11-11 双处核）。
 * 借鉴实现时按 CONTRIBUTING 3.3 在 `ATTRIBUTION.md` 记账。
 */

/** 锁版坐标：写死版本，**不用 `^`**。 */
export const UPSTREAM = {
  name: '@tomjerrygit/dsh-cost-guard',
  version: '0.1.0',
  license: 'MIT',
  repository: 'https://github.com/TomJerryGit/dsh-cost-guard',
  /** 只取这两件事，其余不接管。 */
  reuse: ['collectUsage-token-shape', 'costOf-per-million'],
  notReuse: [
    'webServer /cost-guard/* 只读路由',
    'sidebar.panellist 面板注册',
    'savings mode / 模型发现 / 设置页',
  ],
};

/**
 * TODO：从这里 `import('@tomjerrygit/dsh-cost-guard')` 取上游两件纯事。
 *
 * 骨架阶段返回 `null` —— 评审通过前任何调用方都应拿到 `null` 并自行兜底。
 *
 * @returns {Promise<null>}
 */
export async function loadUpstream() {
  return null;
}

/**
 * TODO：按上游口径把一条用量记录归一成 `{ inputMiss, inputHit, output }`。
 *
 * 上游实现（`index.js:184-188`）：
 * ```
 * const tokens = {
 *   inputMiss: num(totals.uncachedInputTokens) + num(totals.cacheWriteTokens),
 *   inputHit:  num(totals.cacheReadTokens),
 *   output:    num(totals.outputTokens),
 * };
 * ```
 * 其中 `num()` 对任何非有限数返回 0 —— 这条容错必须保留（宿主字段可能缺失）。
 *
 * @param {object} totals 宿主 `session_projcache` 里的 `tokenUsage.val.totals`
 * @returns {{ inputMiss: number, inputHit: number, output: number } | null}
 */
export function normalizeTokens(totals) {
  void totals;
  return null;
}

/**
 * TODO：按「每百万 token 单价」折算成本。
 *
 * 上游实现（`index.js:134-136`）：
 * ```
 * (inputMiss * pricing.inputMiss + inputHit * pricing.inputHit + output * pricing.output) / 1000000
 * ```
 * 保留 6 位小数。**单价必须来自配置**，不得写死（见 `src/index.js` TODO-3）。
 *
 * @param {{ inputMiss: number, inputHit: number, output: number }} tokens
 * @param {{ inputMiss: number, inputHit: number, output: number }} pricing
 * @returns {number | null}
 */
export function costOf(tokens, pricing) {
  void tokens;
  void pricing;
  return null;
}
