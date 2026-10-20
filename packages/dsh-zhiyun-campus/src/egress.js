/**
 * 本包的**出口策略**：一个请求该直连，还是该绕 WebVPN。
 *
 * # 为什么本包要自己管出口（而不是像其它包那样用 `globalThis.fetch`）
 *
 * 宿主的 `globalThis.fetch` 走全局 dispatcher，而那份 dispatcher 来自启动时读的
 * `HTTPS_PROXY`。对 DeepSeek 这类海外目标那是对的，但浙大域名是**国内校园站点**：
 * 实测把这些请求交给本机代理（`127.0.0.1:7993`）会**全部 7 秒后 ECONNRESET**，
 * 而直连 0.1 秒返回 200。
 *
 * 曾试过两条"看起来对"的办法，都不成立：
 *
 * 1. **指望 `dsh-zhiyun-net-proxy` 接管** —— 它默认 `enabled: false`（刻意如此：
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

import { ClassroomError } from './cas/errors.js';
import { toWebvpnUrl, fromWebvpnUrl, WEBVPN_HOST } from './webvpn/protocol.js';

/** 校园域名后缀。命中它才可能需要 WebVPN。 */
const CAMPUS_SUFFIX = 'zju.edu.cn';

/** 拼题A 的域。它走公网，不需要校园网，也不需要 WebVPN。 */
const PINTIA_SUFFIX = 'pintia.cn';

/** 校园网探测端点：返回 `1` / `2` 表示在校园网内。 */
export const CAMPUS_PROBE_URL = 'https://mirrors.zju.edu.cn/api/is_campus_network';

/** 支持的出口模式。 */
export const MODES = ['auto', 'direct', 'webvpn'];

/**
 * 这个主机名是否属于浙大校园网域。
 *
 * 用后缀匹配并**要求点边界**：朴素 `endsWith('zju.edu.cn')` 会让
 * `evilzju.edu.cn` 命中，那等于把任意域名当成校园站点去发凭据。
 *
 * @param hostname - 主机名。
 * @returns 是否校园域名。
 */
export function isCampusHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return host === CAMPUS_SUFFIX || host.endsWith(`.${CAMPUS_SUFFIX}`);
}

/** 是否拼题A 的域。 */
export function isPintiaHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return host === PINTIA_SUFFIX || host.endsWith(`.${PINTIA_SUFFIX}`);
}

/**
 * 这个主机是否**必须**走校园网（也就是校外的唯一解法是 WebVPN）。
 *
 * 网关自己不算：它本来就在公网上，校外可达。
 *
 * @param hostname - 主机名。
 * @returns 是否需要校园网。
 */
export function needsCampusNetwork(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  if (host === WEBVPN_HOST) return false;
  if (isPintiaHost(host)) return false;
  return isCampusHost(host);
}

/** 把 `'1'` / `'2'` 解释成"在校园网内"。其余（含空）都是"不在"。 */
export function interpretCampusProbe(text) {
  const value = String(text ?? '').trim();
  if (value === '1' || value === '2') return true;
  return false;
}

/**
 * 装载 undici。
 *
 * 独立成函数是为了让"宿主没装 undici"这件事**有明确的降级路径**，而不是在
 * 某个深层调用里抛一个莫名其妙的 import 错误。
 *
 * @returns undici 模块，或 null。
 */
export async function loadUndici() {
  try {
    return await import('undici');
  } catch {
    return null;
  }
}

/**
 * 建一份本包自用的出口。
 *
 * @param options.mode - `auto` / `direct` / `webvpn`。
 * @param options.log - 诊断回调。
 * @param options.undici - 注入 undici（测试用）。
 * @param options.onWebvpnRequired - 需要网关但还没登录时的回调；返回 false 表示不重试。
 * @returns 出口对象。
 */
