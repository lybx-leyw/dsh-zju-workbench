/**
 * dsh-radar-tool-plus —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再逐条落实 TODO；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把上游 `@xiaoso/dsh-tool-plus`（MIT，npm 已发布 0.1.14）**锁版挂载**进来，
 * 顶替本仓「今天」页终端面板里的那套工具：**持久 shell**（`cd` / `export` 跨调用保持）、
 * **结构化 read**（行区间、归档 / SQLite / PDF / 图片直读）、**多模式 edit**、
 * **原子 write + diff**、**grep / glob**。
 *
 * ── 当前的通路为什么不够 ───────────────────────────────────────
 *
 *   「今天」页（`dsh-zhiyun-page-today`）里有一个终端分页，跑的是宿主官方 `bash` 工具：
 *   每次调用**都是新 shell** —— `cd` 丢、`export` 丢、`conda activate` 丢。
 *   于是「进目录 → 跑脚本」要写成一长串 `cd … && …`；
 *   课设仓库里 `git log` 一刷几百行，直接灌进上下文，把这一轮的预算吃掉；
 *   想读某个函数的第 120–180 行，只能 `sed -n` 或者整文件读进来。
 *
 *   这几件事本仓**全部没有**，但都属于「同一块面板里的同一类操作」。
 *
 * ── 为什么是「强化式集成」而不是简单集成 ────────────────────────
 *
 * 三条同时成立：
 *   1. **仍是同一个面板** —— 终端分页还在「今天」页，不新开导航项、不新增顶层入口；
 *      只是这一格里敲的命令换了个更聪明的执行器。（⚠ 前提是**不整包套用上游 patch**，
 *      见 TODO-1：上游 patch 会停用四行官方工具，那是「换掉整层」，不是「强化一格」。）
 *   2. **功能仍相似正交** —— 「在终端里跑命令」与「跑完把输出交回给模型看」是同一条通路
 *      的两段；上游动的正是第二段（输出压缩、后台化、落盘可回读），不是另做一件事。
 *   3. **底层多调了更优质实现** —— 上游内核是 [oh-my-pi](https://github.com/can1357/oh-my-pi)
 *      （MIT，★35.8k，当日仍在推送）的工具套件，本仓终端分页**没有**：持久会话、
 *      输出最小化、后台作业托管、`rm` 回收站、行区间读取、AST 结构化检索。
 *
 * ── 集成方式（效法 packages/dsh-zhiyun-paper）────────────────────
 *
 *   ❌ 不改上游源码。
 *   ✅ 锁版（写死 0.1.14，不用 `^`）引入上游。
 *   ✅ 由本包 `cordis.patch.yml` 挂载，但**只挂一条 insert**，不复刻上游那三份 patch。
 *   ✅ 客户端不接管全局插槽（上游 inject 的是 locale / settings 两个面，不是全站 UI）。
 *
 * ── TODO（评审通过后再动，本轮一律不实现）───────────────────────
 *
 *  TODO-1 【阻塞项】不套用上游 patch。上游 `cordis.patch.yml` 会 `disabled: true` 掉
 *          `tool-bash` / `tool-pwsh` / `tool-fs` / `tool-fs-search` 四行，用自己的实现顶替。
 *          本仓的沙箱治理（`dsh-zhiyun-shell` 的权限模式）与 `ctx.shell` 能力缝
 *          （hooks / tmux-context 等消费者）都依赖这几行。**须先确认**：能否只把
 *          「终端分页用哪个执行器」这一处重定向到上游，而不动其余三行；
 *          不能则**降级 🟡**，改为抽取 `src/bash-runtime` 做源码级移植。
 *
 *  TODO-2 沙箱语义对齐。上游 patch 里明确写着「OMP executor does not confine commands,
 *          so no sandbox-permission parameters are advertised」——**它没有沙箱参数**。
 *         本仓是「无独立 API key、受限权限」的工作台，若终端分页绕过沙箱，
 *          等于把 `danger-full-access` 变成默认。**这一条不解决就不能接**。
 *
 *  TODO-3 安装期放行。上游需要 `--allow-build=@xiaoso/dsh-tool-plus` 与
 *          `--allow-build=koffi` 两次放行（pnpm ≥ 10.4；pnpm 11 起不放行直接报
 *          `ERR_PNPM_IGNORED_BUILDS`）。本仓 `profile:init` 走的是 pnpm workspace，
 *          需确认能否在 profile 的 `pnpm-workspace.yaml` 里声明 `allowBuilds`，
 *          而不是让每个使用者手工执行命令。
 *
 *  TODO-4 二进制可审性。`@oh-my-pi/pi-natives@18.1.17` 分发的是上游**编译好的二进制**
 *          （Rust 版 hashline 编辑引擎）。「不搬源码」原则在二进制上无从核对，
 *          须裁定：接受上游 `THIRD_PARTY_NOTICES.md` 的声明，还是**关掉 hashline**、
 *          只用纯 JS 的 `replace` / `patch` 编辑模式（上游 `edit` 默认就是 `replace`，
 *          关掉不影响主路径）。
 *
 *  TODO-5 运行时锁版核对：读 `node_modules/@xiaoso/dsh-tool-plus/package.json` 的
 *          `version`，与 `UPSTREAM_VERSION` 比对，不一致时**不抛错、只上报**
 *          （页面显示「执行器版本与预期不符」）。与 `dsh-radar-session-notebook` 同款处理。
 *
 *  TODO-6 落点收窄：优先只覆盖终端分页；「今天」页的检索 / 笔记 / 论文各面板
 *          继续用本仓自己的工具，**不要**因为装了这个包就全局换掉。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_REPOSITORY,
  UPSTREAM_PATCH_FILES,
  UPSTREAM_DISABLES_HOST_TOOL_IDS,
  UPSTREAM_RUNTIME_RISKS,
} from './upstream.js';

export const name = 'dsh-radar-tool-plus';

export { UPSTREAM_PACKAGE, UPSTREAM_VERSION, UPSTREAM_REPOSITORY };

/**
 * 供页面 / 设置页展示的「锁版状态」。真实实现要读安装后的 manifest（见 TODO-5）。
 * 现在恒为 `unknown` —— 骨架没有实现，任何数值都会是编造的。
 */
export const upstreamStatus = {
  package: UPSTREAM_PACKAGE,
  expectedVersion: UPSTREAM_VERSION,
  installedVersion: null,
  repository: UPSTREAM_REPOSITORY,
  state: 'unknown',
  // 评审时要紧盯着看的三组元数据，从 upstream.js 单一真源取，不在这里重抄一遍。
  patchFiles: UPSTREAM_PATCH_FILES,
  disablesHostToolIds: UPSTREAM_DISABLES_HOST_TOOL_IDS,
  runtimeRisks: UPSTREAM_RUNTIME_RISKS,
};

/**
 * 宿主半边注册入口。
 *
 * TODO-1 骨架：评审通过后在此注册「终端分页执行器」的重定向，
 * 并**只**重定向这一个落点 —— 不调 `ctx.plugin()` 去装上游那三份 patch。
 */
export function apply(/* ctx */) {
  // 骨架：不做任何事。直接返回而不是抛错 —— 万一被误接入 profile，
  // 抛错会让整个工作台起不来（CONTRIBUTING 3.1）；静默空转至少还能启动。
}
