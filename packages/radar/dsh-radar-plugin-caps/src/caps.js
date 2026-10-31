/**
 * 能力清单的**纯数据形状**（占位，没有任何实现）。
 *
 * 本文件存在的目的只有一个：把「评审时该看哪几个字段」钉死，
 * 免得落地时又变成「装了什么插件」的第二个列表 —— 那是插件页**已经有**的东西。
 *
 * ⚠ 这是骨架：下列函数抛错，不返回任何数据。
 */

/** @typedef {{ tool: string, count: number, ms: number, errors: number }} LedgerRow */
/** @typedef {{ id: string, tools: string[], commands: string[], slots: string[] }} CapsRow */

/**
 * 把「一个已装插件」折成能力行。
 *
 * @param {{ id: string, tools?: string[], commands?: string[], slots?: string[] }} _pkg
 * @returns {CapsRow}
 */
export function capsRow(_pkg) {
  throw new Error('dsh-radar-plugin-caps: 候选骨架，未实现（见 src/index.js 的 TODO-0）');
}

/**
 * ⚠️ **应删**：本仓 `packages/dsh-zhiyun-page-plugins/src/usage.js` 已经有等价账本
 * （`count` / `lastUsed` / `STALE_DAYS`），这里再写一遍就是「重复且无增益」。
 * 保留它只是为了把「口径要对齐」这件事钉在评审记录里。
 *
 * 把账本按 `tool` 折叠成行。
 *
 * 口径要求（评审重点）：
 *   1. **跨会话**还是**当次会话**必须写在列头里，不能让用户猜（TODO-N）；
 *   2. `errors` 是「工具返回 isError」还是「抛异常」，二者不能混算（TODO-M）；
 *   3. `ms` 是**墙钟**还是宿主计的工具耗时，须与宿主 `dsh-client-usage` 的口径对齐
 *      —— 对不齐就是 registry 里反复记录过的那种「插件显示的数字和会话里对不上」。
 *
 * @param {Iterable<LedgerRow>} _rows
 * @returns {LedgerRow[]}
 */
export function foldLedger(_rows) {
  throw new Error('dsh-radar-plugin-caps: 候选骨架，未实现');
}

/**
 * ⚠️ **应删**（同 `foldLedger` 的理由）。
 *
 * 只列出「注册了东西、但一次也没被调用」的插件 —— 这才是账本真正的用处：
 * 找出**占着槽位却没在干活**的那几个。
 *
 * @param {CapsRow[]} _caps
 * @param {LedgerRow[]} _ledger
 * @returns {string[]}
 */
export function silentPlugins(_caps, _ledger) {
  throw new Error('dsh-radar-plugin-caps: 候选骨架，未实现');
}
