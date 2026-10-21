/**
 * CC98 数据源（`dsh-zhiyun-source-cc98`）：浙大 CC98 论坛的**只读**数据包。
 *
 * # 它是什么
 *
 * 一个 Cordis 插件 + 一条同源数据路由。挂上之后：
 *
 * ```text
 *   GET  /api/zhiyun-cc98   → 这个包能干什么、当前登录状态
 *   POST /api/zhiyun-cc98   → { type:'client-request', rpcId, method:'cc98.hot', payload:{...} }
 * ```
 *
 * `method` 一律是 `cc98.<函数名>`，函数名就是 `Cc98Reader` 上的 10 个只读方法。
 * 谁是消费方（页面 / 脚本 / 将来的 AI 工具）由调用方决定，本包不预设 ——
 * 与 `source-campus` / `source-omni` 的取舍一致。
 *
 * # 为什么从 omni 拆出来
 *
 * omni 把六个平台（教务、学在浙大、智云、拼题A、CC98、学习通）装在一个包里，
 * 而它们的**认证方式根本不同**：CAS cookie、WebVPN 隧道、OAuth2 Bearer。
 * 混在一起的代价是任何一处认证/网络策略的改动都要在一个 TS 大包里回归全部平台。
 * 拆开之后，CC98 这一半只有「表单换令牌 → Bearer 请求 → 清洗 UBB」三件事，
 * 纯 JS、无编译、可离线测。
 *
 * # 三条边界（都是刻意的）
 *
 * 1. **只读**。不移植 omni 的 `actions.ts`（发帖、回复、私信发送）。本包没有任何
 *    会改变论坛状态的入口 —— 少一个入口比多一层确认更可靠。
 * 2. **不做 WebVPN**。omni 里 `mode === 'webvpn'` 那一支依赖 `ctx.network.webvpnJar()`
 *    / `loginWebvpn()`，那是 omni 自己的网络抽象。本包**只直连**；
 *    校外连不上时明确抛 `WEBVPN_REQUIRED`，由用户决定要不要用别的出口。
 * 3. **不缓存失败**。omni 的 `assertNoRecentFailure` 会把一次网络抖动记成
 *    "凭据被拒"并封锁 15 分钟 —— 偶发失败被放大成"半天不可用"。这里一次失败
 *    就是一次失败，下次调用照常再试。
 *
 * # 凭据：CC98 有**自己的**账号记录（`zhiyun-cc98/account`）
 *
 * 本包用 `dsh-zhiyun-source-card` 的 `readCc98(ctx)` 取 CC98 账号
 * （`{ username, password }`），与「浙大一卡通」是**两条独立记录**。
 *
 * 这一点值得写清楚，因为很容易搞错：
 *
 * - CC98 是**独立站点**，有自己的一套身份服务（`openid.cc98.org`）与自己的账号口令。
 *   CC98 账号历史上就是论坛 ID / 注册邮箱那一路，**没有**"浙大统一认证账号就能登 CC98"
 *   这回事；
 * - omni 也把 CC98 当成**独立账号种类**处理（`ACCOUNT_KINDS` 里 `zju` / `webvpn` /
 *   `cc98` / `xxt` 并列，`cc98` 有自己的 `CC98_USERNAME`/`CC98_PASSWORD` 与自己的
 *   钥匙串条目 `zju-omni.cc98`）。那份代码里**从来没有**把 `zju` 的凭据喂给 CC98；
 * - 本包最初曾**借用**一卡通那份记录，后果是：只有 CC98 账号的人永远登不进去，
 *   而失败提示还把人指向「改一卡通密码」，方向完全相反。现已改为独立记录。
 *
 * 结论：**协议上**两者不同（CAS 换 cookie，CC98 换 OAuth2 令牌），
 * **账号上**也不同，所以凭据必须分开存。
 */

import path from 'node:path';

