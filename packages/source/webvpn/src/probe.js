/**
 * 单主机探测：一个新站点该直连还是走网关、打开时要不要过统一身份认证。
 *
 * # 它回答什么
 *
 * `hosts.js` 那张表是**快照**。表里没有的站怎么办？表过期了怎么复核？
 * 这个模块给出的是一份**可执行的判定**，而不是"凭印象加一行"：
 *
 * ```js
 * const report = await probeHost('some-new-college.zju.edu.cn');
 * report.suggested.network;  // 'public' | 'campus'
 * report.suggested.auth;     // 'cas' | 'unknown'
 * ```
 *
 * # 为什么本机判断不可信
 *
 * 有 TUN 级代理（Clash / FlClash / ZJU Connect / Tailscale / sing-box）在 IP 层
 * 劫持流量时，即使拿公共 DNS 解出真实 IP 再直连，包仍然走隧道进校园网。
 * 于是「本机能连上」这个结论**不成立**。两条对策：
 *
 *   1. 默认在本机跑，但**先探公共 DoH**（223.5.5.5 / 119.29.29.29）拿真实 IP，
 *      直连那个 IP 而不走系统 DNS；同时检测 TUN 接口并在 `caveats` 里明说
 *      「结果不可信」；
 *   2. 传 `via` 时改为在那台外部主机上用 `curl` 实测 —— 干净的国内云主机才是
 *      ground truth。
 *
 * # 判法（与 `hosts.js` 的实测口径、上游 `probe.ts` 一致）
 *
 * 跟着跳转走到底，看最后停在哪：
 *
 * | 落点 | network | auth |
 * | --- | --- | --- |
 * | `zjuam.zju.edu.cn/cas/…` | `public` | `cas` |
 * | 200（首页） | `public` | `unknown` |
 * | `/nopermit_zjusub.jsp`（网站群拒校外） | `campus` | — |
 * | 连不上 / 超时 / 403 / 5xx | `campus` | — |
 *
 * # 与上游的一处偏离
 *
 * 上游 `probe.ts` 只解析 A 记录、只连 443。这里保持一致 —— 不加 AAAA 与 80 端口，
 * 因为浙大没有 IPv6-only 站点，多测一路只会让报告更难读。
 */

import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { execFile } from 'node:child_process';

/** 公共 DoH 解析器。用 IP 直连，避免被本机 DNS 或 hosts 改写。 */
export const DOH_RESOLVERS = Object.freeze([
  Object.freeze({ name: 'alidns', url: (host) => `https://223.5.5.5/resolve?name=${encodeURIComponent(host)}&type=A` }),
  Object.freeze({ name: 'dnspod', url: (host) => `https://119.29.29.29/dns-query?name=${encodeURIComponent(host)}&type=A` }),
]);

/**
 * 私网 / 保留地址段。
 *
 * 命中说明这个站**没有公网入口**，校外一定连不上 —— 那是 `campus` 的**证据**，
 * 不是"探测失败"。所以它单独成为一个字段，而不是混进 `error`。
 */
export const PRIVATE_ADDRESS = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.)/;

/** TUN / 代理软件的接口名。命中任何一个，本机探测结果就要打问号。 */
const TUN_INTERFACE = /clash|mihomo|tun|wintun|tailscale|zju-connect|sing-box/i;

/** 失败探测的默认超时。站点慢的时候 8 秒够了；更长会把整轮拖到几分钟。 */
export const PROBE_TIMEOUT_MS = 8000;

/** DoH 查询的超时。解析比建连快得多，给 6 秒。 */
export const RESOLVE_TIMEOUT_MS = 6000;

/**
 * 是不是私网 / 保留地址。
 *
 * @param ip - 点分十进制 IPv4。
 * @returns 是否私网。
 */
export function isPrivateAddress(ip) {
  return PRIVATE_ADDRESS.test(String(ip ?? ''));
}

/**
 * 本机有没有 TUN 级隧道接口。
 *
 * @param interfaces - `os.networkInterfaces()` 的结果（可注入，便于测试）。
 * @returns 命中的接口名数组。
 */
export function tunInterfaces(interfaces = null) {
  const source = interfaces ?? os.networkInterfaces();
  return Object.keys(source ?? {}).filter((name) => TUN_INTERFACE.test(name));
}

/**
 * 找一段真实的公网解析结果。
 *
 * 依次问 `DOH_RESOLVERS`，第一个答出 A 记录的胜出。全失败返回 `resolver: 'none'`
 * 与空数组 —— **不抛错**：那本身就是一条有意义的结论（校内专用域名通常如此）。
 *
 * @param host - 主机名。
 * @param options.fetch - fetch 实现（默认全局）。
 * @param options.timeout - 单次查询超时。
 * @param options.resolvers - 解析器列表（可注入）。
 * @returns `{ resolver, addresses }`。
 */
