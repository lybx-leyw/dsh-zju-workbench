/**
 * dsh-radar-note-fulltext —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 给「笔记」页的**目录过滤框**补一层**正文**全文索引。
 *
 * 现状（`packages/dsh-zhiyun-page-notes/src/client.jsx:128-131`，本轮逐行读过）：
 *
 *     return entries
 *       .filter((e) => e.type !== 'folder' && `${e.path}`.toLowerCase().includes(query))
 *
 * 只看**路径**。也就是说：一篇叫「第四章 导论.md」的笔记，正文里写了十遍「拉格朗日」，
 * 搜「拉格朗日」**一篇都出不来**。这不是「排序不够好」，是「搜不到」——
 * 本仓 `dsh-zhiyun-core-vault` 的 `buildIndex()` 建的是**链接/标签**索引
 * （`notesMap.set(path, { path, title, outlinks, tags })`），**不保留正文**；
 * `dsh-zhiyun-core-knowledge` 的 `search()` 是**字面** `String.includes`，
 * 且只覆盖 `core-knowledge` 自己的域，与笔记库不是同一批数据。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条逐条核对）─────────────
 *
 *   1. **仍是同一个面板** —— 还是「笔记」页左上角那个过滤框，不新增页面、
 *      不新增搜索入口、不改导航。
 *   2. **功能仍相似正交** —— 同一个问题的两个面：「哪篇笔记**文件名**里有这个词」
 *      与「哪篇笔记**内容**里有这个词」。不是两套并列能力，是同一份结果集的口径扩展。
 *   3. **底层多调了更优质实现** —— 本仓现在这条链上**没有任何**正文索引
 *      （`client.jsx` 是 `.filter` + `.includes`，`vault-index.js` 不存正文）。
 *      clientside-search 提供倒排 + BM25 + 子串/模糊的**索引结构**：
 *      本轮实测 2000 篇 × ~600 字建索引 **286 ms**，单查询 **< 1 ms**。
 *
 * ⚠️ 但**判据③「更优质」目前是有折扣的**，必须在评审时正面处理：
 *
 *     · 上游**没有中文分词**（语言包只有 en/de/fr/es/ja），中文整串当一个 token；
 *     · `score` 是单查询内 min-max 归一化 —— 实测「守恒」打两篇等长文档，
 *       **两条都是 1.000**；一短一长也**都是 1.000**。
 *       → 它比现状强的是「**找得到**」，不是「**排得准**」。README 不许写成「相关度排序」。
 *
 * ── 现场证据（2026-10-28 实测，Node 22.13.1，见 §报告 E-1 ~ E-5）────────
 *
 * 直接 `npm i clientside-search@1.8.1` 后 import 跑的（不是照 README 复述）：
 *
 *   | 现象 | 实测 |
 *   | --- | --- |
 *   | `new SearchEngine(undefined)` | **抛 TypeError**（读 `stopwords` of undefined）→ 必须传语言包 |
 *   | `en.tokenizer('守恒')` | `['守恒']` → 中文整串一个 token，**不分词** |
 *   | 子串能否命中 | `行最简形` / `行 最简形` 都能命中「矩阵的秩」那篇 → **可命中** |
 *   | 只命中一篇时的分数 | 恒 `1.000` |
 *   | **只命中两篇及以上时的排序** | **全部 `1.000`，并列** → 排序层无效 |
 *   | `hydrateState()` | 返回 JSON 字符串，2000 篇约 **1.49 MB**，反序列化 **375 ms** |
 *   | ESM 体积 | `index.esm.js` 23,338 B + `en.esm.js` 14,042 B，**零 `dependencies`** |
 *
 * ── 集成方式（B 类：能力提取 + 封装）──────────────────────────────
 *
 *   ❌ 不改上游源码（`clientside-search` 只作为依赖引入）
 *   ❌ 不改 `client.jsx` 的过滤语义（路径命中必须**原样保留**，正文只是并集）
 *   ✅ 本包只 `provide` 一个服务，页面侧是否调用由**评审后**的改造决定
 *
 * @module dsh-radar-note-fulltext
 */

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION, ADOPTED_ENTRYPOINTS, UPSTREAM_CONSTRAINTS } from './upstream.js';

export const name = 'radar-note-fulltext';

/** 本包只 `provide` 一个服务，不 `inject` 任何宿主服务（与页面侧解耦，评审后可整体摘除）。 */
export const inject = [];

