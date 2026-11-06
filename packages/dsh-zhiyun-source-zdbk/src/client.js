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

import { ClassroomError } from 'dsh-zhiyun-source-campus/http';

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
   * @param {import('dsh-zhiyun-source-campus/http').Transport} transport - 已登录的传输层。
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
  async postOnce(path, { query, form = {}, allowNull = false } = {}) {
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
        method: 'POST',
        body: new URLSearchParams(form).toString(),
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
}

export { ZDBK_BASE };
