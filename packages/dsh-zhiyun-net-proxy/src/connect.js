/**
 * 上游连接：把一条 TCP 连接，变成「通往目标主机的隧道」。
 *
 * 三条路，由路由表决定走哪条：
 *
 *   - `direct`        直接连目标（用于国内站点，不走任何代理）
 *   - `http`          连上游 HTTP 代理，发 `CONNECT host:port` 建隧道
 *   - `socks5`        连上游 SOCKS5 代理，做方法协商 + CONNECT
 *
 * # 为什么握手要这么小心
 *
 * 这三种握手都必须在同一个 socket 上「读到刚好够」，多读一个字节就会把后续
 * 的 TLS 握手数据吞进缓冲区 —— 表现是连接建立了却握手失败，且只在**分片到达**
 * 时复现，极难定位。所以这里用 {@link BufferedSocket}：它只在缓冲区里没有完整
 * 数据时才向 socket 要更多，`detach()` 之后把没消费的字节**还给**调用方
 * （`unshift` 回 socket），保证管道里一个字节都不丢。
 *
 * 上游 `dsh-net-proxy`（MIT）的 `lib/proxy/conn.js` 解决的是同一个问题，本文件
 * 是它的精简重写：只保留中继需要的出站方向，去掉 fetch 层的重定向、HTTP/2、
 * 响应体解码等本包用不到的部分。协议行为一致，实现独立。
 */

import net from 'node:net';

/** 单行头上限，防止半开代理用无穷长的头把内存拖死。 */
const MAX_HEADER_LINE = 64 * 1024;
/** CONNECT 响应头行数上限，防止缺失结束空行时无限读。 */
const MAX_CONNECT_HEADERS = 128;

/**
 * 带缓冲的 socket 读取器。
 *
 * 关键性质：`detach()` 会把**已读但未消费**的字节推回 socket，因此从握手
 * 切换到透明转发时不会有数据丢失。
 */
export class BufferedSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.ended = false;
    this.error = null;
    this.waiters = [];
    socket.on('data', (chunk) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      this.#wake();
    });
    socket.on('end', () => { this.ended = true; this.#wake(); });
    socket.on('close', () => { this.ended = true; this.#wake(); });
    socket.on('error', (error) => { this.error = error; this.#wake(); });
  }

  #wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  /** 等缓冲区有变化。 */
  #tick() {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** 读到 `\n` 为止（含），返回该行文本（不含行尾 CRLF）。 */
  async readLine() {
    for (;;) {
      const index = this.buffer.indexOf(0x0a);
      if (index !== -1) {
        let line = this.buffer.subarray(0, index + 1);
        this.buffer = this.buffer.subarray(index + 1);
        if (line.length > MAX_HEADER_LINE) throw new Error('响应头单行过长');
        if (line[line.length - 2] === 0x0d) line = line.subarray(0, line.length - 2);
        else line = line.subarray(0, line.length - 1);
        return line.toString('latin1');
      }
      if (this.buffer.length > MAX_HEADER_LINE) throw new Error('响应头单行过长');
      if (this.error) throw this.error;
      if (this.ended) throw new Error('连接在读取响应头时被对端关闭');
      await this.#tick();
    }
  }

  /** 精确读 `count` 个字节。 */
  async readExactly(count) {
    for (;;) {
      if (this.buffer.length >= count) {
        const out = this.buffer.subarray(0, count);
        this.buffer = this.buffer.subarray(count);
        return out;
      }
      if (this.error) throw this.error;
      if (this.ended) throw new Error('连接在读取数据时被对端关闭');
      await this.#tick();
    }
  }

  /** 结束缓冲读取：把未消费的字节推回 socket，交还给透明转发。 */
  detach() {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('end');
    this.socket.removeAllListeners('close');
    this.socket.removeAllListeners('error');
    if (this.buffer.length) this.socket.unshift(this.buffer);
    this.buffer = Buffer.alloc(0);
  }
}

/** 带超时的 TCP 连接。 */
function tcpConnect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);
    let settled = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`连接 ${host}:${port} 超时（${timeoutMs}ms）`));
      }, timeoutMs)
      : null;
    const done = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error); else resolve(socket);
    };
    socket.once('connect', () => done(null));
    socket.once('error', (error) => done(new Error(`连接 ${host}:${port} 失败：${error.message}`)));
  });
}

function basicAuth(proxy) {
  if (!proxy.username && !proxy.password) return '';
  const token = Buffer.from(`${proxy.username || ''}:${proxy.password || ''}`).toString('base64');
  return `Proxy-Authorization: Basic ${token}\r\n`;
}

/**
 * 经 HTTP 代理建隧道。
 *
 * 只做 `CONNECT`：本中继服务的是 HTTPS 流量（以及由 dispatcher 转来的
 * 明文请求，那条路不走 CONNECT），因此不需要处理绝对 URL 形式的转发。
 */