export async function resolvePublic(host, {
  fetch: fetchImpl = globalThis.fetch,
  timeout = RESOLVE_TIMEOUT_MS,
  resolvers = DOH_RESOLVERS,
} = {}) {
  for (const resolver of resolvers) {
    try {
      const response = await fetchImpl(resolver.url(host), {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(timeout),
      });
      const payload = await response.json();
      const addresses = (payload?.Answer ?? [])
        .filter((answer) => answer?.type === 1)
        .map((answer) => answer.data)
        .filter((data) => typeof data === 'string');
      if (addresses.length) return { resolver: resolver.name, addresses };
    } catch {
      // 换下一个解析器。全都不行时走下面的 'none' 分支。
    }
  }
  return { resolver: 'none', addresses: [] };
}

/**
 * 直连一个 **IP**（不走系统 DNS），问它 `GET <path>` 给什么。
 *
 * 必须同时给 `Host` 头与 `servername`（SNI）：很多站按 Host 分虚拟主机，
 * 只连 IP 会拿到另一个站的首页，于是"可达性"判对了、"是不是这个站"判错了。
 *
 * `rejectUnauthorized: false` 是**故意的**：我们连的是 IP 而不是域名，证书
 * 天然对不上。这里要的是"能不能建连"，不是"证书好不好"—— 后者由运行时的
 * 正常请求负责。
 *
 * @param host - 真实主机名（用于 Host 与 SNI）。
 * @param ip - 已解析出的 IPv4。
 * @param options.secure - 是否走 443。
 * @param options.timeout - 单跳超时。
 * @param options.path - 请求路径，默认 `/`。
 * @returns `{ status, location? }`。
 */
export function probeByAddress(host, ip, { secure = true, timeout = PROBE_TIMEOUT_MS, path: requestPath = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const mod = secure ? https : http;
    const request = mod.request({
      host: ip,
      servername: host,
      port: secure ? 443 : 80,
      path: requestPath,
      method: 'GET',
      headers: { Host: host, 'User-Agent': 'zju-workbench-probe' },
      rejectUnauthorized: false,
      timeout,
    }, (response) => {
      response.resume();
      const location = response.headers.location;
      resolve(location === undefined
        ? { status: response.statusCode ?? 0 }
        : { status: response.statusCode ?? 0, location });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end();
  });
}

/**
 * 跟着跳转走到底，返回**最终落点**与状态码。
 *
 * 为什么要跟着走：判法靠"停在哪个页面"。第一跳常常只是 `http→https` 或
 * 补一个尾斜杠，真正的结论在最后 —— 停在统一身份认证登录页、还是被网站群
 * 挡到 `nopermit_zjusub.jsp`。
 *
 * 跳去**别的主机**就停：那已经越出了"这个站能不能到"的范围，继续跟只会
 * 让报告指向一个无关的站。
 *
 * @param host - 真实主机名。
 * @param ip - 已解析出的 IPv4。
 * @param options - 透传给 `probeByAddress`，另有 `maxRedirects` 与 `send`。
 * @param options.send - 单跳发送函数（可注入，默认 {@link probeByAddress}）。
 * @returns `{ status, final }`；`final` 是最终 URL。
 */
export async function probeWithRedirects(host, ip, {
  secure = true,
  timeout = PROBE_TIMEOUT_MS,
  maxRedirects = 6,
  send = probeByAddress,
} = {}) {
  let current = `https://${host}/`;
  let requestPath = '/';
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const result = await send(host, ip, { secure, timeout, path: requestPath });
    if (!result.location) return { status: result.status, final: current };
    let next;
    try {
      next = new URL(result.location, current);
    } catch {
      return { status: result.status, final: current };
    }
    current = next.href;
    if (next.hostname !== host) return { status: result.status, final: current };
    requestPath = `${next.pathname}${next.search}`;
  }
  return { status: 0, final: current };
}

/**
 * 在那台外部主机上实测（ground truth）。
 *
 * 走 `ssh` + `curl`：外部主机的网络位置是干净的，不受本机 TUN 影响。
 * 脚本里的主机名做了字符白名单校验 —— 它要被拼进远端 shell。
 *
 * @param host - 主机名。
 * @param target - `~/.ssh/config` 里的别名，或 `user@ip`。
 * @returns `{ ip, status }`。
 */
