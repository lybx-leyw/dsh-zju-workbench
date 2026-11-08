/**
 * 本包的**出口策略**：一个请求该直连，还是该绕 WebVPN。
 *
 * # 实现已迁到 `@lybx-leyw/dsh-zju-source-webvpn`
 *
 * 判定规则（校园域名 → 校外走网关）对**每一个** zju 数据源都成立，不是 campus
 * 的私有知识。它原先住在本文件里，后果是 `cc98` / `zdbk` 想用只能借 campus 的
 * `zhiyunEgress` 服务 —— 一个数据包的能力被另一个业务包绑架。
 *
 * 现在策略与协议都在共享包里，本文件只留**业务专属的那一点配置**：
 * 拼题A 走公网，不需要校园网。除此之外一行判定逻辑都不该在这里出现。
 *
 * # 为什么本仓的数据源要自己管出口（而不是用 `globalThis.fetch`）
 *
 * 宿主的 `globalThis.fetch` 走全局 dispatcher，而那份 dispatcher 来自启动时读的
 * `HTTPS_PROXY`。对 DeepSeek 这类海外目标那是对的，但浙大域名是**国内校园站点**：
 * 实测把这些请求交给本机代理（`127.0.0.1:7993`）会**全部 7 秒后 ECONNRESET**，
 * 而直连 0.1 秒返回 200。
 *
 * 曾试过两条"看起来对"的办法，都不成立：
 *
 * 1. **指望 `@lybx-leyw/dsh-zju-source-netproxy` 接管** —— 它默认 `enabled: false`（刻意如此：
 *    装个插件不该顺手改全局网络行为）。用户没去打开它时，校园域名照样走全局代理。
 *    把可用性押在"用户记得去开另一个开关"上，是把根因留在原地。
 * 2. **给 `globalThis.fetch` 传 `dispatcher`** —— Node 内置 fetch 直接抛
 *    `UND_ERR_INVALID_ARG`，选项根本不生效。
 *
 * 实测**成立**的办法是第三条：用 `undici.fetch` 并**逐请求**显式传 `dispatcher`。
 * 把全局 dispatcher 指向一个死端口后验证过：`globalThis.fetch` 报 ECONNREFUSED，
 * 而同一次 `undici.fetch(…, { dispatcher: new Agent() })` 返回 200。所以本包能
 * 完全自主决定出口，且**不需要**改动宿主的全局策略 —— 别的包怎么走还怎么走。
 *
 * # 三条出口规则（顺序即优先级）
 *
 *   1. **网关自己**（`webvpn.zju.edu.cn`）→ 永远直连。它的地址不能被自己改写，
 *      否则就是"网关的网关"无限套娃。
 *   2. **非校园域名**（拼题A 等公开站点）→ 直连。它们在校外本来就可达，
 *      没有任何理由绕网关。
 *   3. **校园域名**（`*.zju.edu.cn`）→ 按模式：
 *        - `auto`：探测到在校园网 → 直连；探测到在校外 → 走 WebVPN；
 *        - `direct` / `webvpn`：听用户的。
 *
 * 探测不到（请求失败、超时）时**按直连试**，失败再升级 —— 宁可多花一次超时，
 * 也不要把一个能在校园网里正常工作的环境默认推去绕网关。
 */

import {
  CAMPUS_PROBE_URL,
  MODES,
  createEgress as createSharedEgress,
  interpretCampusProbe,
  isCampusHost,
  isPublicHost,
  loadUndici,
  needsCampusNetwork as sharedNeedsCampusNetwork,
} from '@lybx-leyw/dsh-zju-source-webvpn';

/** 拼题A 的域。它走公网，不需要校园网，也不需要 WebVPN。 */
const PINTIA_SUFFIX = 'pintia.cn';

/** 本包走公网的后缀。业务知识，所以留在业务包里。 */
const DIRECT_SUFFIXES = [PINTIA_SUFFIX];

export { CAMPUS_PROBE_URL, MODES, interpretCampusProbe, isCampusHost, loadUndici };

/** 是否拼题A 的域。 */
export function isPintiaHost(hostname) {
  return isPublicHost(hostname, DIRECT_SUFFIXES);
}

/**
 * 这个主机是否**必须**走校园网（也就是校外的唯一解法是 WebVPN）。
 *
 * 委托给共享策略，并把「拼题A 走公网」这条业务知识传进去。
 *
 * @param hostname - 主机名。
 * @returns 是否需要校园网。
 */
export function needsCampusNetwork(hostname) {
  return sharedNeedsCampusNetwork(hostname, { directSuffixes: DIRECT_SUFFIXES });
}

/**
 * 建一份本包自用的出口。
 *
 * 只是把「拼题A 走公网」这条业务配置注入共享策略；其它行为（探测、选路、
 * 失败升级、状态）一律由共享包提供，保证各数据源的判定不会漂移。
 *
 * @param options - 与共享 `createEgress` 一致。
 * @returns 出口对象。
 */
export function createEgress(options = {}) {
  return createSharedEgress({ ...options, directSuffixes: DIRECT_SUFFIXES });
}
