/**
 * 上游封装的**唯一入口**（候选骨架 · 占位实现）。
 *
 * ⚠️ 本文件只有一个用途：把「我们锁的是哪一版上游、凭什么形状挂它」钉在一处，
 *    **不改、不复制上游任何源码**。上游的 `lib/index.js` 是编译产物，本仓**不碰**。
 *
 * # 为什么锁死版本号
 *
 * 上游是 0.x（`0.1.0`），0.x 的小版本也允许破坏性变更。本包是**兼容层**，
 * 兼容层的全部价值来自「我知道对面是什么形状」。版本漂移时宁可让页面显示
 * 「通知不可用」，也不能让形状悄悄变了还照挂 —— 所以 `index.js` 会拿
 * `installed !== UPSTREAM_VERSION` 去比对并**大声报警**。
 */

/** 上游包名。**与 `package.json` 的 `dependencies` 键逐字符一致**。 */
export const UPSTREAM_PACKAGE = 'dsh-plugin-notifications';

/** 锁版。**与 `package.json` 的 `dependencies` 值逐字符一致**（写死，不用 `^`）。 */
export const UPSTREAM_VERSION = '0.1.0';

/** 上游仓库（仅用于 README / ATTRIBUTION 溯源，运行时不使用）。 */
export const UPSTREAM_REPO =
  'https://github.com/bertholomus/dsh-public-plugins/tree/main/plugins/notifications';

/**
 * 我们**只**挂宿主半边。上游的客户端半边（`dsh.client`）**刻意不引入**。
 *
 * 上游 `dsh.client.inject` 里带着 `@deepseek-ai/dsh-client-ui-settings` 等一整组
 * UI 包 —— 换言之它会自己接管 settings 的一组页面。本仓的「今日」页已经有自己的
 * 布局主张与设置分组（`dsh-zhiyun-page-today` / `dsh-zhiyun-shell-ui`），
 * 再接一个会抢分组的客户端过来，等于把两套外壳叠在一起。
 *
 * 同一条判断在 `dsh-radar-market`（上游 `dshmarket`）与 `dsh-zhiyun-host-paper`
 * 里已经各写过一遍，这里是第三次 —— 结论一致：**挂宿主、UI 自写**。
 */
export const CLIENT_HALF_MOUNTED = false;

/**
 * 上游宿主半边对「谁可以发通知」的预期形状。
 *
 * TODO(2)：评审时**逐项核对**上游 `lib/index.js` 的导出与 `ctx.provide` 的服务名，
 *          把下面这份占位换成真实签名。现在写的是**预期**，不是事实：
 *
 *   - 服务名（预期）：`notifications`（`ctx.provide('notifications', …)`）
 *   - 方法（预期）：`send({ title, body, place?, icon? }) → { id }`
 *   - 无窗可发时的行为（预期）：**留在磁盘上**、下次窗口回来再发一次，不丢不重
 *     （README 的 "A restart loses nothing and repeats nothing" 一句所指）
 *   - 发送器选择顺序（已从 README 读到，属**事实**，可照抄）：
 *       `desktopRuntime` → 桌面应用窗口（Web Notifications API）→ 浏览器标签页
 */
export const EXPECTED_HOST_API = Object.freeze({
  service: 'notifications',
  method: 'send',
  args: Object.freeze(['title', 'body']),
});
