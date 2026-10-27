/**
 * dsh-radar-note-search-tokenizer —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 给「笔记」页（`dsh-zhiyun-page-notes`）的库内检索补**中文分词**。
 *
 * 现状（2026-10-26 读码 + 实跑）：
 *   `src/client.jsx` 的 `buildRows()` 过滤时只做
 *   `entries.filter((e) => e.type !== 'folder' && `${e.path}`.toLowerCase().includes(query))`
 *   —— **文件名子串匹配，正文不参与**。
 *
 *   `packages/dsh-radar-note-search/`（同日登记的兄弟骨架）要把 minisearch 接进来补「正文召回」，
 *   但它继承上游的默认分词：**只按空白/标点切**。中文没有空格 →
 *   整段标题成一个 token，查「数学」「泰勒」「线」全部 0 命中（`prefix: false`）；
 *   打开 `prefix: true` 只能命中「整段 token 的开头」，「中间的词」依然 0。
 *
 *   也就是说：**note-search 解决了「正文参不参与」，本包解决「参与了也搜不到中间的字」。**
 *
 * ── 为什么是「强化式集成」（三条判据逐条对照）────────────────────
 *
 *   1. **仍是同一个面板** —— 笔记页左侧资源管理器同一个过滤框（`zs-nt-filter`），
 *      不新增页面、不加按钮、不改导航。本包甚至**不碰 UI**：它只提供 `tokenize` 与实例工厂。
 *   2. **功能仍相似正交** —— 仍是「在一堆笔记里找某几篇」，问法没变；
 *      变的只是「怎样的字符序列算命中」。旧行为（文件名子串命中）**必须保留**（TODO-3），
 *      本包不允许让它消失。
 *   3. **底层多调了更优质实现** —— 上游 minisearch 提供倒排索引、字段加权、前缀、打分；
 *      本仓现状是**一次 `String.includes()`**，这三样一个都没有。本包不替换 minisearch，
 *      只是**替它补上它明确不做的那一层**（中文分词），属「底层更优实现」的最窄形态。
 *
 * ── 现场证据（2026-10-26 沙箱实跑，`minisearch@7.2.0`）──────────
 *
 * 4 篇合成笔记（标题 + 正文），`tokenize` 用上游默认（`split(/[\s\p{P}]+/u)`）：
 *
 *   | 查询 | `prefix:false` | `prefix:true` | 期望 |
 *   | --- | --- | --- | --- |
 *   | `数学` | **0** | 2（`数学分析 第4节…` 的前缀） | 2 |
 *   | `泰勒` | **0** | 2（同上前缀；`泰勒展开与佩亚诺余项` 也命中） | 2 |
 *   | `线` | **0** | 1 | 1 |
 *   | `佩亚诺` | **0** | **0**（它在 token 中间） | 1 |
 *   | `partition` | 1 | 1 | 1 |
 *
 *   最后一行是本包的核心证据：**「佩亚诺」在「泰勒展开与佩亚诺余项」的正中间，
 *   prefix 再宽也救不到** —— 这不是「调个参数」，而是分词层缺失。
 *
 * ── 本包**不做**什么 ─────────────────────────────────────────────
 *
 *   - 不改 `page-notes/src/client.jsx` 的 `buildRows()`（那是 note-search 的地盘，两者择一）；
 *   - 不改 `dsh-radar-search-rank` 的实例（「学习」页重排用 7.1.2 的默认分词，口径不同）；
 *   - 不重写 minisearch（不 fork、不 patch 上游 dist）；
 *   - 不做同义词、不做纠错（纠错是 `dsh-radar-search-fuzzy` 的事，别叠）。
 *
 * ── 与已有候选的关系（评审必读）────────────────────────────────
 *
 *   | 候选 | 职责 | 关系 |
 *   | --- | --- | --- |
 *   | `dsh-radar-note-search` | 正文召回（把 minisearch 接进笔记页） | **前置**：本包必须在它之后实施 |
 *   | `dsh-radar-search-fuzzy` | 打错字仍命中（Fuse.js） | **正交**：错字与分词是两件事，但都在 `findIn` 一族调用点上，须合并裁决 |
 *   | `dsh-radar-search-segment` | jieba-wasm 分词（学习页） | **冲突面**：若它采用 wasm 分词，本包的 bigram 应当让位 —— 同一仓两套分词必然漂移 |
 *   | `dsh-radar-search-rank` | 学习页重排（7.1.2） | **版本冲突**：本包锁 7.2.0，须把 search-rank 一并升版 |
 *
 * TODO（采用前必须完成）：
 *   1. **召回必须包含旧实现**：先算 `path.includes(query)` 的集合（旧行为），
 *      再并上索引命中，且**旧命中排在前面**。只做索引命中 = 静默删掉用户习惯的能力。
 *   2. **单字查询**要单独定口径：`tokenizeCJK` 目前把单字也入表，
 *      一个「的」会命中几乎所有笔记（Fuse.js 那边踩过同一个坑，见 registry 2026-10-22 的 R2）。
 *      建议单字只在**查询长度为 1**时启用，或对单字项降权 —— 二选一，须写测试钉住。
 *   3. **原文子串复核**：索引命中后回正文核对一遍（`markdown.includes(query)`），
 *      否则 bigram 的跨词假阳性会直接呈现给用户。
 *   4. **索引持久化**：`toJSON()` 带 `serializationVersion`，跨版本不保证兼容。
 *      落盘前记下 `UPSTREAM_VERSION`，版本不符就整库重建，**不要** `loadJSON` 试运气。
 *   5. **体积与延迟用真实数据量一次**：合成语料 2,000 篇 → 689 KB / 建索引 81 ms / 查询 1.7 ms；
 *      真实笔记库多半远小于此，但仍须实测一次再上线。
 *   6. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_REPOSITORY,
  UPSTREAM_HAS_CJK_TOKENIZER,
  BASELINE_SEARCH,
} from './upstream.js';
import { tokenizeCJK } from './tokenizer.js';

export const name = 'radar-note-search-tokenizer';

/**
 * 锁版凭据在此取用 —— 让 `src/upstream.js` 不只是摆着的装饰。
 *
 * 真实实现里这段应向宿主暴露一个**窄服务**（只给笔记页用，不外溢到学习页）：
 *
 *   ctx.provide('radarNoteSearchTokenizer', {
 *     tokenize: tokenizeCJK,
 *     version: UPSTREAM_VERSION,
 *     create: (notes) => createNoteSearch({ notes }),   // TODO-0
 *   })
 *
 * 注意本包**不需要**任何宿主服务：分词是纯函数，索引是进程内的。
 * 所以 `ctx.inject` 应保持为空 —— 依赖越少，挂载失败的面越小。
 */
export const upstream = Object.freeze({
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  repository: UPSTREAM_REPOSITORY,
  /** 见 README「现状核实」：上游明确不做中文分词，「强化」是相对这一空缺而言。 */
  hasCjkTokenizer: UPSTREAM_HAS_CJK_TOKENIZER,
  baseline: BASELINE_SEARCH,
});

/**
 * 分词器本身是**真的**（纯函数，无依赖），可以直接被测试引用。
 * 但**索引实例**仍是 TODO —— 见 `./tokenizer.js` 的 `createNoteSearch`。
 */
export { tokenizeCJK };

/**
 * 插件入口（骨架占位）。
 *
 * @param {object} _ctx 宿主上下文（本包预期一个服务都不注入）
 * @returns {{ dispose: () => void }}
 * @throws {Error} 未实现 —— 评审通过后按 TODO-1…5 落实
 */
export function apply(_ctx) {
  throw Object.assign(
    new Error('radar-note-search-tokenizer: 候选骨架，未实现（见 src/index.js TODO-0）'),
    { code: 'NOT_IMPLEMENTED' },
  );
}
