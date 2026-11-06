/**
 * 学习通客户端：**Cookie 导入 + 带会话发请求**，不做自动登录。
 *
 * # 为什么没有登录
 *
 * 学习通的网页登录要扫码或过滑块验证码，任何"自动化登录"最后都变成维护一个
 * 验证码识别器 —— 它每隔几周就会失效一次，而失效的表现是"账号密码明明对的却
 * 登不上"。所以本包的口径是：**用户在浏览器里登录一次，把 Cookie 粘进来**。
 * 会话有效期内一切照常；过期了就再粘一次，错误文案会直说这件事。
 *
 * # 与上游（ZJU-Omni · xxt/client.ts）的差别
 *
 * | 上游 | 这里 | 为什么 |
 * | --- | --- | --- |
 * | `pbpaste \| npm run cli -- xxt-cookie` | 「复制任一请求的 Cookie，粘贴到本机终端导入」 | 上游是 macOS 写法。本仓跑在 Windows 上，`pbpaste` 在那里根本不存在 —— 印在用户可见的错误里等于教用户敲一条必然报错的命令 |
 * | `HttpClient` + `RateLimiter` | 共享层 `Transport` | 会话、Cookie 罐、超时、Windows DPAPI 都在共享层，重复实现只会两份口径分叉 |
 * | `CookieJar` 自己存 | `SessionStore` | 会话要加密落盘（Windows DPAPI），那是共享层的职责 |
 * | 只用 `Cookie` 请求头 | 同一个罐种全部 `name=value` | 学习通按域分片，见 `hosts.js` |
 */

import {
  ClassroomError,
  SessionStore,
  Transport,
} from 'dsh-zhiyun-source-campus/http';

import {
  XXT_BASE,
  XXT_HOST,
  XXT_HOSTS,
  XXT_PASSPORT_HOST,
  XXT_REFERER,
  isXxtHost,
} from './hosts.js';
import {
  missingRequired,
  parseXxtCookie,
  seedCookies,
  storedCookieNames,
} from './cookie.js';

/**
 * 给用户看的导入指引。
 *
 * ⚠️ **跨平台中性措辞**：上游这里是 `pbpaste | npm run cli -- xxt-cookie`。
 * 那是一句 macOS 专属命令，本仓在 Windows 上跑 —— 用户照着敲只会得到
 * "pbpaste 不是内部或外部命令"，然后更不知道该怎么办。所以只说**做什么**，
 * 不说具体敲什么：粘贴的入口在设置页，终端命令由调用方自己决定。
 */
export const XXT_SETUP = '在浏览器登录学习通，复制任一 chaoxing.com 请求的 Cookie（或它的 cURL），粘贴到本机终端导入。';

/** 环境变量名。优先级高于已存会话，便于排障时临时换一份 Cookie。 */
export const XXT_COOKIE_ENV = 'CHAOXING_COOKIE';

/**
 * 登录页特征串。
 *
 * 命中说明服务端把请求当未登录处理了 —— 但它也可能是**内容**（比如通知正文里
 * 有人贴了登录页链接），所以只有响应不是 JSON 时才据此判失效。
 */
const LOGIN_MARKERS = Object.freeze(['passport2.chaoxing.com/login', '用户登录']);

/** 默认超时。学习通分片多，比校园接口慢一点。 */
export const XXT_DEFAULT_TIMEOUT_MS = 20000;

/**
 * 把查询参数拼到 URL 上。
 *
 * 不用字符串拼接：课程名、关键词都可能带 `&` / `#` / 中文，拼字符串会把它们
 * 变成另一种参数。语义上对齐上游 `HttpClient` 的 `options.query`。
 *
 * @param {string} url - 完整地址。
 * @param {Record<string, unknown>} [query] - 附加参数；`null` / `undefined` 跳过。
 * @returns {string}
 */
export function withQuery(url, query) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null) continue;
    target.searchParams.set(key, String(value));
  }
  return target.toString();
}

/**
 * 学习通 API 门面。
 *
 * 只做三件事：判定该用哪个会话罐、把请求发出去、把"不是成功"的响应翻译成
 * 带 code 的错误。**业务解析一律不在这里**（见 `reads.js` / `parse.js`）。
 */
export class XxtClient {
  /**
   * @param {object} [options]
   * @param {SessionStore} [options.session] - 已存 Cookie 的会话罐（不传则纯内存）。
   * @param {Function} [options.fetch] - 注入的 fetch（测试用）。
   * @param {number} [options.timeoutMs] - 单请求超时。
   * @param {(entry: object) => void} [options.log] - 请求日志钩子。
   * @param {Record<string, string|undefined>} [options.env] - 环境变量（默认 `process.env`）。
   */
  constructor({
    session = new SessionStore({}),
    fetch: fetcher = globalThis.fetch,
    timeoutMs = XXT_DEFAULT_TIMEOUT_MS,
    log = () => {},
    env = process.env,
  } = {}) {
    this.session = session;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.env = env;
    /**
     * 环境变量里的 Cookie 单独一个内存罐。
     *
     * 不能直接种进 `session.jar`：那份是会落盘的（DPAPI 密文），把环境变量里的
     * 临时 Cookie 写进用户长期会话文件，下次没设环境变量时它还在，行为就
     * "没见过的人以为自己没配"。
     */
    this.envSession = null;
    this.transports = new Map();
  }

