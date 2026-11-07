/**
 * 上游封装的**唯一入口**（候选骨架 · 占位实现）。
 *
 * ⚠️ 本文件只有一个用途：把「我们锁的是哪一版上游、凭什么形状挂它」钉在一处，
 *    **不改、不复制上游任何源码**。上游的 `lib/index.js` 是编译产物，本仓**不碰**。
 *
 * # 为什么锁死版本号
 *
 * 上游是 0.x（`0.4.8`），0.x 的小版本也允许破坏性变更。本包是**兼容层**，
 * 兼容层的全部价值来自「我知道对面是什么形状」。版本漂移时宁可让页面显示
 * 「推送不可用」，也不能让形状悄悄变了还照挂 —— 所以 `index.js` 会拿
 * `installed !== UPSTREAM_VERSION` 去比对并**大声报警**。
 *
 * # 本轮实测（2026-11-03 r133，沙箱内真装真跑）
 *
 *   1. `npm install @goodandready/dsh-plugin-notify@0.4.8` → `added 33 packages in 4s`，
 *      `node_modules` 共 **12 MB**。传递依赖来自 `dependencies.web-push@^3.6.7`
 *      （asn1.js / bn.js / http_ece / jwa / … 全是 VAPID 签名链，**不是**可选依赖）。
 *      ⇒ 本仓若接入，`node_modules` 会**一次多出 33 个包**。这是 TCO，不是缺陷。
 *   2. `web-push` 的 `generateVAPIDKeys()` 在沙箱里可跑通（公钥 87 / 私钥 43 字符）。
 *   3. peer 依赖 `@deepseek-ai/{cordis,dsh-session,dsh-credentials,schemastery}`
 *      由 npm 自动装进同一棵树 —— 意味着**宿主版本若不在 peer 区间内，装完才会发现**。
 *      本仓 `devDependencies` 只有 `@deepseek-ai/dsh-atomic-write`，
 *      没有把 `cordis` / `dsh-session` 的版本钉在仓库里 ⇒ **接入前必须在真实 profile 里核**。
 *   4. 仓库 HEAD 的 `package.json` 版本是 `0.4.8`，与 npm `latest` **一致**
 *      （对照：本轮另外两个候选都对不上，见报告「拒录记要」）。
 *
 * # 刻意不引入的东西
 *
 * 上游的**客户端半边**只往 `plugins.item` / `plugins.row.config` 两个槽位注册
 * （`lib/client.js:945,952`），**不接管** settings 分组 —— 这一点与本仓
 * `dsh-zhiyun-page-plugins` 的「插件页」是同一个槽位体系，所以**不冲突**。
 * 但骨架阶段仍然不挂：评审要先决定「订阅入口放插件页还是今日页」。
 */

/** 上游包名。**与 `package.json` 的 `dependencies` 键逐字符一致**。 */
export const UPSTREAM_PACKAGE = '@goodandready/dsh-plugin-notify';

/** 锁版。**与 `package.json` 的 `dependencies` 值逐字符一致**（写死，不用 `^`）。 */
export const UPSTREAM_VERSION = '0.4.8';

/** 上游 bundle patch 里的行 id。**冲突检测要用它**，不能用包名。 */
export const UPSTREAM_ENTRY_ID = 'plugin-notify';

/** 上游仓库（仅用于 README / ATTRIBUTION 溯源，运行时不使用）。 */
export const UPSTREAM_REPO = 'https://github.com/GooDAnDReaDY/dsh-plugin-notify';

/**
 * 上游宿主半边 `inject` 的服务面（实测自 `lib/index.js:18`）。
 *
 * 与本仓的关系：
 *   - `sessions` / `credentials` / `settings` / `webServer` / `connection`
 *     里，`webServer` 与 `connection` 本包**也要**用（要注册自己的窄路由），
 *     其余三个由上游自己 inject，本包**不重复声明** —— 重复声明会让两个包
 *     在同一服务上互相等待。
 */
export const EXPECTED_HOST_INJECT = Object.freeze([
  'sessions',
  'credentials',
  'settings',
  'webServer',
  'connection',
]);

/**
 * 上游的触发口径（实测自 `lib/index.js:1027`）。
 *
 * **这是本包最重要的一个判断依据**：上游的所有通道都由
 * `session/event`（`turn/end` / `approval/asked`）与 `user-questions/request` 驱动，
 * 而 `webPush` 分支额外要求 `sseClients.size === 0`（**没有页面连着才推**）。
 *
 * ⇒ 「待办到期」是一件**没有会话发生**的事。上游的 Web Push 能送到**关掉标签页的设备**，
 *    但**送不出一件没有会话在跑的事**。所以本包要补的正是这一段：
 *    由「今日」页的到期判定**主动调用**上游的投递函数，而不是等上游替我们触发。
 */
export const TRIGGER_SOURCE = 'session/event + user-questions/request（上游）→ 本包另加「待办到期」';

/**
 * 上游**没有**对外暴露发送入口（实测：`tools.register` 零命中，
 * 只有 `lib/client.js` 里的 `plugins.item` / `plugins.row.config` 两个槽位）。
 *
 * ⇒ 本包若要走「发一条」，只剩两条路，**都要人工评审拍板**（见 README）：
 *   a. 挂上游为子插件 + 由它自己的 `webServer` 路由 `POST /dsh-plugin-notify/push/test`
 *      发一条「测试推送」—— 语义是「测试」，不是「提醒」，**不建议**拿来当通道；
 *   b. 本包自己引入 `web-push@3.6.7`，复用上游已存盘的 subscription 清单
 *      （落盘路径见上游 `resolveStatePath`），**只借数据、不借发送器**。
 *
 * 骨架**两条都没写**。哪条成立取决于评审对「谁拥有 VAPID 私钥」的答复。
 */
export const SEND_ENTRY = 'none（上游无对外发送面；见文件末两条候选路径）';

/** 上游客户端半边是否挂载。骨架阶段恒为 false。 */
export const CLIENT_HALF_MOUNTED = false;
