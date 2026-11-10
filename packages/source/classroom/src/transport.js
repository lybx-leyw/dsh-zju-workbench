import { ClassroomError, object, shape } from './errors.js';
import { SessionStore } from './session.js';
import { resourceUrl } from './urls.js';

export const REFERER = 'https://classroom.zju.edu.cn/';
export const AUTH_HOSTS = new Set(['zjuam.zju.edu.cn', 'identity.zju.edu.cn', 'tgmedia.cmc.zju.edu.cn', 'classroom.zju.edu.cn', 'interactivemeta.cmc.zju.edu.cn', 'education.cmc.zju.edu.cn', 'yjapi.cmc.zju.edu.cn']);
export class Transport {
  constructor({ session = new SessionStore(), fetch: fetcher = globalThis.fetch, timeoutMs = 60000, log = () => {} } = {}) {
    this.session = session; this.fetcher = fetcher; this.timeoutMs = timeoutMs; this.log = log;
    this.controllers = new Set(); this.closed = false;
  }
  async request(url, { signal, method = 'GET', body, headers = {}, stream = false, auth = true, timeoutMs = this.timeoutMs } = {}) {
    if (this.closed) throw new ClassroomError('DISPOSED', '数据源已关闭');
    url = resourceUrl(url);
    const target = new URL(url);
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))) throw new ClassroomError('URL', '不支持的请求协议');
    const controller = new AbortController(); this.controllers.add(controller);
    const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    let cookies = '';
    let handedOff = false;
    const epoch = this.session.epoch;
    try {
      if (auth && AUTH_HOSTS.has(target.hostname)) cookies = (await this.session.jar.getCookies(url))
        .filter(c => c.key !== 'iPlanetDirectoryPro' || target.hostname === 'zjuam.zju.edu.cn').map(c => c.cookieString()).join('; ');
      combined.throwIfAborted();
      const response = await this.fetcher(url, { method, body, redirect: 'manual', signal: combined,
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/122.0.0.0 Safari/537.36', Accept: 'application/json, text/plain, */*', Referer: REFERER,
          ...headers, ...(cookies ? { Cookie: cookies } : {}) } });
      if (epoch === this.session.epoch && auth && AUTH_HOSTS.has(target.hostname)) {
        const receivedCookies = response.headers.getSetCookie();
        for (const cookie of receivedCookies) {
          try { await this.session.jar.setCookie(cookie, url); } catch { throw new ClassroomError('COOKIE', '服务端 Cookie 域或格式异常'); }
        }
        if (receivedCookies.length) await this.session.save();
      }
      this.log({ method, host: target.hostname, path: target.pathname, status: response.status });
      if (stream) { handedOff = true; return { response, release: () => this.controllers.delete(controller), signal: combined }; }
      const text = await response.text();
      return { status: response.status, headers: response.headers, text };
    } catch (error) {
      if (error instanceof ClassroomError) throw error;
      if (combined.aborted) throw new ClassroomError(signal?.aborted || controller.signal.aborted ? 'CANCELLED' : 'TIMEOUT', '请求已取消或超时');
      throw new ClassroomError('NETWORK', '无法连接智云服务');
    } finally { if (!handedOff) this.controllers.delete(controller); }
  }
  /**
   * 取 JSON 并做统一的失败分类。
   *
   * `options.tolerate` 是本仓为**一种**上游行为开的口子：有些接口在「这一类资源
   * 本来就不存在」时是**拒绝**而不是给空表（例如当天还没点播的课次查字幕，
   * 上游回 `未查询到语音数据`）。默认把它归成 `BUSINESS` 是对的 —— 别吞错。
   * 但调用方如果**确实知道**这一种可以当空处理，就得有个地方说清楚：
   * `tolerate(data)` 返回真时**原样返回 data**，由调用方自己决定怎么用。
   *
   * 关键点：判定发生在**能看到上游原文的**这一层。放到外面去匹配
   * `error.message` 是不行的 —— 下面把业务失败统一成了「智云服务返回失败」，
   * 上游的 `msg` 根本不出现在 message 里，外面匹配什么都不会命中。
   */
  async json(url, label, options = {}) {
    const { tolerate, ...request } = options;
    const result = await this.request(url, request);
    if ([401, 403].includes(result.status)) throw new ClassroomError('SESSION_EXPIRED', '智云登录会话已过期', { status: result.status, label });
    if (result.status >= 400) throw new ClassroomError('HTTP', '智云服务请求失败', { status: result.status, label });
    if (result.status >= 300 && result.status < 400) throw new ClassroomError('SESSION_EXPIRED', '智云请求被重定向，需要重新登录', { label });
    if (/^\s*</.test(result.text)) {
      if (/name=["']execution["']|cas\/login/i.test(result.text)) throw new ClassroomError('SESSION_EXPIRED', '智云登录会话已过期', { label });
      throw shape(label, '预期 JSON，收到 HTML');
    }
    let data;
    try { data = JSON.parse(result.text); } catch { throw shape(label, '不是 JSON'); }
    if (!object(data)) throw shape(label, '不是对象');
    if ([401, 403].includes(Number(data.code))) throw new ClassroomError('SESSION_EXPIRED', '智云登录会话已过期', { label });
    // Course API uses business code=1000 for success, not an HTTP status.
    if (Number(data.code) >= 400 && Number(data.code) <= 599 && !tolerate?.(data)) throw new ClassroomError('BUSINESS', '智云服务返回失败', { label });
    if ((data.success === false || data.success === 'false') && !tolerate?.(data)) throw new ClassroomError('BUSINESS', '智云服务返回失败', { label });
    return data;
  }
  cancelAll() { for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
  close() { this.closed = true; this.cancelAll(); }
}
