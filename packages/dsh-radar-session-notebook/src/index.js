/**
 * dsh-radar-session-notebook —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把上游 `@timestatic/dsh-session-notebook`（Apache-2.0，npm 已发布 0.1.0）
 * **锁版挂载**进来，补上本仓**「对话 → 笔记」这条断掉的边**：
 * 在对话轨迹里**划线、引用**，把片段整理成**可搜索 / 可打标签 / 可导出**的
 * 个人知识库，落在「今天」页与「笔记」页之间。
 *
 * ── 当前的通路为什么是断的 ──────────────────────────────────────
 *
 *   「今天」页（`dsh-zhiyun-page-today`）：能看到今天发生了什么（课程、待办、轨迹），
 *       但**看不见「我在对话里读到过什么」** —— 对话是一维流水，划不出重点。
 *   「笔记」页（`dsh-zhiyun-page-notes`）：Obsidian 式笔记库（文件树 / 双链 / 反链 / 标签），
 *       但**入口只有「新建一篇」** —— 内容要人自己敲，**没有「从对话里摘一段」的入口**。
 *
 *   中间这一段（选中 → 引用 → 落库）**本仓完全空白**。
 *
 * ── 为什么是「强化式集成」而不是简单集成 ────────────────────────
 *
 * 三条同时成立：
 *   1. **仍是同一个面板** —— 「今天」页的对话轨迹 + 「笔记」页的笔记库，不新增导航项。
 *      （⚠ 上游默认往 **4 个宿主插槽**注入 UI，直接挂会变成「全站划线」——见 TODO-1，
 *      这是本候选**必须**先解决的一条，否则判据 1 不成立。）
 *   2. **功能仍相似正交** —— 「在对话里读到过什么」与「我笔记库里有什么」是同一域
 *      的两个不同问题，不是同一件事做两遍。
 *   3. **底层多调了更优质实现** —— 上游有本仓**没有**的三样：
 *      **文本锚定**（`text-anchor.js`：重开会话仍能定位到原句，不靠偏移量硬猜）、
 *      **消息高亮 + 引用**（`message-highlights.js` / `quote.js`）、
 *      **快照与恢复**（`snapshot-*.js` / `restore-*.js` / `json-backup.js`：预算内增量快照 + 可恢复）。
 *      本仓笔记域是**纯存储**，没有任何一处做锚定或快照。
 *
 * ── 集成方式（效法 packages/dsh-zhiyun-host-paper）────────────────────
 *
 *   ❌ 不改上游源码。
 *   ✅ 锁版（写死 0.1.0，不用 `^`）引入上游。
 *   ✅ 由本包 `cordis.patch.yml` 把上游挂进 DSH 运行时。
 *   ✅ 客户端**只在本仓自有面板内叫它**，不接管全局插槽（见 TODO-1）。
 *
 * ── TODO（评审通过后再动，本轮一律不实现）───────────────────────
 *
 *  TODO-1 【阻塞项】把上游的「宿主半边」与「客户端半边」拆开：
 *          本包只想挂 `@timestatic/dsh-session-notebook` 的 host 入口
 *          （`exports["."] -> ./src/host/index.js`），客户端由自有面板按需 import
 *          （`exports["./client"]`）。先确认上游能否**单独** import `.` 而不触发
 *          `dsh.client.inject` 的四个插槽；不能则改判 🟡、走源码级移植。
 *
 *  TODO-2 落点：在 `dsh-zhiyun-page-today` 的轨迹区加「选中即引用」，
 *          不新开面板；引用产生的条目写入「笔记」页当期 vault 的**同一棵树**
 *          （不改 `dsh-zhiyun-core-vault` 的存储形状，只多一类来源标记）。
 *
 *  TODO-3 锚定语义：上游的 `text-anchor.js` 与我们 `zy://section/<账号>.<节次>`
 *          是两套定位体系。需要一个**双向映射**（会话消息 → 课程节次），
 *          否则笔记点回去只会落在对话，不会落在播放位置。
 *
 *  TODO-4 存储冲突：上游有自己的 json 存储与备份；本仓笔记是**磁盘上的 .md 文件**。
 *          必须裁定**谁是唯一真源**（建议：.md 为真源，上游只作捕获层与快照层）。
 *          两侧都写会造成同一段文字两个真相。
 *
 *  TODO-5 隐私：划线内容来自对话，可能含个人材料。落库前要过本仓既有的
 *          「不写入未授权内容」检查，并在导出时保留来源（会话 id + 时间）。
 *
 *  TODO-6 许可证双源：npm 包的 `license` 字段为空，GitHub 与 LICENSE 为 Apache-2.0。
 *          评审时向上游提 issue，补 `license` 字段（发布产物合规）。
 *
 *  TODO-7 测试：补 `tests/radar-session-notebook.test.mjs`，
 *          断言「声明版本 = 实际安装版本 = `upstream.js` 常量」三者一致。
 */

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

/** 插件名（与目录名、patch 的 id/name 一致）。 */
export const name = 'dsh-radar-session-notebook';


/**
 * 占位入口。**不做任何事** —— 返回的是一份「我打算做什么」的描述，
 * 由宿主按需读取（本骨架不注册任何路由、不注入任何 UI）。
 */
export function describe() {
  return {
    status: 'candidate-skeleton',
    reviewed: false,
    wiredIntoProfile: false,
    upstream: { package: UPSTREAM_PACKAGE, version: UPSTREAM_VERSION },
    todos: [1, 2, 3, 4, 5, 6, 7].map((n) => `TODO-${n}`),
  };
}

/**
 * 上游版本核对（不抛错）。
 *
 * 为什么**不抛**：本骨架根本没有被挂载，抛错只会在评审时把宿主带崩，
 * 而评审者真正需要的是「装的是不是我以为的那个版本」这句话。
 */
export function verifyUpstream(installedVersion) {
  return {
    expected: UPSTREAM_VERSION,
    installed: installedVersion ?? null,
    ok: installedVersion === UPSTREAM_VERSION,
  };
}
