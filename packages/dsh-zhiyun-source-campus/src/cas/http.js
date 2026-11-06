/**
 * 校园站点共享的 HTTP 层 —— **供本仓其它 `source-*` 包复用**。
 *
 * # 为什么要有这个文件
 *
 * `Transport` / `SessionStore` 原本在 `cas/` 下，只有学在浙大与拼题A 用。
 * 教务（zdbk）、CC98、学习通（xxt）三个包需要的是**同一套东西**：
 * 按主机白名单收发 cookie、手动跟跳转、超时与取消、DPAPI 落地会话。
 *
 * 复制三份会立刻分叉（本仓已有教训：`classroom/src/auth.js` 与
 * `campus/src/cas/auth.js` 逐行几乎相同，改动要改两处）。所以这里做一层
 * 稳定的导出面，其它包 import `dsh-zhiyun-source-campus/http` 即可。
 *
 * # 这里**不**包含的东西（故意的）
 *
 * - **CAS 登录流程**：各站点的 CAS 用法不同。学在浙大不带 `service`，
 *   教务必须带 `service`（见 `source-zdbk` 的说明）。把任一方的策略
 *   钉进共享层，另一方就得绕开它。
 * - **凭据读取**：那属于 `dsh-zhiyun-source-card`，不在这里重复。
 */

export { Transport, AUTH_HOSTS, REFERER } from './transport.js';
export { SessionStore, dpapi } from './session.js';
export { ClassroomError, shape, object, array } from './errors.js';
export { resourceUrl } from './urls.js';

/**
 * 主机白名单要**按包**给全。
 *
 * `Transport` 只对命中 `hosts` 的请求读写 cookie；少一个主机，那条链路的
 * 会话永远是空的，而且不报错（表现为「登录成功但立刻又未登录」）。
 * 各包在自己的 `hosts.js` 里声明，别复用这一份。
 */
export const CAS_HOST = 'zjuam.zju.edu.cn';
export const IDENTITY_HOST = 'identity.zju.edu.cn';

/**
 * 取一份**带自动出口**的 fetch，供其它 `source-*` 包使用。
 *
 * # 它解决什么
 *
 * 没有它时，各包要么直接用 `globalThis.fetch`（会走宿主为 LLM 配的全局代理 ——
 * 而浙大站点/国内站点经代理基本必失败），要么各自 `new undici.Agent()`（各开一套
 * 连接池），要么各自登录 WebVPN（互相作废会话）。三种都不对。
 *
 * 这里统一从 `zhiyunEgress` 服务借那份**唯一的**出口：
 *
 *   - 非校园域（pintia.cn、cc98.org、chaoxing.com）→ 直连（绕开全局代理）；
 *   - 校园域（*.zju.edu.cn）→ 按 `auto` 策略：校内直连、校外绕 WebVPN；
 *   - 拿不到服务（campus 没装）→ 退回 `fallback`，即宿主 fetch。
 *
 * # 为什么必须是**惰性**的
 *
 * 不能在 `apply()` 阶段把服务取出来存起来：profile 里包的装配顺序不保证
 * campus 在前，取到 `undefined` 就会被永久缓存成"没有出口"。
 * 所以返回的是一个**每次调用都重新查**的函数。
 *
 * @param ctx - 插件上下文（Cordis）。
 * @param options.fallback - 拿不到出口时用哪个 fetch（默认 `globalThis.fetch`）。
 * @returns 与 `fetch` 同签名的函数。
 */
export function sharedFetch(ctx, { fallback = globalThis.fetch } = {}) {
  return function egressAwareFetch(url, init) {
    try {
      const egress = ctx?.get?.('zhiyunEgress');
      if (egress && typeof egress.fetch === 'function') return egress.fetch(url, init);
    } catch {
      // 服务解析失败（例如 ctx 已销毁）不该把一次请求变成异常 —— 直接退回直连。
    }
    return fallback(url, init);
  };
}
