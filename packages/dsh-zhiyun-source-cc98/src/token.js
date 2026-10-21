/**
 * CC98 的 OAuth2 令牌：获取、刷新与本地缓存。
 *
 * # 为什么是 OAuth2 而不是 cookie 会话
 *
 * CC98 不是 CAS 体系。它有一个独立的身份服务 `openid.cc98.org`，第三方客户端
 * （CC98-CLI、CC98-Desktop、cc98-mcp）统一走 **OAuth2 密码模式**：
 *
 * ```text
 * POST https://openid.cc98.org/connect/token
 *      grant_type=password&username=<学号>&password=<密码>
 *      &client_id=…&client_secret=…&scope=cc98-api openid offline_access
 *   → { access_token, refresh_token, expires_in }
 * 之后：GET https://api.cc98.org/topic/1  Authorization: Bearer <access_token>
 * ```
 *
 * 这也解释了为什么本包**不依赖 WebVPN 抽象**：令牌是自己拿的，之后是纯 HTTPS
 * API 调用。真正需要网关的是**站点可达性**（校外能不能连上），那是网络出口的问题，
 * 不是认证的问题 —— 两者混在一起会让"令牌过期"和"人不在校园网"看起来是同一种故障。
 *
 * # 令牌缓存在哪
 *
 * 借 `SessionStore` 的文件格式（DPAPI 密文）存，但内容是**一个 cookie**：
 * `cc98-token=<JSON>`。为什么不新增一种存储：会话文件的加解密、原子替换、
 * `protect` 注入点都已经在共享层验证过了；为了多存两个字段再造一套加密落盘，
 * 等于把同一批风险复制一遍。用 cookie 当容器只是个信封 —— 它永远只发给
 * `https://cc98-token.invalid/`（`.invalid` 是保留域名，不可能被真实解析），
 * 所以既不会被 `Transport` 发到 CC98 上，也不会和真正的会话 cookie 混在一起。
 *
 * # 失败不封锁
 *
 * omni 的 `assertNoRecentFailure` 会把一次网络抖动弹成"凭据被拒"，此后 15 分钟
 * 直接抛错。本包**不缓存失败**：这一次失败就是这一次，下次调用照常再试。
 */

import { ClassroomError } from 'dsh-zhiyun-source-campus/http';
import { TOKEN_URL } from './hosts.js';

/**
 * 第三方 CC98 客户端的公开 OAuth2 客户端。
 *
 * ⚠️ 这**不是**本项目的密钥，也不是任何人的私密凭据：它是 CC98 官方发给公开
 * 第三方客户端的 `client_id` / `client_secret`（密码模式没有 PKCE，客户端密钥
 * 天然是公开的，上游 cc98-mcp / CC98-CLI 都把它写在源码里）。所以它出现在公开
 * 仓库里不构成信息泄露 —— 但也不该被当成"可以随便换"的配置项：换成别的 id
 * 拿不到 `offline_access`，refresh_token 就没了。
 */
export const CLIENT_ID = '9a1fd200-8687-44b1-4c20-08d50a96e5cd';
export const CLIENT_SECRET = '8b53f727-08e2-4509-8857-e34bf92b27f2';

/** `offline_access` 是拿到 `refresh_token` 的前提；少了它只能反复用密码登录。 */
export const SCOPE = 'cc98-api openid offline_access';

/**
 * 令牌信封在 `SessionStore` 里的键。
 *
 * 以 `cc98-token` 命名而不是塞进访问 CC98 的 cookie：本包的 cookie 队列里
 * **只允许出现这一条**（见 `TokenStore` 的读写实现），名字带前缀便于人工排查
 * 会话文件时一眼认出它不是站点 cookie。
 */
const TOKEN_COOKIE = 'cc98-token';

/** 令牌信封的宿主。`.invalid` 是 RFC 2606 保留的顶级域，永远不会被解析。 */
export const TOKEN_ORIGIN = 'https://cc98-token.invalid/';

/**
 * 提前 60 秒判定过期。
 *
 * 与 omni 一致：`expires_in` 是"从发令牌那一刻起还剩多久"，而请求本身要花时间。
 * 不留这点余量的话，卡在过期边界上的请求会拿到 401，再走一次刷新 —— 白白多一轮。
 */
const EXPIRY_MARGIN_MS = 60_000;

/** `expires_in` 缺失时的兜底值（OpenID Connect 的常见默认值）。 */
const DEFAULT_EXPIRES_IN = 3600;

/**
 * 构造密码模式的表单体。
 *
 * 单独抽出来是因为**字段名与顺序是接口契约**：`grant_type` 写错、`scope` 少了
 * `offline_access`，服务端都会以"密码错误"之外的方式失败。测试直接对着这个函数
 * 断言，比对着一次真实网络请求断言可靠。
 *
 * @param account - `{ username, password }`。
 * @returns 表单字段（不含 client_id / client_secret / scope，那三个由 `post` 补）。
 */
export function passwordForm(account) {
  return { grant_type: 'password', username: String(account.username ?? ''), password: String(account.password ?? '') };
}

