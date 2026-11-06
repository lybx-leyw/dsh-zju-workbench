/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zju-workbench` 的 `packages/dsh-zhiyun-paper/src/upstream.js`。
 *
 * B 类骨架没有「上游 DSH 插件」，但同样需要一个可被 grep 到的单一真源：
 * 面板侧的排序结果依赖 clientside-search 的**分词与打分行为**，而这两件事在小版本之间
 * 会变（本轮实测 1.8.1 的 `match` 字段与 `index_` 前缀 metadata 约定就是这样定下来的）。
 * 因此版本必须写死，不能写 `^1`。
 */

export const UPSTREAM_PACKAGE = 'clientside-search';

/** 我们适配并实测过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.8.1';

/** 上游许可证：GitHub `/license` 实核 `MIT`（1069 B），npm `license` 亦为 `MIT`。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者 / 组织。 */
export const UPSTREAM_AUTHOR = 'kyr0';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/kyr0/clientside-search';

/**
 * 上游的运行时不变量（评审时要逐条核对，本骨架**不替他证明**）。
 *
 * 前两条是本轮在 Node 22 上**真跑过**的读数，第三条来自 1.8.1 的源码与类型声明：
 *
 *   1. **必须显式传语言包**。`new SearchEngine(undefined)` 直接抛
 *      `TypeError: Cannot read properties of undefined (reading 'stopwords')` ——
 *      不是「回落到英文」，是崩。必须 `import en from 'clientside-search/en'`。
 *   2. **语言包集合没有中文**（`en/de/fr/es/ja` + `phonetic` + `stem`）。
 *      实测用 `en` 包跑中文**可用**：`en.tokenizer('守恒')` 返回 `['守恒']`，
 *      `isLogograhic` 为 `undefined`，于是整串中文被当成**一个 token**，
 *      子串命中走 `bkTree.searchPartial`，`match` 标成 `partial`。
 *      → 中文能「搜到」，但**没有中文分词**，这一点与 README 的定位必须一致，不得宣称分词。
 *   3. **`score` 是单查询内 min-max 归一化**（源码 `(score-l)/(a-l)`），
 *      同一命中集里**最高分恒为 1.000、最低分恒为 0.000**。
 *      实测 `守恒` 打「动量守恒」与「能量守恒」两篇等长文档，**两条都是 1.000**；
 *      打一短一长两篇，**也都是 1.000**。→ 只命中文档之间的排序**不可信**，
 *      跨查询更不可比，不得当「相关度」展示给用户。
 */
export const UPSTREAM_CONSTRAINTS = Object.freeze([
  '必须显式传语言包：new SearchEngine(undefined) 抛 TypeError',
  '无中文语言包：中文整串当单一 token，能子串命中但无分词',
  'score 为单查询 min-max 归一化：最高恒 1.000、最低恒 0.000，只命中文档之间排序不可信',
]);

/**
 * 锁版之外**实际用到的入口**（写下来是为了防评审时顺手扩权）：
 *
 *   · `clientside-search` 主入口：`SearchEngine`（`addDocument` / `search` /
 *     `removeDocument` / `hydrateState` / `fromHydratedState`）；
 *   · `clientside-search/en`：语言包（`iso2Language/stem/stopwords/tokenizer/diacritics`）。
 *
 * 上游真正的「持久化」不是 IndexedDB，而是 `hydrateState()` 吐一段 JSON、
 * `fromHydratedState(json, lang)` 读回来 —— 落盘与否由**本仓**决定（见 TODO-4）。
 */
export const ADOPTED_ENTRYPOINTS = Object.freeze([
  'SearchEngine（addDocument / search / removeDocument / hydrateState / fromHydratedState）',
  'clientside-search/en（语言包）',
]);

/**
 * 本骨架**不从上游取**的东西（写下来是为了防止评审时顺手扩权）：
 *
 *   · 不用 `BKTree` / `BM25` / `TfidfVectorizer` 这些具名导出自己拼索引 —— 那是把上游
 *     当零件用，等于重写一遍 `SearchEngine`，与「能力提取 + 封装」的边界不符；
 *   · 不用 `phonetic` 入口（Soundex/Cologne 音标匹配，面向前述 4 种拉丁语）；
 *     中文场景下只会在噪声里多出一堆「读音相近」的假命中；
 *   · 不用语言包里的 `stopwords` 做中文停用词（英文停用词表对中文无意义）。
 */
export const NOT_ADOPTED = Object.freeze([
  'BKTree / BM25 / TfidfVectorizer 具名导出（自己拼索引 = 重写上游）',
  'phonetic 入口（面向拉丁语，中文只增噪声）',
  '语言包 stopwords 当中文停用词',
]);
