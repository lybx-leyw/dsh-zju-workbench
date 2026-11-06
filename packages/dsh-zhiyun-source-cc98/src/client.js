/**
 * CC98 的 HTTP 客户端：拼 URL、带 Bearer、把响应收成数据或 `ClassroomError`。
 *
 * # 只用共享层的 `Transport`
 *
 * 请求、超时、取消、按主机白名单收发 cookie 都在 `Transport` 里（本仓已验证过）。
 * 本文件只做 CC98 **特有**的三件事：
 *
 * 1. 在 `Transport` 之上补 `Authorization: Bearer`（`Transport` 只管 cookie，不管
 *    Bearer —— 那是本平台独有的认证方式，钉进共享层会让别的站点背着它）；
 * 2. 把 HTTP 状态翻成有**可操作语义**的错误码（401 / 403 / 404 / 429 的处置完全不同）；
 * 3. 401 时**只刷新一次**再重试：无限重试会在令牌被吊销时变成死循环。
 *
 * # 只读
 *
 * 本包的公开面只有 GET。发令牌那次 POST 在 `token.js` 里，目标写死为
 * `TOKEN_URL`，不进这里的数据路径 —— 所以即使调用方拿到 `Cc98Client`，
 * 也没有任何能改论坛状态的入口。
 */

import { ClassroomError, Transport } from 'dsh-zhiyun-source-campus/http';
import { CC98_API, CC98_HOSTS, REFERER } from './hosts.js';

/**
 * 路径白名单校验。
 *
 * 只允许以 `/` 开头的相对路径，且不许出现 `..`：这个客户端拼的是
 * `${CC98_API}${path}`，放开绝对 URL 就等于让调用方拿本包的令牌去打任意站点
 * （令牌泄漏给第三方域，且请求会带着 `Referer`）。
 *
 * @param path - 例：`/topic/123`。
 * @returns 原路径。
 * @throws ClassroomError `INVALID_PATH`。
 */
export function apiPath(path) {
  const text = String(path ?? '');
  if (!text.startsWith('/') || text.includes('..') || text.includes('//')) {
    throw new ClassroomError('INVALID_PATH', `只允许 CC98 接口的相对路径，收到：${text}`);
  }
  return text;
}

/**
 * 把查询参数拼进 URL。
 *
 * `undefined` / `null` 的键**整个不出现**，而不是发 `?from=undefined`：
 * CC98 对未知取值会回 400，而错误信息不会指向"某个参数是 undefined"。
 *
 * @param base - 例：`https://api.cc98.org/topic/1`。
 * @param query - 参数表。
 * @returns 完整 URL。
 */
export function withQuery(base, query) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') url.searchParams.set(key, value ? 'true' : 'false');
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * 把 HTTP 状态翻成错误。
 *
 * 每种状态给的是**下一步该做什么**，不是状态的复述：
 * 401 去重登、403 是权限、404 是对象不存在、429 是等一会。
 * 这四种搅在一起时，用户看到"CC98 请求失败"只会反复重试。
 *
 * @param status - HTTP 状态码。
 * @param text - 响应体（截断后进错误信息，便于归因）。
 * @param path - 出错的接口路径。
 * @param where - 给用户看的位置描述（如「帖子 1 的楼层」）。
 * @returns ClassroomError。
 */
export function httpError(status, text, path, where) {
  const reason = String(text ?? '').slice(0, 120).replace(/\s+/g, ' ').trim();
  if (status === 401) return new ClassroomError('LOGIN_REQUIRED', 'CC98 登录已失效（令牌被拒）。', { status, path });
  if (status === 403) return new ClassroomError('FORBIDDEN', `CC98 拒绝访问${where ? `（${where}）` : ''}：可能没有该版面权限，或账号受限。`, { status, path });
  if (status === 404) return new ClassroomError('NOT_FOUND', `CC98 上没有${where || '这个对象'}。`, { status, path });
  if (status === 429) return new ClassroomError('RATE_LIMITED', 'CC98 请求过于频繁，请稍后再试。', { status, path });
  if (status >= 300 && status < 400) return new ClassroomError('UNEXPECTED_RESPONSE', 'CC98 返回了跳转（接口地址可能变了）。', { status, path });
  return new ClassroomError('PLATFORM_REJECTED',
    `CC98 返回 HTTP ${status}${reason ? `：${reason}` : ''}`, { status, path });
}