/**
 * 构造刷新用的表单体。
 *
 * @param refreshToken - 上一次换到的 refresh_token。
 * @returns 表单字段。
 */
export function refreshForm(refreshToken) {
  return { grant_type: 'refresh_token', refresh_token: String(refreshToken ?? '') };
}

/**
 * 把令牌响应解析成内部形状。
 *
 * @param data - 令牌端点返回的 JSON（已解析）。
 * @param now - 当前时间戳（毫秒），注入以便测试。
 * @returns `{ access_token, refresh_token, expires_at }`。
 * @throws ClassroomError `CC98_TOKEN_SHAPE` —— 响应里没有 access_token。
 */
export function parseTokenResponse(data, now = Date.now()) {
  if (!data || typeof data !== 'object' || typeof data.access_token !== 'string' || !data.access_token) {
    throw new ClassroomError('CC98_TOKEN_SHAPE', 'CC98 令牌端点没有返回 access_token。');
  }
  const expiresIn = Number(data.expires_in);
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN;
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : undefined,
    expires_at: now + seconds * 1000 - EXPIRY_MARGIN_MS,
  };
}

/**
 * 令牌的读写与获取。
 *
 * 依赖注入的形状只有三样：`store`（一个 `SessionStore`）、`fetch`（发令牌请求的
 * 函数）、`account`（取凭据的函数）。这样单测可以整条链路跑，不联网也不碰 DPAPI。
 */
export class TokenStore {
  /**
   * @param options
   * @param options.store - `SessionStore` 实例（共享层）。
   * @param options.fetch - `(url, init) => Response`；默认 `globalThis.fetch`。
   * @param options.account - `async () => ({ username, password } | null)`。
   * @param options.log - 日志函数。
   * @param options.now - 时钟注入（测试用）。
   * @param options.timeoutMs - 令牌请求超时。
   */
  constructor({ store, fetch = globalThis.fetch, account, log = () => {}, now = Date.now, timeoutMs = 20000 } = {}) {
    this.store = store;
    this.fetcher = fetch;
    this.account = account;
    this.log = log;
    this.now = now;
    this.timeoutMs = timeoutMs;
    /** 并发的取令牌请求合并成一次 —— 否则页面同时拉三个接口会打三次密码模式。 */
    this.pending = null;
    /** 载入只做一次：并行请求不能在别人写令牌时把 jar 换掉。 */
    this.loading = null;
  }

  /**
   * 确保 `SessionStore` 已载入（幂等）。
   *
   * @returns 载入完成的 Promise。
   */
  async ready() {
    this.loading ??= this.store.load();
    return this.loading;
  }

  /**
   * 读出已缓存的令牌信封。
   *
   * @returns `{ access_token, refresh_token?, expires_at, username? }` 或 null。
   */
  async read() {
    await this.ready();
    const cookies = await this.store.jar.getCookies(TOKEN_ORIGIN).catch(() => []);
    const cookie = cookies.find(item => item.key === TOKEN_COOKIE);
    if (!cookie?.value) return null;
    try {
      // 写入时做过 `encodeURIComponent`（令牌里有 `.` `-` 之外的字符，tough-cookie
      // 对未编码的值会按 cookie 语法报错），读出来必须对称解码。
      const parsed = JSON.parse(decodeURIComponent(cookie.value));
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      // 信封坏了（手工编辑过、旧版本格式）→ 当成没有，重新登录一次即可。
      return null;
    }
  }

  /**
   * 写入令牌信封。
   *
   * 同名同路径的 `setCookie` 本身就是**替换**，所以不需要先删；也**不能**清空整个
   * jar —— 它与 `Transport` 共用（见 `client.js`），清空会把业务请求的 cookie 带走。
   *
   * @param tokens - 内部令牌形状。
   * @param username - 令牌归属的账号（换账号时用来判断要不要作废）。
   */
  async write(tokens, username) {
    await this.ready();
    const value = JSON.stringify({ ...tokens, username: username ?? null });
    await this.store.jar.setCookie(`${TOKEN_COOKIE}=${encodeURIComponent(value)}; Path=/`, TOKEN_ORIGIN);
    await this.store.save();
  }

  /**
   * 清掉缓存的令牌（换账号、或账号被明确拒绝时用）。
   *
   * 用「过期时间设在 1970 年」而不是整 jar 删除：`removeAllCookies()` 是 jar 级的，
   * 会把 `Transport` 的 cookie 一并带走。
   */
  async clear() {
    await this.ready();
    await this.store.jar.setCookie(`${TOKEN_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`, TOKEN_ORIGIN);
    await this.store.save();
  }

