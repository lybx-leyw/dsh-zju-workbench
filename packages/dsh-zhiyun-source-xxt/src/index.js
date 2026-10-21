/**
 * 学习通数据源（`dsh-zhiyun-source-xxt`）：超星 / chaoxing.com 的**只读**数据包。
 *
 * # 这个包是什么
 *
 * 一个 Cordis 插件 + 一条同源数据路由（默认 `/api/zhiyun-xxt`）。它把学习通的
 * 课程、作业、截止时间、考试、通知、课表读出来，交给页面 / 脚本 / 将来要接的 AI
 * 去消费。**不注册任何 AI 工具** —— 那是消费方的适配，钉在包里以后想换客户端
 * 就得绕开它。
 *
 * # 为什么从 omni 里拆出来
 *
 * `dsh-zhiyun-source-omni` 是从上游移植来的（TypeScript、为 macOS 写），把六个
 * 平台塞在一个包里，任何一处改动都要重新编译整个数据层。拆包后每个平台是
 * 纯 JavaScript，改一行跑一行。xxt 这一块的具体取舍：
 *
 * | 上游 | 这里 | 为什么 |
 * | --- | --- | --- |
 * | `pbpaste \| npm run cli -- xxt-cookie` | 中性文案（见 `client.js` 的 `XXT_SETUP`） | 本仓跑在 Windows 上，`pbpaste` 在那里不存在 |
 * | 自己的 `HttpClient` / `CookieJar` / 限流 | 共享层 `Transport` / `SessionStore` | 加密落盘（DPAPI）、Cookie 域判定都是共享层的职责，重复实现必然分叉 |
 * | `extractCookie`（pta/cookie.ts） | 复用 campus 的 `parsePtaCookie` | 同一套"四种粘贴形态"的识别规则，没有一条是拼题A 特有的 |
 * | `ToolError` | `ClassroomError` | 全仓一套错误形状 |
 *
 * # 只读边界（这是产品口径，不是实现细节）
 *
 * 9 个方法全部只做**查询**。学习通里「交作业」「开始考试」「签到」这类动作
 * **没有**对应方法：那是用户自己的决定，一个数据包替用户点下去，是不可逆的。
 * 唯一的写操作是 `xxt.importCookie` —— 它写的是本机会话文件，不是学习通的数据。
 *
 * # 不做自动登录
 *
 * 学习通网页登录要扫码或过滑块。任何"自动化登录"最终都变成维护一个验证码识别器，
 * 每几周失效一次，而失效表现是"密码明明对的却登不上"。所以口径是：
 * 浏览器登录 → 复制 Cookie → 导入。过期了再粘一次。
 */

import path from 'node:path';

import { ClassroomError, SessionStore, sharedFetch } from 'dsh-zhiyun-source-campus/http';

import { XxtClient, XXT_DEFAULT_TIMEOUT_MS } from './client.js';
import { XxtReader, XXT_METHODS, describeError } from './reads.js';
import { XXT_BASE, XXT_HOST } from './hosts.js';

export const name = 'zhiyun-xxt';

/** 只硬依赖 `profileContext`（数据目录）。`connection` 走 `ctx.inject` 惰性取。 */
export const inject = ['profileContext'];

/** 本包的数据路由。与 `/api/zhiyun-campus`、`/api/zhiyun-omni` 并列，互不干扰。 */
export const ROUTE_PATH = '/api/zhiyun-xxt';

export { XxtClient, XXT_SETUP, XXT_COOKIE_ENV, withQuery } from './client.js';
export { XxtReader, XXT_METHODS } from './reads.js';
export { XXT_HOST, XXT_BASE, XXT_HOSTS, XXT_ENDPOINTS, isXxtHost } from './hosts.js';
export { parseXxtCookie, missingRequired, XXT_REQUIRED } from './cookie.js';
export {
  parseCourses, parseHomeworkList, parseHomeworkDetail, parseExams,
  parseSchedule, matchesNotice, normalizeNotice, isPending, nearestDate,
  stripTags, unescapeHtml, hiddenValue,
} from './parse.js';

