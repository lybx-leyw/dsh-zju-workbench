/**
 * 上游封装占位 —— `dsh-prompt-market@0.1.3`（MIT）。
 *
 * ── 为什么要有这一层 ────────────────────────────────────────────
 *
 * 本仓的惯例（见 `dsh-zhiyun-paper` / `dsh-zhiyun-page-paper`）是：
 * 上游一律**锁版引入 + 外围兼容层**，业务代码只跟本文件说话，不直接 import 上游。
 * 这样上游升级 / 换源 / 甚至换实现时，改动面被压在**一个文件**里。
 *
 * ── 上游形状（已核实，2026-11-02） ──────────────────────────────
 *
 * | 项 | 值 |
 * | --- | --- |
 * | npm 包 | `dsh-prompt-market@0.1.3`（`registry.npmjs.org` 可达） |
 * | 许可证 | MIT（npm `license` 字段 + 仓库根 LICENSE 一致） |
 * | 运行时依赖 | **无**（`dependencies` 为空） |
 * | 构建 | **无**（无 `prepare`，`files` 直接发源码） |
 * | `exports` | `.` → `index.js`（Host 半身）、`./client` → `client.js`（浏览器半身） |
 * | `dsh` | `bundle.patch: ./cordis.patch.yml`、`client.platform: web`、`client.immediately: true` |
 * | Host 半身 | `inject: []`、`apply` 空实现 —— 零后端 |
 * | 浏览器半身 | `window.__ModuleLoader__.load()`；`globalThis.__pmCore`（数据层）+ `__pmUi`（UI） |
 * | 注册槽位 | `conversation.input.left`（按钮，order 80）、`conversation.input.overlay`（浮层，order 80） |
 * | 数据 | 自管 localStorage：`favorites` / `customs` / `tags` |
 * | 远端源 | `core/sources.js` 默认拉远端目录，含 `api.github.com` base64 兜底 |
 *
 * ── 一个必须知道的细节 ──────────────────────────────────────────
 *
 * 浏览器半身把数据层挂在 `globalThis.__pmCore`（`api.createDataLayer({})` →
 * `init()` → `search()`），**没有** `ctx.provide` 之类的正式服务出口。
 * 这意味着「别的插件想复用它的提示词库」只能读全局对象 —— 属于隐式契约，
 * 上游一改就断。**本包不依赖它**：若将来需要读提示词，走 TODO-2 的「导出」通路，
 * 而不是直接摸 `__pmCore`。
 */

/** 锁定的上游版本（与 `package.json` 的 `dependencies` 必须逐字一致）。 */
export const UPSTREAM_NAME = 'dsh-prompt-market'
export const UPSTREAM_VERSION = '0.1.3'

/** 许可证核验记录。 */
export const LICENSE = {
  spdx: 'MIT',
  sources: ['npm package.json license', 'repository LICENSE'],
  consistent: true,
  verifiedAt: '2026-11-02',
}

/**
 * 加载上游（占位，当前**恒失败**）。
 *
 * 现在是故意返回失败的：评审未通过前不允许有任何代码路径真的去 import 上游。
 * 落实 TODO-1 / TODO-2 时，把这里换成
 * `const mod = await import('dsh-prompt-market'); return { ok: true, mod };`
 * ——并且**只在**本文件里出现这一句 import。
 *
 * @returns {Promise<{ok: false, reason: string}>}
 */
export async function loadUpstream() {
  return {
    ok: false,
    reason: '骨架占位：上游未接入（见 README「三条判据」与 src/index.js TODO-1/2/3）',
  }
}

/**
 * 上游是否支持「纯本机模式」（不拉任何远端目录）。
 *
 * TODO-2：需要读 `core/sources.js` 的 catalog 分支才能确认。
 * 在确认之前**一律按「不支持」处理** —— 宁可判死，也不要让评审以为它能离线跑。
 *
 * @returns {{supported: false, reason: string}}
 */
export function localOnlySupport() {
  return {
    supported: false,
    reason: '未核实：上游 catalog 默认含远端源与 github base64 兜底，尚无「只留自定义」的开关证据',
  }
}
