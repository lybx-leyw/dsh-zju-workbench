/**
 * 上游 `minisearch` 的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * B 类骨架没有「上游 DSH 插件」，但同样需要一个可被 grep 到的单一真源：
 * 「笔记」页的检索结果直接依赖 minisearch 的**分词与打分行为**，而这两件事在
 * 小版本之间会变（7.1 → 7.2 调整过 `prefix` 的权重语义）。因此版本写死，不写 `^7`。
 *
 * ⚠️ 与本仓已有骨架 `dsh-radar-search-rank` 的**版本不同是故意的**：
 * 那个包锁 `7.1.2`、服务于「学习」页的排序层。两个包各自一个真源，
 * 不共用——共用会让「升一个就得重测另一个」变成隐形的耦合。
 */

export const UPSTREAM_PACKAGE = 'minisearch';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '7.2.0';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者 / 组织。 */
export const UPSTREAM_AUTHOR = 'lucaong';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/lucaong/minisearch';

/**
 * 上游的运行时不变量（评审时要逐条核对，本骨架**不替他证明**）。
 *
 *   1. `MiniSearch` 是**纯 JS、零运行时依赖**（`npm view minisearch dependencies` → `{}`），
 *      可进 Web 客户端 bundle。本仓前端不做后台线程，worker 形态会拖垮首屏。
 *   2. **默认分词器对中文完全无效**：按空白/标点切，「动量守恒定律」整段是一个 token。
 *      2026-10-26 实测：默认配置下查「动量」→ **0 条**；接 `Intl.Segmenter` 后 → 3 条。
 *      中文不接分词**不准上线**。
 *   3. `search()` 返回 `{ id, score, match }`，`score` **无量纲、只在同一查询内可比**
 *      —— 不得跨查询比较，也不得当作「命中率 / 匹配度 %」展示给用户。
 *   4. `Intl.Segmenter` 对中文会**过度切分**：「弹道学」→ `弹道 | 学`。由此产生的
 *      **假阳性**（把「弹道导弹的学理解释」也当成「弹道学」的命中）用
 *      `combineWith: 'AND'` **兜不住**。必须靠原文子串复核（见 `src/index.js` 的两层策略）。
 */
export const UPSTREAM_CONSTRAINTS = Object.freeze([
  '纯 JS、零运行时依赖：可进客户端 bundle',
  '默认分词器对中文无效，必须外接 tokenize（实测：查「动量」默认 0 条）',
  'score 只在同一查询内可比，不得跨查询或当命中率展示',
  '中文分词会过度切分，召回后必须做原文子串复核',
]);

/**
 * 本骨架**不从上游取**的东西（写下来是为了防止评审时顺手扩权）：
 *
 *   · 不用 `autoSuggest` 作为默认 —— 它是前缀补全，会把「输入半个词」与
 *     「我要找这一篇」混成一件事；
 *   · 不用 `fuzzy` 作为默认 —— 模糊匹配会把 `∑a²`、`p=mv` 这类符号查询打散成噪声；
 *   · 不用 `discard` / `replace` 的**持久化** —— 索引必须每次从页面内存里的
 *     笔记正文现算。「落盘的索引」是第二真源：用户在别的编辑器里改了 .md，
 *     落盘索引不会知道，于是搜出来一篇已经改过的内容。
 */
export const NOT_ADOPTED = Object.freeze([
  'autoSuggest（默认关）',
  'fuzzy（默认关）',
  'discard/replace 持久化（索引只在内存现算）',
]);