/**
 * 解析响应体。
 *
 * CC98 大多数接口回 JSON，但 `/board/{id}/topic` 之类的某些实现会回裸文本
 * （例如发帖接口回一个裸帖子 id）。所以：能 `JSON.parse` 就 JSON，否则原样返回字符串，
 * 空体返回 `undefined`。这**不是**宽松——调用方（`reads.js`）随后会校验形状，
 * 形状不对时报 `SCHEMA_CHANGED`，比在这里猜更准。
 *
 * @param text - 响应体。
 * @returns 解析结果。
 */
export function parseBody(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * CC98 REST 客户端。
 *
 * 构造时注入 `Transport` 与 `TokenStore`；两者都可以在测试里换成假的，
 * 于是整条链路（拼 URL、带 Bearer、401 重试、错误归因）都能离线验证。
 */
export class Cc98Client {
  /**
   * @param options
   * @param options.tokens - `TokenStore`（`token.js`）。
   * @param options.transport - 共享层 `Transport`；不给就按 `hosts` 建一个。
   * @param options.session - `SessionStore`（建 `transport` 时用）。
   * @param options.fetch - 出口实现（测试注入）。
   * @param options.log - 日志。
   * @param options.timeoutMs - 单请求超时。
   */
  constructor({ tokens, transport, session, fetch, log = () => {}, timeoutMs = 20000 } = {}) {
    this.tokens = tokens;
    this.transport = transport ?? new Transport({
      session,
      fetch: fetch ?? globalThis.fetch,
      timeoutMs,
      // ⚠️ 必须显式传 `hosts`。`Transport` 的默认白名单是智云课堂那一套，
      //    与本包无关；漏传会让「发不发 cookie」由一个不相干的默认值决定。
      hosts: CC98_HOSTS,
      referer: REFERER,
      log,
    });
    this.log = log;
    this.timeoutMs = timeoutMs;
  }

  /**
   * 发一次带 Bearer 的请求（不发令牌请求，不做重试）。
   *
   * @param {string} method - GET（本包只会用 GET）。
   * @param {string} path - CC98 接口路径。
   * @param {object} [options]
   * @param {object} [options.query] - 查询参数。
   * @param {boolean} [options.anonymous] - 不带令牌（首页配置、版面列表是公开的）。
   * @param {AbortSignal} [options.signal] - 取消信号。
   * @returns `{ status, text }`。
   */
  async send(method, path, { query, anonymous = false, signal } = {}) {
    const url = withQuery(`${CC98_API}${apiPath(path)}`, query);
    const headers = { Accept: 'application/json', Referer: REFERER };
    if (!anonymous) headers.Authorization = `Bearer ${await this.tokens.token()}`;
    return this.transport.request(url, { method, headers, signal });
  }

  /**
   * 读一个 CC98 接口。
   *
   * 401 时刷新令牌**重试一次**：令牌可能只是到期（`expires_at` 留了 60 秒余量，
   * 仍可能被服务端提前判废）。若第二次仍是 401，说明密码/账号真有问题，
   * 交给 `httpError` 报 `LOGIN_REQUIRED` —— 不再重试。
   *
   * @param {string} method - 只应传 GET。
   * @param {string} path - 接口路径。
   * @param {object} [options] - 同 `send`。
   * @returns 解析后的响应体。
   */
  async request(method, path, options = {}) {
    const target = apiPath(path);
    let result = await this.send(method, target, options);
    if (result.status === 401 && !options.anonymous) {
      this.log('CC98 令牌被拒，刷新后重试一次');
      await this.tokens.token({ force: true });
      result = await this.send(method, target, options);
    }
    if (result.status < 200 || result.status >= 300) {
      throw httpError(result.status, result.text, target, options.where);
    }
    return parseBody(result.text);
  }

  /**
   * GET 的语法糖 —— 本包所有数据方法都走它。
   *
   * @param path - 接口路径。
   * @param options - 同 `request`。
   * @returns 响应体。
   */
  async get(path, options) {
    return this.request('GET', path, options);
  }
}
