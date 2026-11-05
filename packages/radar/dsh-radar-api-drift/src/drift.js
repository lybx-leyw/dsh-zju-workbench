/**
 * 版本漂移的**形状**（骨架，未实现；纯函数，无 IO）。
 *
 * 评审要点：这里只定义「一行漂移长什么样」以及**判定优先级**，
 * 不定义数据从哪来（见 `index.js` 的 TODO-0）。把它挪进
 * `dsh-zhiyun-page-plugins` 也不需要改形状。
 */

/**
 * @typedef {object} DeclaredRange
 * @property {string[]} [peer]      `peerDependencies` 里与宿主相关的项，如 `["@deepseek-ai/cordis"]`
 * @property {string}   [engines]   `engines.node`，如 `">=22"`
 */

/**
 * @typedef {object} DriftRow
 * @property {string} name          包名
 * @property {'ok'|'stale'|'unknown'} verdict
 *   - `ok`：声明仍覆盖当前宿主；
 *   - `stale`：声明**不再**覆盖（如 `cordis <5` 而宿主 5.x）→ 该行值得报警；
 *   - `unknown`：读不到声明。**不显示成 `ok`** —— 本仓既有口径是「读不到就说读不到」。
 * @property {string} [reason]      人话解释，如「声明 cordis ^4.0.0，本机 5.1.2」
 */

/**
 * **占位**：按 semver 区间求值一条声明是否还覆盖某版本。
 *
 * 实现时必须用 `semver` 的 `satisfies()` 而不是字符串比较：
 * `>=4.0.0-rc.7 <5.0.0` 这类带 prerelease 的区间是活约束，字符串比较会误判。
 *
 * @param {string} declared  区间字符串
 * @param {string} actual    当前宿主版本
 * @returns {'ok'|'stale'|'unknown'}
 */
export function evaluate(declared, actual) {
  if (!declared || !actual) return 'unknown';
  return 'unknown'; // TODO：接 `semver.satisfies(actual, declared, { includePrerelease: true })`
}

/**
 * **占位**：把一包的全部声明折叠成一行。任一约束不满足即 `stale`。
 *
 * @param {string} name
 * @param {DeclaredRange} declared
 * @param {{node?: string, cordis?: string}} host
 * @returns {DriftRow}
 */
export function foldRow(name, declared, host) {
  void declared; void host;
  return { name, verdict: 'unknown' };
}

/**
 * **占位**：只查 `dist-tags.latest`，**不下载 tarball**。
 *
 * 唯一允许联网的地方。默认不调用；由用户点「检查更新」触发，结果必须带时间戳 ——
 * 与本仓「读不到就显示读不到，不显示 0」的既有口径一致。
 *
 * @param {string} pkg
 */
export async function fetchLatest(pkg) {
  void pkg;
  return null; // TODO：GET `https://registry.npmjs.org/<pkg>` → `dist-tags.latest`
}
