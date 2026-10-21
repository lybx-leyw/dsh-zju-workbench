/**
 * 设置页的 HTTP 面（`/_dsh/zhiyun-net-proxy`）。
 *
 * 只有三个动作，够「个人 → 网络代理」面板用：
 *
 *   GET                      读配置 + 运行状态
 *   POST { action:'save' }   校验并保存配置，随后立即重载（无需重启）
 *   POST { action:'test' }   对一个出口做连通性探测
 *
 * # 安全边界
 *
 * 这份配置里有代理凭据（用户名/密码），而本路由与宿主 Web UI 同源。两层防护：
 *
 *   1. **Host 校验**：只接受回环 Host。防的是 DNS rebinding —— 恶意域名解析到
 *      127.0.0.1 后，浏览器会把请求当同源发过来读走凭据；
 *   2. **自定义头**：写操作必须带 `x-zhiyun-net-proxy`。跨站的「简单请求」带不了
 *      自定义头，一旦带上就会触发 CORS 预检，而本路由不响应 OPTIONS，预检必失败 ——
 *      于是 `evil.com` 无法用表单或 `text/plain` 改写代理配置（CSRF）。
 *
 * 读配置时**密码一律打码**，前端提交打码值代表「未改动」并保留原值。这样即便
 * 同源页面被 XSS 注入，也读不到明文凭据。
 */

import { openTunnel } from './connect.js';

/** 密码打码值。前端回传它 = 不改密码。 */
const MASK = '***';

const MAX_BODY = 64 * 1024;
export const WRITE_HEADER = 'x-zhiyun-net-proxy';
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function hostOf(header) {
  const value = String(header ?? '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? value : value.slice(1, close);
  }
  const colon = value.lastIndexOf(':');
  if (colon !== -1 && value.indexOf(':') === colon && /^\d+$/.test(value.slice(colon + 1))) {
    return value.slice(0, colon);
  }
  return value;
}

/** Host 头必须是回环（无 Host 视为非浏览器直连，放行）。 */
function allowedHost(headers) {
  const host = hostOf(headers?.host);
  return !host || ALLOWED_HOSTS.has(host);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error(`请求体过大（上限 ${MAX_BODY} 字节）`);
    chunks.push(chunk);
  }
  if (!size) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/** 读出站配置时把凭据打码。 */
function maskConfig(config) {
  return {
    ...config,
    proxies: config.proxies.map((proxy) => ({ ...proxy, password: proxy.password ? MASK : '' })),
  };
}

/**
 * 提交上来的配置里，密码为打码值或空但原配置有密码时，保留原密码。
 *
 * 判据用 `id`：面板里每个代理的 `id` 由前端生成且稳定，因此能准确对上
 * 「这是同一个代理，只是密码字段没改」。新加的代理没有对应 id，按用户填的来。
 */
function unmaskConfig(incoming, previous) {
  const byId = new Map(previous.proxies.map((proxy) => [proxy.id, proxy]));
  return {
    ...incoming,
    proxies: (Array.isArray(incoming.proxies) ? incoming.proxies : []).map((proxy) => {
      const old = byId.get(proxy?.id);
      const password = proxy?.password;
      if (!old) return proxy;
      if (password === MASK) return { ...proxy, password: old.password };
      // 前端把密码框留空（且原本有密码）也视为未改动：避免用户为了改端口
      // 就被迫重新输入一遍密码。
      if ((password === '' || password === undefined) && old.password) return { ...proxy, password: old.password };
      return proxy;
    }),
  };
}

/**
 * 连通性探测：**直接连该出口**，分辨「出口本身通不通」。
 *
 * 刻意不经中继：若经中继，一条配错的域名规则会把「出口连不上」伪装成
 * 「中继坏了」，用户看到的现象一样、原因却完全不同。分开探测，两种故障
 * 才能被区分开。
 *
 * 目标是 `example.com:80` 而不是某个业务域名 —— 探测不该变成对第三方站点的
 * 骚扰，也不该依赖某个具体业务是否可用。用 80 端口而非 443：只验证隧道能否
 * 建立，不做 TLS 握手（探测代理可用性不需要它，还能少一次失败面）。
 */
export async function probeDirect(target, timeoutMs = 15000) {
  const started = Date.now();
  try {
    const socket = await openTunnel(target, 'example.com', 80, timeoutMs);
    socket.destroy();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error.message };
  }
}

export function createSettingsHandler({ getConfig, save, reload, status }) {
  return async function handler(req, res) {
    const headers = req.headers ?? {};
    if (!allowedHost(headers)) {
      sendJson(res, 403, { ok: false, error: { message: '拒绝非回环 Host 的请求' } });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, config: maskConfig(getConfig()), status: status() });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { message: '只支持 GET / POST' } });
      return;
    }

    // CSRF：写操作必须带自定义头（跨站简单请求带不了，带上就会触发预检）。
    if (!headers[WRITE_HEADER]) {
      sendJson(res, 403, { ok: false, error: { message: `写操作缺少 ${WRITE_HEADER} 头` } });
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: { message: error.message } });
      return;
    }

    const action = String(body.action ?? '');

    if (action === 'save') {
      try {
        const merged = unmaskConfig(body.config ?? {}, getConfig());
        const config = await save(merged); // save 内部会 normalize 并重载
        sendJson(res, 200, { ok: true, config: maskConfig(config), status: status() });
      } catch (error) {
        // 校验失败要**原样回传原因**：用户需要知道是哪一条规则/哪个代理写错了。
        sendJson(res, 400, { ok: false, error: { message: error.message } });
      }
      return;
    }

    if (action === 'test') {
      const targetId = String(body.target ?? '');
      const config = getConfig();
      const target = targetId === 'direct'
        ? { kind: 'direct' }
        : (() => {
          const proxy = config.proxies.find((item) => item.id === targetId);
          return proxy ? { kind: 'proxy', proxy } : null;
        })();
      if (!target) {
        sendJson(res, 400, { ok: false, error: { message: `没有这个出口：${targetId}` } });
        return;
      }
      const result = await probeDirect(target, 15000);
      sendJson(res, 200, { ok: true, result });
      return;
    }

    if (action === 'reload') {
      try {
        const config = await reload();
        sendJson(res, 200, { ok: true, config: maskConfig(config), status: status() });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: { message: error.message } });
      }
      return;
    }

    sendJson(res, 400, { ok: false, error: { message: `未知操作：${action || '(空)'}` } });
  };
}
