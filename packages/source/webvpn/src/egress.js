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
import { classifyHost, HOSTS, HOSTS_GENERATED_AT, needsCas as hostNeedsCas } from './hosts.js';
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
 * # 三级判定（D4/D5 裁决）
 *
 * 从前这里只有一条规则：「`*.zju.edu.cn` 就要校园网」。那条规则是**对域名规律
 * 的猜测**，两个方向都会错 —— 教务网、学在浙大、智云、体艺、研究生教务实测
 * 从校外**能直连**却被强制绕道；而 `cc98.org`（不在该后缀下）与实验平台的
 * 私网 IP `10.203.16.55` 只在校内可达却被判直连，校外必然失败。
 *
 * 现在改成按 `hosts.js` 的主机表判定，三级：
 *
 *   1. `public`  → **永不**走校园网（用户选了「都走网关」也不改）；
 *   2. `campus`  → 需要校园网；
 *   3. `unknown` → 回退到原有的后缀规则（`isCampusHost`），
 *      即 `*.zju.edu.cn` 绕网关、其余直连。**保守**，与改动前的行为一致，
 *      不会因为换了表而让既有站点突然改变判定。
 *
 * `directSuffixes` 仍然优先于表：它是业务包声明的「这些站走公网」，
 * 属于业务知识，比表更具体。
 *
 * 网关自己永远不算需要校园网：它本来就在公网上，校外可达；
 * 若把它也改写就是「网关的网关」，无限递归。
 *
 * @param hostname - 主机名。
 * @param options.directSuffixes - 额外走公网的后缀（业务侧注入）。
 * @returns 是否需要校园网。
 */
export function needsCampusNetwork(hostname, { directSuffixes = [] } = {}) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (host === WEBVPN_HOST) return false;
  // 业务侧点名的公网站优先：它比表更具体。
  if (isPublicHost(host, directSuffixes)) return false;

  switch (classifyHost(host)) {
    case 'public':
      return false;
    case 'campus':
      return true;
    default:
      // unknown：回退后缀规则，保持既有行为。
      return isCampusHost(host);
  }
}

/**
 * 某个主机这次该走哪条路 —— 不探测、不看 `mode`，只看归属表。
 *
 * 与 {@link needsCampusNetwork} 的区别：这个返回三态，把「表里没有」暴露给
 * 调用方；`needsCampusNetwork` 是它折叠成布尔后的历史接口。
 *
 * @param hostname - 主机名。
 * @param options.directSuffixes - 额外走公网的后缀。
 * @returns `'public' | 'campus' | 'unknown'`。
 */
export function hostNetwork(hostname, { directSuffixes = [] } = {}) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (isPublicHost(host, directSuffixes)) return 'public';
  return classifyHost(host);
}

/** 把 `'1'` / `'2'` 解释成"在校园网内"。其余（含空）都是"不在"。 */
export function interpretCampusProbe(text) {
  const value = String(text ?? '').trim();
  return value === '1' || value === '2';
}

/** 学校网站群把校外读者挡下来时跳去的页面（`hosts.ts:27` 的同名常量）。 */
const NO_PERMIT_PATH = '/nopermit_zjusub.jsp';

/**
 * 这个响应是不是「只给校内看」的拒绝页。
 *
 * 网站群对某些只给校内看的页面，会把校外访问**以 200 返回一个拒绝页**，
 * 地址落在 `nopermit_zjusub.jsp`（可能带 `?parentUrl=…`）。只看状态码发现不了，
 * 所以按响应地址的路径匹配。
 *
 * 只读 `response.url`（undici 与全局 fetch 都提供），不读 body —— 读 body 会
 * 把这层变成需要消费流的异步判断，而且拒绝页可能很大。
 *
 * @param response - 一次直连得到的响应。
 * @returns 是否为「无权访问」页。
 */
