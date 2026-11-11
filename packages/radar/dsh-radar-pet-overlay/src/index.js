/**
 * 桌宠状态表情 · 插件入口（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。`apply()` 只打一行日志，
 *    不注册页面、不注册 slot、不注册工具、**不注册 shell.overlay**。评审驳回则整目录删除。
 *
 * # 定性：**强化式集成**（不是「全新」）
 *
 * 本仓 `page-planning` 右下角**已经有一个对话角色 pet**（`src/client.jsx:2504`
 * `/* pet：右下角的对话角色 *\/`，配套 `pet.js` / `pet-stream.js` / `pet-context.js`）。
 * 它已经能说话、能出卡、能在卡片上点「好」才落库 —— **唯独没有状态表情**：
 * 它不知道自己在「干活 / 思考 / 等你 / 出错」。
 *
 * 上游 `dsh-kun-like-pet` 恰好只做这一件事的**表现层**：9 行精灵图 × 8 列，
 * 每行一种状态（idle / runRight / runLeft / wave / jump / failed / waiting /
 * working / review），帧序与帧时长是现成的常量表。
 *
 * 本包把那张**帧表**接到已有 pet 上，不新增角色、不新增面板。
 *
 * # 三条判据
 *
 * | 判据 | 状态 | 说明 |
 * | --- | --- | --- |
 * | ① 仍是同一个面板 | ✅ | 渲染面是 `page-planning` 已有的 pet，不注册 `shell.overlay` |
 * | ② 功能仍相似正交 | ✅ | 已有 pet 管「说什么」，本包管「长什么样」；同一角色、两个正交维度 |
 * | ③ 底层多调了更优质实现 | ⚠ **带前提** | 上游的帧表确实比「一个静态头像」好；但上游**没有真实实现可锁**（见 upstream.js） |
 *
 * # 三条硬性裁剪（评审时请逐条确认）
 *
 * 1. **不装 `shell.overlay`**。上游把桌宠挂在全局覆盖层上；本仓已有一个分区内的
 *    pet，全局再飘一个是「重复且无增益」。
 * 2. **不调系统命令放音**。上游 `host.js` 用 `child_process` 执行 `afplay` /
 *    `powershell SoundPlayer` / `ffplay` 播放绝对路径的 mp3。本仓不引入这条通道：
 *    「会话完成必须响一声」是上一轮（r130 通知层轴）已判定**未成立**的需求，
 *    且跨平台系统命令 + 绝对路径是明确的供应链风险面。
 * 3. **不搬 2.0 MB 精灵图**。上游 `assets/spritesheet.webp` 2079622 字节、来自
 *    Codex 桌宠契约。评审若要做，应自绘或自采素材；**不得**把上游素材复制进本仓
 *    （CC 归属未声明，只有代码是 MIT）。
 *
 * # TODO（评审通过后才允许动）
 *
 * - [ ] 先确认上游 `dsh-kun-like-pet@1.0.0` 是否真的可从 npm 安装；不能则清空
 *       `dependencies`，只内联帧表常量（见 `cordis.patch.yml` 顶部说明）。
 * - [ ] 从 `page-planning/src/pet.js` 的现有事件流读出 4 个状态，映射到上游 9 行里
 *       的 4 行（idle / working / waiting / failed）；**不再造一套事件源**。
 * - [ ] 素材自备，放进 `assets/`，并在 `ATTRIBUTION.md` 里写清来源。
 * - [ ] 位置只在本页右下角，**不进 `docs/`、不进 `page-today`**。
 * - [ ] 若评审认为「一个静态头像已经够用」，正确结局是**整目录删除**。
 *
 * @param {import('cordis').Context} ctx
 */

export const name = 'radar-pet-overlay';

export function apply(ctx) {
  // 骨架不挂任何东西：不注册页面、不注册 slot、不听事件、不调上游。
  ctx?.logger?.info?.(
    '[radar-pet-overlay] 候选骨架 · 未评审 · 未接入 profile · 不可直接使用；apply() 为空实现，见 README.md',
  );
}
