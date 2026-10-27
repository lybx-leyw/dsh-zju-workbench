/**
 * dsh-radar-plugin-ledger —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**：只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**
 * （`@zseven-w/dsh-harbor`），只从 `./upstream.js` 取锁版凭据。`apply()` 直接抛错，
 * 目的与 `dsh-radar-kb-rag` 相同 —— 万一有人误挂，**立刻响**，
 * 而不是静默转成一个什么都不做的包。
 *
 * ── 这个包想做什么（强化式集成，不是新建功能）───────────────────────
 *
 * 「插件」页（`packages/dsh-zhiyun-page-plugins`，885 行）现在回答的是
 * **「谁依赖谁、谁可以取消」**：`buildView()` 把模块边（`ctx.modules.manifest.modules`）、
 * 服务硬边（fiber 的 `inject` + `ctx.reflect.store`）、插槽边（`ctx.slots.snapshot()`）
 * 折成一张拓扑序的表，每一行给 `deps` / `dependents` / `waiting` / `leaf` / `cancellable`。
 *
 * 它**没有**的那一维是：**这个包装了什么能力、会不会起进程、会不会往外发、是谁的、什么许可**。
 * 全仓 `grep -rniE "spdx|license" packages/dsh-zhiyun-<pkg>/src` → **0 条**。
 * 而本仓恰恰是**锁版引入第三方上游**的形态（`dsh-zhiyun-host-paper` 锁
 * `@ggboy123/dsh-paper-reader@1.3.1`，`ATTRIBUTION.md` 靠人手维护）。
 *
 * `@zseven-w/dsh-harbor@0.1.0-rc.4` 正好补这一维，且它的扫描器 `./scan`
 * **不碰 ctx、同步纯函数**（`inspectPlugin({ dir, name })` + `reconcile(report)`，
 * 实测 12 ms / 129 ms）—— 于是它接进来之后：
 *
 *   - 面板还是那个面板（**同一张表、同一行**，不新建页面、不加侧栏）；
 *   - 功能还是那件事（认识一个已装包的形状），只是从**结构**扩到**能力与出处**；
 *   - 底层换成了别人的实现（13 项能力词表 + `file:line` 证据 + `undeclared/unused` 对账）。
 *
 * 三条同时成立 ⇒ 「重复且可强化」，**不是**「重复且无增益」。
 *
 * ⚠ 但第三条要**打折**：M3 实测它会把**注释行**当证据（`src/egress.js` 第 4/6/16/20/21/146 行
 * 全是块注释）。所以「更优」只能理解为「**有底座 vs 没有底座**」，
 * **不能**写成「更准」，界面上必须标「启发式，可能命中注释」。
 *
 * ── 为什么 `apply()` 里要抛错，而不是「先空着」 ──────────────────
 *
 * 上游 `register()` 失败只 `warn`、不抛错；若扫描根与本仓 profile 不在同一处
 * （TODO-0），`scan()` 会返回**空列表**而不是报错。两种失败都**不响**。
 * 如果再叠一层「本包也不报错」，评审就永远发现不了。
 * ⇒ 宁可 `apply()` 抛错（响的失败），也不要一个不响的壳。
 *
 * ── TODO 一览（全部是评审要先拍板的，不是「怎么写代码」）───────────
 *
 *   TODO-0【阻塞】扫描根对不上。
 *         上游 `discoverInstalls()` 以 `$DSH_HOME/profiles`（默认 `~/.dsh/profiles`）为根，
 *         本仓 profile 在**仓库内**的 `profiles/zhiyun-bench/`。
 *         核实方式：在真机上跑 `scan({ root: <本仓 profiles 目录> })`，看 `plugins` 是否非空。
 *         - 非空 → 继续。
 *         - 空 → **不要接这个包**；它会返回一张空表，而「插件」页照常打开。
 *
 *   TODO-1【阻塞】挂载形态：**只挂宿主半边**（`webServer` 路由），**不消费** `./client`。
 *         理由：本仓「插件」页已经列出了全部包，再挂上游的 `settings.section`
 *         就是「一个概念两个入口」。
 *
 *   TODO-2 哪几项能力进那一行？提案见 `CAPABILITIES_FOR_ROW`（4 项），其余折叠。
 *         注意 `tool-registration` / `env-read` 是 `heuristic` 档（上游自己标的 tier），
 *         展示时必须区分 `static` 与 `heuristic`。
 *
 *   TODO-3 体积：`unpackedSize` 1,202,836 B，含 16 份多语 README 与 4 张 png。
 *         随包分发前要不要裁 `files`？（裁剪 = 改上游清单，**只能在本地 fork 或 patch**，
 *         与「不改上游源码」冲突 → 建议**接受体积**，不要裁。）
 *
 *   TODO-4 两条**会联网**的路由（`/updates`、`/preflight*`）要不要挂？
 *         本仓既有叙述是「本地优先」；上游注释写明「Network only on an explicit
 *         panel action」。若不允许联网，就别注册这三条（`NETWORK_ROUTES`）。
 *
 *   TODO-5 许可证字段**不在上游**（M4）→ 必须**自写**：读每个包的
 *         `package.json.license`（SPDX 字符串或 `{ type }`）。不要写成「harbor 提供」。
 *
 *   TODO-6 挂载后自检：取 `/_dsh/dsh-harbor/ping`，核对 `routes.mounted.length === 6`
 *         且 `failed` 为空 —— 这是唯一能把「路由没挂上」显形的位置。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  REQUIRED_SERVICES,
  UPSTREAM_ROUTES,
  CAPABILITY_IDS_SNAPSHOT,
} from './upstream.js';

export const name = 'radar-plugin-ledger';

/**
 * 上游宿主半边需要的宿主服务。**声明在这里**，让 cordis 等它就绪后再激活本包 ——
 * 否则本包会在 `webServer` 注册之前执行（loader 用 `Promise.allSettled` 并发激活），
 * `ctx.get('webServer')` 拿到 `undefined`，上游只 `warn` 一行然后什么都不挂。
 */
export const inject = REQUIRED_SERVICES;

/**
 * @param {import('@deepseek-ai/cordis').Context} _ctx
 */
export function apply(_ctx) {
  throw new Error(
    'dsh-radar-plugin-ledger 是候选骨架（未评审、未接入 profile、不可直接使用）：'
      + '请先裁决 TODO-0（扫描根 ~/.dsh/profiles 是否与本仓 profiles/ 同一处）'
      + '与 TODO-4（是否允许两条联网路由）。'
      + `上游 = ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}，将注册 ${UPSTREAM_ROUTES.length} 条回环路由`
      + `、提供 ${CAPABILITY_IDS_SNAPSHOT.length} 项能力词表。`,
  );
}
