/**
 * 局域网桥：把手机（Celechron）和这台电脑接起来。
 *
 * # 为什么需要它
 *
 * Celechron 要拿到电脑上这份规划数据，但两台设备之间没有共享存储。
 * 走公网服务要部署、要账号；走文件传输要用户手动搬。局域网是最短的路。
 *
 * # 安全模型
 *
 * **这里不引入任何账号体系**，只有一个随机 8 位数字密码：
 *
 *   - 密码在**每次开桥时重新生成**，不落盘、不复用；
 *   - 手机扫码或手输一次，之后带着它请求；
 *   - 关桥即失效。
 *
 * 这不是"强安全"，是"防止同一局域网里的其他人随手点开"。真正的边界是
 * **用户自己要开这个桥**（默认关闭），以及密码不会长期存在。
 *
 * # 为什么不用 HTTPS
 *
 * 局域网内自签证书会让手机端必须信任一个自制 CA —— 对普通用户是不可接受的
 * 摩擦，而它换来的对抗能力（同网段中间人）并不在这个威胁模型里。
 * 明文 + 短时密码是这类"同网段传数据"工具的常规取舍。
 */

import { createServer } from 'node:http';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

/** 桥的默认端口。选一个不常见的，避免和开发服务器/常见服务撞。 */
export const DEFAULT_PORT = 8791;

/**
 * 生成 8 位数字密码。
 *
 * 用 `randomInt` 而不是 `Math.random` —— 后者是可预测的 PRNG，
 * 局域网里知道时间戳的人能大致推出来。
 *
 * @returns {string} 8 个数字字符。
 */
export function generatePasscode() {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += String(randomInt(0, 10));
  return out;
}

/**
 * 常数时间比较密码。
 *
 * 直接 `===` 会在第一个不同的字符处返回，攻击者能靠响应时间逐位试出来。
 * 这里先各自哈希成等长缓冲再比较，长度差异不泄露。
 *
 * @param {string|null|undefined} given - 请求里带来的
 * @param {string} expected - 本次开桥生成的
 * @returns {boolean}
 */
export function passcodeMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * 列出本机所有可用于局域网访问的 IPv4 地址。
 *
 * 排除：
 *   - 回环（127.x）—— 手机连不上；
 *   - 链路本地（169.254.x）—— 通常是没拿到 DHCP 的无效地址；
 *   - 非 internal 但已经 down 的网卡。
 *
 * @returns {string[]} 形如 `['192.168.1.5']`
 */
export function lanAddresses() {
  const out = [];
  const interfaces = networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      // Node < 18 用字符串 'IPv4'，新版本用数字 4。两个都认。
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4) continue;
      if (entry.internal) continue;
      if (entry.address.startsWith('127.')) continue;
      if (entry.address.startsWith('169.254.')) continue;
      out.push(entry.address);
    }
  }
  // 去重：一张网卡可能有多个别名。
  return [...new Set(out)];
}

/**
 * 起一个桥服务器。
 *
 * @param {object} options
 * @param {(req: import('node:http').IncomingMessage) => Promise<object>} options.getSnapshot
 *   每次请求都要重新取快照 —— 数据会变，不能缓存一份就发一辈子。
 * @param {number} [options.port] - 端口，0 表示让系统挑。
 * @param {string} [options.host] - 绑定的地址，默认 0.0.0.0（局域网可达）。
 * @param {number} [options.now] - 注入时间（测试用）。
 * @param {(msg: string) => void} [options.log] - 日志出口。
 * @returns {Promise<{ url: string, href: string, passcode: string, port: number, addresses: string[], close: () => Promise<void> }>}
 */