export function createEgress({ mode = 'auto', log = () => {}, undici = null, onWebvpnRequired = null } = {}) {
  if (!MODES.includes(mode)) throw new ClassroomError('EGRESS', `未知的出口模式：${mode}`);

  /**
   * 直连 agent。
   *
   * 与全局 dispatcher **并存**而不是替换它：本包只在自己的请求上挂这个
   * dispatcher，别的包（LLM、web_fetch）继续用宿主那份，互不影响。
   */
  let direct = null;
  /** 探测结果缓存：`true` 在校园网、`false` 在校外、`null` 还没探到。 */
  let campus = null;
  /** 当前是否正在用 WebVPN（用于状态展示与日志）。 */
  let usingWebvpn = false;

  const agentFor = () => {
    if (!undici) return undefined;
    if (!direct) direct = new undici.Agent({ connect: { timeout: 20000 } });
    return direct;
  };

  /**
   * 一次低层请求。**这是本包唯一的出网点。**
   *
   * `undici` 不可用时退回 `globalThis.fetch` —— 那条路会受全局代理影响，
   * 但总比完全不能取数好；调用方通过 `degraded` 知道这件事。
   */
  async function send(url, init = {}) {
    const dispatcher = agentFor();
    if (dispatcher) return undici.fetch(url, { ...init, dispatcher });
    return globalThis.fetch(url, init);
  }

  /**
   * 探测当前网络是否在校园网内。只在 `auto` 模式下需要。
   *
   * 缓存一次结果就够了：一次取数期间网络不会突变，而每次请求都探一遍会把
   * 延迟平白翻倍。失败（`null`）**不缓存**为既定结论 —— 下次照常再探。
   *
   * @returns `true` / `false` / `null`（探不到）。
   */
  async function probeCampus() {
    if (campus !== null) return campus;
    try {
      const response = await send(CAMPUS_PROBE_URL, {
        redirect: 'manual',
        headers: { Accept: 'text/plain' },
        signal: AbortSignal.timeout(6000),
      });
      if (response.status !== 200) return null;
      campus = interpretCampusProbe(await response.text());
      log(`校园网探测：${campus ? '在校园网内' : '在校外'}（${CAMPUS_PROBE_URL}）`);
      return campus;
    } catch (error) {
      // 探不到就是探不到，不猜。调用方按"先试直连"处理。
      log(`校园网探测失败（${error?.code ?? error?.message}），本次按直连处理`);
      return null;
    }
  }

  /**
   * 某个逻辑地址这次该走哪条路。
   *
   * @param url - 逻辑地址。
   * @returns `'direct'` 或 `'webvpn'`。
   */
  async function routeFor(url) {
    const target = url instanceof URL ? url : new URL(String(url));
    if (mode === 'direct') return 'direct';
    if (mode === 'webvpn') return needsCampusNetwork(target.hostname) ? 'webvpn' : 'direct';
    // CAS and identity are public services, independent of campus membership.
    if (['zjuam.zju.edu.cn', 'identity.zju.edu.cn'].includes(target.hostname)) return 'direct';
    // auto
    if (!needsCampusNetwork(target.hostname)) return 'direct';
    const inside = await probeCampus();
    // 探不到时按直连试：校园网里直连永远是对的，校外直连失败后由调用方升级。
    return usingWebvpn && inside !== true ? 'webvpn' : 'direct';
  }

  /**
   * 逻辑地址 → 物理地址。
   *
   * @param url - 逻辑地址。
   * @returns 实际要请求的地址。
   */
  async function toPhysical(url) {
    const target = url instanceof URL ? url : new URL(String(url));
    const route = await routeFor(target);
    if (route !== 'webvpn') return target;
    usingWebvpn = true;
    return toWebvpnUrl(target);
  }

  /**
   * 物理地址 → 逻辑地址（回写跳转用）。
   *
   * @param url - 物理地址（字符串或 URL）。
   * @returns 逻辑地址；不是网关地址就原样返回。
   */
  function toLogical(url) {
    if (!url) return url;
    try {
      return fromWebvpnUrl(new URL(String(url))) ?? new URL(String(url));
    } catch {
      return null;
    }
  }

  /**
   * 本包的 `fetch`：先决定出口，再发请求。
   *
   * 签名与 `globalThis.fetch` 一致，因此可以直接交给 `Transport`。
   *
   * 自动模式先尝试业务站点直连。校外探测不代表每个业务域都不可达。
   * 仅未确认在校内的 GET/HEAD 网络失败可以升级；HTTP 答复、取消以及
   * POST 都不能重放，避免密码提交结果不明时再次提交。
   *
   * @param url - 逻辑地址。
   * @param init - fetch 选项。
   * @returns 响应。
   */
  async function fetchWithEgress(url, init = {}) {
    const target = url instanceof URL ? url : new URL(String(url));
    const route = await routeFor(target);

    if (route !== 'webvpn') {
      try {
        return await send(target, init);
      } catch (error) {
        // Only retry safe reads; never replay credential submissions.
        const worthEscalating = mode === 'auto'
          && needsCampusNetwork(target.hostname)
          && campus !== true
          && ['GET', 'HEAD'].includes(String(init.method ?? 'GET').toUpperCase())
          && !init.signal?.aborted;
        if (!worthEscalating) throw error;
        if (typeof onWebvpnRequired === 'function' && (await onWebvpnRequired()) === false) throw error;
        log(`${target.hostname} 直连失败（${error?.code ?? error?.message}），网络未探明，试一次 WebVPN`);
        usingWebvpn = true;
        try {
          return await send(toWebvpnUrl(target), init);
        } catch (upgradeError) {
          // 升级也失败：把**最初**那个错误抛出去。它更接近"到底怎么了"，
          // 而升级只是我们的一次尝试，不该覆盖原始证据。
          throw error;
        }
      }
    }

    if (typeof onWebvpnRequired === 'function' && (await onWebvpnRequired()) === false) {
      throw new ClassroomError('WEBVPN_REQUIRED', '访问校园站点需要 WebVPN，但还没有可用的 WebVPN 会话');
    }
    usingWebvpn = true;
    if (!undici) {
      log('warn: 没有 undici，WebVPN 请求仍会受全局代理影响');
    }
    return send(toWebvpnUrl(target), init);
  }

  return {
    mode,
    fetch: fetchWithEgress,
    send,
    toPhysical,
    toLogical,
    routeFor,
    probeCampus,
    /** 清掉探测缓存（换了网络、或用户改了设置时用）。 */
    forget() { campus = null; },
    /** 给状态面板/日志用的一句事实。 */
    state() {
      return {
        mode,
        campus: campus === null ? 'unknown' : campus ? 'inside' : 'outside',
        viaWebvpn: usingWebvpn,
        degraded: !undici,
      };
    },
    close() {
      if (direct) {
        const closing = direct;
        direct = null;
        return closing.close().catch(() => {});
      }
      return Promise.resolve();
    },
  };
}
