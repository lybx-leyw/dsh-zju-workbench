/**
 * 教务系统（正方 zdbk）的 HTTP 客户端。
 *
 * # 全是 POST，且全是 `application/x-www-form-urlencoded`
 *
 * 正方的 `/jwglxt` 接口族不接受 GET：查询条件（`doType=query`、
 * `queryModel.showCount` …）都放在**表单体**里。这一点与「把条件拼在 URL 上」的
 * REST 习惯不同，写错的表现是**服务端回 200 但 `items` 全空**——不报错，
 * 只是永远读不到数据，所以必须在代码里明确写下来。
 *
 * # 状态码不能只看 HTTP 语义
 *
 * 正方用三个**非标准**状态码表达会话问题/繁忙：
 *   - `401` / `901` / `902` —— 会话失效，要重新登录；
 *   - `>= 900` —— 短时间重复查询被拒（`PLATFORM_BUSY`），等一下再试是有效的。
 * 按「HTTP 401 才是未授权」的常规理解去写，会把 901/902 当成 500 类错误，
 * 于是不会重登 —— 用户看到的是「登录态明明还在却一直失败」。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

import { ZDBK_BASE } from './hosts.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 页面里出现这些字样说明「回来的其实是登录页」，而不是业务 JSON。
 *
 * 正方在会话过期时不一定回 3xx：有时直接回 200 + 登录页 HTML。
 * 只按状态码判断会漏掉这一支，然后把一整页 HTML 当数据去 `JSON.parse`，
 * 报出来的却是「JSON 无法解析」—— 归因方向完全错了。
 */
