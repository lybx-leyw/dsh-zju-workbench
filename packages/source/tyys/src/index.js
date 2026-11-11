/**
 * 浙大体艺数据源的宿主入口。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：**不注册 AI 工具**、**无写操作**。上游 `tyys/booking.ts` 里的
 * 预约（`bookVenue`）、付款（`payAndVerify`）、取消（`cancelVenue`）三个写动作
 * 归 `packages/tool/`（见 README 的「写操作去哪了」）。
 *
 * 分层不只写在注释里：`tyys.js` 的 `VenueClient.request_` 见到写接口
 * （`/api/reservation/order/submit`、`/api/venue/finances/order/pay`、
 * `/api/venue/finances/order/cancel`）**直接抛错**，路径拼对了也发不出去。
 *
 * # 认证是 cas，两个面各要一次
 *
 * 上游 `module.json` 声明 `auth: cas`、`network: public`，与主机表一致
 * （`tyys.zju.edu.cn` / `www.tyys.zju.edu.cn` 在 `source/webvpn/src/hosts.js`
 * 里都判 `public`，所以校外**能直连**，不必绕 WebVPN）。
 *
 * 但场馆平台与体艺 App 是**两套令牌**，都要各自走一次 CAS service 委托，
 * 所以服务面收**一个**回调 `setLoginProvider`，由它按 `service` 分派：
 *
 * | 调用方 | `service` | 需要什么 |
 * | --- | --- | --- |
 * | 场馆平台 | `VENUE_LOGIN_SERVICE` | 回跳后的最终地址（里面有 `oauth_token`） |
 * | 体艺 App | `APP_LOGIN_SERVICE` | 回跳后的页面正文（里面有 `jwtToken`） |
 *
 * 本包不知道凭据从哪来 —— 那是 `source/login` 与集成层的事。
 *
 * # 为什么账号要单独传
 *
 * App 令牌里的 `sub` 必须等于本次要读的账号（见 `tyys.js` 的 `parseTokens`），
 * 否则会把别人的考勤读给现在的人。所以服务面收 `setAccountProvider`，
 * 由调用方给出**当前账号**；本包不读凭据文件、也不猜。
 */
import { sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import { createTyysWrites } from './writes.js';
import {
  APP_LOGIN_SERVICE, ATTENDANCE_STATUS, TyysApp, TyysError, VENUE_LOGIN_SERVICE, VenueClient,
  beijingDate, history, listOrders, listVenues, targetDate, timeRange,
} from './tyys.js';

export const name = 'zju-source-tyys';

/** 只需要出口；凭据与登录由调用方注入。 */
export const inject = [];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zhiyun-tyys';

/**
 * 把 `sharedFetch` 适配成数据层期望的形状。
 *
 * @param ctx - 宿主上下文。
 * @returns `(url, init) => Promise<{status, text}>`。
 */
const requestOf = (ctx) => async (url, init = {}) => {
  const response = await sharedFetch(ctx)(url, init);
  return { status: response.status, text: await response.text() };
};

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文。
 * @returns 卸载函数。
 */
export function apply(ctx) {
  return ctx.effect(() => {
    /** 登录回调（由集成层注入）。 */
    let acquireLogin = null;
    /** 取当前账号的回调（由集成层注入）。 */
    let accountProvider = null;
    /** 上一次解析出来的账号。 */
    let account = '';
    /** 缓存的客户端对。账号或注入变了就重建。 */
    let cached = null;

    /** 丢掉缓存（换账号、换注入、或用户点了「重新登录」时）。 */
    const forget = () => { cached = null; };

    /**
     * 取共享 CAS 服务（`source/login` 提供）。
     *
     * # 这是 D18 的 B 方案：CAS 会话由 `login` 统一持有一份
     *
     * 本包先前只留了 `setLoginProvider` / `setAccountProvider` 两个注入点，
     * 而**全仓没有任何调用方** —— 于是它挂着却永远拿不到登录，
     * 场馆预约与考勤都不可用。那不是「用户没配账号」，是「没人喂账号」。
     *
     * 现在兜底到 `zhiyunCard`：凭据、CAS 流程、会话文件全在 tier 0，
     * 本包只说明自己要哪个 `service`。
     *
     * @returns 服务对象，或 `null`（没装 `source/login`）。
     */
    const cardService = () => ctx.get?.('zhiyunCard') ?? null;

    /**
     * 登录回调（注入优先，其次共享 CAS）。
     *
     * 场馆要**回跳落地 URL**（取 `oauth_token`），体艺 App 要**落地正文**
     * （取 `jwtToken`）—— 所以走 `casLoginFor` 而不是 `casTransport`。
     *
     * @param input - `{ service }`：`VENUE_LOGIN_SERVICE` 或 `APP_LOGIN_SERVICE`。
     * @returns 落地结果 `{ url, html, status? }`。
     */
    const loginFor = async (input = {}) => {
      if (typeof acquireLogin === 'function') return acquireLogin(input);
      const card = cardService();
      if (typeof card?.casLoginFor !== 'function') {
        throw new TyysError(
          'CONFIG',
          '体艺平台还没接入登录：到「设置 → 浙大一卡通」配置后重试'
          + '（它用的是统一身份认证的共享会话）。',
        );
      }
      const service = String(input?.service ?? '').trim();
      if (!service) throw new TyysError('CONFIG', '体艺登录需要 service 地址。');
      const landing = await card.casLoginFor({
        entry: service,
        hosts: [HOST, 'zjuam.zju.edu.cn', 'tyys.zju.edu.cn', 'www.tyys.zju.edu.cn'],
      });
      return { url: landing?.url?.href ?? '', body: landing?.html ?? '', status: 200 };
    };

    /**
     * 取当前账号：注入优先，其次「浙大一卡通」里的学号。
     *
     * @returns 账号字符串（可能为空）。
     */
    const accountOf = async () => {
      if (typeof accountProvider === 'function') return accountProvider();
      const card = cardService();
      if (typeof card?.read === 'function') {
        const account = await card.read().catch(() => null);
        return account?.username ?? '';
      }
      return '';
    };

    /**
     * 解析当前账号，账号变了就丢掉旧客户端。
     *
     * @returns 账号字符串。
     * @throws {TyysError} `CONFIG` 没有账号提供者、或它返回空。
     */
    const ensureAccount = async () => {
      const value = await accountOf();
      const next = String(value ?? '').trim();
      if (!next) {
        throw new TyysError('CONFIG', '还不知道用哪个账号查体艺：到「设置 → 浙大一卡通」配置学号后重试。');
      }
      if (next !== account) {
        account = next;
        forget();
      }
      return account;
    };

    /**
     * 取一对客户端（场馆平台 + 体艺 App）。
     *
     * 账号变了就重建 —— 复用上一个人的客户端会把他的考勤/订单读给现在的人。
     *
     * ⚠️ 这里**不**检查有没有注入登录回调：预约须知是匿名接口，不需要登录，
     * 上游也是用 `publicOnly` 打开客户端的。真正需要登录的路径会在 `login()`
     * 里抛 `CONFIG`（文案指向设置入口），所以不注入也只会「读到需登录的那一步」才失败。
     *
     * @returns `{ venue, app }`。
     */
    const clients = () => {
      if (!cached) {
        cached = {
          account,
          venue: new VenueClient({ request: requestOf(ctx), acquireLogin: loginFor, username: account }),
          app: new TyysApp({ request: requestOf(ctx), acquireLogin: loginFor, username: account }),
        };
      }
      return cached;
    };

    /**
     * 把用户写的日期规整成 `YYYY-MM-DD`。
     *
     * @param input - `今天` / `明天` / `后天` / `N天后` / `YYYY-MM-DD`。
     * @param bounded - 是否限制在今天至三天后（查订单历史时传 false）。
     * @returns `YYYY-MM-DD`。
     */
    const resolveDate = (input, { bounded = true } = {}) => {
      // 不给日期就按今天 —— 与上游 `venue list` 的 `default: "今天"` 一致；
      // 查订单时「不给日期」意为「不限日期」，所以那时不补今天。
      if (input === undefined || input === null || input === '') return bounded ? beijingDate() : undefined;
      return targetDate(input, Date.now(), bounded);
    };

    /**
     * 写操作集合（Prepare 与 Execute 共用同一份）。
     *
     * 缓存键是 `venue` 客户端实例：换账号后 `clients()` 会重建，
     * 写会话不该还挂在旧客户端上。
     */
    let writesCache = null;
    const writes = async () => {
      const { venue } = clients();
      if (!writesCache || writesCache.client !== venue) {
        writesCache = { client: venue, api: createTyysWrites(venue) };
      }
      return writesCache.api;
    };

    const service = {
      routePath: ROUTE_PATH,
      platform: 'tyys',
      label: '浙大体艺',
      // 本包含写方法（场馆预约 / 取消），如实标 false。
      readOnly: false,
      methods: [
        'tyys.venues', 'tyys.slots', 'tyys.notice', 'tyys.orders',
        'tyys.attendance', 'tyys.session', 'tyys.identity',
      ],
      /** 写方法名（成对出现），与只读 `methods` 分开列。 */
      writeMethods: ['tyys.bookVenuePrepare', 'tyys.bookVenueExecute',
        'tyys.cancelVenuePrepare', 'tyys.cancelVenueExecute'],
      site: 'http://www.tyys.zju.edu.cn/venue-server',

      /**
       * 写操作的两个方法。
       *
       * `prepare` 算参数与说明，`execute` 才发请求。**审批不在这里** ——
       * 那是 `packages/tool/campus-write` 的事。
       */
      bookVenuePrepare: async (input) => (await writes()).bookVenue.prepare(input),
      bookVenueExecute: async (signal) => (await writes()).bookVenue.execute(signal),
      bookVenueCancel: async () => (await writes()).bookVenue.cancel(),
      cancelVenuePrepare: async (input) => (await writes()).cancelVenue.prepare(input),
      cancelVenueExecute: async (signal) => (await writes()).cancelVenue.execute(signal),
      cancelVenueCancel: async () => (await writes()).cancelVenue.cancel(),

      /**
       * 注入登录能力。返回撤销函数。
       *
       * 回调收到 `{ service }`（`VENUE_LOGIN_SERVICE` 或 `APP_LOGIN_SERVICE`），
       * 返回 `{ url?, body?, status? }`：场馆平台读 `url` 里的 `oauth_token`，
       * 体艺 App 读 `body` 里的 `jwtToken`。
       *
       * @param handler - 回调，或 null 取消注册。
       * @throws {TyysError} 传了既不是函数也不是 null 的东西 —— 静默置 null 会让
       *   调用方以为注入成功，直到下一次请求才报「还没接入登录」。
       */
      setLoginProvider(handler) {
        if (handler !== null && handler !== undefined && typeof handler !== 'function') {
          throw new TyysError('CONFIG', 'setLoginProvider 需要一个返回 CAS 回跳结果的函数。');
        }
        acquireLogin = typeof handler === 'function' ? handler : null;
        forget();
        return () => { if (acquireLogin === handler) { acquireLogin = null; forget(); } };
      },

      /**
       * 注入当前账号。返回撤销函数。
       *
       * @param provider - `() => string | Promise<string>`，或 null 取消注册。
       * @throws {TyysError} 传了非函数。
       */
      setAccountProvider(provider) {
        if (provider !== null && provider !== undefined && typeof provider !== 'function') {
          throw new TyysError('CONFIG', 'setAccountProvider 需要一个返回学号的函数。');
        }
        accountProvider = typeof provider === 'function' ? provider : null;
        account = '';
        forget();
        return () => { if (accountProvider === provider) { accountProvider = null; account = ''; forget(); } };
      },

      /** 是否已接入登录。 */
      /**
       * 是否已接入登录。
       *
       * 两个来源都算：注入了 provider，**或者** source/login 已装配
       * （共享 CAS 会话由它负责）。先前只认前者，而那个注入点全仓没人调用。
       */
      ready() {
        return typeof acquireLogin === 'function'
          || typeof ctx.get?.('zhiyunCard')?.casLoginFor === 'function';
      },

      /** 清掉缓存的会话（换账号、或用户点了「重新登录」）。 */
      reset() { forget(); },

      /* ── 只读接口 ── */

      /**
       * 场馆目录，或（筛选唯一时）某一天的余量。
       *
       * @param input - `{ sport?, campus?, venue?, date?, time? }`。
       * @returns `listVenues` 的结果。
       */
      async venues(input = {}) {
        await ensureAccount();
        const date = resolveDate(input.date);
        const time = input.time === undefined || input.time === null || input.time === '' ? undefined : timeRange(input.time);
        return listVenues(clients().venue, {
          ...(input.sport ? { sport: String(input.sport) } : {}),
          ...(input.campus ? { campus: String(input.campus) } : {}),
          ...(input.venue ? { venue: String(input.venue) } : {}),
          date,
          ...(time ? { time } : {}),
        });
      },

      /**
       * 指定场馆某一天的时段表（不做筛选与聚合）。
       *
       * @param input - `{ venueSiteId, date? }`。
       * @returns `DayInfo`。
       */
      async slots(input = {}) {
        await ensureAccount();
        const id = String(input.venueSiteId ?? '').trim();
        if (!id) throw new TyysError('CONFIG', '查时段要给 venueSiteId（先从场馆目录里取）。');
        const date = resolveDate(input.date);
        return clients().venue.day({ id }, date);
      },

      /** 预约须知与放号时刻（匿名可读）。 */
      async notice() {
        // 须知是匿名接口，但仍要客户端 —— 它不触发登录。
        return clients().venue.notice();
      },

      /**
       * 本人场馆预约订单（只读）。
       *
       * @param input - `{ date?, venue? }`；不给 `date` 只看今天及以后。
       * @returns `listOrders` 的结果。
       */
      async orders(input = {}) {
        await ensureAccount();
        const date = resolveDate(input.date, { bounded: false });
        return listOrders(clients().venue, {
          ...(date ? { date } : {}),
          ...(input.venue ? { venue: String(input.venue) } : {}),
        });
      },

      /**
       * 体育课历史考勤（体艺 App 面）。
       *
       * @param input - `{ course? }`。
       * @returns `history` 的结果。
       */
      async attendance(input = {}) {
        await ensureAccount();
        return history(clients().app, input.course === undefined ? undefined : String(input.course));
      },

      /**
       * 体艺 App 会话状态（**会联网**：`/api/l/v6/u/info`）。
       *
       * @returns `{ authenticated: true, uid?, name? }`。
       */
      async session() {
        await ensureAccount();
        const info = await clients().app.checkSession();
        return {
          authenticated: true,
          ...(info.uid == null ? {} : { uid: String(info.uid) }),
          ...(info.name == null ? {} : { name: String(info.name) }),
        };
      },

      /** 场馆平台上的本人信息（需要登录）。 */
      async identity() {
        await ensureAccount();
        return clients().venue.identity();
      },
    };

    const disposeService = ctx.provide('zhiyunTyys', service);

    let removeRoute = null;
    ctx.inject(['webServer'], (scope) => {
      removeRoute = scope.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          try {
            const body = await new Promise((done, fail) => {
              const chunks = [];
              req.on('data', (chunk) => chunks.push(chunk));
              req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
              req.on('error', fail);
            });
            const input = body ? JSON.parse(body) : {};
            const action = input?.action;
            const handlers = {
              venues: () => service.venues(input.input ?? {}),
              slots: () => service.slots(input.input ?? {}),
              notice: () => service.notice(),
              orders: () => service.orders(input.input ?? {}),
              attendance: () => service.attendance(input.input ?? {}),
              session: () => service.session(),
              identity: () => service.identity(),
              status: () => ({ ready: service.ready(), readOnly: true }),
            };
            const handler = handlers[action];
            if (!handler) throw new TyysError('CONFIG', `不认识的操作：${action ?? '(空)'}`);
            res.end(JSON.stringify({ ok: true, value: await handler() }));
          } catch (error) {
            res.end(JSON.stringify({ ok: false, error: { code: error?.code ?? 'FAILED', message: String(error?.message ?? error) } }));
          }
        },
      });
    });

    return () => {
      removeRoute?.();
      cached = null;
      disposeService?.();
    };
  }, 'zju: tyys data source');
}

export {
  APP_LOGIN_SERVICE, ATTENDANCE_STATUS, TyysApp, TyysError, VENUE_LOGIN_SERVICE, VenueClient,
  beijingDate, history, listOrders, listVenues, targetDate, timeRange,
};
