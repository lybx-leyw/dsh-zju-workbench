/**
 * 中转站条目的**去重键**——本地留存与「源条目 → 卡片」映射共用的口径。
 *
 * # 为什么用内容而不是 `seq`
 *
 * 中转站是 append-only 且可能被重建（seq 会变），而内容跨重建稳定。本地留存与
 * AI 规划两处必须用**同一个键口径**，否则会出现"这条已经拆过了，但页面认为没拆"。
 *
 * # 为什么不再用「拼起来取前 40 字」
 *
 * 早先的键是 `kind\0title\0text` 截前 40 个字符。中转站允许标题 200 字
 * （`deploy/relay-service/server.py` 的 `MAX_TITLE`），所以**标题一长，正文就
 * 一个字都进不了键**：
 *
 *   标题 40 字以上的两条不同日记 → 前缀完全相同 → 判成同一条 → 第二条被
 *   `mergeIncoming` 静默跳过，**不落盘**；如果它又被 AI 拆过，还会复用别人的卡片。
 *
 * 这不是"偶尔重复"的瑕疵，是**丢数据**：用户在别处写的日记，页面上一辈子看不到。
 *
 * # 现在的口径：整份内容取哈希
 *
 * `kind + title + text` 全量进 sha256，键 = `kind\0标题前若干字\0哈希`。
 *
 *   - **不撞键**：哈希覆盖全文，任意字段任意位置不同 → 键不同。不存在"截断导致
 *     两个不同条目同键"这一类故障。
 *   - **跨重建稳定**：不含 `seq` / `at` / `cachedAt`，只有内容。
 *   - 标题前若干字只是**给人看的**（`plans.json` 里能认出是哪条），不参与唯一性 ——
 *     唯一性完全由哈希保证。
 *
 * ⚠️ 这里刻意**不再**做「尾部微调算同一条」的模糊匹配。中转站是 append-only、
 * 只有追加没有更新，所以"用户改了一下重推"在对方那里本来就是**新的一条**；
 * 而我们把它合并掉，等于让页面永远停在旧版本。模糊匹配省下的那点重复，
 * 换来的是"编辑不生效"和"两条不同内容撞键"，不划算。
 */

import { createHash } from 'node:crypto';

/** 键里保留的标题字数（**只为可读**，唯一性靠哈希）。 */
export const KEY_TITLE_CHARS = 24;

/** 哈希取多少位十六进制。128 位，对"一个人的日记条数"这个量级远超需要。 */
const DIGEST_CHARS = 32;

/**
 * 把一条内容的三个字段规整成**同一个口径**的字符串。
 *
 * 抽出来是为了让"计算新键"与"迁移旧键"用完全相同的归一化：
 * 一边 `trim()` 一边不 `trim`，迁移就会漏掉本该匹配上的条目。
 *
 * @param entry - 中转站条目（或本地留存的条目）。
 * @returns `{ kind, title, text }`，均已规整。
 */
export function normalizeFields(entry) {
  return {
    kind: String(entry?.kind ?? ''),
    title: String(entry?.title ?? '').trim(),
    // 正文里的换行/连续空白不参与区分：同一条内容在不同途径回读时，
    // 行尾空格、CRLF 之类不该让它变成"新的一条"。
    text: String(entry?.text ?? '').replace(/\s+/g, ' ').trim(),
  };
}

/**
 * 内容的完整指纹。
 *
 * @param entry - 中转站条目。
 * @returns 32 位十六进制串。
 */
export function contentDigest(entry) {
  const { kind, title, text } = normalizeFields(entry);
  return createHash('sha256')
    .update(`${kind}\u0000${title}\u0000${text}`, 'utf8')
    .digest('hex')
    .slice(0, DIGEST_CHARS);
}

/**
 * 一条内容稳定的去重键。**同一条内容恒等，不同内容必然不同。**
 *
 * @param entry - 中转站返回的一条。
 * @returns 稳定的去重键。
 */
export function entryPrefix(entry) {
  const { kind, title } = normalizeFields(entry);
  return `${kind}\u0000${title.slice(0, KEY_TITLE_CHARS)}\u0000${contentDigest(entry)}`;
}

/**
 * **旧版**键口径：`kind\0title\0text` 截前 40 个字符。
 *
 * 只用来做**一次性迁移**：老的 `entries.json` 里存着旧键，老的 `plans.json`
 * 用旧键当映射的键。不迁移的话，升级后同一批内容会算出新键、匹配不上旧记录，
 * 结果是「本地每条都重复一份」+「所有条目被重新拆一遍（花钱）」。
 *
 * 新代码不该调用它 —— 除了迁移与"确实要复现旧行为"的测试。
 *
 * @param entry - 中转站条目。
 * @returns 旧口径的键。
 */
export function legacyEntryPrefix(entry) {
  const { kind, title, text } = normalizeFields(entry);
  return `${kind}\u0000${title}\u0000${text}`.slice(0, LEGACY_DEDUPE_PREFIX);
}

/** 旧键口径的截断长度。仅为迁移保留。 */
export const LEGACY_DEDUPE_PREFIX = 40;

/**
 * 新键的历史名字。
 *
 * @deprecated 键已经不是"前缀"而是内容指纹了。保留这个导出只为不破坏既有
 * 调用方（`src/index.js` 的重新导出与测试），新代码请用 `entryPrefix`。
 */
export const DEDUPE_PREFIX = LEGACY_DEDUPE_PREFIX;
