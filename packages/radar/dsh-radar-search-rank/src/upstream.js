/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * B 类骨架没有「上游 DSH 插件」，但同样需要一个可被 grep 到的单一真源：
 * 面板侧的排序结果依赖 minisearch 的**分词与打分行为**，而这两件事在小版本之间
 * 会变（7.x 曾调整 `prefix` 的权重语义）。因此版本必须写死，不能写 `^7`。
 */

export const UPSTREAM_PACKAGE = 'minisearch';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '7.1.2';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者 / 组织。 */
export const UPSTREAM_AUTHOR = 'lucaong';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/lucaong/minisearch';

/**
 * 上游的运行时不变量（评审时要逐条核对，本骨架**不替他证明**）。
 *
 * 这三条是从 minisearch 7.x 的公开 API 形状推出来的**使用约束**，不是运行态读数：
 *   1. `MiniSearch` 是**纯 JS、零运行时依赖**（无 wasm、无 worker），因此可以进
 *      Web 客户端 bundle —— 本仓前端不做后台线程，worker 形态会拖垮首屏；
 *   2. 中文分词靠**外部 `tokenize` 函数**接入：默认分词器按空白/标点切，中文整段
 *      会变成一个 token，不接中文分词时**不准上线**；
 *   3. `search()` 返回的是 `{ id, score, match }`，`score` 无量纲、只可同查询内比较
 *      —— 不得跨查询比较，也不得当作「命中率」展示给用户。
 */
export const UPSTREAM_CONSTRAINTS = Object.freeze([
  '纯 JS、零运行时依赖：可进客户端 bundle',
  '中文必须外接 tokenize：默认分词器对中文无效',
  'score 只在同一查询内可比，不得跨查询或当命中率展示',
]);

/**
 * 本骨架**不从上游取**的东西（写下来是为了防止评审时顺手扩权）：
 *
 *   · 不用 minisearch 的 `autoSuggest` / `fuzzy` 作为默认开关 —— 模糊匹配会把
 *     「∑a²」这类符号查询打散成噪声，必须由页面开关控制；
 *   · 不用它的 `discard` / `replace` 持久化 —— 索引由页面所在的
 *     `layered-search.js` 每次从 `result` 现算，落盘会引入「课改了索引没改」的第二真源。
 */
export const NOT_ADOPTED = Object.freeze(['autoSuggest', 'fuzzy（默认关）', 'discard/replace 持久化']);
