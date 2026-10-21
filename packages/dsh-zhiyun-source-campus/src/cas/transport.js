import { ClassroomError, object, shape } from './errors.js';
import { SessionStore } from './session.js';
import { resourceUrl } from './urls.js';

export const REFERER = 'https://classroom.zju.edu.cn/';

/**
 * 统一的 User-Agent。
 *
 * ⚠️ 必须是**完整的浏览器 UA 串**（含平台段与内核段）。早先这里写的是
 * `Mozilla/5.0 Chrome/122.0.0.0 Safari/537.36` —— 缺了平台段
 * （`(Windows NT 10.0; Win64; x64) AppleWebKit/...`），是不合法的 UA 格式。
 *
 * 对照 `zju-mcp` 的同名常量，它用的是完整串。站点若按 UA 判断客户端类型，
 * 残缺串可能被归到"非浏览器"，进而走不同的处理路径（限速、降级、改写响应）。
 * 这与"同样是 `/api/todos`，有人拿到完整列表、有人拿到残缺列表"是同一类风险。
 */
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * 默认放行主机 —— **classroom 那一套**。
 *
 * ⚠️ 这是从 `dsh-zhiyun-source-classroom` 原样复制来的，所以默认值只覆盖智云课堂的域名。
 *    学在浙大（`courses.zju.edu.cn`）与拼题A（`pintia.cn`）**不在**其中，
 *    必须由调用方通过 `hosts` 传进来。
 *
 *    不传的后果很隐蔽：`Transport.request` 只在 `AUTH_HOSTS.has(host)` 时才
 *    读写 cookie，于是**请求一个 cookie 都不带、回来的 Set-Cookie 也一个都不存** ——
 *    登录流程"成功"了，会话却永远是空的，下一次读立刻回到未登录。
 *    这正是学在浙大"连不上"的根因。
 */
export const AUTH_HOSTS = new Set(['zjuam.zju.edu.cn', 'tgmedia.cmc.zju.edu.cn', 'classroom.zju.edu.cn', 'interactivemeta.cmc.zju.edu.cn', 'education.cmc.zju.edu.cn', 'yjapi.cmc.zju.edu.cn']);

