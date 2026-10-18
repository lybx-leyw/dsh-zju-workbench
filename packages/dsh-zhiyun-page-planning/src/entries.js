/**
 * 中转站条目的**内容前缀**——去重与「源条目 → 卡片」映射共用的键。
 *
 * 为什么用内容而不是 `seq`：中转站是 append-only 且可能被重建（seq 会变），
 * 而内容前缀跨重建稳定。本地留存与 AI 规划两处必须用**同一个键口径**，
 * 否则会出现"这条已经拆过了，但页面认为没拆"这种对不上的状态。
 *
 * 取 `kind + title + text` 的前 N 字符：
 *   - 太短（只用 title）会把"同一天的两条日记"误判成同一条；
 *   - 太长（全文）会让用户改一个错别字就变成"新的一条"。
 */
export const DEDUPE_PREFIX = 40;

/**
 * @param entry - 中转站返回的一条。
 * @returns 稳定的去重键。
 */
export function entryPrefix(entry) {
  const kind = String(entry?.kind ?? '');
  const title = String(entry?.title ?? '').trim();
  const text = String(entry?.text ?? '').replace(/\s+/g, ' ').trim();
  return `${kind}\u0000${title}\u0000${text}`.slice(0, DEDUPE_PREFIX);
}
