/**
 * 上游封装占位 —— **未实现**。
 *
 * 上游：`symudie/ZJU-ontime-charge` 的 `neptune.mjs`（MIT，375 行，单文件，零依赖）。
 * 这里只列出**打算调用**的四个接口与一个时间函数，签名与语义抄自上游，
 * 实现留空。**不搬运上游源码**：评审通过后按 `packages/vendor/paper-reader`
 * 的路线 vendor 入库，再由本文件转发。
 *
 * 上游接口（`BASE = http://www.szlzxn.cn/wxn`，`POST` + `x-www-form-urlencoded`）：
 *
 *   | 上游函数       | 路径              | 入参                         | 只读 |
 *   | -------------- | ----------------- | ---------------------------- | ---- |
 *   | getUserInfo    | `getUserInfo`     | `{ openId, areaId }`         | ✅   |
 *   | getDeviceInfo  | `getDeviceInfo`   | `{ areaId, devaddress }`     | ✅   |
 *   | isChargeing    | `isChargeing`     | `{ areaId, openId }`         | ✅   |
 *   | startCharging  | （见上游实现）    | `{ devaddress, port, ... }`  | ❌   |
 *   | offCharge      | `offCharge`       | `{ ...base, count:1 / 2 }`   | ❌   |
 *
 * ⚠ 上游 `offCharge` 是**两段式**：第一次 `count:1` 返回 `obj` 作为挑战值，
 *   第二次 `count:2, msgflag: r1.obj` 才算断电。只做一次 = 没断电。
 */

/** 上游默认值，原样保留以便对照。`areaId=6` 是作者所在片区，**不是**通用值。 */
export const UPSTREAM_DEFAULTS = Object.freeze({
  base: 'http://www.szlzxn.cn/wxn',
  areaId: '6',
  retryMinutes: 15,
  /** 开电金额选项（对应预扣 ¥2），上游写死 `"7"`。 */
  money: '7',
});

/**
 * 上游 `nextChargeTime()` 的语义（**未实现**）。
 *
 * 北京时区锚定、与服务器时区无关：
 * - 取「北京墙钟的今天 06:30」；
 * - 若该时刻已过 **且** 北京小时 ≥ 10，则顺延到明天 06:30；
 * - 否则（10 点前）仍算今天这一轮。
 *
 * 上游实现用 `Date.UTC(y, m, d, 6 - 8, 30)` —— 那个 `-8` 是时区偏移，
 * 不是笔误，照抄时**不要"修正"**。
 *
 * @param {number} nowMs 当前毫秒时间戳
 * @returns {number} 目标开电时刻（毫秒）
 */
export function nextChargeTime(nowMs) {
  void nowMs;
  throw new Error('dsh-radar-night-charge: 骨架未实现（nextChargeTime）');
}

/**
 * 只读状态：余额 / 是否在充（**未实现**）。
 *
 * @param {{ fetchImpl?: typeof fetch, credentials: unknown }} _deps
 * @returns {Promise<{ balanceFen: number, charging: null | { port: string, beginAt: string, prepaidFen: number } }>}
 */
export async function readStatus(_deps) {
  throw new Error('dsh-radar-night-charge: 骨架未实现（readStatus）');
}

/**
 * 到点开电（**未实现**，写操作）。
 *
 * 约束：只操作本人账号；必须由用户显式触发；失败在 `retryMinutes` 内重试，
 * 超过重试窗就放弃并如实报错（上游是「桩 6:35 才上线」的实际情形）。
 *
 * @param {{ devaddress: string, port: string, retryMinutes?: number }} _target
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function startCharging(_target) {
  throw new Error('dsh-radar-night-charge: 骨架未实现（startCharging）');
}
