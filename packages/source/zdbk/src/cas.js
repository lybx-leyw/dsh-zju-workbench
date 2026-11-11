/**
 * 教务网的 CAS 登录：**复用 `@lybx-leyw/dsh-zju-source-login/cas` 的通用流程**（D18）。
 *
 * # 这个文件现在只剩「教务自己的三件事」
 *
 * 通用流程（跟跳转 → 抠 execution → 取 RSA 公钥 → 加密密码 → 提交 → 判有没有票）
 * 在 D18 之后归 `source/login`。那里是 tier 1 的**凭证包**：谁都能依赖它，
 * 它不依赖任何业务包 —— 于是「tier 1 不得依赖另一个 tier 1」这条规则不再被违反。
 *
 * 留在本文件的只有教务特有的三个值：
 *
 * | 值 | 为什么是教务自己的 |
 * | --- | --- |
 * | `ZDBK_CAS_ENTRY` | CAS 登录地址 + 教务的 `service`（`/jwglxt`） |
 * | `[ZDBK_HOST]` | 允许跳转的主机 |
 * | `upgradeHttpHosts` | 正方偶尔回 `http://zdbk.zju.edu.cn/…`，要允许升到 https |
 *
 * 这三样换成别的站点就不对了，所以它们不该钉进通用流程里。
 *
 * # 为什么保留 `casLogin` 这个名字与默认参数
 *
 * `index.js:249` 现在这样调：
 * ```js
 * casLogin(transport, { hosts: [...], upgradeHttpHosts: [...], credentials, signal })
 * ```
 * 不传 `entry`，靠这里的默认值补上。保留同一签名意味着这次改造是**零调用点改动**的，
 * `index.js` 一行都不用碰。
 *
 * # 三处踩过的坑
 *
 * `getPubKey` 只认 JSON 的 Accept、`service` 只能编码一次、登录失败通常回
 * 200 + 登录页（不是 4xx）—— 这三条的细节与代码都在 `source/login/src/cas.js` 里。
 * 本文件不再重复一份实现，也就不存在两份实现漂移的可能。
 */

import { CAS_HOST } from '@lybx-leyw/dsh-zju-source-http';
import {
  casLogin as genericCasLogin,
  authUrlGuard, casForm, hasCasForm, encryptCasPassword, casErrorMessage, describeAuthFailure,
} from '@lybx-leyw/dsh-zju-source-login/cas';

import { ZDBK_CAS_ENTRY, ZDBK_HOST, ZDBK_HOSTS } from './hosts.js';

/**
 * 跑完一次教务的统一身份认证，把会话装进 `transport.session.jar`。
 *
 * 与通用流程唯一的差别是**默认参数**：不传 `entry` / `hosts` 时用教务自己的。
 * 传了就按传的走（将来别的包想复用这套默认值也可以直接调这个）。
 *
 * @param transport - 必须带 `session.jar`（通用流程会从里面取 `iPlanetDirectoryPro`）。
 * @param options.entry - CAS service 入口；默认教务的。
 * @param options.hosts - 允许跳转的主机；默认 `[ZDBK_HOST]`。
 * @param options.upgradeHttpHosts - 允许 http→https 的主机；默认 `[ZDBK_HOST]`。
 * @param options.credentials - 返回 `{ username, password }` 的函数。
 * @param options.signal - 取消信号。
 * @returns `{ url, html, passwordSubmitted }`。
 */
export function casLogin(transport, options = {}) {
  return genericCasLogin(transport, {
    ...options,
    entry: options.entry ?? ZDBK_CAS_ENTRY,
    hosts: options.hosts ?? [ZDBK_HOST],
    upgradeHttpHosts: options.upgradeHttpHosts ?? [ZDBK_HOST],
  });
}

export {
  CAS_HOST, authUrlGuard, casForm, hasCasForm, encryptCasPassword, casErrorMessage, describeAuthFailure,
  ZDBK_CAS_ENTRY, ZDBK_HOSTS,
};