export class Transport {
  constructor({
    session = new SessionStore(),
    fetch: fetcher = globalThis.fetch,
    timeoutMs = 60000,
    log = () => {},
    hosts = AUTH_HOSTS,
    referer = REFERER,
    cookieFilter = null,
  } = {}) {
    this.session = session; this.fetcher = fetcher; this.timeoutMs = timeoutMs; this.log = log;
    this.hosts = hosts;
    this.referer = referer;
    /**
     * 逐条决定"这个 cookie 要不要发出去"。
     *
     * ⚠️ classroom 的默认实现是**只把 `iPlanetDirectoryPro` 发给 zjuam**：
     *
     * ```js
     * (c, _i, _arr) => c.key !== 'iPlanetDirectoryPro' || <host> === 'zjuam.zju.edu.cn'
     * ```
     *
     * 那条规则对智云课堂成立（它的会话靠 `_token` 走，不靠 SSO 票），
     * 但**对学在浙大是致命的**：学在浙大恰恰要带着 SSO 票去
     * `courses.zju.edu.cn`，让站点的 CAS 过滤器认出身份。
     *
     * 所以这里默认**不过滤**（发全部），并由调用方按需覆盖 ——
     * 复制来的那份默认行为不再强加给新站点。
     */
    this.cookieFilter = cookieFilter ?? (() => true);
    this.controllers = new Set(); this.closed = false;
    /**
     * 累计发起的请求数。
     *
     * 只用于诊断（"这次待办到底打了多少个请求"），不影响任何行为。
     * 之所以值得有个计数器：待办的耗时几乎完全由**请求数 × 单请求延迟**决定，
     * 而请求数是逐门课累加的（5 个端点 × 课程数），肉眼看不出来。
     */
    this.requests = 0;
    /**
     * 每次请求的耗时样本（只保留最近 200 条）。
     *
     * ⚠️ 只记 `ms` 与 `path`，**不记 header / cookie / body** —— 这是诊断数据，
     * 不该把凭证带进去。有了它才能看出「1.1 秒/请求」到底是普遍慢，
     * 还是少数请求（如首次 TLS 握手）拖累了均值。
     */
    this.timings = [];
  }
  async request(url, { signal, method = 'GET', body, headers = {}, stream = false, auth = true, timeoutMs = this.timeoutMs } = {}) {
    if (this.closed) throw new ClassroomError('DISPOSED', '数据源已关闭');
    url = resourceUrl(url);
    const target = new URL(url);
    this.requests += 1;
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))) throw new ClassroomError('URL', '不支持的请求协议');
    const controller = new AbortController(); this.controllers.add(controller);
    const startedAt = Date.now();
    const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    let cookies = '';
    let handedOff = false;
    const epoch = this.session.epoch;
    try {
      if (auth && this.hosts.has(target.hostname)) cookies = (await this.session.jar.getCookies(url))
        .filter(this.cookieFilter).map(c => c.cookieString()).join('; ');
      combined.throwIfAborted();
      const response = await this.fetcher(url, { method, body, redirect: 'manual', signal: combined,
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', Referer: this.referer,
          ...headers, ...(cookies ? { Cookie: cookies } : {}) } });
      if (epoch === this.session.epoch && auth && this.hosts.has(target.hostname)) {
        const receivedCookies = response.headers.getSetCookie();
        for (const cookie of receivedCookies) {
          try { await this.session.jar.setCookie(cookie, url); } catch { throw new ClassroomError('COOKIE', '服务端 Cookie 域或格式异常'); }
        }
        /**
         * ⚠️ 这里**不能** `await this.session.save()`。
         *
         * `save()` 会 spawn `powershell.exe` 做 DPAPI 加密 —— 本机实测单次
         * **1249ms**。而每个带 `Set-Cookie` 的响应都会走到这里，一次逐课待办
         * 有几十个请求，于是每个请求白等一秒多，且保存互相排队。
         *
         * `scheduleSave()` 把落盘推迟并合并：请求立刻继续，磁盘副本稍后写一次。
         * 内存里的 jar 始终是最新的，所以同一次运行内行为完全不变。
         */
        if (receivedCookies.length) {
          if (typeof this.session.scheduleSave === 'function') this.session.scheduleSave();
          else await this.session.save?.();
        }
      }
      this.log({ method, host: target.hostname, path: target.pathname, status: response.status });
      if (stream) { handedOff = true; return { response, release: () => this.controllers.delete(controller), signal: combined }; }
      const text = await response.text();
      // 记一条耗时样本（诊断用；只留路径与毫秒，不含凭证）
      this.timings.push({ ms: Date.now() - startedAt, path: target.pathname, status: response.status });
      if (this.timings.length > 200) this.timings.splice(0, this.timings.length - 200);
      return { status: response.status, headers: response.headers, text };
    } catch (error) {
      if (error instanceof ClassroomError) throw error;
      if (combined.aborted) throw new ClassroomError(signal?.aborted || controller.signal.aborted ? 'CANCELLED' : 'TIMEOUT', '请求已取消或超时');
      throw new ClassroomError('NETWORK', '无法连接智云服务');
    } finally { if (!handedOff) this.controllers.delete(controller); }
  }
  async json(url, label, options) {
    const result = await this.request(url, options);
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
    if (Number(data.code) >= 400 && Number(data.code) <= 599) throw new ClassroomError('BUSINESS', '智云服务返回失败', { label });
    if (data.success === false || data.success === 'false') throw new ClassroomError('BUSINESS', '智云服务返回失败', { label });
    return data;
  }
  cancelAll() { for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
  close() { this.closed = true; this.cancelAll(); }
}
