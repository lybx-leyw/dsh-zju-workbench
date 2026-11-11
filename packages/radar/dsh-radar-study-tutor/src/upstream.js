/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * 为什么 A 类骨架要单列一个 upstream 模块：
 *
 *   1. 本包**不搬运**上游任何源码，只 `import` 它的公开入口。因此「我们调的到底是
 *      哪一版 API」必须有可被 grep 到的单一真源。
 *   2. 上游 `engines.dsh` 写的是 `>=0.2.1-rc.3 <0.2.3`，且 0.2.2 版专门为了
 *      适配 DSH `0.2.2` 改了工具呈现方式（`presentAs()` 被移除，改挂原生
 *      executor）。**宿主小版本一升，上游的整个工具呈现路径就可能换掉**，
 *      放开成 `^0.2.2` 会在宿主升级时静默换 API，必须写死。
 *   3. 版本号必须与 `package.json` 的 `dependencies["dsh-study-tutor"]`
 *      **逐字符相同**。真实安装的版本由 `npm ls` 核对，不得信任本文件。
 */

export const UPSTREAM_PACKAGE = 'dsh-study-tutor';

/** 我们适配并记录过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.2.2';

/**
 * 上游在 GitHub 上的仓库名**不等于 npm 包名**。
 * 仓库叫 `HaowenCang/dsh-study-mode`，npm 包叫 `dsh-study-tutor`
 * （上游 README 原话：npm 上的 `dsh-study-mode` 属于无关项目）。
 * 登记/引用时两个名字都要写，否则会再次找错仓。
 */
export const UPSTREAM_REPOSITORY = 'https://github.com/HaowenCang/dsh-study-mode';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者（署名用）。 */
export const UPSTREAM_AUTHOR = 'HaowenCang';

/**
 * 上游声明的宿主兼容区间。上游自己是这么写的，本包**不放宽**。
 * 宿主版本基线见仓库根 `runtime.lock.json`。
 */
export const UPSTREAM_ENGINES = Object.freeze({
  dsh: '>=0.2.1-rc.3 <0.2.3',
  node: '>=24.13.0',
});

/**
 * 上游声明的 agent tool 名单（README 的表格）。
 *
 * 本包**只读**这份名单做兼容性断言，不代理调用 —— 判分与作答权必须留在
 * 上游手里，本包不做法「中间层判分」（那正是要避免的重复实现）。
 */
export const UPSTREAM_TOOLS = Object.freeze([
  'study_get_state',
  'study_get_plan',
  'study_teaching_step',
  'study_issue_question',
  'study_author_question',
  'study_model_review',
  'rich_render',
  'rich_physics_demo',
  'rich_mermaid',
  'rich_heatmap',
  'rich_image',
  'rich_svg',
]);