import { ClassroomError, SessionStore, object, sharedFetch } from 'dsh-zhiyun-source-campus/http';
import { readCc98 } from 'dsh-zhiyun-source-card';

import { Cc98Client } from './client.js';
import { Cc98Reader, cc98Id } from './reads.js';
import { TokenStore } from './token.js';
import { ubbToText } from './ubb.js';

export const name = 'zhiyun-cc98';

/**
 * 只硬依赖 `profileContext`（数据目录）。
 *
 * `connection` 走 `ctx.inject` 惰性取：路由要它，但「有没有路由」不该决定
 * 这个包能不能装。凭据服务同理，由 `readCc98` 每次现取。
 */
export const inject = ['profileContext'];

/** 本包的数据路由。与 `/api/zhiyun-campus`、`/api/zhiyun-omni` 并列。 */
export const ROUTE_PATH = '/api/zhiyun-cc98';

/**
 * 暴露的方法白名单。
 *
 * 白名单而不是"反射读取器上的一切"：这条路由是同源页面可调的，
 * 让调用方能拨动 `constructor` / `__proto__` 这类属性没有正当用途。
 * 同时它也是**只读**的证明 —— 表里没有任何写操作。
 */
export const METHODS = Object.freeze([
  'search',
  'topic',
  'hot',
  'newTopics',
  'boards',
  'boardTopics',
  'user',
  'notifications',
  'conversations',
  'messages',
]);

/**
 * 每个方法接受哪些参数（**只做自描述，不参与校验**）。
 *
 * 校验在 `reads.js` 里按方法各自做（那里知道哪个参数是必填、哪个是枚举）。
 * 这里给的是调用方发现能力用的示例值 —— 与 campus/zdbk 的自描述口径一致：
 * 页面与脚本先 GET 一份能力表，而不是在别处维护第二份清单（清单一定会漂）。
 */
const ARGS_OF = Object.freeze({
  search: { keyword: '选课', from: 0, size: 20 },
  topic: { topic_id: 1, from: 0, size: 20, max_characters: 4000 },
  hot: { range: 'today' },
  newTopics: { from: 0, size: 20 },
  boards: {},
  boardTopics: { board_id: 1, from: 0, size: 20, best: false },
  user: { user_id: 1, name: '水友' },
  notifications: { kind: 'reply', from: 0, size: 20 },
  conversations: { from: 0, size: 20 },
  messages: { user_id: 1, from: 0, size: 20 },
});

export { Cc98Client, Cc98Reader, TokenStore, ubbToText, cc98Id };
export { CC98_API, CC98_WEB, TOKEN_URL, CC98_HOSTS, REFERER } from './hosts.js';
export { CLIENT_ID, CLIENT_SECRET, SCOPE, parseTokenResponse, passwordForm, refreshForm } from './token.js';
export { asList, at, postText, topicSummary, nextFrom } from './reads.js';
export { apiPath, withQuery, httpError, parseBody } from './client.js';

/**
 * 给用户看的一句话状态：这次请求走的是哪条路。
 *
 * 为什么值得单列：用户看到"连不上"时，第一个要回答的问题就是**走的是哪条路**。
 * 没有这一行，所有人都会先去怀疑密码。本包只有一条路（直连），所以文案很短 ——
 * 但保留这个字段，是为了调用方按统一形状展示。
 */
const TRANSPORT_LABEL = '直连 api.cc98.org（本包不做 WebVPN）';

/**
 * 插件入口。
 *
 * @param ctx - Cordis 上下文。
 * @param [config]
 * @param [config.dataDir] - 会话/令牌目录；默认 `<profile>/data/zhiyun-cc98`。
 *   传 `null` 表示**纯内存**（不落盘、不碰 DPAPI），测试用它。
 * @param [config.fetch] - 出口实现（测试注入假 fetch 时用）。
 * @param [config.protect] - `SessionStore` 的保护器（默认 DPAPI）。
 * @param [config.timeoutMs] - 单请求超时。
 * @param [config.verbose] - 打请求日志。
 */
