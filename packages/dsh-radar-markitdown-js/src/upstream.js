/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.0.14`，不是 `^0.0.14`）。
 *      上游 `0.0.x` —— 按语义化版本，`0.0.x` 之间**没有任何兼容性承诺**，
 *      `^0.0.14` 实际等价于 `0.0.14` 但意图模糊，写死更清楚。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果
 *      暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. 后续应补 `tests/radar-markitdown-js.test.mjs`，用这两个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版这件事必须有一条会红的测试，
 *      否则它只是一句口号。（本轮仅出骨架，测试留待评审通过后补。）
 */

export const UPSTREAM_PACKAGE = 'markitdown-js';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.0.14';

/**
 * 上游在 npm registry 里声明的形状（2026-10-17 经 registry.npmjs.org 核实）：
 *
 *   { name: 'markitdown-js', version: '0.0.14', license: 'MIT',
 *     type: 'module', main: 'dist/markitdown.js',
 *     published: 2025-03-02 }
 *
 * **注意 `hasDshBundlePatch: false`** —— 上游是普通 JS 库，
 * **不是**原生 DSH 插件包（无 `dsh.bundle.patch` / `dsh.client`）。
 * 这就是本包被判定为 **B 类**、并采用「能力提取 + 封装」而非
 * 「锁版挂载 + 外围承载」的原因。若评审后要改为 A 类范式，说明前提有误。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  // ↓ 上游**不是** DSH 插件包：无 dsh 字段、无 cordis patch、无 client 入口。
  hasDshBundlePatch: false,
  hasClientEntry: false,
  // ↓ 上游的真实入口形状（供封装时判断导出类型）。
  npmMain: 'dist/markitdown.js',
  npmType: 'module',
};

/**
 * 上游声明的**平台强绑定**依赖 —— 这三个是「整包引入 vs 自建收敛子集」
 * 这个裁量点的依据（见 README 的「裁量二」）。
 *
 *   - `exiftool-vendored`     捆绑二进制
 *   - `fluent-ffmpeg`         需系统 ffmpeg
 *   - `node-tesseract-ocr`    需系统 tesseract
 */
export const UPSTREAM_PLATFORM_BOUND_DEPS = [
  'exiftool-vendored',
  'fluent-ffmpeg',
  'node-tesseract-ocr',
];

/**
 * 若评审选择「自建收敛子集」路线，以下为**候选底层件**及其核实过的许可证
 * （2026-10-17 经 registry.npmjs.org 逐一核实），全部落在宽松白名单内 ✅。
 *
 * 注意：这是**设计参考**，不是已经写进 `package.json` 的依赖 ——
 * 骨架阶段刻意不引入任何依赖，避免在未评审前改变安装图。
 */
export const SELF_ASSEMBLED_CANDIDATES = [
  { name: 'turndown', version: '7.2.4', license: 'MIT', covers: 'html → markdown' },
  { name: 'turndown-plugin-gfm', version: '1.0.2', license: 'MIT', covers: 'GFM 扩展' },
  { name: 'mammoth', version: '1.13.0', license: 'BSD-2-Clause', covers: 'docx → html/markdown' },
  { name: 'node-pptx-parser', version: '1.0.1', license: 'MIT', covers: 'pptx 文本抽取' },
  { name: 'xlsx', version: '0.18.5', license: 'Apache-2.0', covers: 'xlsx 解析' },
];
