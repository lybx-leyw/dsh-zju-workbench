/**
 * 分域路由中继：本工作台网络出口的**唯一决策点**。
 *
 * # 为什么是这个形状（本文件是全包的核心，请先读完这段）
 *
 * 需求是「域 A 走代理 1、域 B 走代理 2、域 C 直连」。一个自然的想法是给每条
 * 出站通道各自装一个分域 dispatcher —— **那是错的**，而且会踩到一个很难查的坑：
 *
 * 宿主的 `@deepseek-ai/dsh-http-proxy` 有一条硬约束（其 README 明写）：
 * `proxyForUrl()` 与「已安装的 dispatcher」**绝不能对同一个 URL 给出不同答案**。
 * 因为 `dsh-web-fetch-http` 会先问策略层要答案、把请求钉在它校验过的地址上，
 * 而实际连接由 dispatcher 发出。两者不一致时，请求会被发往「策略从未放行」的去处。
 *
 * 所以这里换一个思路：**只暴露一个代理端点**（本中继，监听 127.0.0.1 随机端口），
 * 让两条通道都指向它：
 *
 * ```
 *   harness 策略层 ─┐
 *                   ├─► 本中继（唯一代理）─► 按目标域名查路由表 ─► 代理 A / 代理 B / 直连
 *   globalThis.fetch┘
 * ```
 *
 * 这样「策略层的答案」永远只有一句「走本中继」，分域逻辑全部收在中继内部 ——
 * 从构造上就不可能不一致。附带两个好处：
 *
 *   1. **不依赖环境变量**。路由答案来自配置文件，不再受进程级
 *      `HTTP_PROXY` / `NO_PROXY` 影响（此前智云正是被全局代理误伤）。
 *   2. **一行日志就能看清去向**。每条连接记「目标 → 命中哪条规则 → 走了谁」，
 *      排查「这个请求到底从哪个出口出去的」不再需要猜。
 *
 * # 同时支持 HTTPS CONNECT 与明文 HTTP
 *
 *   - HTTPS 走 `CONNECT host:port`：中继读出目标主机名 → 查路由 → 建隧道 → 纯字节转发。
 *   - 明文 HTTP 走「绝对 URI 请求行」：中继读到 `GET http://host/path HTTP/1.1`，
 *     同样查路由，然后把请求行改写成 origin-form 转发。**不能只处理 CONNECT** ——
 *     宿主里确实有明文 HTTP 出站（本机服务、少数 SDK）。
 */

import net from 'node:net';

import { DEFAULT_TIMEOUT_MS } from './constants.js';
import { openTunnel, pipeBoth, BufferedSocket } from './connect.js';
import { DIRECT, resolveRoute } from './config.js';

/** 中继只监听回环：它无鉴权，不能暴露到局域网。 */
const LISTEN_HOST = '127.0.0.1';

/**
 * 创建一个中继实例。
 *
 * @param getConfig - 每次连接**实时**取配置。用取值函数而不是快照，是为了让
 *                    设置页一保存就生效，无需重启（中继端口终身不变）。
 * @param log       - 诊断回调（收到结构化的 { host, matched, via, kind }）。
 */