export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-cc98] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  /**
   * 落盘目录。
   *
   * `config.dataDir === null` 是**显式的"纯内存"开关**：不建目录、不写文件。
   * 单测用它来保证一行都不落盘（也就不会触发 `SessionStore` 的 DPAPI 保护器）。
   * 不能只靠 `SessionStore` 不传 `file`：那样 `path.join` 仍会算出目录名，
   * 日志里还会印出一个并不存在的路径，排查时误导人。
   */
  const persist = config.dataDir !== null;
  const dataDir = config.dataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-cc98');
  const timeoutMs = config.timeoutMs ?? 20000;

  /* ── 令牌存储 ─────────────────────────────────────────────────────
   * 一个 `SessionStore` 同时装两样东西：CC98 的 cookie（本包其实不靠它，
   * 但站点偶尔会下发）与令牌信封（`cc98-token` 那条 cookie，见 `token.js`）。
   *
   * 为什么两者合一而不是拆成两个文件：`Transport` 只认一个 jar，而令牌的
   * 读写又必须与业务请求共用同一次 `load()` —— 拆开就要在两条写路径之间加锁，
   * 而这份锁的正确性共享层已经验证过了。
   *
   * ⚠️ `SessionStore` **不传 `file` 就是纯内存**（共享层的既定行为）。
   *    所以 `config.dataDir === null` 时本包一行都不落盘 —— 单测据此不碰 DPAPI。
   */
  const session = new SessionStore({
    file: persist ? path.join(dataDir, 'cc98.session') : undefined,
    protect: config.protect,
  });

  /**
   * 取账号：读 **CC98 自己的**凭据记录。
   *
   * # 为什么必须是独立记录
   *
   * CC98 有**自己的账号体系**（`openid.cc98.org` 的 OAuth2），与浙大统一认证
   * （`zjuam.zju.edu.cn` 的 CAS）是两套东西：
   *
   *   - 只用 CC98 的人（校外、已毕业、只注册过论坛）**没有**浙大统一认证身份；
   *   - 有浙大身份的人，CC98 密码也未必与一卡通密码相同。
   *
   * 早先这里读的是「浙大一卡通」那份记录 —— 在那个假设下，只有 CC98 账号的人
   * 永远登不进去，而失败提示还把用户指向「改一卡通密码」，方向完全相反。
   * 现在改用 `dsh-zhiyun-source-card` 的 `readCc98`（独立记录键
   * `zhiyun-cc98/account`）。
   *
   * ⚠️ **每次现读，不缓存**：凭据服务可能晚于本包就绪（profile 里 cc98 排在
   * 凭据包之前是常态），把 null 缓存下来的后果是「配了也一直说没配」。
   *
   * 本包**只读不写**凭据：一个数据包不该替用户保存密码，否则「设置里配的是什么」
   * 与「实际在用的是什么」迟早分叉。
   */
  const account = async () => readCc98(ctx);

  /**
   * 本包的 `fetch`。
   *
   * 走**共享出口**（`zhiyunEgress`，campus 提供）：CC98 是公网域，出口策略会
   * 判定为直连 —— 关键是它会**绕开宿主为 LLM 配的全局代理**，那个代理打国内
   * 站点基本必失败。同时保留 campus 那份校园域判定，将来若有站内资源要过
   * WebVPN 也不用再改这里。
   *
   * `config.fetch` 仍是测试注入口（注入假 fetch 时不发真请求）。
   */
  const fetcher = typeof config.fetch === 'function' ? config.fetch : sharedFetch(ctx);

  const tokens = new TokenStore({
    store: session,
    fetch: fetcher,
    account,
    log,
    timeoutMs,
  });

  /**
   * 业务客户端。
   *
   * `fetch` 的注入点只有一个：上面的 `fetcher`（经 `Transport`，它负责超时与取消）。
   */
  const client = new Cc98Client({
    tokens,
    session,
    fetch: fetcher,
    timeoutMs,
    log: config.verbose
      ? (entry) => log(`${entry.method} ${entry.host}${entry.path} → ${entry.status}`)
      : () => {},
  });

  const reader = new Cc98Reader(client);

  /**
   * 调一个只读方法。
   *
   * 参数按方法各自校验（在 `reads.js` 里），这里只做两件事：白名单与
   * 「不许把参数当成了别的形状」。`payload` 必须是对象 —— 传数组或字符串时
   * 各方法解构出来的全是 undefined，报错会指向一个莫名其妙的地方。
   *
   * @param method - `cc98.<函数名>` 或裸函数名。
   * @param payload - 参数对象。
   * @returns 方法结果。
   */
  const invoke = async (method, payload = {}) => {
    const raw = String(method ?? '');
    const fn = raw.startsWith('cc98.') ? raw.slice(5) : raw;
    if (!METHODS.includes(fn)) {
      throw new ClassroomError('INVALID_METHOD', `未知的 CC98 数据方法：${raw || '(空)'}。可用：${METHODS.map(m => `cc98.${m}`).join(', ')}`);
    }
    if (payload != null && !object(payload)) {
      throw new ClassroomError('INVALID_ARGUMENT', 'payload 必须是对象（参数表）。');
    }
    try {
      return await reader[fn](payload ?? {});
    } catch (error) {
      // 「校外连不上」这一支要单独翻译：`Transport` 只知道"网络失败"，
      // 而用户真正需要知道的是"这可能是你不该期待本包能解决的事"。
      //
      // 三种来源都要归一：
      //   - `NETWORK` / `TIMEOUT` —— 业务请求（共享层 `Transport` 给的）；
      //   - `CC98_UNREACHABLE` —— 令牌端点连不上（`token.js` 自己发的那次请求）。
      // 少归一一种，用户就会看到两个不同的错误码描述同一件事，而页面只会处理其中一个。
      if (error?.code === 'NETWORK' || error?.code === 'TIMEOUT' || error?.code === 'CC98_UNREACHABLE') {
        throw new ClassroomError('WEBVPN_REQUIRED',
          `连不上 CC98（${error?.code === 'TIMEOUT' ? '请求超时' : '网络失败'}）。`
          + '本包只做直连：请确认在校园网内，或通过一条能连上 api.cc98.org 的出口再试。'
          + '人在校外时，访问 CC98 需要经 WebVPN —— 而本包没有内置网关支持，详见 README 的「WebVPN 限制」一节。',
          { cause_code: error?.code });
      }
      throw error;
    }
  };

  /**
   * 登录状态。
   *
   * 只回**有没有令牌 + 账号名**，绝不回令牌本身：这条路由是给浏览器用的，
   * 把 Bearer 令牌回给页面等于把它存进浏览器缓存与开发者工具的历史里。
   */
  const status = async () => {
    const cached = await tokens.read().catch(() => null);
    const username = typeof cached?.username === 'string' ? cached.username : null;
    return {
      configured: Boolean(await account().catch(() => null)),
      authenticated: Boolean(cached?.access_token),
      username,
      // 过期时间给人看，不参与判断（判断在 `TokenStore.token()` 里）。
      expires_at: cached?.expires_at ? new Date(Number(cached.expires_at)).toISOString() : null,
      transport: TRANSPORT_LABEL,
      readOnly: true,
      methods: METHODS.map(m => `cc98.${m}`),
    };
  };

  /**
   * 自描述：这个包能干什么。
   *
   * 与 `status()` 分开：`status()` 回答"我现在能不能读"，`describe()` 回答
   * "能读什么、参数长什么样"。合成一个的话，没配账号时调用方连能力清单都拿不到。
   */
  const describe = () => ({
    route: ROUTE_PATH,
    platform: 'cc98',
    label: 'CC98 论坛',
    readOnly: true,
    dataDir: persist ? dataDir : null,
    methods: METHODS.map(key => ({ method: `cc98.${key}`, args: ARGS_OF[key] })),
    note: '只读数据源：没有发帖/回复/私信发送等写操作。认证走 OAuth2 密码模式（Bearer），只支持直连。',
  });

  /* ── 数据路由 ────────────────────────────────────────────────────── */

  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const remove = scope.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const send = (value, httpStatus = 200) =>
            Response.json(value, { status: httpStatus, headers: { 'cache-control': 'no-store' } });

          let rpcId = 'invalid-request';
          try {
            // GET 回自描述 + 当前状态：一份响应就能回答"能干什么"与"现在能不能读"，
            // 调用方不必先探测再决定要不要问第二个问题。
            if (request.method === 'GET') {
              return send({ ok: true, value: { ...describe(), status: await status() } });
            }

            const body = await request.json();
            // 与 study-core / omni 同一套信封：{ type, rpcId, method, payload }
            if (body?.type !== 'client-request' || typeof body.rpcId !== 'string' || body.rpcId.length > 200) {
              throw new ClassroomError('INPUT', '请求信封不对：需要 { type:"client-request", rpcId, method, payload }。');
            }
            rpcId = body.rpcId;

            // `method` 既接受顶层（本包约定的形态），也接受 `payload.method`
            // （omni 时代的口径）—— 两种信封都已在用的调用方不该为一个字段改名。
            const method = typeof body.method === 'string' ? body.method : body.payload?.method;
            const args = body.payload?.args ?? (body.method ? body.payload : undefined) ?? {};

            // 认证状态是**非数据方法**，单独放行：它不碰网络（只读本地令牌），
            // 所以没配账号时也能回答"我到底配了没"。
            if (method === 'cc98.status') return send({ type: 'server-response', rpcId, result: { ok: true, value: await status() } });
            if (method === 'cc98.logout') {
              await tokens.clear();
              return send({ type: 'server-response', rpcId, result: { ok: true, value: await status() } });
            }

            const value = await invoke(method, args);
            return send({ type: 'server-response', rpcId, result: { ok: true, value } });
          } catch (error) {
            return send({
              type: 'server-response',
              rpcId,
              result: {
                ok: false,
                // details 只放安全元数据（code/status 之类），不放原始响应体：
                // 这个对象会直接出现在浏览器控制台里。
                error: {
                  code: error?.code ?? 'CC98_FAILED',
                  message: String(error?.message ?? error),
                  details: object(error?.details) ? error.details : {},
                },
              },
            });
          }
        },
      });
      log(`数据路由：${ROUTE_PATH}（会话 ${persist ? dataDir : '内存，不落盘'}）`);
      return remove;
    }, 'zhiyun: cc98 data route');
  });

  /**
   * 宿主侧服务面：别的包/脚本不必绕 HTTP 就能用。
   *
   * 与路由暴露同一批方法，**不加**额外能力 —— 两处能力不一致时，
   * 「HTTP 能调、宿主侧调不到」这类问题会先在页面上暴露出来。
   */
  const removeService = ctx.provide('zhiyunCc98', {
    routePath: ROUTE_PATH,
    platform: 'cc98',
    label: 'CC98 论坛',
    readOnly: true,
    methods: METHODS.map(m => `cc98.${m}`),
    describe,
    status,
    logout: async () => { await tokens.clear(); return status(); },
    client,
    reader,
    /** 直接用某个方法（等价于路由的 POST）。 */
    invoke,
    /** 内联的 UBB 清洗，供调用方处理自己拿到的正文。 */
    ubbToText,
  });

  return async () => {
    // 先摘服务与路由，再关传输：反过来的话，卸载窗口里打进来的请求会打到
    // 一个已经 dispose 的 Transport 上。
    if (typeof removeService === 'function') removeService();
    client.transport?.close?.();
  };
}