  /**
   * 环境变量里的 Cookie 原文（没有则空串）。
   * @returns {string}
   */
  envCookie() {
    return String(this.env?.[XXT_COOKIE_ENV] ?? '').trim();
  }

  /**
   * 取当前该用的会话。
   *
   * 有环境变量就用它（现搭一个内存罐），否则用落盘会话。与上游的前提一致：
   * 环境变量是"临时覆盖"，不该被已存会话盖过。
   *
   * ⚠️ 不缓存"有没有 Cookie"这个判断：用户随时可能刚导入完就点刷新。
   * 缓存下来的后果是「明明导入了还说没配」，而这条链路没有任何东西会去
   * 让它失效 —— 只能重启进程。
   *
   * @returns {Promise<SessionStore>} 永远有值；空罐由调用方按"没配"处理。
   */
  async activeSession() {
    const raw = this.envCookie();
    if (!raw) return this.session;
    if (!this.envSession) {
      this.envSession = new SessionStore({});
      const parsed = parseXxtCookie(raw);
      // 环境变量按理就是 `a=1; b=2`；解析失败也不抛 —— 把错误留到请求那一步，
      // 那时的信息（"没识别出 Cookie"）比在这里throw 更贴近用户看到的现象。
      if (parsed) await seedCookies(this.envSession.jar, parsed.cookie);
    }
    return this.envSession;
  }

  /**
   * 按会话取一个 `Transport`（同一会话复用，别每个请求新建）。
   *
   * `hosts` 必须是 `XXT_HOSTS`（按后缀判定）。漏传的后果在 `hosts.js` 里写了：
   * 请求一个 Cookie 都不带，然后被误报成「Cookie 已失效」。
   *
   * @param {SessionStore} session - 会话。
   * @returns {Transport}
   */
  transportFor(session) {
    let transport = this.transports.get(session);
    if (!transport) {
      transport = new Transport({
        session,
        fetch: this.fetcher,
        timeoutMs: this.timeoutMs,
        hosts: XXT_HOSTS,
        referer: XXT_REFERER,
        log: this.log,
      });
      this.transports.set(session, transport);
    }
    return transport;
  }

  /**
   * 当前已配的 Cookie 名。
   *
   * @returns {Promise<string[]>}
   */
  async cookieNames() {
    const session = await this.activeSession();
    const names = await storedCookieNames(session.jar, XXT_BASE);
    if (names.length) return names;
    // 罐是按域取的：某个地址取不到不代表罐里没有。退一步问根域那个地址 ——
    // 域被存成 `chaoxing.com`（无前导点）时，`i.chaoxing.com` 取不到而根域能取到。
    return storedCookieNames(session.jar, `https://${XXT_HOST}/`);
  }

  /**
   * 会话状态。
   *
   * 只回**名字**，不回值：这个结果会进页面、进日志，也可能被用户贴进对话。
   *
   * @returns {Promise<{configured: boolean, source: 'environment'|'session'|null, cookie_names?: string[], missing_required?: string[]}>}
   */
  async status() {
    const raw = this.envCookie();
    const names = await this.cookieNames();
    if (!names.length) return { configured: false, source: null };
    return {
      configured: true,
      source: raw ? 'environment' : 'session',
      cookie_names: names,
      missing_required: missingRequired(names),
    };
  }

  /**
   * 导入一份 Cookie。
   *
   * 只写会话（加密落盘），不验证、不登录 —— 验证是下一次读取的事，
   * 而且"导入即验证"会让一次网络抖动表现为"Cookie 无效"。
   *
   * @param {string} input - 用户粘贴的原文（cURL / 请求头 / 表格 / 裸串）。
   * @returns {Promise<{source: string, cookie_names: string[], missing_required: string[]}>}
   */
  async importCookie(input) {
    const parsed = parseXxtCookie(input);
    if (!parsed) {
      throw new ClassroomError(
        'INVALID_ARGUMENT',
        '没有从输入中识别出 Cookie。请复制任一 chaoxing.com 请求的 cURL 或 Cookie 请求头。',
        { setup: XXT_SETUP },
      );
    }
    const stored = await seedCookies(this.session.jar, parsed.cookie);
    if (!stored) {
      throw new ClassroomError('INVALID_ARGUMENT', 'Cookie 里的键值都不合规，没有存下任何一条。', {
        setup: XXT_SETUP,
      });
    }
    await this.session.save();
    const names = await this.cookieNames();
    return {
      source: parsed.source,
      cookie_names: names,
      missing_required: missingRequired(names),
    };
  }

