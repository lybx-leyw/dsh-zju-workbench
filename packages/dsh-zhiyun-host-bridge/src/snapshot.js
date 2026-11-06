/**
 * AI 规划数据的导出快照。
 *
 * # 这一层解决什么
 *
 * Celechron 是独立的 Flutter App，它跑在手机/桌面上，**拿不到**本仓的这些数据：
 * 学在浙大待办、拼题A 题集、中转站条目、用户自己写的规划。
 *
 * 而这个仓库里它们已经在内存/磁盘上了。所以这里做一件事：把它们**归一成一份
 * 对方能直接消费的 JSON**，交给局域网服务器推给手机。
 *
 * # 为什么是纯函数
 *
 * `collect()` 里除了读四个来源，剩下的全是"把 A 形状改成 B 形状"。那部分是
 * 最容易写错、也最容易被上游改动悄悄带偏的（字段改名、null 变 undefined）。
 * 抽成纯函数才能被测试钉住，也让移动端同事能直接看这个文件知道契约。
 *
 * # 契约版本
 *
 * `CONTRACT_VERSION` 变了就意味着 Celechron 侧必须同步改。**只加字段不算破坏**，
 * 改名字/改语义才算 —— 那种情况必须升版本，否则旧 App 会安静地读错数据。
 */

/** 快照格式版本。Celechron 侧应当校验它。 */
export const CONTRACT_VERSION = 1;

/**
 * 一个条目在快照里的形状。
 *
 * @typedef {object} ExportedItem
 * @property {string} id - 跨来源唯一键，形如 `xzzd:123` / `pta:456` / `relay:abc` / `mine:xyz`
 * @property {string} source - `xzzd` | `pta` | `relay` | `mine`
 * @property {string} sourceLabel - 给人看的来源名
 * @property {string} title - 标题
 * @property {string} detail - 副标题（课程名 / 组织名 / 来源条目标题）
 * @property {string|null} due - ISO 时间串；**没有截止时间时为 null**
 * @property {string|null} dueText - 原始的截止文案（可能比 ISO 更有信息量）
 * @property {string|null} url - 平台链接
 * @property {string} kind - `todo` | `problemSet` | `note` | `plan`
 * @property {boolean} done - 是否已完成（本地勾选 / 规划页勾选）
 * @property {string|null} action - 规划卡片的"要做什么"（只有 mine/relay 拆出的卡片有）
 */

/** 来源 → 显示名。 */
const SOURCE_LABELS = Object.freeze({
  xzzd: '学在浙大',
  pta: '拼题A',
  relay: '中转站',
  mine: '我的规划',
});

/**
 * 把 `normalizeXzzd` / `normalizePta` 那一套形状转成快照形状。
 *
 * 上游（campus）已经把它们归一成
 * `{ source, sourceLabel, id, title, detail, due, dueText, url, kind }`，
 * 这里只做字段改名与 `id` 加来源前缀，不改语义。
 *
 * @param {Array<object>} rows - campus 归一后的待办/题集。
 * @param {object} options
 * @param {Map<string, object>} options.ticks - `key → { doneAt }`，本地勾选。
 * @returns {ExportedItem[]}
 */
export function fromCampusRows(rows, { ticks = new Map() } = {}) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const source = String(row?.source ?? '').trim();
    if (!source) continue;
    const rawId = String(row?.id ?? '').trim();
    // 没有 id 的条目不能导出：跨来源去重、勾选状态全靠它。
    if (!rawId) continue;
    const id = `${source}:${rawId}`;
    out.push({
      id,
      source,
      sourceLabel: row?.sourceLabel ?? SOURCE_LABELS[source] ?? source,
      title: String(row?.title ?? '').trim() || '(无标题)',
      detail: String(row?.detail ?? '').trim(),
      due: normalizeIso(row?.due),
      dueText: row?.dueText == null ? null : String(row.dueText),
      url: row?.url == null ? null : String(row.url),
      kind: String(row?.kind ?? 'todo'),
      done: ticks.has(id),
      action: null,
    });
  }
  return out;
}

