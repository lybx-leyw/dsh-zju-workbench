/**
 * 白板注解层 —— 「笔记 / 论文」页的内嵌 .drawio 画布（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。本文件只有占位与 TODO，
 *    **不写业务逻辑**。与本仓 `dsh-zhiyun-host-paper` 的差别：那一份已是可跑实现，
 *    这一份只是把「将来要怎么接」的形状摆出来，供人工评审判断方向是否成立。
 *
 * # 这个包要做的事（意图）
 *
 * 「笔记」页现在只有 Markdown（`dsh-zhiyun-core-notes`：`zy://section` / `zy-asset`
 * 内链，零 UI、零落盘）；「论文」页只有 PDF/精读（`dsh-zhiyun-page-paper`）。
 * 两者都只有**文字**一种表达 —— 公式推导、架构草图、算法流程这类内容，
 * 用文字写会变形，用图片贴又不可编辑、不可 diff。
 *
 * 上游 `@guowenzhang/dsh-whiteboard` 提供了**可编辑的 .drawio 画布**（开放格式，
 * 也能在 draw.io 桌面端打开），这正是缺的那一层；它自己的 patch 与客户端半边
 * 则默认把白板当**独立导航项**（左侧「Whiteboards」）——那是**新面板**，
 * 与本仓「同一面板」的主张冲突。
 *
 * # 为什么不接它的客户端半边（本包最关键的判断）
 *
 * 上游 `dsh.client.inject` 里列着 `dsh-client-ui-layout` / `-sidebar` /
 * `-sidebar-right` / `-workspace`，并自带 `./client` 导出 —— 它会**自建左侧导航
 * 与整块 workspace 视图**。这与 `dsh-radar-market` 不接 `dsh-client-ui-settings`
 * 是同一条理由：抢本仓外壳的布局主张。
 *
 * ⇒ **只挂宿主半边（文件读写 + 画布运行时），UI 由 `dsh-zhiyun-core-notes` /
 *   `dsh-zhiyun-page-paper` 以 iframe 承载。**
 *   该承载层**不在本骨架范围内**，是人工评审通过后、接入之前必须完成的前置工作
 *   （效法 `packages/dsh-zhiyun-paper` 的 iframe + 主题注入 + 接管控件三件套）。
 *
 * # 存储边界（评审必看）
 *
 * 上游把白板存在**插件自己的 `files/` 目录**（README「Notes」一节明写），
 * 不在 workspace 里。这正是它能被"锁版挂载"的前提 —— 不写本仓数据目录、
 * 不与 `dsh-zhiyun-core-notes` 的 store 抢键。代价是：笔记与白板的对应关系
 * 只能靠本包旁挂的**索引文件**维护，索引格式在评审时需先定死。
 */

/** 上游包名（锁版，见 package.json；版本不得写 `^`）。 */
export const UPSTREAM = '@guowenzhang/dsh-whiteboard';

/** 上游编辑器依赖（peerDependencies 要求，必须与上游同轮锁版挂载）。 */
export const UPSTREAM_EDITOR = '@guowenzhang/dsh-drawioedit';

export const name = 'dsh-radar-whiteboard';

/**
 * cordis 插件入口（占位）。
 *
 * TODO(评审通过后):
 *  1. 由 `upstream.js` 取得上游宿主半边的服务，注册「画布读写」能力
 *     （create / open / save / export-svg），**不注册任何路由或导航项**；
 *  2. 在 `dsh-zhiyun-core-notes` 的 `zy-asset` 解析链上挂 `board://<id>` 协议
 *     → 返回 iframe 承载地址（URL 拼接在本包内，不改 notes 的解析器主干）；
 *  3. 为论文页补「批注板」：`paper://<docId>#<page>` → 对应白板 id 的映射表；
 *  4. 主题注入：把本仓 shell 的 CSS 变量透传进 iframe（效法 dsh-zhiyun-paper）；
 *  5. 卸载时只摘服务，**不删上游 `files/` 下的既有画板文件**。
 */
export function apply(ctx) {
  ctx.logger?.info?.(
    `[${name}] 候选骨架占位：未评审、未接入 profile、不可直接使用（上游 ${UPSTREAM}@0.4.0 锁版，当前不生效）`,
  );
}