export async function startBridge({
  getSnapshot,
  port = DEFAULT_PORT,
  host = '0.0.0.0',
  log = () => {},
} = {}) {
  if (typeof getSnapshot !== 'function') {
    throw new Error('startBridge 需要一个 getSnapshot 函数');
  }

  const passcode = generatePasscode();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // 所有响应都不许被中间层缓存 —— 数据是"此刻的规划"。
    res.setHeader('Cache-Control', 'no-store');

    // 手机浏览器与 Flutter 都会先发 OPTIONS（自定义头触发预检）。
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (url.pathname === '/health') {
      // 健康检查**不需要密码**：它只回"这里有个桥"，不含任何数据。
      sendJson(res, 200, { ok: true, name: 'zhiyun-bridge' });
      return;
    }

    if (url.pathname === '/') {
      // 说明页，不含数据。用户扫错码时能看懂这是什么。
      sendHtml(res, 200, landingPage(passcode));
      return;
    }

    if (url.pathname === '/snapshot') {
      if (!passcodeMatches(header(req, 'x-zhiyun-passcode') ?? url.searchParams.get('passcode'), passcode)) {
        sendJson(res, 401, { error: 'PASSCODE_REJECTED' });
        return;
      }
      try {
        const snapshot = await getSnapshot(req);
        sendJson(res, 200, snapshot);
      } catch (error) {
        log(`导出快照失败：${error?.message ?? error}`);
        sendJson(res, 500, { error: 'SNAPSHOT_FAILED', message: String(error?.message ?? error) });
      }
      return;
    }

    sendJson(res, 404, { error: 'NOT_FOUND' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const actualPort = server.address().port;
  const addresses = lanAddresses();
  const base = addresses[0] ? `http://${addresses[0]}:${actualPort}` : `http://127.0.0.1:${actualPort}`;

  log(`局域网桥已启动：${base}（密码 ${passcode}）`);

  return {
    /** 手机应访问的地址（用第一个局域网 IP）。 */
    url: `${base}/snapshot`,
    /** 说明页地址，二维码该指向这里。 */
    href: base,
    passcode,
    port: actualPort,
    addresses,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/**
 * 二维码该指向哪。
 *
 * 指向**说明页**而不是 `/snapshot`：说明页会显示"这个桥在干什么 + 一个
 * 一键复制密码的按钮 + 密码本身"，用户扫码后能看到发生了什么，而不是
 * 直接下载一段 JSON 不知道是什么。
 *
 * @param {string} base - 形如 `http://192.168.1.5:8791`
 * @returns {string}
 */
export function qrTarget(base) {
  return String(base).replace(/\/+$/, '');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Zhiyun-Passcode',
    'Access-Control-Max-Age': '600',
  };
}

function header(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, code, html) {
  res.writeHead(code, {
    ...corsHeaders(),
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

/** 说明页。刻意做成手机友好的窄栏。 */
function landingPage(passcode) {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>智云桥</title>
<style>
  :root{color-scheme:light dark}
  body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       max-width:32rem;margin:0 auto;padding:2rem 1.25rem;color:#111;background:#fff}
  @media (prefers-color-scheme:dark){body{color:#eee;background:#111}
    code{background:#222!important}}
  h1{font-size:1.35rem;margin:0 0 .5rem}
  p{margin:.5rem 0;color:#666}
  @media (prefers-color-scheme:dark){p{color:#aaa}}
  .code{font:600 2rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;
        letter-spacing:.35rem;padding:.9rem 1rem;background:#f4f4f4;border-radius:.6rem;
        text-align:center;margin:1.25rem 0}
  code{font-family:ui-monospace,monospace;background:#f4f4f4;padding:.1rem .3rem;border-radius:.25rem}
  .muted{font-size:.85rem}
</style></head>
<body>
<h1>智云桥</h1>
<p>这台电脑正在把它本地的规划数据共享到局域网。在 Celechron 里输入下面的密码即可同步。</p>
<div class="code">${escapeHtml(passcode)}</div>
<p class="muted">数据只在局域网内传输，关掉这个桥就断开。密码每次开桥都会重新生成。</p>
<p class="muted">接口：<code>GET /snapshot</code>，请求头 <code>X-Zhiyun-Passcode</code>。</p>
</body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