export async function httpTunnel(proxy, host, port, timeoutMs) {
  const socket = await tcpConnect(proxy.host, proxy.port, timeoutMs);
  const stream = new BufferedSocket(socket);
  const authority = `${host}:${port}`;
  try {
    socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${basicAuth(proxy)}\r\n`);
    const statusLine = await stream.readLine();
    const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine)?.[1] ?? 0);
    if (status !== 200) throw new Error(`上游代理拒绝 CONNECT ${authority}：HTTP ${status || statusLine}`);
    // 必须把响应头读到空行为止：代理附带的响应头若分包到达而没读完，
    // 会漏进后续 TLS 流并破坏握手。
    for (let n = 0; ; n++) {
      if (n > MAX_CONNECT_HEADERS) throw new Error('上游代理的 CONNECT 响应头过多');
      if ((await stream.readLine()) === '') break;
    }
    stream.detach();
    return socket;
  } catch (error) {
    stream.detach();
    socket.destroy();
    throw error;
  }
}

/**
 * 经 SOCKS5 代理建隧道（RFC 1928 + RFC 1929 用户名/密码认证）。
 *
 * 目标地址一律按域名（ATYP=3）发送，交给代理端解析：这样代理软件可以按
 * 自己的规则分流（很多客户端对 IP 直连与域名分流处理不同），也避免本机
 * 先做一次 DNS —— 国内方向那次解析若走了错误的出口，分流就失去意义。
 */
export async function socks5Tunnel(proxy, host, port, timeoutMs) {
  const socket = await tcpConnect(proxy.host, proxy.port, timeoutMs);
  const stream = new BufferedSocket(socket);
  try {
    const needAuth = Boolean(proxy.username || proxy.password);
    socket.write(needAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await stream.readExactly(2);
    if (greeting[0] !== 0x05) throw new Error('上游不是 SOCKS5 代理');
    if (greeting[1] === 0xff) throw new Error('上游 SOCKS5 代理拒绝所有认证方式');
    if (greeting[1] === 0x02) {
      if (!needAuth) throw new Error('上游 SOCKS5 代理要求认证，但未配置用户名/密码');
      const user = Buffer.from(proxy.username || '', 'utf8');
      const pass = Buffer.from(proxy.password || '', 'utf8');
      if (user.length > 255 || pass.length > 255) throw new Error('SOCKS5 用户名或密码过长');
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const reply = await stream.readExactly(2);
      if (reply[1] !== 0x00) throw new Error('SOCKS5 认证失败');
    } else if (greeting[1] !== 0x00) {
      throw new Error(`上游 SOCKS5 代理选择了不支持的认证方式：${greeting[1]}`);
    }

    const name = Buffer.from(host, 'utf8');
    if (name.length > 255) throw new Error('目标主机名过长');
    socket.write(Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name,
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    ]));
    const head = await stream.readExactly(4);
    if (head[1] !== 0x00) {
      const reasons = {
        1: '通用失败', 2: '规则不允许', 3: '网络不可达', 4: '主机不可达',
        5: '连接被拒绝', 6: 'TTL 超时', 7: '命令不支持', 8: '地址类型不支持',
      };
      throw new Error(`SOCKS5 连接 ${host}:${port} 被拒绝：${reasons[head[1]] ?? `错误码 ${head[1]}`}`);
    }
    // 消费掉 BND.ADDR / BND.PORT，否则残留在缓冲区里的字节会混进后续 TLS 流。
    const addrLen = head[3] === 0x01 ? 4 : head[3] === 0x04 ? 16 : (await stream.readExactly(1))[0];
    await stream.readExactly(addrLen + 2);
    stream.detach();
    return socket;
  } catch (error) {
    stream.detach();
    socket.destroy();
    throw error;
  }
}

/** 按路由结果建立到目标的连接。 */
export function openTunnel(target, host, port, timeoutMs) {
  if (target.kind === 'proxy' && target.proxy.protocol === 'socks5') {
    return socks5Tunnel(target.proxy, host, port, timeoutMs);
  }
  if (target.kind === 'proxy') return httpTunnel(target.proxy, host, port, timeoutMs);
  return tcpConnect(host, port, timeoutMs);
}

/**
 * 双向转发并计数。
 *
 * 任一侧结束时**两边一起收尾**：HTTP 代理的语义是每个请求一条连接
 * （中继对下游回 `Connection: close`），留半开连接会积压成句柄泄漏。
 */
export function pipeBoth(a, b, onBytes) {
  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    try { a.destroy(); } catch { /* 已关闭 */ }
    try { b.destroy(); } catch { /* 已关闭 */ }
  };
  a.on('data', (chunk) => {
    if (onBytes) onBytes(chunk.length, 'up');
    if (!b.write(chunk)) a.pause();
  });
  b.on('drain', () => a.resume());
  b.on('data', (chunk) => {
    if (onBytes) onBytes(chunk.length, 'down');
    if (!a.write(chunk)) b.pause();
  });
  a.on('drain', () => b.resume());
  a.once('end', () => { try { b.end(); } catch { /* 已关闭 */ } });
  b.once('end', () => { try { a.end(); } catch { /* 已关闭 */ } });
  a.once('error', shutdown);
  b.once('error', shutdown);
  a.once('close', shutdown);
  b.once('close', shutdown);
  return shutdown;
}
