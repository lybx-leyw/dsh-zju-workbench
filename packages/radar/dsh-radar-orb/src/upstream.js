/**
 * 上游封装占位（A 类骨架）。
 *
 * ⚠️ 未评审、未接入 profile、不可直接使用。此处**不实现**任何截屏或附件写入，
 *    只声明本包打算怎么包住上游 —— 评审据此判断「外围兼容层」是否成立。
 *
 * 原则（与 `dsh-zhiyun-paper` 同构）：
 *   - **绝不改上游源码**：只从 `dsh-orb` 的主入口拿会话附件服务；
 *   - **锁版**：`0.2.0` 写死（package.json 无 `^`/`~`），上游小版本变更时人工重新评审；
 *   - **只取宿主半边**：不上拉 `preset-computer-use`，也不上拉 `./client`。
 */

export { UPSTREAM, UPSTREAM_VERSION, UPSTREAM_PINS, REFUSED_UPSTREAM_FACES } from './index.js';

import { UPSTREAM } from './index.js';

/**
 * 取得上游宿主半边（占位，返回 null）。
 *
 * TODO(评审通过后)：改为 `await import(UPSTREAM)` 并按上游导出形状取服务。
 * 上游 `exports` 里 `.` 是 bundle 主入口、`./host` 才是宿主服务 —— 届时优先取
 * `./host`，避免把 bundle 的 preset 装载逻辑一并拉进来。
 * 若上游未来调整导出映射，**在本函数内适配**，外溢不到调用方。
 *
 * @returns {Promise<null>} 骨架期恒为 null —— 调用方必须容忍「尚无上游」。
 */
export async function loadUpstream() {
  return null;
}

/**
 * 版本守卫（占位）。
 *
 * 上游 `dsh-orb@0.2.0` 的 `dependencies` 用区间锁 DSH 主体
 * （`@deepseek-ai/dsh-*` 均为 `>=0.1.7-rc.2 <0.3.0-0`），但把
 * `@deepseek-ai/cordis@4.0.4` 与 `@deepseek-ai/schemastery@3.18.4` **写死**。
 * 本仓宿主若与这两个写死版本不一致，**不得挂载** —— 由调用方在 apply() 里先调本守卫。
 *
 * @param {{cordis?: string, schemastery?: string}} _host 宿主版本信息
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkHostCompat(_host) {
  // TODO: 解析宿主实际装到的 cordis / schemastery 版本，与 UPSTREAM_PINS 逐项比对；
  //       骨架期一律返回「未评审」。
  return { ok: false, reason: '骨架期未实现版本比对；接入前必须补齐' };
}

/**
 * 上游面审计（占位）。
 *
 * 评审通过后必须能用它回答：「我们到底拉了上游的哪几个面？」
 * 骨架期只声明**拒绝清单**，不读上游产物。
 *
 * @returns {{refused: string[], loaded: string[]}}
 */
export function auditFaces() {
  return { refused: ['preset-computer-use', './client'], loaded: [] };
}