  /**
   * 发一个请求并返回响应正文。
   *
   * @param {string} url - 完整地址，必须属于 `chaoxing.com`。
   * @param {object} [options] - `{ method, query, form, headers, signal }`。
   * @returns {Promise<string>} 响应正文。
   */
  async request(url, { method = 'GET', query, form, headers = {}, signal } = {}) {
    const target = withQuery(url, query);
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      throw new ClassroomError('INVALID_PATH', `不是合法的学习通地址：${String(url)}。`);
    }
    // 白名单在发请求**之前**判：`Transport` 自己只拦协议，不认平台。
    // 少了这一步，"读一个网址"就等于给了一段任意出网的代码。
    if (parsed.protocol !== 'https:' || !isXxtHost(parsed.hostname)) {
      throw new ClassroomError('INVALID_PATH', '只允许学习通（chaoxing.com）地址。');
    }
    const session = await this.activeSession();
    const names = await storedCookieNames(session.jar, target);
    if (!names.length) {
      throw new ClassroomError(
        'COOKIE_IMPORT_REQUIRED',
        `学习通需要导入一次 Cookie（它登录要扫码或过滑块验证，不做自动登录）。${XXT_SETUP}`,
        { setup: XXT_SETUP },
      );
    }
    const transport = this.transportFor(session);
    const init = { method, headers, signal };
    if (form) {
      init.body = new URLSearchParams(form).toString();
      init.headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...headers,
      };
    }
    const response = await transport.request(target, init);
    return this.inspect(parsed, response);
  }

  /**
   * 把「不是成功」的响应翻译成带 code 的错误，成功则回正文。
   *
   * # 判定顺序（与上游一致）
   *
   * 1. 跳转到登录域 → Cookie 失效（这是学习通最常见的一种"失败"）；
   * 2. 其他 3xx → 意外跳转（签名/参数变了，重试没用）；
   * 3. 403 → 拒绝访问（多半是 Cookie 生效但权限/风控）；
   * 4. 其他非 2xx → 平台错误，带上 status 与端点；
   * 5. 正文里出现登录页特征**且不是 JSON** → Cookie 失效。
   *
   * 第 5 条为什么要判 JSON：通知接口会把用户粘贴的正文原样回给客户端，
   * 里面完全可能出现 `用户登录` 四个字。把 JSON 也按失效处理，就会在
   * "Cookie 明明好的"时候报失效。
   *
   * @param {URL} target - 请求的地址。
   * @param {{status: number, headers: Headers, text: string}} response - 传输层回包。
   * @returns {string} 正文。
   */
  inspect(target, response) {
    const location = response.headers?.get?.('location') ?? '';
    if (response.status >= 300 && response.status < 400) {
      if (location.includes(XXT_PASSPORT_HOST)) {
        throw new ClassroomError('COOKIE_EXPIRED', `学习通登录已失效，请重新导入 Cookie。${XXT_SETUP}`, {
          setup: XXT_SETUP,
        });
      }
      throw new ClassroomError('UNEXPECTED_RESPONSE', '学习通返回了意外的跳转。', {
        status: response.status,
      });
    }
    if (response.status === 403) {
      throw new ClassroomError('FORBIDDEN', '学习通拒绝访问。', { endpoint: target.pathname });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ClassroomError('PLATFORM_ERROR', `学习通返回 HTTP ${response.status}。`, {
        http_status: response.status,
        endpoint: target.pathname,
      });
    }
    const body = String(response.text ?? '');
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!/json/i.test(contentType) && LOGIN_MARKERS.some((marker) => body.includes(marker))) {
      throw new ClassroomError('COOKIE_EXPIRED', `学习通返回了登录页，请重新导入 Cookie。${XXT_SETUP}`, {
        setup: XXT_SETUP,
      });
    }
    return body;
  }

  /**
   * GET 一个地址。
   *
   * @param {string} url - 完整地址。
   * @param {Record<string, unknown>} [query] - 查询参数。
   * @param {object} [options] - `{ signal }`。
   * @returns {Promise<string>} 正文。
   */
  get(url, query, options = {}) {
    return this.request(url, { method: 'GET', query, ...options });
  }

  /**
   * POST 一个表单。
   *
   * @param {string} url - 完整地址。
   * @param {Record<string, string>} [form] - 表单字段。
   * @param {object} [options] - `{ signal }`。
   * @returns {Promise<string>} 正文。
   */
  post(url, form = {}, options = {}) {
    return this.request(url, { method: 'POST', form, ...options });
  }

  /**
   * 探一次登录态：能打开个人主页就算有效。
   *
   * @returns {Promise<{authenticated: boolean, reason?: string}>}
   */
  async checkLogin() {
    try {
      await this.get(XXT_BASE);
      return { authenticated: true };
    } catch (error) {
      if (error instanceof ClassroomError
        && (error.code === 'COOKIE_EXPIRED' || error.code === 'COOKIE_IMPORT_REQUIRED')) {
        return { authenticated: false, reason: error.code };
      }
      throw error;
    }
  }
}