const LOGIN_MARKERS = /cas\/login|login_ssologin|login_slogin|统一身份认证|未登录|请先登录|登录已失效|name=["']password["']/i;

/**
 * 「这一页是登录页吗」的**页面级**判据（比 `LOGIN_MARKERS` 窄得多）。
 *
 * 为什么不能复用上面那一份：`LOGIN_MARKERS` 是拿来判**JSON 接口**的正文的，
 * 一个正常页面里出现「未登录」「统一身份认证」并不异常（顶栏、页脚、说明文字
 * 都可能写着）。拿它去判页面，会把正常页面误判成登录页。
 *
 * 这里只认三件事，都是登录页独有、业务页面不会有的：
 *   - 登录表单的 `id="loginForm"`（正方自己的登录页标记）；
 *   - 表单 action 指向 CAS；
 *   - 一个 `name="password"` 的输入框。
 */
const LOGIN_PAGE = /id=["']loginForm["']|\/cas\/login|name=["']password["']/i;

/**
 * 一次请求的取数选项。
 *
 * @typedef {object} PostOptions
 * @property {Record<string, unknown>} [query] - 拼在 URL 上的参数（少用，多数条件在表单里）。
 * @property {Record<string, string>} [form] - 表单体参数。
 * @property {boolean} [allowNull] - 允许服务端回 `null` / 空串（课表在学期不存在时就是这样）。
 */

/**
 * 教务系统的客户端。
 *
 * 只做一件事：把「POST 一个 `/jwglxt` 路径并判定结果」封装成一次调用。
 * 解析与 GPA 计算都在 `parse.js`，读取编排在 `reads.js` —— 三层各自可测。
 */
export class ZdbkClient {
  /**
   * @param {import('@lybx-leyw/dsh-zju-source-http').Transport} transport - 已登录的传输层。
   * @param {object} [options] - 选项。
   * @param {number} [options.retryDelayMs] - 繁忙重试前的等待（默认 1500ms）。
   * @param {AbortSignal} [options.signal] - 取消信号，透传给每一跳。
   */
  constructor(transport, { retryDelayMs = 1500, signal } = {}) {
    this.transport = transport;
    this.retryDelayMs = retryDelayMs;
    this.signal = signal;
  }

  /**
   * 发一次请求；只对「繁忙」重试一次。
   *
   * 为什么只对 `PLATFORM_BUSY` 重试：
   *   - 它是**明确可重试**的（正方自己的限流），等一下就好；
   *   - 其余失败（会话失效、无权限、结构变化）重试只会把同一次失败打两遍，
   *     在验证码/锁定场景下还会加重问题。
   *
   * @param {string} path - 相对 `ZDBK_BASE` 的路径（必须以 `/` 开头）。
   * @param {PostOptions} [options] - 取数选项。
   * @returns {Promise<Record<string, unknown>|null>} 解析后的对象；`allowNull` 时可能为 null。
   */
  async post(path, options = {}) {
    try {
      return await this.postOnce(path, options);
    } catch (error) {
      if (error?.code !== 'PLATFORM_BUSY') throw error;
      await sleep(this.retryDelayMs);
      return this.postOnce(path, options);
    }
  }

  /**
   * 单次请求。
   *
   * @param {string} path - 相对 `ZDBK_BASE` 的路径。
   * @param {PostOptions} [options] - 取数选项。
   * @returns {Promise<Record<string, unknown>|null>} 解析后的对象。
   */
  /**
   * 发一次请求并做**状态与登录页**判定，返回原始正文。
   *
   * 这一层被 `postOnce` / `postArray` / `getHtml` 共用：三者的差别只有
   * 「方法」与「正文怎么解析」，状态码口径必须**完全一致** —— 复制三份的话，
   * 迟早有一份忘了判 901，那条链路就会把登录页当数据。
   *
   * @param {string} path - 相对 `ZDBK_BASE` 的路径。
   * @param {{query?: Record<string, unknown>, form?: Record<string, string>, method?: 'GET'|'POST'}} [options] - 请求选项。
   * @returns {Promise<{body: string, status: number}>} 正文与状态码。
   */
  async exchange(path, { query, form = {}, method = 'POST' } = {}) {
    // 路径必须是本包写死的相对路径：拒绝绝对地址与 `..`，
    // 否则这条接口就成了「用已登录的会话去访问任意地址」的口子。
    if (!path.startsWith('/') || path.includes('..')) throw new ClassroomError('INVALID_PATH', '只允许教务系统接口路径。');

    const url = new URL(`${ZDBK_BASE}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value != null) url.searchParams.set(key, String(value));
    }

    let response;
    try {
      response = await this.transport.request(url.toString(), {
        method,
        ...(method === 'POST' ? { body: new URLSearchParams(form).toString() } : {}),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          // 正方会校验来源页；不带 Referer 时部分接口直接回登录页。
          Referer: `${ZDBK_BASE}/xtgl/index_initMenu.html`,
          Origin: `https://${url.hostname}`,
        },
        signal: this.signal,
      });
    } catch (error) {
      if (error?.code === 'NETWORK' || error?.code === 'TIMEOUT') {
        throw new ClassroomError('NETWORK_ERROR', '无法连接教务系统。校外访问可能需要 WebVPN。', { cause: error.code });
      }
      throw error;
    }

    const status = response.status;
    if (status >= 300 && status < 400) throw new ClassroomError('LOGIN_REQUIRED', '教务系统会话已失效。');
    // 正方的三个非标准码：都表示会话没了，必须重新登录（不是「服务器错误」）。
    if (status === 401 || status === 901 || status === 902) throw new ClassroomError('LOGIN_REQUIRED', '教务系统会话已失效。');
    if (status === 403) throw new ClassroomError('FORBIDDEN', '教务系统拒绝访问该功能。');
    if (status >= 900) {
      throw new ClassroomError('PLATFORM_BUSY', `教务系统暂时拒绝请求（HTTP ${status}），通常是短时间内重复查询所致。请稍后再试，不要连续重复调用。`, { http_status: status, endpoint: path });
    }
    if (status === 429) throw new ClassroomError('RATE_LIMITED', '教务系统请求过于频繁，请稍后再试。');
    if (status < 200 || status >= 300) throw new ClassroomError('PLATFORM_ERROR', `教务系统返回 HTTP ${status}。`, { http_status: status, endpoint: path });

    const body = String(response.text ?? '').trim();
    if (body.includes('captcha_error')) {
      throw new ClassroomError('AUTH_CHALLENGE_REQUIRED', '教务系统要求输入验证码。请先在浏览器打开教务系统完成一次验证码后再试；不会自动识别或重试。');
    }
    return { body, status };
  }

  /**
   * jqGrid 分页查询（培养方案列表那一族）。
   *
   * # 与 `post` 的区别
   *
   * `post` 是「路径 + 查询串」，条件全在 URL 上；jqGrid 的**全部条件都在表单体里**
   * （`doType=query`、`queryModel.showCount` …），URL 上只有 `doType`。
   * 混用会得到「HTTP 200 + `items: []`」，而不是错误。
   *
   * # `totalResult` 可能藏在行里
   *
   * 正方个别版本把总数放在每条记录的 `totalResult` 字段上（外层没有）。
   * 不兜这一手，`total` 会变成 0，于是「翻页到此为止」—— 只取到第一页。
   *
   * @param {string} path - 相对 `ZDBK_BASE` 的路径。
   * @param {Record<string, string>} form - 表单条件。
   * @param {{page?: number, size?: number, sort?: string, order?: 'asc'|'desc'}} [paging] - 分页与排序。
   * @returns {Promise<{items: Record<string, unknown>[], total: number, page: number, size: number, totalPages: number}>} 一页结果。
   */
  async grid(path, form = {}, { page = 1, size = 15, sort = '', order = 'desc' } = {}) {
    const data = {
      ...form,
      'queryModel.showCount': String(size),
      'queryModel.currentPage': String(page),
      'queryModel.sortName': sort,
      'queryModel.sortOrder': order,
      time: '1',
    };
    const payload = await this.post(path, { query: { doType: 'query' }, form: data });
    if (!payload || !Array.isArray(payload.items)) {
      throw new ClassroomError('SCHEMA_CHANGED', '教务系统列表响应缺少 items 数组。');
    }
    const total = Number(payload.totalResult ?? payload.items[0]?.totalResult ?? payload.items.length) || 0;
    return { items: payload.items, total, page, size, totalPages: Math.max(1, Math.ceil(total / size)) };
  }

  /**
   * 单次请求（`post` 的底座），只接受**对象** JSON。
   *
   * @param {string} path - 相对 `ZDBK_BASE` 的路径。
   * @param {PostOptions} [options] - 取数选项。
   * @returns {Promise<Record<string, unknown>|null>} 解析后的对象。
   */
  async postOnce(path, { query, form = {}, allowNull = false } = {}) {
    const { body } = await this.exchange(path, { query, form });
    if (allowNull && (body === 'null' || body === '')) return null;
    if (body.startsWith('{') || body.startsWith('[')) {
      try {
        const data = JSON.parse(body);
        // 只接受对象：正方偶尔回一个裸数组或 `[]`，那说明接口形态变了。
        if (data && typeof data === 'object' && !Array.isArray(data)) return data;
      } catch {
        throw new ClassroomError('SCHEMA_CHANGED', '教务系统返回的 JSON 无法解析。');
      }
      throw new ClassroomError('SCHEMA_CHANGED', '教务系统返回的 JSON 无法识别。');
    }
    if (LOGIN_MARKERS.test(body)) throw new ClassroomError('LOGIN_REQUIRED', '教务系统返回了登录页，会话已失效。');
    throw new ClassroomError('UNEXPECTED_RESPONSE', '教务系统未返回 JSON，接口可能发生变化。');
  }

  /**
   * 单次请求，只接受**数组** JSON（自主选课那一族）。
   *
   * # 为什么必须单开一个方法
   *
   * 自主选课的六个查询接口回的是裸数组 `[{xkkh, kcmc, …}, …]`，而
   * `postOnce` 明确拒绝数组（它把裸数组判成「接口形态变了」）。
   * 把 `postOnce` 放宽成「对象或数组都收」是最省事的写法，但那样
   * 成绩/课表那一族的形态校验就一起失效了 —— 它们**必须**是对象。
   *
   * 空正文 `''` 按空数组处理：正方在「本学期没有可选项」时就是回空串，
   * 那不是错误（与课表的 `allowNull` 同一语义）。
   *
   * @param {string} path - 相对 `ZDBK_BASE` 的路径。
   * @param {PostOptions} [options] - 取数选项。
   * @returns {Promise<Record<string, unknown>[]>} 数组。
   */
  async postArray(path, { query, form = {} } = {}) {
    const { body } = await this.exchange(path, { query, form });
    if (body === '' || body === 'null') return [];
    if (body.startsWith('[')) {
      try {
        const data = JSON.parse(body);
        if (Array.isArray(data)) return data;
      } catch {
        throw new ClassroomError('SCHEMA_CHANGED', '教务系统返回的 JSON 无法解析。');
      }
    }
    if (body.startsWith('{')) {
      // 这里收到对象通常是「会话正常但服务器给了错误信封」，如实报出来，
      // 不要退化成空数组 —— 空数组会被上层读成「没有可选课程」。
      throw new ClassroomError('SCHEMA_CHANGED', '选课接口返回了对象而不是数组，接口形态可能已变化。');
    }
    if (LOGIN_MARKERS.test(body)) throw new ClassroomError('LOGIN_REQUIRED', '教务系统返回了登录页，会话已失效。');
    throw new ClassroomError('UNEXPECTED_RESPONSE', '选课接口未返回 JSON，接口可能发生变化。');
  }

  /**
   * 取一页 **HTML**（培养方案、选课首页这类页面级接口）。
   *
   * # 顺序：先判登录页，再判「像不像页面」
   *
   * 反过来的话，会话失效时的登录页**恰好是合法 HTML**（有 `<form>`、有
   * `<input name="password">`），会被当成正常页面向下传，最后在解析层报
   * 「页面上找不到 `xjxjhh`」—— 一个把「没登录」说成「页面改版」的错误归因。
   *
   * 不跟随重定向（`exchange` 把 3xx 一律判成 `LOGIN_REQUIRED`）：正方在会话
   * 失效时 302 到 CAS，跟过去只会拿到一张登录页。
   *
   * @param {string} path - 相对 `ZDBK_BASE` 的路径。
   * @param {{query?: Record<string, unknown>, method?: 'GET'|'POST', form?: Record<string, string>}} [options] - 选项。
   * @returns {Promise<string>} HTML 正文。
   */
  async html(path, { query, method = 'GET', form = {} } = {}) {
    const { body } = await this.exchange(path, { query, method, form });
    if (/^\s*$/.test(body)) throw new ClassroomError('UNEXPECTED_RESPONSE', '教务系统返回了空页面。');
    // ⚠️ 这里必须用 `LOGIN_PAGE`（窄），不能用 `LOGIN_MARKERS`（宽）。
    // 后者含「统一身份认证」「未登录」等字样 —— 正常页面的顶栏/页脚就写着这些，
    // 用它判页面会把每一个正常页面都判成登录页。
    if (LOGIN_PAGE.test(body)) throw new ClassroomError('LOGIN_REQUIRED', '教务系统返回了登录页，会话已失效。');
    if (!/<(?:html|body|form|input|div|table|select)\b/i.test(body)) {
      throw new ClassroomError('UNEXPECTED_RESPONSE', '教务系统返回的不是页面，接口可能发生变化。');
    }
    return body;
  }
}

export { ZDBK_BASE };