function isNoPermitResponse(response) {
  const landed = typeof response?.url === 'string' ? response.url : '';
  if (!landed) return false;
  try {
    return new URL(landed).pathname === NO_PERMIT_PATH;
  } catch {
    return false;
  }
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
  /**
   * 本次会话里「直连不通、已改走网关」的主机集合（W3，D6 裁决：会话内持久）。
   *
   * # 为什么需要它
   *
   * 改动前每次请求都重新 `routeFor`，同一个主机可能反复
   * 「直连失败 → 升级 → 下一次又先直连失败」。在校园网外访问 `notice` 那类
   * 逐站判定为 public、实际却只给校内看的页面时，用户会连着吃几次超时。
   *
   * 上游的口径是：某主机一旦直连不通、或落到「无权访问」页，就**在这次运行里**
   * 移出直连集合，之后直接走网关（`jju-assistant` 的 `transport.ts:139`
   * `open.delete(host)`）。这里照同一语义实现。
   *
   * # 为什么是「持久到会话结束」而不是「只重试这一次」
   *
   * 网络在同一会话内突变的情况少，而每次失败都要等一个连接超时；
   * 反复试探的代价比偶尔多绕一跳高得多。用户换了网络（`forget()`）时清空。
   */
  const downgraded = new Set();

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
    // 本次会话里已降级的主机直接走网关，不再重新试探直连。
    //
    // ⚠️ 这里是**唯一**一条「因为过去失败过而改道」的判据，而且它**按主机**记账。
    //    历史实现还读过 `usingWebvpn` —— 那是个全局闩锁：任意一个主机降级之后，
    //    所有需要校园网的主机都跟着改道。实测后果是「sztz 失败一次，
    //    另一个本来能直连的站点也被推去网关」。降级必须 per-host。
    if (downgraded.has(target.hostname)) return 'webvpn';
    if (mode === 'webvpn') return needsCampusNetwork(target.hostname, { directSuffixes }) ? 'webvpn' : 'direct';
    // 登录域是**公网服务**，与校园网身份无关。这条必须在 auto 分支之前判：
    // 放在分支里会让 `mode: 'webvpn'` 把 zjuam 也改写，变成「网关的网关」。
    if (PUBLIC_AUTH_HOSTS.includes(target.hostname)) return 'direct';
    // auto
    if (!needsCampusNetwork(target.hostname, { directSuffixes })) return 'direct';
    // 先探一次，但**不论探到什么都先试直连**：
    //   - 在校园网内直连永远是对的；
    //   - 在校外，很多主机其实也能直连（这正是 D4 那张表的意义），
    //     试探失败的代价是一次连接超时，而误绕过网关的代价是「明明能通却打不开」。
    // 探测结果的用途在 `fetchWithEgress` 里 —— 它决定**失败后是否值得升级**。
    await probeCampus();
    return 'direct';
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
    // 只有「需要校园网」的主机才值得因失败而永久降级；公网站失败是它自己的事。
    const mayDowngrade = mode === 'auto' && needsCampusNetwork(target.hostname, { directSuffixes });

    if (route !== 'webvpn') {
      try {
        const response = await send(target, init);
        // 学校网站群会把校外的访问挡到「无权访问」页。这时的 HTTP 状态是 200，
        // 只看状态码发现不了 —— 上游靠识别这个路径（`transport.ts:28` 的
        // `NO_PERMIT_PATH`），这里照同一口径。
        if (mayDowngrade && isNoPermitResponse(response)) {
          log(`${target.hostname} 这一页只给校内看，改走 WebVPN`);
          await ensureWebvpnReady(target.hostname, null);
          downgraded.add(target.hostname);
          usingWebvpn = true;
          return send(toWebvpnUrl(target), init);
        }
        return response;
      } catch (error) {
        // 只重试安全的读；绝不重放凭据提交。
        const worthEscalating = mayDowngrade
          && campus !== true
          && ['GET', 'HEAD'].includes(String(init.method ?? 'GET').toUpperCase())
          && !init.signal?.aborted;
        if (!worthEscalating) throw error;
        await ensureWebvpnReady(target.hostname, error);
        log(`${target.hostname} 直连失败（${error?.code ?? error?.message}），网络未探明，试一次 WebVPN`);
        usingWebvpn = true;
        try {
          const response = await send(toWebvpnUrl(target), init);
          // 升级成功 → 记住这个主机，本次会话不再先试直连（W3）。
          downgraded.add(target.hostname);
          return response;
        } catch {
          // 升级也失败：把**最初**那个错误抛出去。它更接近"到底怎么了"，
          // 而升级只是我们的一次尝试，不该覆盖原始证据。
          throw error;
        }
      }
    }

    // route === 'webvpn'：确定要走网关。此时同样必须先确认「有人能建会话」，
    // 否则发出去的就是一个会被网关回登录页的请求（见 ensureWebvpnReady 的注释）。
    await ensureWebvpnReady(target.hostname, null);
    usingWebvpn = true;
    if (!undici) {
      log('warn: 没有 undici，WebVPN 请求仍会受全局代理影响');
    }
    return send(toWebvpnUrl(target), init);
  }

  /**
   * 决定能不能真的走网关，并在不能时给出可行动的错。
   *
   * # 为什么不能「没传回调就直接改写」（历史缺陷）
   *
   * 历史实现是 `typeof onWebvpnRequired === 'function' && (...)`：**没传回调时
   * 条件整体为 false，于是直接往下改写并发出去**。而 `source/http` 建共享出口时
   * 恰恰没传它 —— 结果是「校外 + 直连失败」时，请求被改写到网关，
   * 网关回的是**登录页**（HTTP 200），`cc98` / `zdbk` / `xxt` / `classroom`
   * 会把登录页当成业务数据去解析，报出一堆莫名其妙的字段缺失。
   *
   * 现在的口径与上游一致：**没有回调就没有人负责建立网关会话**，
   * 这时不能假装能走网关，而要抛 `WEBVPN_REQUIRED` 让调用方去配账号。
   * 回调返回 `false` 同样是「这个人现在建不了会话」。
   *
   * @param hostname - 目标主机（只用于错误文案）。
   * @param cause - 触发升级的原始错误，有的话挂进 details 便于排查。
   * @throws {WebvpnError} code `WEBVPN_REQUIRED`。
   */
  async function ensureWebvpnReady(hostname, cause) {
    if (typeof onWebvpnRequired !== 'function') {
      throw new WebvpnError(
        'WEBVPN_REQUIRED',
        `访问 ${hostname} 需要 WebVPN，但这一层没有配置网关会话的建立方式。`
        + '请先在「设置 → 浙大一卡通」里填 WebVPN 的上网账号与密码。',
        cause ? { cause } : {},
      );
    }
    if ((await onWebvpnRequired()) === false) {
      throw new WebvpnError('WEBVPN_REQUIRED', `访问 ${hostname} 需要 WebVPN，但还没有可用的 WebVPN 会话`);
    }
  }

  return {
    mode,
    fetch: fetchWithEgress,
    send,
    toPhysical,
    toLogical,
    routeFor,
    probeCampus,
    /**
     * 清掉探测缓存与降级集合（换了网络、或用户改了设置时用）。
     *
     * 两样都要清：只清探测结果的话，某个主机仍会因为上一张网络下的失败被
     * 永久绕网关 —— 用户明明回到校园网了却还在走网关。
     */
    forget() { campus = null; downgraded.clear(); },
    /** 本次会话里已降级到网关的主机（诊断用）。 */
    downgradedHosts() { return [...downgraded]; },
    /** 给状态面板/日志用的一句事实。 */
    state() {
      return {
        mode,
        campus: campus === null ? 'unknown' : campus ? 'inside' : 'outside',
        viaWebvpn: usingWebvpn,
        degraded: !undici,
        downgraded: [...downgraded],
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