/**
 * TODO 清单 —— 评审通过后按序落实；**本骨架不含任何实现**。
 *
 * TODO-0（必须先裁决，不是技术问题）：**索引建在哪一侧**。
 *   现状 `buildRows()` 跑在**浏览器**（`client.jsx` 是 JSX 客户端组件），
 *   而正文要靠 `notes('read', { name })` **逐篇**取 —— 2000 篇就是 2000 次 IPC。
 *   三条路，评审先选：
 *     (a) **服务端建索引**（宿主的 notes 服务侧，一次 `tree` 顺带把正文喂进去）
 *         —— 查询快、无 IPC 风暴；代价是要动 `core-notes` 或新开一条路由。
 *     (b) **客户端建索引**（首屏异步 batcast 读正文，边读边 `addDocument`）
 *         —— 不动服务端；代价是首屏多一轮 IO，且大库会卡（实测 286 ms/2000 篇可接受，
 *            但 IPC 往返不是 286 ms）。
 *     (c) **只索引当前打开的标签页 + 最近 N 篇** —— 最省，但「搜不到」的问题只解一半。
 *   本骨架**不预设**，`apply()` 里留空位。
 *
 * TODO-1：语言包怎么给。必须 `import en from 'clientside-search/en'` 并显式传给
 *   `new SearchEngine(lang)`；**不得**因为「中文」就去 `import zh`（不存在，会 404）。
 *   若将来上游出中文包，本包升级需重跑 E-5 的计分差分。
 *
 * TODO-2：**路径命中与正文命中怎么合并**。建议：路径命中**置顶且不改序**
 *   （用户此刻输入的是文件名片段，语义优先），正文命中追加在后、按 `score` 降序、
 *   同分按 `path.localeCompare` 稳定排序。执行前必须用真实库证明：
 *   「原来能出的结果一个不少」（差分计数，与 `search-rank` 的 TODO-3 同一纪律）。
 *
 * TODO-3：**同分必须显式处理**。上游 min-max 归一化会让只命中 2 篇时的两条都是 1.000 ——
 *   若不做 tie-break，「按相关度排序」就是一句空话。可用的廉价信号：
 *   `match` 字段（`exact` > `partial` > `fuzzy`）、命中词数、`path` 字典序。
 *   **不得**改用 `index_title` 加权来伪造相关度（那是另一套 11 维/2×11 档位的事）。
 *
 * TODO-4：索引**何时失效**。`notes('write'/'create'/'remove'/'move'/'rename')` 都会改库
 *   （`client.jsx` 里这 6 个入口都存在）。上游只有 `removeDocument(id)`，
 *   且 `id` 是 `addDocument` 返回的**内容哈希**（同文本 → 同 id）。
 *   → 改一篇笔记就等于换了一个 id，必须先 `removeDocument(旧 id)` 再 `addDocument`。
 *   本骨架**不落盘**：`hydrateState()` 的 1.49 MB JSON 存哪、什么时候重建，
 *   评审时一并裁定；默认「每次库变化全量重建」，在 286 ms 量级是可接受的。
 *
 * TODO-5：**空查询与无结果的不变量**，逐条对齐本仓现有纪律：
 *   · 空查询 → **不发请求、不建索引**（上游 `search('')` 返回 `[]`，但不得退化成「返回全部」）；
 *   · 无结果 → 返回 `[]`，页面照常显示「没有匹配的笔记」，**不得**抛错。
 *
 * TODO-6：**逐条复核 `UPSTREAM_CONSTRAINTS`**（`src/upstream.js`），
 *   尤其第 3 条（score 恒 1.000）—— 它决定 TODO-3 是否是「必须」而不是「可选」。
 */
export function apply(ctx) {
  ctx.provide('radarNoteFulltext', {
    /** 上游标识（诊断用；不参与业务）。 */
    upstream: { package: UPSTREAM_PACKAGE, version: UPSTREAM_VERSION },

    /** 本包实际用到的上游入口（与 `upstream.js` 同源，便于评审核对）。 */
    entrypoints: ADOPTED_ENTRYPOINTS,

    /** 上游约束（诊断用；评审按 TODO-6 逐条复核）。 */
    constraints: UPSTREAM_CONSTRAINTS,

    /**
     * 建库级正文索引；**只建一次**，后续由 TODO-4 的失效策略驱动重建。
     *
     * @param {Array<{ path: string, markdown: string }>} _notes 全库笔记（含正文）
     * @returns {Promise<void>} 索引就绪
     * @throws {Error} 未实现 —— 评审通过后按 TODO-0 / TODO-1 / TODO-4 落实
     */
    async index(_notes) {
      throw Object.assign(new Error('radar-note-fulltext: 候选骨架，未实现（见 src/index.js TODO-0）'), {
        code: 'NOT_IMPLEMENTED',
      });
    },

    /**
     * 在**路径命中之外**补上正文命中。不删、不改路径命中的顺序。
     *
     * @param {Array<{ path: string, type: string }>} _entries `notes('tree')` 的返回值（只读）
     * @param {string} _query 用户输入（原样，不做 trim 之外的处理）
     * @param {Array<{ path: string }>} _pathHits `buildRows()` 已算好的路径命中（必须原样保留）
     * @returns {Array<{ path: string, source: 'path'|'body', score: number }>}
     * @throws {Error} 未实现 —— 评审通过后按 TODO-2 / TODO-3 / TODO-5 落实
     */
    async bodyHits(_entries, _query, _pathHits) {
      throw Object.assign(new Error('radar-note-fulltext: 候选骨架，未实现（见 src/index.js TODO-2）'), {
        code: 'NOT_IMPLEMENTED',
      });
    },
  });
}
