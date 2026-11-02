/**
 * dsh-radar-sketchpad —— 上游封装占位（A 类）。
 *
 * ⚠ 未评审 · 不可直接使用。这里只有**占位与笔记**，没有任何实现。
 *
 * ## 上游事实（2026-11-02 实核，均来自 npm tarball / GitHub 文件树，不来自 README）
 *
 * - `dsh-sketchpad@0.1.1`（MIT，作者 bmhty123，仓库 ★2，2026-11-01 仍在推）
 * - `dependencies` 为空；唯一 peer 是宿主的 `@deepseek-ai/cordis ^4.0.0`
 * - `dsh.bundle.patch → ./cordis.patch.yml`，patch 里是 `insert: [{ id: dsh-sketchpad, name: dsh-sketchpad }]`
 * - `dsh.client = { platform: "web", external: ["react", "react-dom"] }` —— **纯客户端插件**
 * - 宿主半侧 `lib/index.js` 只有 12 行：`export const name` + 空的 `apply()`，**没有 `ctx.provide`**
 * - 客户端 `lib/client.js` 共 72,803 B，注入 **1 个服务 + 3 个槽位**：
 *   - `ctx.inject(["commandUi"])`
 *   - `conversation.input.left`（输入框 `+` 菜单里的「画板」、`/sketchpad`）
 *   - `conversation.input.right`
 *   - `sidebar.right.pane.tab`（右侧栏竖版画板）
 * - 真正往消息里塞图走的是宿主 `conversation` 服务的 `createDrafts(...)`
 *   （`draft.points` / `draft.kind` / `draft.width` / `draft.color` 是笔画级 API）
 * - 画笔能力：水笔 / 直线 / 箭头 / 删除笔画，笔宽 4·7·12，黑红蓝，`Shift` 吸附 0°/45°，
 *   撤销 40 步、重做、双指轻点撤销，触摸屏 Palm rejection（按本机手指尺寸自学习，下限 55 px）
 * - **不写网络、不读消息内容**；只碰宿主的草稿附件 API、会话输入状态、右侧栏 API 与 `localStorage`
 * - 已知限制（上游自陈）：无压感；两块画板内容互相独立；尺寸固定；刷新页面清空
 *
 * ## 本仓现状（决定了「是不是强化式集成」）
 *
 * | 本仓位置 | 现有 | 缺口 |
 * | --- | --- | --- |
 * | `dsh-zhiyun-core-classroom-stage/src/geometry.js` | `SHAPE_PATHS` 只有 **3 个**：`rectangle` / `circle` / `triangle`，路径写死，全部落在 1000×1000 viewBox；白名单外的名字**刻意不许退化成矩形** | 讲「流程 / 判定 / 关系 / 坐标系」时没有 line / arrow / diamond / text / freeform |
 * | 同上 | 动作由 DSL 给出（`wb_draw_shape`），几何合法性走 `dsh-zhiyun-classroom-geometry` 的 `validateShapeGeometry` | **没有「人手直接画」这条输入通道**；手绘只能画成图片贴进来，不参与 DSL |
 * | 全仓 `packages/dsh-zhiyun-*/src` | `createDrafts` 命中 **0**；`conversation.input.left` / `conversation.input.right` / `sidebar.right.pane.tab` 命中 **0**；`commandUi` 命中 **0** | 上游那三个入口在本仓**一个都没占**，所以**不抢槽位**（与 `dsh-prompt-market` 那次「两枚按钮抢同一槽位」的情况不同） |
 *
 * ## 判据核对（强化式集成三条）
 *
 * | 判据 | 成立？ | 依据 |
 * | --- | --- | --- |
 * | ① 仍是同一个面板 | ✅（但有条件） | 课堂页 `dsh-zhiyun-page-classroom` 的舞台仍是唯一画布；不新增导航项、不新增右侧栏标签页。**条件**：上游自带的「右侧栏竖版画板」必须关掉，否则等于多出一个页面 |
 * | ② 功能仍相似正交 | ✅ | 现有是「按 DSL 动作画形状」，本包加的是「同一舞台上人手补一笔」。都是「在课堂页面上画」，但一个由脚本驱动、一个由人驱动，互不替代 |
 * | ③ 底层多调了更优质实现 | ⚠ **只成立一半 —— 评审必须先回答这个问题** | 上游带来的**真增量**是笔画级手感（压感自学习、Palm rejection、吸附、40 步撤销）与一个已经跑通的「画完落成附件」链路，这两样本仓都没有。**但它画出来的东西是 PNG，不进 DSL 的 `SHAPE_PATHS`**。想把形状从 3 个扩到 8 个，仍要**本仓自己**往 `SHAPE_PATHS` 加路径并过 `validateShapeGeometry` —— 那部分**不借用上游任何代码**，只是借用「手画这一笔的坐标流」 |
 *
 * ## 评审第一步（必须先做，否则本骨架应作废）
 *
 * 1. 在 `packages/dsh-zhiyun-core-classroom-stage` 里 grep 舞台的实际载体：它是 React 画布还是 iframe？
 *    若是 iframe（如 `dsh-zhiyun-page-paper` 那种承载方式），上游的 `conversation.input.*` 槽位
 *    **进不了 iframe 内部**，本骨架的形态要整体改成「在外层包一个画板浮层」。
 * 2. 跑一次上游 tarball 的 `lib/client.js`，确认 `ctx.get("conversation").createDrafts`
 *    在本仓宿主版本上存在（本仓是 `0.2.0-rc.2`，上游 README 只承诺 `0.2.1-rc.2+` —— **版本口径不一致**）。
 * 3. 若第 2 条不成立：降级为「只借 `SHAPE_PATHS` 扩充 + 上游的手感参数」，**不挂 bundle**。
 */

/** 锁定的上游版本。改动必须同时改 package.json 的 dependencies。 */
export const SKETCHPAD_VERSION = '0.1.1';

/** 上游占用的槽位（本仓当前 0 占用，见 README 表格）。 */
export const UPSTREAM_SLOTS = Object.freeze([
  'conversation.input.left',
  'conversation.input.right',
  'sidebar.right.pane.tab',
]);

/** 上游注入的宿主服务。 */
export const UPSTREAM_SERVICES = Object.freeze(['commandUi']);

/** 上游客户端依赖的宿主 API。 */
export const UPSTREAM_HOST_API = Object.freeze(['conversation.createDrafts']);

/** 一句话描述兼容层要处理的表面，给 index.js 的日志用。 */
export function describeCompatSurface() {
  return `上游占 ${UPSTREAM_SLOTS.length} 个槽位、${UPSTREAM_SERVICES.length} 个服务、依赖 ${UPSTREAM_HOST_API.join('/')}`;
}

/**
 * TODO（评审通过后实现）：
 *   1. 重定向入口：把上游 `conversation.input.left` 里的「画板」按钮改为打开课堂页内的画布，
 *      并关掉上游 `sidebar.right.pane.tab`（课堂页已有舞台，不需要第二个画板标签页）。
 *   2. 笔画落库：上游 `完成` 时出 PNG；本包在 PNG 之外**另存一份笔画数组**
 *      （每笔 = `{ points: [[x,y],...], width, color }`），供 `dsh-zhiyun-core-classroom-stage`
 *      的 `ledger` 作为一条舞台动作记录 —— DSL 侧只看数组，不看 PNG。
 *   3. 形状扩充：在 `SHAPE_PATHS` 里补 `line` / `arrow` / `diamond` / `text` / `ellipse`，
 *      每个都必须先过 `validateShapeGeometry({ path, viewBox: [1000, 1000], width, height })`；
 *      白名单外的名字**继续不许**退化成矩形。
 *   4. 坐标系：上游浮窗是 1600×1000、侧栏是 1000×1333，舞台是 1000×1000 且 `viewportRatio` 是 高/宽
 *      —— 三套坐标系必须在落库前归一到 `WHITEBOARD_VIEWPORT_SIZE`，否则线会画歪。
 */
export function createCompatLayer() {
  return {
    ready: false,
    reason: '候选骨架：未评审，未实现兼容层',
    upstream: SKETCHPAD_VERSION,
  };
}
