/**
 * 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
 *
 * 上游封装占位：A 类「锁版挂载」的**唯一**与上游打交道的地方。
 *
 * 规矩（沿用 `dsh-zhiyun-paper` 的做法）：
 *   - 只在这里 `import` 上游；本包其它文件一律不直接引用上游路径，
 *     这样上游换版本、换导出形状时，改动面只有这一个文件；
 *   - **不改上游源码**，不打 patch，不 vendor `node_modules`；
 *   - 上游是 ESM（`"type": "module"`，`exports` 里有 `.` / `./client`），
 *     本包也是 ESM，直接静态 import 即可，不做动态兜底。
 */

const NOT_REVIEWED =
  'dsh-radar-mistake-book 是候选骨架：未评审、未接入 profile、不可直接使用。';

/**
 * TODO-4 · 把上游的挂载做成一件事
 *
 * 上游补丁 id 是 `ai-mistake-book`、name 是 `ai-mistake-book`（见上游 `cordis.patch.yml`）。
 * 本包不重复插入上游那一行，而是**把上游当依赖、由本包整体挂载** ——
 * 评审时需确认这样不会与用户自己 `dsh plugin add` 装的上游**双挂**。
 *
 * @param {object} _ctx cordis 上下文
 * @returns {Promise<void>} TODO 未实现
 */
export async function mount(_ctx) {
  throw new Error(NOT_REVIEWED);
}

/**
 * TODO-5 · 上游版本与本仓 peer 基线的对照
 *
 * 上游 `engines.dsh >= 0.2.1-rc.2`，peer 依赖三个 `@deepseek-ai/dsh-client-*`（可选）。
 * 本仓 profile 的 DSH 版本一旦低于这个下界，**挂载前就要失败**，
 * 而不是等到第一次 `/mistake` 才发现。
 *
 * @param {string} _dshVersion
 * @returns {{ok: boolean, reason?: string}} TODO 未实现
 */
export function checkEngines(_dshVersion) {
  throw new Error(NOT_REVIEWED);
}

export default { mount, checkEngines };
