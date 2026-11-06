/**
 * 上游 `@dsh-external/dsh-skill-stats` 的**唯一**引用点 —— 锁版凭据只在本文件出现一次。
 *
 * 本文件是占位：**不 import 上游本身**，只把「包名 / 版本 / 形状 / 已知坑」写死在这里，
 * 供评审者对照。评审通过后再实现 `loadUpstream()`。
 *
 * 所有形状结论都在沙箱里对仓库 `package.json` / `README.md`（main 分支，2026-10-29）原文核对过，
 * 见 `docs/ecosystem-radar/2026-10-29-18.md` §4。
 *
 * ⚠ **本文件里的 `readStats()` 不是上游的导出**，而是本包**拟提供给调用方**的形状（占位，抛错）。
 */

/** 主仓库（README 写明「star / issue / PR 请到此处」）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/chen-zz20/dsh-skill-stats'

/** 本轮扫到的是**只读社区镜像**；真正要跟的是主仓库。 */
export const UPSTREAM_MIRROR = 'https://github.com/omdsh-dev/dsh-skill-stats'

/** npm 包名 —— **带 scope**，且上游 `private: true`。 */
export const UPSTREAM_PACKAGE = '@dsh-external/dsh-skill-stats'

/**
 * **锁版**（不带 `^`）：`0.1.0` 是 `0.x`，语义化版本对它**不承诺兼容**；
 * 而本包吃的是「日志事件字段名」（`tool/call`）这一层，一次改名字段就全表归零。
 */
export const UPSTREAM_VERSION = '0.1.0'

/** 许可证：仓库 `package.json` 的 `license` 字段为 MIT；GitHub API `spdx_id` 亦为 MIT。 */
export const UPSTREAM_LICENSE = 'MIT'

/** 上游的挂载形状（`dsh` 段原文）。 */
export const UPSTREAM_DSH = Object.freeze({
  bundle: { patch: './cordis.patch.yml' },
  client: { inject: ['@deepseek-ai/dsh-client-runtime'], platform: 'web' },
})

/** 上游唯一的运行时依赖 —— 注意 `^` 落在 **rc 段**（`^0.1.0-rc.6`）。 */
export const UPSTREAM_DEPS = Object.freeze({ '@deepseek-ai/dsh-home-paths': '^0.1.0-rc.6' })

/** 上游暴露的三个只读接口（README「API」节原文）。 */
export const UPSTREAM_ENDPOINTS = Object.freeze([
  'GET /skill-stats/api/stats',
  'GET /skill-stats/api/stats?scope=current',
  'GET /skill-stats/api/stats?sessionId=...',
])

/**
 * TODO-C · 锁版加载器
 *
 *   P0  **`private: true` 决定了没法 `npm i`**：上游未发布到公共 registry
 *       （或至少本包不能假设它在）。只能 `link:` 本地 checkout，或从 git URL 装。
 *       → **这是本骨架能不能成立的第一道门**，见 README 问题 1。
 *   P0  `@deepseek-ai/dsh-home-paths@^0.1.0-rc.6` 是 **rc 段上的 `^`**：
 *       `^0.1.0-rc.6` 会放进 `0.1.x` 的后续 rc **与正式版**。宿主若锁的是另一个 rc，
 *       同一条 `skill-stats` 数据会来自两个不同版本的路径解析。
 *       → 引入前必须把这条依赖**一起锁到宿主在用的那个 rc**。
 *   P1  只调 HTTP 接口，**不 import 上游 `lib/*.js`** —— 上游产物是 `tsdown` 打的 ESM，
 *       `exports` 没有 `require` 分支，宿主若走 CJS 打包会 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
 */
export function loadUpstream() {
  throw new Error('TODO-C: 未实现（候选骨架，禁止挂载）')
}

/** TODO-D · 统一响应形状（占位）。 */
export function readStats() {
  throw new Error('TODO-D: 未实现（候选骨架，禁止挂载）')
}