/**
 * 规划卡片 → 快照条目。
 *
 * 卡片来自两种地方：
 *   - 中转站条目被 AI 拆出来的（`plans.json`，键是源条目前缀）；
 *   - 用户自己写的规划被拆出来的（`local.js` 的 `mine.split`）。
 *
 * 两者形状一样：`{ title, action, due, sourceTitle, tags }`，外加 `done`。
 *
 * ⚠️ **`due` 允许为 null**：模型被明确要求"原文没写时间就留空，不要硬凑"。
 * 快照如实传递 null，由 Celechron 决定怎么处理（跳过或建无期限任务）。
 *
 * @param {Array<{ prefix: string, cards: Array<object> }>} groups
 * @param {object} options
 * @param {string} options.source - `relay` 或 `mine`
 * @param {string|((prefix: string) => string)} options.detailOf - 每组的副标题
 * @returns {ExportedItem[]}
 */
export function fromCards(groups, { source = 'mine', detailOf = () => '' } = {}) {
  if (!Array.isArray(groups)) return [];
  const out = [];
  for (const group of groups) {
    const prefix = String(group?.prefix ?? '');
    const cards = Array.isArray(group?.cards) ? group.cards : [];
    const detail = typeof detailOf === 'function' ? detailOf(prefix) : String(detailOf ?? '');
    cards.forEach((card, index) => {
      const title = String(card?.title ?? '').trim();
      if (!title) return;
      out.push({
        // 卡片的身份 = 源条目前缀 + 它在数组里的位置。`plans.js` 里勾选状态
        // 就是按 `cards[i]` 存的，所以位置是稳定身份的一部分。
        id: `${source}:${prefix}#${index}`,
        source,
        sourceLabel: SOURCE_LABELS[source] ?? source,
        title,
        detail: String(card?.sourceTitle ?? detail ?? '').trim(),
        due: normalizeIso(card?.due),
        dueText: null,
        url: null,
        kind: 'plan',
        done: card?.done === true,
        action: card?.action == null ? null : String(card.action),
      });
    });
  }
  return out;
}

/**
 * 校验收成 ISO —— 但**不接受**当年 1 月 1 日那种"纪元哨兵"。
 *
 * 中转站/拼题A 都会用 `1970-01-01` 表示"没有时间"。直接透传会让对方显示成
 * "1970 年截止"。这里统一转成 null。
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeIso(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  const year = new Date(at).getUTCFullYear();
  if (year <= 1970) return null;
  return new Date(at).toISOString();
}

/**
 * 组装整份快照。
 *
 * 各来源**互不依赖**，所以某一处坏了不该让整份导出失败 —— 每个来源单独 try，
 * 失败就把出错信息放进 `errors`，其余照常导出。
 *
 * @param {object} input
 * @param {Array<object>} [input.xzzd] - campus 的学在浙大待办
 * @param {Array<object>} [input.pta] - campus 的拼题A 题集
 * @param {Array<object>} [input.relayCards] - 中转站拆出的卡片组
 * @param {Array<object>} [input.mineCards] - 我的规划拆出的卡片组
 * @param {Map<string, object>} [input.ticks] - 本地勾选
 * @param {object} [input.errors] - 各来源的读取错误
 * @param {number} [input.now] - 毫秒时间戳，注入以便测试
 * @returns {object} 快照
 */
export function buildSnapshot({
  xzzd = [],
  pta = [],
  relayCards = [],
  mineCards = [],
  ticks = new Map(),
  errors = {},
  now = Date.now(),
} = {}) {
  const items = [
    ...fromCampusRows(xzzd, { ticks }),
    ...fromCampusRows(pta, { ticks }),
    ...fromCards(relayCards, {
      source: 'relay',
      // 中转站卡片的副标题用"它来自哪条原文"，方便用户核对
      detailOf: (prefix) => prefix,
    }),
    ...fromCards(mineCards, {
      source: 'mine',
      detailOf: () => '我的规划',
    }),
  ];

  // 有 due 的按时间升序在前，没 due 的排到最后（它们没有紧迫性可言）。
  items.sort((a, b) => {
    const av = a.due ? Date.parse(a.due) : Infinity;
    const bv = b.due ? Date.parse(b.due) : Infinity;
    if (av !== bv) return av - bv;
    return a.title.localeCompare(b.title, 'zh');
  });

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: new Date(now).toISOString(),
    counts: {
      total: items.length,
      withDue: items.filter((item) => item.due != null).length,
      withoutDue: items.filter((item) => item.due == null).length,
      done: items.filter((item) => item.done).length,
      bySource: countBySource(items),
    },
    items,
    /** 某个来源没读到时的说明。**空对象表示全部正常**。 */
    errors,
  };
}

function countBySource(items) {
  const out = {};
  for (const item of items) {
    out[item.source] = (out[item.source] ?? 0) + 1;
  }
  return out;
}
