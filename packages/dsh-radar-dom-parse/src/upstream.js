/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * B 类骨架没有「上游 DSH 插件」，但同样需要一个可被 grep 到的单一真源：
 * 登录页表单提取与课表页解析都依赖 cheerio 的**解析与选择器语义**，而这件事
 * 在小版本之间会变（`cheerio` 1.0 之后默认改用 `parse5` 的 HTML5 解析树，
 * 与 0.x 的 `htmlparser2` 默认解析在畸形标签的归属上不同）。
 * 因此版本必须写死，不能写 `^1`。
 */

export const UPSTREAM_PACKAGE = 'cheerio';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.2.0';

/**
 * **必须走 `./slim` 子入口**，不要走包根。
 *
 * 实测（2026-10-20）：包根的 `dist/esm/index.js` 第 11 行是 `import * as undici from 'undici'`
 * —— 为了 `fromURL()` 那个「按 URL 抓取」的便利函数。`undici` 是 Node 专用实现，
 * 浏览器 bundle 里没有它；而本仓的构建目标是**浏览器 + Cordis 宿主**双端，
 * 一个无条件的 Node-only 静态依赖会让客户端构建直接失败。
 *
 * `cheerio/slim` 的导出面是 `load / html / xml`，不带 `fromURL`，`^import` 里没有 `undici`。
 * 本包**本来也不需要** `fromURL`：HTML 一律由 `dsh-zhiyun-classroom` 的 transport 取回，
 * 解析层只接字符串。所以在 slim 上是**能力等价、体积更小**，不是妥协。
 */
export const UPSTREAM_ENTRY = 'cheerio/slim';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者 / 组织。 */
export const UPSTREAM_AUTHOR = 'cheeriojs';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/cheeriojs/cheerio';

/**
 * 上游的运行时不变量（评审时要逐条核对，本骨架**不替他证明**）。
 *
 *   1. `./slim` **不含** `undici`，但包根的传递依赖里仍有 `undici`（`npm i cheerio` 会装）。
 *      这意味着 `node_modules` 会大 ~2.1 MB，**但不进 bundle**（slim 不 import 它）。
 *      取舍写在这里，避免评审时把「安装体积」误读成「运行时体积」。
 *   2. `load()` 默认返回一个 `Cheerio` 实例：`$('sel')` 走 `cheerio-select`（基于 `css-select`），
 *      支持 CSS3 选择器；**不保证**支持全部 CSS4（如 `:has()` 需确认版本行为）。
 *   3. 解析**不执行脚本**（解析树里保留 `<script>` 节点，但不求值）—— 这是「安全」而不是「净化」：
 *      若要把结果拿来拼 HTML，仍须过 sanitizer（见 NOT_ADOPTED 第 2 条）。
 *   4. `text()` 会**解码 HTML 实体**（`&amp;` → `&`）。本仓 `executionToken()` 不会，
 *      这正是本骨架的一个修正点（见 TODO-2），但评审要确认 CAS 的 execution 值
 *      确实可能含实体，否则这条修正没有实际收益。
 */
export const UPSTREAM_CONSTRAINTS = Object.freeze([
  '必须用 ./slim 入口：包根静态 import undici（Node-only），会破坏浏览器构建',
  'load() 不执行脚本，但也不做净化；拼回 HTML 仍须 sanitizer',
  'text() 会解码 HTML 实体，与现有正则实现的返回值可能不同',
  '选择器支持 CSS3 为主，CSS4 需逐条验证',
]);

/**
 * 本骨架**不从上游取**的东西（写下来是为了防止评审时顺手扩权）：
 *
 *   · 不用 `fromURL()` —— 抓取一律走 `dsh-zhiyun-classroom` 的 transport，
 *     那里才有 cookie jar、HTTPS 白名单、超时与取消。解析层**不得**自己发请求，
 *     否则等于在登录链路上开了第二个网络出口。
 *   · 不用 `$.html()` 回写 —— 本包只读。回写会把 CAS 页面重新序列化，
 *     隐藏域顺序、注释、`<noscript>` 都可能变，属于「不该动的动了」。
 *   · 不引入 `parse5` 直接使用 —— 它是 cheerio 的传递依赖，直接依赖它等于绕过
 *     cheerio 的选择器层，却仍受其版本约束，收益为零。
 */
export const NOT_ADOPTED = Object.freeze(['fromURL()（抓取归 transport）', '$() 回写 HTML', '直接依赖 parse5']);