export function createRelay({ getConfig, log = () => {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let server = null;
  let port = null;
  const sockets = new Set();

  function track(socket) {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  }

  /** 查一次路由并落一条诊断。返回可直接交给 `openTunnel` 的 target。 */
  function route(host, portNumber, kind) {
    const config = getConfig();
    const target = resolveRoute(config, host);
    if (target.missing) {
      // 配置里指向了不存在的代理：保守直连，但必须留痕（否则是「静默走错出口」）。
      log({ kind, host, port: portNumber, matched: target.matched, via: DIRECT, warning: `规则指向不存在的代理：${target.missing}` });
      return { kind: DIRECT };
    }
    log({ kind, host, port: portNumber, matched: target.matched, via: target.kind === DIRECT ? DIRECT : target.proxy.id });
    return target;
  }

  /** 隧道建好后统一收尾：失败回 502 并关闭，成功则双向转发。 */
  async function tunnel(socket, target, host, portNumber) {
    let upstream;
    try {
      upstream = await openTunnel(target, host, portNumber, timeoutMs);
    } catch (error) {
      log({ kind: 'tunnel', host, error: error.message });
      try { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch { /* 对端已断 */ }
      return;
    }
    track(upstream);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    pipeBoth(socket, upstream);
  }

  /** HTTPS：读 CONNECT 头，取目标主机名。 */
  async function handleConnect(socket, firstLine, stream) {
    const match = /^CONNECT\s+(\S+)\s+HTTP\/\d/i.exec(firstLine);
    if (!match) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const authority = match[1];
    const index = authority.lastIndexOf(':');
    const host = index === -1 ? authority : authority.slice(0, index).replace(/^\[|\]$/g, '');
    const portNumber = index === -1 ? 443 : Number(authority.slice(index + 1));
    if (!host || !Number.isInteger(portNumber)) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    // 把 CONNECT 请求头读到空行，否则残留字节会混进后续 TLS 流。
    for (;;) {
      const line = await stream.readLine();
      if (line === '') break;
    }
    stream.detach();
    await tunnel(socket, route(host, portNumber, 'connect'), host, portNumber);
  }

  /**
   * 明文 HTTP：请求行是绝对的 `METHOD http://host/path HTTP/1.1`。
   *
   * 转发前把请求行改写成 origin-form（`METHOD /path HTTP/1.1`）并去掉
   * 逐跳头 —— 目标服务器看到的是普通请求，不知道经过了中继。
   */
  async function handlePlain(socket, firstLine, stream) {
    const match = /^([A-Z]+)\s+(\S+)\s+(HTTP\/\d(?:\.\d)?)$/i.exec(firstLine);
    if (!match) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const [, method, rawUrl, version] = match;
    let url;
    try { url = new URL(rawUrl); } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (url.protocol !== 'http:') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const host = url.hostname;
    const portNumber = url.port ? Number(url.port) : 80;

    // 收集原始头的其余部分（保留原样，仅剔除逐跳头）。
    const headerLines = [];
    for (;;) {
      const line = await stream.readLine();
      if (line === '') break;
      if (/^(proxy-connection|proxy-authorization|connection|keep-alive)\s*:/i.test(line)) continue;
      headerLines.push(line);
    }
    stream.detach();

    const target = route(host, portNumber, 'plain');
    let upstream;
    try {
      upstream = await openTunnel(target, host, portNumber, timeoutMs);
    } catch (error) {
      log({ kind: 'plain', host, error: error.message });
      try { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch { /* 对端已断 */ }
      return;
    }
    track(upstream);
    const path = `${url.pathname}${url.search}`;
    upstream.write(`${method} ${path} ${version}\r\n${headerLines.join('\r\n')}\r\n\r\n`);
    pipeBoth(socket, upstream);
  }

  function onConnection(socket) {
    track(socket);
    socket.setNoDelay(true);
    const stream = new BufferedSocket(socket);
    // 头阶段限时：半开客户端不该永久占着一条连接。隧道建立后不再限时
    // （长连接是正常的），所以这里自己计时、读到头就清掉。
    const timer = setTimeout(() => {
      try { socket.destroy(); } catch { /* 已关闭 */ }
    }, timeoutMs);
    const clear = () => clearTimeout(timer);

    (async () => {
      const firstLine = await stream.readLine();
      clear();
      if (/^CONNECT\s/i.test(firstLine)) return handleConnect(socket, firstLine, stream);
      return handlePlain(socket, firstLine, stream);
    })().catch((error) => {
      clear();
      log({ kind: 'relay', error: error.message });
      // 读头失败（对端半开、超时、格式错）时 buffer 里可能还有字节：
      // 一律直接断开，不要尝试复用这条语义已经不可信的连接。
      try { socket.destroy(); } catch { /* 已关闭 */ }
    });
  }

  return {
    /** 启动监听。端口由系统分配（传 0），**终身不变**。 */
    async start() {
      if (server) return port;
      server = net.createServer(onConnection);
      server.on('error', (error) => log({ kind: 'relay', error: `监听失败：${error.message}` }));
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, LISTEN_HOST, () => resolve());
      });
      port = server.address().port;
      log({ kind: 'relay', listening: true, port });
      return port;
    },
    get port() { return port; },
    get listening() { return Boolean(server?.listening); },
    /** 本中继的代理 URL（给宿主策略层用）。 */
    get url() { return port ? `http://${LISTEN_HOST}:${port}` : null; },
    stop() {
      for (const socket of sockets) { try { socket.destroy(); } catch { /* 已关闭 */ } }
      sockets.clear();
      if (server) { try { server.close(); } catch { /* 已关闭 */ } server = null; port = null; }
    },
  };
}
