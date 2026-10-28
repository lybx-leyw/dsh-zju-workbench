/**
 * 插件 / 技能 / 工具的**使用计数**。
 *
 * # 这个文件从哪来
 *
 * 能力提取自生态雷达候选 `packages/radar/dsh-radar-knowledge-graph`
 * （上游 `dsh-knowledge-graph@0.1.3`，MIT）。**没有移植上游代码** —— 见下。
 *
 * # 为什么要先说明「上游不是它自称的那张图」
 *
 * 候选 README 把上游描述成「笔记的语义图 / documentId / LLM 抽取 / SQLite 持久化」。
 * 实测 0.1.3 的 `package.json` 与 README：
 *
 * > 可视化插件/技能/工具、依赖关系与使用统计
 *
 * `grep -ci 'note|语义|semantic|vault' lib/client.js` = **0**。
 * 它看的是**插件生态**，不是笔记。候选里那 6 条 TODO（路径↔documentId 映射、
 * 抽取产物写库、SQLite 豁免…）全部建立在这个错误前提上，**一条都不成立**。
 *
 * # 那还剩下什么
 *
 * 去掉误读之后，上游对本仓**唯一**的真空白是：**「这个工具我到底用过没有」**。
 * 本仓「插件」页（`Panel.jsx`）回答的是运行时**依赖拓扑**（谁依赖谁、能不能安全关掉），
 * 不回答**使用频率**。而上游的 `ensureNode/touch` 逻辑就是干这个的（`lib/index.js:43-57`）：
 * 每个节点记 `count` 与 `lastUsed`，据此判「吃灰」。
 *
 * 本文件只提取**这个判据**，实现为纯函数；不引入上游的 1854 行、不引入它的会话监听。
 * 上游其余能力（插件依赖边读 `peerDependencies`）本仓已有**更准**的运行时口径，不采纳。
 */

/** 「很久没用」的默认阈值：30 天。 */
export const STALE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 空账本。
 * @returns {{items: Map<string, {key: string, kind: string, name: string, count: number, lastUsed: number|null}>}}
 */
export function createLedger() {
  return { items: new Map() };
}

/**
 * 记一次使用。
 *
 * `key` 用 `kind:name` 而不是名字 —— 同名工具和服务是两回事，混在一起计数会失真。
 *
 * @param {ReturnType<typeof createLedger>} ledger
 * @param {{kind: string, name: string, at?: number}} event
 * @returns {boolean} 是否被采纳（`name` 缺失时返回 false，不产生脏节点）
 */
export function recordUse(ledger, event) {
  const kind = String(event?.kind ?? '').trim();
  const name = String(event?.name ?? '').trim();
  if (!kind || !name) return false;

  const key = `${kind}:${name}`;
  const at = Number.isFinite(event?.at) ? Number(event.at) : Date.now();
  const prev = ledger.items.get(key);
  if (prev) {
    prev.count += 1;
    prev.lastUsed = at;
  } else {
    ledger.items.set(key, { key, kind, name, count: 1, lastUsed: at });
  }
  return true;
}

/**
 * 判定某个条目是否「吃灰」。
 *
 * 三种状态分开，因为处置方式不同：
 * - `never`：一次都没用过 → 最该被看见的（上游 README 第 4 条痛点）
 * - `stale`：用过但超过阈值 → 可能只是最近没用到
 * - `active`：近期用过
 *
 * @param {{count: number, lastUsed: number|null}} item
 * @param {{now?: number, staleDays?: number}} [options]
 * @returns {'never'|'stale'|'active'}
 */
export function staleness(item, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const days = Number.isFinite(options.staleDays) ? options.staleDays : STALE_DAYS;
  const count = Number(item?.count) || 0;
  if (count === 0) return 'never';
  const last = Number(item?.lastUsed);
  // 没有时间戳但有计数：说明记录不完整，按 stale 处理而不是谎报 active。
  if (!Number.isFinite(last)) return 'stale';
  return now - last > days * DAY_MS ? 'stale' : 'active';
}

/**
 * 把账本整理成「可显示的清单」，吃灰的排前面。
 *
 * @param {ReturnType<typeof createLedger>} ledger
 * @param {{now?: number, staleDays?: number, known?: string[]}} [options]
 *   `known` 是「已安装但一次都没用过」的条目 —— 它们不在账本里，需要外部补进来。
 * @returns {object[]} 每项含 `key/kind/name/count/lastUsed/state`
 */
export function summarize(ledger, options = {}) {
  const rows = [];
  for (const item of ledger.items.values()) {
    rows.push({ ...item, state: staleness(item, options) });
  }

  // 安装清单里有、账本里没有的 → never。这是「吃灰」的主体，不能漏。
  for (const key of options.known ?? []) {
    const k = String(key);
    if (ledger.items.has(k)) continue;
    const [kind, ...rest] = k.split(':');
    rows.push({ key: k, kind, name: rest.join(':'), count: 0, lastUsed: null, state: 'never' });
  }

  // 排序：never → stale → active；同类里用得最少的在前。
  const order = { never: 0, stale: 1, active: 2 };
  return rows.sort((a, b) => (order[a.state] - order[b.state])
    || (a.count - b.count)
    || a.key.localeCompare(b.key));
}