  /**
   * 发一次令牌请求。
   *
   * @param form - `grant_type` 等字段。
   * @param {object} [options]
   * @param {boolean} [options.passwordGrant] - 密码模式失败时的错误归因不同。
   * @returns 内部令牌形状；刷新失败（服务端明确拒绝）时返回 null，好让调用方退回密码登录。
   */
  async request(form, { passwordGrant = false } = {}) {
    const body = new URLSearchParams({
      ...form,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: SCOPE,
    });
    let response;
    try {
      response = await this.fetcher(TOKEN_URL, {
        method: 'POST',
        // ⚠️ 必须是 `application/x-www-form-urlencoded`（OAuth2 规范里令牌端点的唯一格式）。
        //    发 JSON 会被端点直接 400，而错误体看起来像"参数缺失"，很难归因。
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // 网络类失败就到这里（DNS/连接/超时）。它是"连不上"，不是"密码错"，
      // 所以错误码与 AUTH_REJECTED 分开，重试语义也分开。
      throw new ClassroomError('CC98_UNREACHABLE', `连不上 CC98 的令牌端点：${error?.message ?? error}`, { cause: error?.name ?? null });
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (data && typeof data.access_token === 'string' && data.access_token) {
      return parseTokenResponse(data, this.now());
    }
    if (!passwordGrant) return null;
    // 密码模式失败必须区分「凭据被拒」与「端点/网络异常」：
    // 前者要用户改密码，后者重试就好。说反了会把人赶去反复改一个正确的密码。
    const reason = String(data?.error ?? '');
    const status = Number(response?.status ?? 0);
    if (reason === 'invalid_grant') {
      // ⚠️ 措辞要点：**CC98 账号不是浙大统一认证账号**。所以不能说"去改你的浙大密码" ——
      //    那会把人赶去改一个本来就正确的密码。这里如实说"CC98 拒绝了这组账号口令"，
      //    并点明该去哪里改（设置 → CC98 账号），让用户知道这不是一卡通的问题。
      throw new ClassroomError('AUTH_REJECTED',
        'CC98 未接受这组账号口令。注意：CC98 有自己的账号体系，'
        + '不是浙大统一认证（一卡通）那套 —— 请到「设置 → CC98 账号」核对 CC98 的账号与密码。');
    }
    throw new ClassroomError('CC98_LOGIN_FAILED',
      `CC98 登录失败${status ? `（HTTP ${status}）` : ''}${reason ? `：${reason}` : ''}。`
      + '这不是密码问题：多半是 openid.cc98.org 临时故障，稍后再试。');
  }

  /**
   * 取一个可用的 access_token。
   *
   * 三条路径按优先级：缓存未过期 → refresh_token 换新 → 密码模式登录。
   *
   * @param {object} [options]
   * @param {boolean} [options.force] - 忽略缓存（401 重试用）。
   * @returns access_token。
   */
  async token({ force = false } = {}) {
    if (!force) {
      const cached = await this.read();
      if (cached?.access_token && this.now() < Number(cached.expires_at)) return cached.access_token;
    }
    // 并发合并：同一刻多个读取方法都要令牌时，只打一次网络。
    this.pending ??= this.acquire().finally(() => { this.pending = null; });
    return this.pending;
  }

  /**
   * 真正去拿令牌的那条路（`token()` 已负责并发合并）。
   *
   * 「要不要用缓存」的判断在 `token()` 里，这里一律去换一个新令牌 ——
   * `force` 只影响上层那一跳，不该在这一层再分叉一次。
   *
   * @returns access_token。
   */
  async acquire() {
    const cached = await this.read();
    if (cached?.refresh_token) {
      const refreshed = await this.request(refreshForm(cached.refresh_token));
      if (refreshed) {
        await this.write({ ...refreshed, refresh_token: refreshed.refresh_token ?? cached.refresh_token }, cached.username);
        return refreshed.access_token;
      }
      // 刷新被拒（refresh_token 过期 / 被吊销）→ 落到密码模式，不在这里抛。
      this.log('CC98 refresh_token 已失效，改用密码模式重新登录');
    }
    // 刷新不成（或压根没有 refresh_token）→ 用密码重新登录。`force` 只影响
    // 上面那一层「能不能直接用缓存」，到这里都必须真的去换一个新令牌。
    return this.login(cached?.username);
  }

  /**
   * 用 **CC98 自己的**账号走一次密码模式。
   *
   * 账号每次**现读**（`this.account()`），不缓存：凭据服务可能晚于本包就绪，
   * 把 null 缓存下来的后果是「配了也一直说没配」。
   *
   * @param username - 期望的账号（仅用于日志与写入，不参与校验）。
   * @returns access_token。
   */
  async login(username) {
    const account = await this.account();
    if (!account) {
      // CC98 账号与一卡通不等价，所以不能说"去填浙大密码"——
      // 只如实说该去配哪一份记录。
      throw new ClassroomError('NEED_LOGIN',
        '还没配 CC98 账号。CC98 有自己的账号体系（不是浙大统一认证），'
        + '请到「设置 → CC98 账号」填一次论坛的账号与密码。');
    }
    const tokens = await this.request(passwordForm(account), { passwordGrant: true });
    await this.write(tokens, account.username ?? username);
    this.log('CC98 令牌已获取');
    return tokens.access_token;
  }

  /**
   * 令牌归属的账号名（供会话指纹 / 展示用，不返回密码）。
   *
   * @returns 用户名或 null。
   */
  async username() {
    const cached = await this.read();
    return typeof cached?.username === 'string' ? cached.username : null;
  }
}
