/**
 * dsh-radar-night-charge —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 从上游 `ZJU-ontime-charge`（symudie/ZJU-ontime-charge，MIT，单文件 CLI
 * `neptune.mjs`，375 行，零运行时依赖）提取**「预约 → 到点开电 → 重试窗」这一条
 * 状态机**，接到本仓「今天」页的**次日清晨时段**上：
 *
 *   (a) **预约模型**：`{ atMs, devaddress, port, bookedAt }` —— 一个可持久化的队列
 *   (b) **到点执行**：到 `atMs` 调 `startCharging(devaddress, port)`，失败在
 *       `retryMinutes`（上游默认 15 分钟）内重试，过期超 1 小时直接丢弃
 *   (c) **状态只读**：余额 / 是否在充 / 当前订单（对应上游 `status`）
 *
 * ── 为什么是「强化式集成」而不是简单集成（B 类，三条同时成立）──────
 *
 *   1. **仍是同一个面板** —— 不新增页面。「今天」页 `agenda.js` 的时段投影
 *      （`projectAgenda`）继续是唯一渲染入口，只是在**次日 06:30 前后这段时间**
 *      多出一行「昨晚预约的充电桩」状态。不新开「充电桩」面板。
 *   2. **功能仍相似正交** —— 本仓全仓 `grep -ri "charger|充电|neptune|尼普顿"`
 *      **零实现**（`packages/source/` 的九个 source 里没有尼普顿）；「今天」页
 *      现有能力是**课程时段**，充电是同一时间轴上的**另一个生活事件**，不是
 *      课程数据的另一种切法。
 *   3. **底层多调了更优质实现** —— 本仓没有任何尼普顿协议实现。上游有真实
 *      抓包还原的接口（`getUserInfo` / `getDeviceInfo` / `isChargeing` /
 *      `offCharge` 两段式退款确认）+ 北京时区锚定的 `nextChargeTime()`。
 *      骨架只调用上游，不自己重写协议。
 *
 * ── 必须说明的三条硬边界（评审第一问）───────────────────────────
 *
 *   ① **凭证等同账号钥匙**：上游链接里的 `openId` 是尼普顿的**唯一身份**，
 *      拿到 openId 即可扣该账号预存款。本包**不得**把 openId / 配置写入
 *      工作区任何文件、日志或遥测；只能走宿主已有的凭证存储（与
 *      `source-campus` 的「浙大一卡通」同一处），且**只读回显余额**。
 *   ② **禁止自带执行器**：上游 `serve` 用 `spawn(detached)` + `PID_FILE` +
 *      `setInterval(20s)` 拉起一个**常驻进程**。DSH 工作台是 Web 宿主，
 *      不能起游离进程。执行器必须换成**宿主内单次定时器 + `unref()`**
 *      （照 `packages/core/llm-error/src/watchdog.js:64` 的写法），
 *      **进程退出即放弃本次预约**，绝不 daemon 化。
 *   ③ **只操作本人账号**：上游 README 明写「协议由作者本人账号抓包还原」。
 *      本包任何写操作（开电 / 断电）都必须用户**显式点击**确认，不做自动续约、
 *      不做多账号、不做代充值。
 *
 * ── 待落实的 TODO ───────────────────────────────────────────────
 *
 * [ ] TODO-0（阻塞项）：确认上游允许的引入方式。npm 查无同名包
 *     （`zju-ontime-charge` 与 `@symudie/zju-ontime-charge` 均 404）、无发布 tag
 *     ⇒ 「B 类 `dependencies` 锁版」**不成立**。需照 `packages/vendor/paper-reader`
 *     的路线：`git clone` + 删 `.git` + 写 `VERSION`/`PATCHES.md` + 入库。
 *     在拍板之前**不要**写 `dependencies`。
 * [ ] TODO-1：把 `neptune.mjs` 的 `post()` 与四个只读接口拆成 `src/upstream.js`
 *     的薄封装；**不改上游源码**，用参数注入 `fetch` 以便注入宿主（WebVPN 出口 / 代理）。
 * [ ] TODO-2：`nextChargeTime()` 原样复用（北京时区锚定，`10 点前算今天`）。
 *     注意上游 `Date.UTC(..., 6 - 8, 30)` 的 `-8` 是时区偏移，不要"修正"。
 * [ ] TODO-3：执行器改成 `setTimeout(atMs - now)` + `unref()`；重试窗
 *     `retryMinutes` 内轮询 `isChargeing` 直到成功或超窗；过期 > 1h 丢弃。
 * [ ] TODO-4：与 `packages/client/page-today/src/agenda.js` 对接（**不新增页面**）：
 *     在次日 06:00–08:00 段插入一行状态，其它时段不渲染。
 * [ ] TODO-5：写操作统一走二次确认；`offCharge` 的两段式（`msgflag` 回传）
 *     必须两步都成功才算成功，失败要如实显示 `msg`。
 * [ ] TODO-6：凭证落盘位置与宿主产物目录对齐；日志脱敏（`openId` 只留前 4 后 4）。
 */

export const NAME = 'dsh-radar-night-charge';

/**
 * DSH 插件入口。骨架阶段**什么都不做**。
 *
 * 空实现是刻意的：`apply()` 一旦有副作用，评审前误挂载就会真的去访问尼普顿。
 *
 * @returns {void}
 */
export function apply() {
  // TODO-0 拍板前不要实现任何东西。
}