/**
 * 客户端级动作。
 *
 * 它们**不是**读取方法（不在 `XXT_METHODS` 里）：`status` 回答"配了没"、
 * `importCookie` 写会话、`checkLogin` 探一次登录态。放进同一个白名单会让
 * "读数据"和"改配置"混成一层。
 */
const CLIENT_ACTIONS = Object.freeze(['status', 'importCookie', 'checkLogin']);

/**
 * 把 `xxt.deadlines` 拆成 `deadlines`。
 *
 * 方法名里带一遍前缀能让人一眼看出这条请求是给谁的（与 omni 的 `xxt.courses`
 * 形状一致）；但**前缀可以省略** —— 路由本身已经把范围限死在 xxt 上，
 * 强求前缀只是给调用方添麻烦。别的平台前缀一律拒，不静默当成自家方法。
 *
 * @param {unknown} method - 信封里的 `payload.method`。
 * @returns {string} 去掉前缀的方法名。
 */
export function splitMethod(method) {
  const text = String(method ?? '').trim();
  if (!text) throw new ClassroomError('INVALID_ARGUMENT', '缺少 method。');
  const [prefix, ...rest] = text.split('.');
  if (rest.length === 0) {
    // 允许省略前缀（`deadlines` 与 `xxt.deadlines` 都收）：
    // 路由本身已经把范围限死在 xxt 上了，强求前缀只是给调用方添麻烦。
    return text;
  }
  if (prefix !== 'xxt') {
    throw new ClassroomError('INVALID_ARGUMENT', `本路由只处理 xxt.*，收到 ${text}。`);
  }
  return rest.join('.');
}

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-xxt] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  // 数据目录跟着 profile 走：能跟 profile 一起被备份/清理，也与其他数据包一致。
  const dataDir = config.dataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-xxt');

  /**
   * 会话文件是**一份**，不是三份。
   *
   * 学习通只有一个登录态（不像 campus 那边学在浙大 / 拼题A / WebVPN 是三套系统）。
   * 拆成多份只会让"清除会话"变成一道选择题。
   */
  const session = new SessionStore({ file: path.join(dataDir, 'xxt.session'), protect: config.protect });
  const loaded = session.load().then(
    () => null,
    (error) => {
      // 会话文件坏掉不该让插件起不来（起不来的是整个工作台，见 CONTRIBUTING 3.1）。
      // 记下来、当作"没配"，用户重新导入一次即可 —— 那比让他去删文件友好。
      log(`会话文件无法读取，按未配置处理：${error?.message ?? error}`);
      return error;
    },
  );

  const client = new XxtClient({
    session,
    // 共享出口：学习通是公网域，策略判定为直连 —— 但会绕开宿主为 LLM 配的
    // 全局代理（国内站点经代理基本必失败）。campus 没装时退回宿主 fetch。
    fetch: typeof config.fetch === 'function' ? config.fetch : sharedFetch(ctx),
    timeoutMs: config.timeoutMs ?? XXT_DEFAULT_TIMEOUT_MS,
    env: config.env ?? process.env,
    log: config.verbose ? (entry) => log(`${entry.method} ${entry.host}${entry.path} → ${entry.status}`) : () => {},
  });
  /** 会话只可能 `load()` 一次：并发请求不该各读一遍文件。 */
  await loaded;

  const reader = new XxtReader(client, { now: config.now ?? (() => new Date()) });

  const routePath = config.routePath ?? ROUTE_PATH;

  // 两个字段各写一处就够了：路由要能列出来，服务给脚本用。
  const describe = () => ({
    ready: true,
    route: routePath,
    dataDir,
    platform: { id: 'xxt', label: '学习通', host: XXT_HOST, base: XXT_BASE },
    methods: [...XXT_METHODS],
    actions: [...CLIENT_ACTIONS],
    note: '只读数据包：9 个读取方法 + 状态/导入 Cookie。学习通不做自动登录，Cookie 失效后需要重新导入。',
  });

  /**
   * 调一个读取方法。
   *
   * 白名单在**这张表**上校验，不做任意属性访问 —— 这条路由是给同源页面用的，
   * 不该成为一个能拨动插件进程内部对象的口子（`constructor` / `__proto__` 必拒）。
   *
   * @param {string} method - 已去前缀的方法名。
   * @param {object} args - 方法参数。
   * @param {AbortSignal} [signal] - 请求的取消信号。
   * @returns {Promise<unknown>}
   */
  async function invoke(method, args, signal) {
    if (!XXT_METHODS.includes(method)) {
      throw new ClassroomError('INVALID_ARGUMENT', `未知数据方法：xxt.${method}`);
    }
    // 参数一律当对象：把 `args` 原样透传会让 `findCourse` 收到一个字符串，
    // 然后以"找不到课程"的形式失败 —— 错误信息离真正的原因十万八千里。
    const payload = args === null || typeof args !== 'object' || Array.isArray(args) ? {} : args;
    return reader[method]({ ...payload, signal });
  }

  /**
   * 调一个客户端动作。
   *
   * @param {string} action - `status` / `importCookie` / `checkLogin`。
   * @param {object} args - 动作参数。
   * @returns {Promise<unknown>}
   */
  async function act(action, args = {}) {
    if (!CLIENT_ACTIONS.includes(action)) {
      throw new ClassroomError('INVALID_ARGUMENT', `未知动作：xxt.${String(action)}`);
    }
    if (action === 'status') return client.status();
    if (action === 'checkLogin') return client.checkLogin();
    const input = typeof args?.input === 'string' ? args.input : '';
    if (!input.trim()) throw new ClassroomError('INVALID_ARGUMENT', '没有收到 Cookie 内容。');
    const result = await client.importCookie(input);
    log(`学习通 Cookie 已保存（来源：${result.source}，${result.cookie_names.length} 个键）`);
    // 导入完顺手把课程缓存清掉：换了账号还读旧课程列表是最容易骗到人的错误。
    reader.courseCache.clear();
    return result;
  }

  // ── 数据路由 ────────────────────────────────────────────────────────
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const remove = scope.connection.fetch.register({
        path: routePath,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const send = (value, status = 200) => Response.json(value, {
            status,
            headers: { 'cache-control': 'no-store' },
          });
          let rpcId = 'invalid-request';
          try {
            if (request.method === 'GET') return send({ ok: true, value: describe() });
            const body = await request.json();
            // 与 study-core / omni / vault 同一套信封：{ type, rpcId, method, payload }
            if (body?.type !== 'client-request' || typeof body.rpcId !== 'string' || body.rpcId.length > 200) {
              throw new ClassroomError('INVALID_ARGUMENT', '请求信封无效（需要 { type: "client-request", rpcId, payload }）。');
            }
            rpcId = body.rpcId;
            const payload = body.payload ?? {};
            const method = splitMethod(payload.method);
            const value = CLIENT_ACTIONS.includes(method)
              ? await act(method, payload.args ?? {})
              : await invoke(method, payload.args, request.signal);
            return send({ type: 'server-response', rpcId, result: { ok: true, value } });
          } catch (error) {
            return send({
              type: 'server-response',
              rpcId,
              result: { ok: false, error: describeError(error) },
            });
          }
        },
      });
      log(`数据路由：${routePath}（会话 ${dataDir}）`);
      return remove;
    }, 'zhiyun: xxt data route');
  });

  const removeService = ctx.provide('zhiyunXxt', {
    routePath,
    dataDir,
    describe,
    invoke,
    act,
    /** 直接拿读取器（宿主侧代码可以绕过 HTTP 层）。 */
    reader: () => reader,
    client: () => client,
    /** 原始会话（脚本需要自己发请求时用）。 */
    session: () => session,
  });

  return async () => {
    if (typeof removeService === 'function') removeService();
    reader.courseCache.clear();
  };
}
