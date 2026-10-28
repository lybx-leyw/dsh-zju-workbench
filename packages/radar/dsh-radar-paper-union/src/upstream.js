/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 写法照 `dsh-zhiyun-host-paper/src/upstream.js` 与 `dsh-radar-kb-rag/src/upstream.js`：
 *
 *   1. `package.json` 的依赖写**精确版本**（`0.3.39`，不是 `^0.3.39`）；
 *   2. 运行时再核对一次真实安装的版本（别人的 lockfile / `npm link` 能让声明的版本失真）；
 *   3. 锁版这件事必须有一条会红的测试 —— 本骨架**尚未**带测试，评审通过后第一件事就是补
 *      `tests/paper-union.test.mjs`。
 *
 * ── 与另外两个兼容层骨架的关键差别 ──────────────────────────────────
 *
 * `dsh-zhiyun-host-paper` / `dsh-radar-kb-rag` 都是**挂上游插件**（`ctx.plugin(upstream)`）；
 * 本包**不挂**，只是 `import` 上游的一个**纯函数模块**。原因是上游的挂载面里有三样本仓不需要、
 * 且会破坏边界的东西（r92 实测）：
 *
 *   - 客户端 `ctx.slots.inject('sidebar.panellist', …)`（`dsh-ai-library/lib/client.js:5088`）
 *     → 侧栏多一个「资料馆」面板 = 第二个资料库；
 *   - 宿主 `/install` 直接 `dsh plugin add`、`/update` 对本地目录 `git pull`
 *     → **从 Web 面板执行装包与 git pull**，与「只推 radar、不接 profile」正面冲突；
 *   - `/market` 同步 `api.dshmk.com`、GitHub 仓库卡 / 头像代理 → 域外。
 *
 * ⇒ 整包挂 ⛔，只借用 `lib/paper.js` ✅。**这是本包的立身之本**，改之前先读 r92 §2.4。
 *
 * ── r92 实测到的上游缺陷（写在这里，评审别再重查一遍）─────────────────
 *
 *   a. **`auto` 只走 5 源**。`FREE_SOURCES` 导出 10 个，但 `AUTO_SET` 是
 *      `['openalex','crossref','arxiv','doaj','europepmc']`（`lib/paper.js:333`）；
 *      `openaire / inspire / zenodo / hal / datacite` 的函数写好了，`auto` 永不调用。
 *      ⇒ README 的「十源并发」在默认路径上不成立。
 *
 *   b. **arXiv 源对「多词查询」不可靠**。上游构造 `all:"<整句>"`（`:50`）：
 *      - 20 s 超时（`AbortSignal.timeout(TIMEOUT)`，`TIMEOUT = 20000`）；
 *      - 放宽到 30 s → **200 但 `<entry>` 数 = 0**；
 *      - 去掉引号 → 200 + 5 条。
 *      12 个常见英文查询单源直打：11 成 1 超时；`spaced repetition memory` 5 次里 2 超时 / 3 空。
 *      中文查询 `all:"图神经网络"` → **恒 0**。
 *
 *   c. **`auto` 合并无相关性排序**。按源**轮转交错**（`paper.js:388-396`），不是 relevance。
 *      中文 3 条里第 3 条是《卒中后…脑电图微状态》—— 原样铺给学生不可接受。
 *
 *   d. **npm 与仓库 tag 岔开**：仓库 `0.3.54`，npm 最新 `0.3.39`（2026-10-19）。
 *      两者 `lib/paper.js` 逐字节相同（399 行），所以本包锁 `0.3.39` 在**这一层能力上**不亏，
 *      但**不代表**新版本的其他改动被锁住。
 */

export const UPSTREAM_PACKAGE = 'dsh-ai-library';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.3.39';

/** 上游发布源头（npm `repository.url` 与仓库一致；2026-10-28 实查）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/Instant-KING/dsh-ai-library';

/** 上游许可证。MIT —— 宽松白名单内，可以集成。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 仓库 tag（**不是** npm 版本）。锁版核对时别拿它当基准。 */
export const UPSTREAM_REPO_TAG = '0.3.54';

/**
 * 本包**唯一**会 import 的上游模块（相对包根）。
 *
 * 只允许这一项。任何 `import 'dsh-ai-library'`（即 `lib/index.js`）都会把整包宿主半边
 * 带进来 —— 24 条路由 + 16 个 tool + 装包/自更新能力。
 */
export const UPSTREAM_ENTRY = 'lib/paper.js';

/** 上游 `lib/paper.js` 导出的函数/常量名，评审时用来核实接口没漂。 */
export const UPSTREAM_EXPORTS = ['searchPapers', 'FREE_SOURCES', 'KEYED_SOURCES'];

/** `auto` 模式**实际**会查询的 5 个源（`paper.js:333` 的 `AUTO_SET`）。 */
export const AUTO_SOURCES_ACTUAL = ['openalex', 'crossref', 'arxiv', 'doaj', 'europepmc'];

/** 声明了但 `auto` **不会**调用的 5 个源（要么显式指定 source 才走）。 */
export const DECLARED_BUT_UNUSED_IN_AUTO = ['openaire', 'inspire', 'zenodo', 'hal', 'datacite'];

/**
 * 时间预算：上游 `TIMEOUT = 20000` 是**每个源**的超时，`auto` 并发 5 个源，
 * 最坏情况一次调用 20 s 才返回（r92 实测出现过 20 069 ms）。
 * 论文页的交互不能等 20 s ⇒ 本包必须自带更短的超时 + 部分结果返回。
 */
export const UPSTREAM_TIMEOUT_MS = 20000;

/**
 * 上游 `apply()` 需要的宿主服务与本包无关 —— 本包**不挂**上游插件，
 * 所以只依赖 `tools`（注册 model tool）。
 */
export const REQUIRED_SERVICES = ['tools'];
