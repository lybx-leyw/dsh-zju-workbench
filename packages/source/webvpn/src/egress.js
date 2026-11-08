/**
 * 出口策略：一个请求该**直连**，还是该**绕 WebVPN**。
 *
 * # 为什么这一层要独立
 *
 * 判定规则只有一条真源：「`*.zju.edu.cn` 在校外时需要网关」。这条规则对
 * **每一个** zju 数据源都成立 —— 学在浙大、教务（zdbk）、学习通、智云课堂，
 * 用的都是同一套校园域名。
 *
 * 但在这之前，它躺在 `@lybx-leyw/dsh-zju-source-campus` 里，于是：
 *
 *   - `cc98` / `zdbk` 想用，只能借 campus 的 `zhiyunEgress` 服务 ——
 *     **一个数据包的能力被另一个业务包绑架**：campus 不装，它们就退回
 *     `globalThis.fetch`，而那条路会走全局代理（实测 10.7 秒后失败）；
 *   - 各包若自己复制一份判定，两份规则迟早漂移，且「校园网探测」会被重复调用。
 *
 * 所以策略层与协议层（`./protocol.js`）一起独立，**不依赖任何业务包**。
 *
 * # 三层结构
 *
 * ```text
 *   各数据源（campus / zdbk / cc98 / …）
 *        │  用 createEgress()
 *        ▼
 *   策略层（本文件）：探测 → 判定 → 选路 → 失败升级
 *        │  需要改写地址时
 *        ▼
 *   协议层（./protocol.js）：地址改写、网关登录
 * ```
 *
 * # 本层**不管**什么
 *
 * - 不知道具体业务（学在浙大 / 教务 / CC98 各自要取什么数据）；
 * - 不存凭据（那是 `@lybx-leyw/dsh-zju-source-login`）；
 * - 不做登录（网关登录由调用方在 `onWebvpnRequired` 里完成）。
 *
 * # 依赖面
 *
 * 只用 `node:` 内置模块 + 可选注入的 `undici`。`undici` 缺失时退回
 * `globalThis.fetch` 并在 `state().degraded` 里如实标记。
 */

import { toWebvpnUrl, fromWebvpnUrl, WEBVPN_HOST } from './protocol.js';
import { WebvpnError } from './errors.js';

/**
 * 校园域名后缀。命中它才可能需要 WebVPN。
 *
 * 注意：这是**唯一**一处定义。业务包要做自己的额外排除（例如拼题A 走公网），
 * 通过 `directSuffixes` 配置传入，而不是改这里。
 */
const CAMPUS_SUFFIX = 'zju.edu.cn';

/** 校园网探测端点：返回 `1` / `2` 表示在校园网内。 */
export const CAMPUS_PROBE_URL = 'https://mirrors.zju.edu.cn/api/is_campus_network';

/** 支持的出口模式。 */
export const MODES = ['auto', 'direct', 'webvpn'];

/**
 * 登录域：它们是**公网服务**，与是否在校园网无关。
 *
 * CAS 与 identity 都必须直连 —— 网关登录自己也要走这里，若被改写成网关地址
 * 就是「网关的网关」，无限递归。
 */
export const PUBLIC_AUTH_HOSTS = Object.freeze(['zjuam.zju.edu.cn', 'identity.zju.edu.cn']);

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

/**
 * 额外声明「走公网、不需要校园网」的域名后缀。
 *
 * 拼题A（`pintia.cn`）是典型：它在公网上，校外直连可达。这个判断原先硬编码在
 * campus 里，但它是**业务知识**而不是校园网事实，所以现在由调用方传入。
 *
 * @param hostname - 主机名。
 * @param suffixes - 后缀列表（如 `['pintia.cn']`）。
 * @returns 是否命中。
 */
export function isPublicHost(hostname, suffixes = []) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return suffixes.some((suffix) => {
    const clean = String(suffix ?? '').toLowerCase().replace(/^\./, '');
    if (!clean) return false;
    return host === clean || host.endsWith(`.${clean}`);
  });
}

/**
 * 这个主机是否**必须**走校园网（也就是校外的唯一解法是 WebVPN）。
 *
 * 网关自己不算：它本来就在公网上，校外可达。
 *
 * @param hostname - 主机名。
 * @param options.directSuffixes - 额外走公网的后缀。
 * @returns 是否需要校园网。
 */
export function needsCampusNetwork(hostname, { directSuffixes = [] } = {}) {
  const host = String(hostname ?? '').toLowerCase();
  if (host === WEBVPN_HOST) return false;
  if (isPublicHost(host, directSuffixes)) return false;
  return isCampusHost(host);
}

/** 把 `'1'` / `'2'` 解释成"在校园网内"。其余（含空）都是"不在"。 */
export function interpretCampusProbe(text) {
  const value = String(text ?? '').trim();
  return value === '1' || value === '2';
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
 * 建一份出口策略。
 *
 * @param options.mode - `auto` / `direct` / `webvpn`。
 * @param options.log - 诊断回调。
 * @param options.undici - 注入 undici（测试用）。
 * @param options.onWebvpnRequired - 需要网关但还没登录时的回调；返回 false 表示不重试。
 * @param options.directSuffixes - 额外走公网的后缀（如 `['pintia.cn']`）。
 * @returns 出口对象。
 */
export function createEgress({
  mode = 'auto',
  log = () => {},
  undici = null,
  onWebvpnRequired = null,
  directSuffixes = [],
} = {}) {
  if (!MODES.includes(mode)) throw new WebvpnError('EGRESS', `未知的出口模式：${mode}`);

  /**
   * 直连 agent。
   *
   * 与全局 dispatcher **并存**而不是替换它：本策略只在自己的请求上挂这个
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
   * 一次低层请求。**这是唯一的出网点。**
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
    if (mode === 'webvpn') return needsCampusNetwork(target.hostname, { directSuffixes }) ? 'webvpn' : 'direct';
    // CAS 与 identity 是公网服务，与校园网身份无关。
    if (PUBLIC_AUTH_HOSTS.includes(target.hostname)) return 'direct';
    // auto
    if (!needsCampusNetwork(target.hostname, { directSuffixes })) return 'direct';
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
   * 本策略的 `fetch`：先决定出口，再发请求。
   *
   * 签名与 `globalThis.fetch` 一致，因此可以直接交给各包的 `Transport`。
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
        // 只重试安全的读；绝不重放凭据提交。
        const worthEscalating = mode === 'auto'
          && needsCampusNetwork(target.hostname, { directSuffixes })
          && campus !== true
          && ['GET', 'HEAD'].includes(String(init.method ?? 'GET').toUpperCase())
          && !init.signal?.aborted;
        if (!worthEscalating) throw error;
        if (typeof onWebvpnRequired === 'function' && (await onWebvpnRequired()) === false) throw error;
        log(`${target.hostname} 直连失败（${error?.code ?? error?.message}），网络未探明，试一次 WebVPN`);
        usingWebvpn = true;
        try {
          return await send(toWebvpnUrl(target), init);
        } catch {
          // 升级也失败：把**最初**那个错误抛出去。它更接近"到底怎么了"，
          // 而升级只是我们的一次尝试，不该覆盖原始证据。
          throw error;
        }
      }
    }

    if (typeof onWebvpnRequired === 'function' && (await onWebvpnRequired()) === false) {
      throw new WebvpnError('WEBVPN_REQUIRED', '访问校园站点需要 WebVPN，但还没有可用的 WebVPN 会话');
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
