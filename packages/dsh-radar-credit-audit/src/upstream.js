/**
 * 上游资产的**锁版凭据**（单一真源）。
 *
 * 写法照 `dsh-zhiyun-host-paper/src/upstream.js` 与 `dsh-radar-kb-rag/src/upstream.js`：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`1.7.0`，不是 `^1.7.0`）。
 *   2. 光锁 `package.json` 不够 —— 真实的 `node_modules` 里装的是什么，取决于别人的 lockfile、
 *      全局覆盖、`npm link`。所以还要在**运行时**核对一次 `UPSTREAM_ENGINE_VERSION`。
 *   3. 锁版必须有一条会红的测试；本骨架**尚未**带测试，评审通过后第一件事是补
 *      `tests/credit-audit.test.mjs`（含 TODO-1 的双向学期映射用例）。
 *
 * # 这一轮（r64）实查到的四件事，写在这里以免评审时重查
 *
 *   a. **上游不是 DSH 插件**：仓库根无 `cordis.patch.yml` / `dsh.bundle.patch`，无 `package.json`
 *      （实测 contents API 返回 `Not Found`）→ 不能走 A 类「锁版挂载 + 外围兼容层」。
 *   b. **没有 npm 包**：`registry.npmjs.org/zju-kezhou` → `{"error":"Not found"}`。
 *      所以 `UPSTREAM_VENDOR_PACKAGE` 是**待发布**的内部包名，现在 install 会 404。
 *      **这是刻意的**：TODO-0 没拍板之前，本包不应该能被装上。
 *   c. **许可证是 MIT +「第三方说明」附件**：GitHub 的 `license.spdx_id` 报 `NOASSERTION`，
 *      原因是 `LICENSE` 文件在 MIT 正文之后附了一段第三方说明（Celechron GPL-3.0、Noto Sans SC OFL-1.1）。
 *      正文本身是**逐字 MIT**（本轮已通读 1664 字节），附件不改变本项目的授权范围
 *      → 判定 `MIT ✅`，但**只取 `engine/` 与 `schema/`**，**不取** `assets/fonts/`（OFL 字体）
 *      与 `compass_app/`（Flutter UI，与本仓无关）。
 *   d. **引擎版本号在源码里**：`engine/audit.py` 顶部 `ENGINE_VERSION = "1.7"`。
 *      锁版号取 `1.7.0`（三段式，便于将来 patch 级修订）；运行时核对 `1.7` 前缀。
 */

/** 内部 vendor 包名（TODO-0 (a) 路线）。**当前 npm 上不存在**，发布前 install 会 404。 */
export const UPSTREAM_VENDOR_PACKAGE = 'dsh-radar-credit-audit-vendor';

/** 我们适配并测试过的 vendor 版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VENDOR_VERSION = '1.7.0';

/** 上游源码里声明的引擎版本（`engine/audit.py` 的 `ENGINE_VERSION`）。运行时核对用。 */
export const UPSTREAM_ENGINE_VERSION = '1.7';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/Kepler16f/zju-kezhou';

/** 上游许可证（`LICENSE` 正文逐字 MIT；GitHub spdx 因附加「第三方说明」报 NOASSERTION，见文件头 c）。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者（`LICENSE` 版权行：`Copyright (c) 2026 KeZhou (ClassArk) contributors`）。 */
export const UPSTREAM_COPYRIGHT = 'Copyright (c) 2026 KeZhou (ClassArk) contributors';

/**
 * **只取这两个目录**。
 *
 * `engine/`：`audit.py`(54,444 B) + `common.py`(2,867 B) + `adapters.py` + `run_audit.py` + `tests/`，纯 stdlib。
 * `schema/`：`plan.schema.json`(3,797 B) / `record.schema.json`(2,487 B) / `report.schema.json`(3,145 B)，JSON Schema 2020-12。
 *
 * 明确**不取**：`compass_app/`（Flutter）、`eval/`（CI 金标，可参考流程但不随包发）、
 * `assets/`（含 OFL-1.1 字体）、`docs/`（中文说明，接口事实已在 TODO-4 摘录）。
 */
export const UPSTREAM_PATHS = ['engine/', 'schema/'];

/**
 * 引擎的入口与调用约定（**待 TODO-0 落地后核对**）。
 *
 * `engine/audit.py` 的 docstring 写的是 `main(record_json) -> {"report": ..., "report_json": ...}`，
 * 但同一文件后面还有 `ENGINE_VERSION`、`PLAN_JSON` 等模块级常量 —— 说明它既可作为 Dify Code 节点
 * 被复制粘贴，也可被 `run_audit.py` 以 CLI 方式调用。**两种调用约定的入参不同**：
 *   - Dify 形态：`record_json` 是**字符串**，方案由 `PLAN_JSON` 注入（golden）；
 *   - CLI 形态：`run_audit.py --record x.json --plan y.json`（**未核实**，需读 `run_audit.py`）。
 * 本常量先记 Dify 形态；评审时若选 CLI 路线，改这里即可，**不要在 index.js 里散落调用细节**。
 */
export const UPSTREAM_ENTRY = {
  module: 'engine.audit',
  callable: 'main',
  signature: 'main(record_json: str) -> { report: dict, report_json: str }',
  planSuppliedBy: 'PLAN_JSON 模块常量（golden 方案）或 run_audit.py 的 --plan',
};

/**
 * 运行时能力核对。
 *
 * 与 A 类包不同，本包**不注入宿主服务**（`inject = []`），所以这里不查 `tools`/`slots`，
 * 只查「引擎在不在、版本对不对」。返回缺失项而不是抛错 —— 由调用方决定是降级还是报错
 * （本仓风格：**不许静默降级**，所以调用方拿非空数组必须 `throw`）。
 *
 * @param {{ engineVersion?: string|null }} [env] - 运行时可观测到的引擎版本。
 * @returns {string[]} 问题清单，空数组表示 OK。
 */
export function checkUpstream(env = {}) {
  const problems = [];
  const v = env.engineVersion ?? null;
  if (!v) {
    problems.push(
      `${UPSTREAM_VENDOR_PACKAGE} 未安装：请先按 README TODO-0 (a) 发布 vendor 包 ${UPSTREAM_VENDOR_VERSION}，`
      + ' 或改用 TODO-0 (c) 只借 schema 的路线。',
    );
  } else if (!String(v).startsWith(`${UPSTREAM_ENGINE_VERSION}.`) && String(v) !== UPSTREAM_ENGINE_VERSION) {
    problems.push(
      `引擎版本不匹配：期望 ${UPSTREAM_ENGINE_VERSION}，实际 ${v}。`
      + ' 上游 54 KB 规则一版一改（v1.3 修选课组重复计分、v1.5 加在修证据降级），跨版本行为不可假定一致。',
    );
  }
  return problems;
}
