/**
 * 上游封装占位（A 类骨架）。
 *
 * ⚠️ 未评审、未接入 profile、不可直接使用。此处**不实现**任何读写，
 *    只声明本包打算怎么包住上游 —— 评审据此判断「兼容层」是否成立。
 *
 * 原则（与 `dsh-zhiyun-paper` 同构）：
 *   - **绝不改上游源码**：只从 `@guowenzhang/dsh-whiteboard` 的 `./` 入口拿宿主服务；
 *   - **锁版**：`0.4.0` 写死（package.json 无 `^`/`~`），上游小版本变更时人工重新评审；
 *   - **只取宿主半边**：不上拉 `./client`（上游客户端会自建左侧导航，抢外壳布局）。
 */

export { UPSTREAM, UPSTREAM_EDITOR } from './index.js';

import { UPSTREAM } from './index.js';

/**
 * 取得上游宿主半边（占位，返回 null）。
 *
 * TODO(评审通过后)：改为 `await import(UPSTREAM)` 并按上游导出形状取服务。
 * 若上游未来把宿主服务从默认导出迁走，**在本函数内适配**，外溢不到调用方。
 *
 * @returns {Promise<null>} 骨架期恒为 null —— 调用方必须容忍"尚无上游"。
 */
export async function loadUpstream() {
  return null;
}

/**
 * 版本守卫（占位）。
 *
 * 上游 `engines.node` 为 `^22.19.0 || >=24.0.0`，`engines.dsh` 为 `>=0.2.0-rc.1`。
 * 本仓当前宿主版本若低于后者则**不得挂载** —— 由调用方在 apply() 里先调用本守卫。
 *
 * @param {{dsh?: string}} _host 宿主版本信息
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkHostCompat(_host) {
  // TODO: 解析 semver 后与 `>=0.2.0-rc.1` 比较；骨架期一律返回"未评审"。
  return { ok: false, reason: '骨架期未实现版本比对；接入前必须补齐' };
}
