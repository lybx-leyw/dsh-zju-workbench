/**
 * 「屏上即所得」输入层 —— 把任意窗口的一帧画面接进既有会话（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。本文件只有占位与 TODO，
 *    **不写业务逻辑**。它把「将来要怎么接」的形状摆出来，供人工评审判断方向是否成立。
 *
 * # 这个包要做的事（意图）
 *
 * 本仓所有「把外部材料变成学习内容」的入口，都停在**文件**上：
 * 讲义是 PDF（`dsh-zhiyun-source-classroom`）、课表是 JSON（`dsh-zhiyun-source-zdbk`）、
 * 题目是 API（`dsh-zhiyun-core-question`）。于是凡是没有文件形态的东西 ——
 * 投屏上的板书、老师口述后写下的推导、课堂小测、板书旁的一句「这个会考」——
 * 只能靠手打，或者放弃。
 *
 * 上游 `dsh-orb` 的宿主半边（`@deepseek-ai/dsh-attachment` + `dsh-session-projection`
 * 那一层）提供的正是缺的那一步：**把一帧屏幕画面作为附件送进一次会话**。
 * 它自己把这些能力包在「Computer Use 预设 + 桌面悬浮球」里卖；本包只要**中间那一段**。
 *
 * # 三条必须守住的边界（评审重点，也是本包与上游全部差异所在）
 *
 * 1. **不引入 `preset-computer-use`**。上游 `cordis.patch.yml` 的第一件事是
 *    `insert: preset-computer-use` —— 那会新建一个 agent 模式，等于给工作台加一个
 *    新的「入口形态」。本仓的会话只有一个形态（问一问 / 课堂）。
 * 2. **不引入 `./client`（悬浮球）**。常驻桌面的球是**第三个外壳**：本仓外壳是
 *    `dsh-zhiyun-shell-workbench` + `dsh-zhiyun-shell-ui`，桌面球不在其中。
 *    它与「`dsh-radar-market` 不接 `dsh-client-ui-settings`」同一条理由：抢外壳主张。
 * 3. **入口仍长在既有页面里**：
 *    - 今天页（`dsh-zhiyun-page-today`）的「问一问」输入框旁 → 「截一段屏」；
 *    - 课堂页（`dsh-zhiyun-page-classroom`）的讲义工具栏 → 「补一张板书」。
 *    两处都是**原面板多一个按钮**，不新增导航、不新增页面。
 *
 * # 存储边界（评审必看）
 *
 * 截图**只进当次会话的附件流**，不落本仓数据目录：不写 notes store、不写 vault、
 * 不建 `attachments/` 子目录。要长期留存的话，是评审通过后由
 * `dsh-zhiyun-core-notes` 的既有「粘贴即附件」路径决定，**不由本包决定**。
 */

/** 上游包名（锁版，见 package.json；版本不得写 `^`）。 */
export const UPSTREAM = 'dsh-orb';

/** 上游锁定的版本（必须与 `package.json` / npm `dist-tags.latest` 一致）。 */
export const UPSTREAM_VERSION = '0.2.0';

/** 上游一并锁定的底层（`dsh-orb` 的 dependencies 里写死版本的两项）。 */
export const UPSTREAM_PINS = {
  '@deepseek-ai/cordis': '4.0.4',
  '@deepseek-ai/schemastery': '3.18.4',
};

/** 明确**不引入**的上游面（评审若要求引入，视为方向变更，需重新评审）。 */
export const REFUSED_UPSTREAM_FACES = [
  'preset-computer-use', // 新建 agent 模式 = 新入口形态
  'dsh-orb/client', // 桌面悬浮球 = 第三个外壳
];

export const name = 'dsh-radar-orb';

/**
 * cordis 插件入口（占位）。
 *
 * TODO(评审通过后):
 *  1. 由 `upstream.js` 取得上游宿主半边的会话附件服务，注册一个
 *     「capture → attach」能力（**不注册 agent 预设、不注册路由、不注册导航项**）；
 *  2. 今天页：在「问一问」输入框中继一层 `onCapture`，把返回的附件 id
 *     塞进既有会话（不改 `dsh-zhiyun-page-today` 的会话构造）；
 *  3. 课堂页：讲义工具栏加「补一张板书」→ 走同上附件路径，挂到当前讲义节点
 *     （不改 `dsh-zhiyun-source-classroom` 的解析链）；
 *  4. 权限：截图是敏感动作，必须复用宿主已有的用户授权通道
 *     （上游 `dsh-user-approval`），**本包不自建开关**；
 *  5. 卸载时只摘服务，**不删任何已产生的附件 / 会话记录**。
 */
export function apply(ctx) {
  ctx.logger?.info?.(
    `[${name}] 候选骨架占位：未评审、未接入 profile、不可直接使用（上游 ${UPSTREAM}@${UPSTREAM_VERSION} 锁版，当前不生效）`,
  );
}