export function probeVia(host, target) {
  if (!/^[a-z0-9.-]+$/i.test(String(host ?? ''))) {
    return Promise.reject(new Error(`主机名里有不该出现的字符：${host}`));
  }
  const remote = `ip=$(getent ahostsv4 ${host} 2>/dev/null | awk '{print $1; exit}');`
    + ` code=$(curl -sS -o /dev/null -m 10 -w '%{http_code}' https://${host}/ 2>/dev/null || echo 000);`
    + ' echo "$ip $code"';
  return new Promise((resolve, reject) => {
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', target, remote], { timeout: 40000 }, (error, stdout) => {
      if (error) return reject(new Error(`ssh ${target} 探测失败：${error.message}`));
      const [ip, code] = String(stdout ?? '').trim().split(/\s+/);
      resolve({ ip: ip ?? '', status: Number(code) || 0 });
    });
  });
}

/**
 * 探测一个主机该直连还是走网关。
 *
 * 报告形状与上游 `ProbeReport` 一致，多一项 `caveats` 里的中文说明。
 *
 * @param host - 主机名。
 * @param options.via - 从这台 SSH 主机实测；本机开着 TUN 时结果不可信。
 * @param options.fetch - DoH 用的 fetch（可注入，便于离线测试）。
 * @param options.timeout - 直连超时。
 * @param options.probe - 直连探测函数（可注入，默认 {@link probeWithRedirects}）。
 * @param options.interfaces - 网卡表（可注入，默认 `os.networkInterfaces()`）。
 * @param options.viaRunner - 外部主机实测函数（可注入，默认 {@link probeVia}）。
 * @returns 探测报告。
 */
export async function probeHost(host, {
  via,
  fetch: fetchImpl = globalThis.fetch,
  timeout = PROBE_TIMEOUT_MS,
  probe = probeWithRedirects,
  interfaces = null,
  viaRunner = probeVia,
} = {}) {
  const name = String(host ?? '').trim();
  if (!name) throw new Error('探测需要一个主机名');
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(name)) throw new Error(`主机名格式无法识别：${name}`);

  const { resolver, addresses } = await resolvePublic(name, { fetch: fetchImpl });
  const privateAddress = addresses.length === 0 || addresses.every(isPrivateAddress);

  const report = {
    host: name,
    via: via ?? 'local',
    resolver,
    addresses,
    privateAddress,
    direct: { reachable: false },
    suggested: { network: 'campus', auth: 'unknown' },
    caveats: [],
  };
  if (addresses.length === 0) report.caveats.push('公共 DNS 无 A 记录：校内专用域名');

  if (via) {
    try {
      const measured = await viaRunner(name, via);
      report.direct = {
        ip: measured.ip,
        reachable: measured.status > 0 && measured.status < 500,
        status: measured.status,
      };
      if (!report.direct.reachable) report.direct.error = `curl 返回 ${measured.status}`;
    } catch (error) {
      report.direct = { reachable: false, error: error instanceof Error ? error.message : String(error) };
      report.caveats.push('外部主机探测失败，无法确定');
    }
  } else {
    const tunnels = tunInterfaces(interfaces);
    if (tunnels.length) {
      report.caveats.push(
        `本机存在隧道接口 ${tunnels.join('、')}；IP 直连可能被隧道劫持，结果不可信。请用 via 指定一台校外主机复核`,
      );
    }
    const address = addresses.find((item) => net.isIPv4(item));
    if (address && !privateAddress) {
      const startedAt = performance.now();
      try {
        const result = await probe(name, address, { timeout });
        const ms = Math.round(performance.now() - startedAt);
        let landed = null;
        try {
          landed = new URL(result.final);
        } catch {
          landed = null;
        }
        // 网站群把校外读者挡到「无权访问」页时，状态码同样是 200 —— 只看状态码
        // 会把它判成「公网可达」。这与 `egress.js` 的 `isNoPermitResponse` 同一口径。
        const noPermit = landed?.pathname === '/nopermit_zjusub.jsp';
        const reachable = !noPermit && result.status > 0 && result.status < 500;
        report.direct = {
          ip: address,
          reachable,
          status: result.status,
          final: result.final,
          ms,
        };
        if (noPermit) report.direct.error = '被网站群挡到「无权访问」页：只给校内看';
        if (landed && landed.hostname === 'zjuam.zju.edu.cn' && landed.pathname.startsWith('/cas')) {
          const service = landed.searchParams.get('service');
          report.casRedirect = service ? { service } : {};
        }
      } catch (error) {
        report.direct = {
          ip: address,
          reachable: false,
          error: String(error?.code ?? error?.message ?? error),
          ms: Math.round(performance.now() - startedAt),
        };
      }
    } else if (address) {
      report.direct = { ip: address, reachable: false, error: '私网地址，校外不可达' };
    }
  }

  report.suggested.network = report.direct.reachable ? 'public' : 'campus';
  if (report.casRedirect) {
    report.suggested.auth = 'cas';
    if (report.casRedirect.service) report.suggested.casService = report.casRedirect.service;
  } else {
    report.caveats.push('auth 只看首页重定向；SPA 站点的 CAS 入口通常在具体接口上，需人工确认');
  }
  return report;
}
