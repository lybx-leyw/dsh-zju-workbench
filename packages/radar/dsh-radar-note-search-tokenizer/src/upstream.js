/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 与 `dsh-zhiyun-host-paper/src/upstream.js`、`dsh-radar-temml/src/upstream.js` 同一套做法，
 * 此处只记本包特有的部分。
 *
 * # 为什么锁死了 7.2.0，而不是 7.1.2
 *
 * 本仓已有一个锁 `7.1.2` 的骨架（`packages/dsh-radar-search-rank/`，用途是「学习」页的重排）。
 * 本包**必须**锁同一个版本，否则两个包会各装一份 minisearch：打包体积翻倍，
 * 而且更糟 —— 两者的 `serializationVersion` 一旦不同，索引 JSON 就不能互换，
 * 未来「一个索引多面板复用」的路直接被堵死。
 *
 * 为什么是 **7.2.0** 而不是 7.1.2：
 *
 *   1. `dsh-radar-note-search`（2026-10-26 登记，与本包同一面板、同一次扫描）已经锁 7.2.0
 *      并实测通过；本包与它只差**分词**这一层，没有理由在同一个面板里并存两个小版本。
 *   2. 7.2.0 是 `latest`（2025-09-16 发布，`npm view` 实查）。
 *   3. 7.2.0 的 `dependencies: {}` —— 零传递依赖，锁版风险面只有它自己。
 *
 * ⚠ **这会让 `dsh-radar-search-rank` 的 7.1.2 成为孤例**。评审若采用本包，
 *   应同时把 `search-rank` 升到 7.2.0（它的 README 与测试都写了「7.1.2」，需要一起改）。
 *   本包不替别的包做这个决定，只把冲突摆在明面上。
 *
 * # 锁版能挡什么、挡不住什么
 *
 * - 挡得住：`npm ci` 某天悄悄把 minisearch 换成一个改了打分公式的版本，
 *   于是「哪条更贴」静默变了（不报错、不崩、只是顺序不同 —— 最难发现的那类）。
 * - 挡不住：**索引格式**。minisearch 的 `toJSON()` 里有一个 `serializationVersion`
 *   字段，跨大版本不保证兼容。所以运行时核对版本这件事不是洁癖：
 *   版本漂了，`loadJSON` 可能不抛错但给出错误的字典。
 */

export const UPSTREAM_PACKAGE = 'minisearch';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '7.2.0';

/** 上游仓库，供 README 与人工复核对照。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/lucaong/minisearch';

/**
 * 上游**没有**中文分词（2026-10-26 沙箱实跑核对，`minisearch@7.2.0`）。
 *
 * 它默认的 `tokenize` 是（节选上游 `dist/es/index.js`）：
 *
 *   const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u
 *   tokenize = (text) => text.split(SPACE_OR_PUNCTUATION)
 *
 * 即**只按空白与标点切**。中文没有空格 → 「数学分析 第4节 泰勒展开」整段是一个 token；
 * 更糟的是**标题里带空格的英文笔记**也会被切碎（`Note` / `4` 分别成词）。
 *
 * 实跑（4 篇中文笔记，`prefix: false`）：
 *
 *   | 查询 | 结果 | 说明 |
 *   | --- | --- | --- |
 *   | `数学` | **0** | 正文确有「数学分析」，但整段是一个 token |
 *   | `泰勒` | **0** | 同上 |
 *   | `线` | **0** | 同上 |
 *   | `partition` | 1 | 拉丁词，碰巧有空格/标点隔开 |
 *
 * 打开 `prefix: true` 后「数学」「泰勒」能命中（整段 token 的前缀），
 * 但这要求写对「该段文本的**开头**」—— 用户想搜「中间的词」时依然 0 命中。
 * 这个「prefix 救不了中间」的事实是本包存在的理由，也是它相对
 * `dsh-radar-note-search`（同样受此限制）的**唯一**增量。
 */
export const UPSTREAM_HAS_CJK_TOKENIZER = false;

/**
 * 本仓「笔记」页**当前**的检索实现（2026-10-26 读码结论）。
 *
 * `packages/dsh-zhiyun-page-notes/src/client.jsx` 的 `buildRows()` 在过滤时：
 *
 *   entries.filter((e) => e.type !== 'folder' && `${e.path}`.toLowerCase().includes(query))
 *
 * 只对 **`path`**（`课程/第4节` 这种，**不含 `.md`**，见 `page-notes/src/index.js` 的 `tree`）
 * 做**子串**匹配，正文一个字符都不看。
 *
 * 而 `tree` 已经返回了 `preview`（正文前 120 字）与 `title` —— 数据在手边，
 * 只是没参与匹配。这是「基线」：**文件名子串匹配**。
 *
 * ⚠ 本包不改这个基线（它只提供检索内核），改基线是 `dsh-radar-note-search` 的事；
 *   两者必须**一起评审、择一实施**，见 README「与已有候选的关系」。
 */
export const BASELINE_SEARCH = 'substring-on-path';
