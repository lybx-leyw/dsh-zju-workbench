/**
 * 校内通知公告数据源的宿主入口。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：**不注册 AI 工具**、`writes: false`。上游的 `notice list` /
 * `view` / `new` / `sources` 四个命令在这里变成服务上的四个只读方法 + 一条同源路由。
 *
 * `new` 会算出「上次查看之后新出现的是哪些」，但它**不写盘** —— `seen` 交回调用方，
 * 持久化由集成层用 `setSeenStore({ load, save })` 注入。这样本包在磁盘上没有副作用。
 *
 * # auth 是 cas、network 是 campus
 *
 * 照上游 `module.json`：`auth: "cas"`、`network: "campus"`。
 * 但**绝大多数栏目其实不需要登录** —— 只有个别站点（信息技术中心）落到统一身份认证
 * 登录页时才要。所以本包的做法是「遇到再说」：请求落到 CAS 登录页时，若集成层
 * 注入了 `setServiceLoginProvider`，就做一次**该站点的委托登录**后重取；
 * 没注入就抛 `AUTH_REQUIRED` 并指到设置页。
 *
 * # 为什么不依赖 `source/zdbk`
 *
 * 上游的 `requires` 里有 `zdbk`（教务网），因为它的教务适配器直接借了 zdbk 的会话。
 * 本仓的硬规则是 **tier 1 不得依赖另一个 tier 1**，而 `source/zdbk` 与 `notice`
 * 都是 tier 1 —— 所以这里**不 import zdbk 包**。
 *
 * 教务适配器需要的东西恰好只有两件，都来自 tier 0：
 *
 * 1. **一个已登录的会话** —— 由 `request`（`Transport`）提供，而 `Transport` 来自
 *    `@lybx-leyw/dsh-zju-source-http`；
 * 2. **CAS 登录流程** —— `@lybx-leyw/dsh-zju-source-login/cas`（也是 tier 0）。
 *
 * 所以教务那套「POST jqGrid 列表 + 解析详情页」在 `notice.js` 里**独立实现**，
 * 与 `zdbk` 包不共享一行代码，也就不存在版本耦合。
 * 详见 README 的「为什么不依赖 zdbk」。
 */
import { sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import { NoticeSource, NoticeError } from './notice.js';

export const name = 'zju-source-notice';

/** 只需要出口；凭据与登录由调用方注入。 */
export const inject = [];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zhiyun-notice';

/**
 * 把 `sharedFetch` 适配成数据层期望的形状。
 *
 * ⚠️ 这里**必须有超时**（在 `notice.js` 的 `withTimeout` 里），因为
 * `sharedFetch` → `egress.fetch` → `undici.fetch` 整条链上没有任何一层读 `timeoutMs`
 * —— 只有 `Transport` 读。而本包不保证调用方注入的是 `Transport`。
 *
 * @param ctx - 宿主上下文。
 * @returns `(url, init) => Promise<{status, headers, text}>`。
 */
const requestOf = (ctx) => async (url, init = {}) => {
  const response = await sharedFetch(ctx)(url, init);
  return { status: response.status, headers: response.headers, text: await response.text() };
};

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文。
 * @returns 卸载函数。
 */
export function apply(ctx) {
  return ctx.effect(() => {
    /** 使用者信息（`{ level, college }`）。由集成层从个人档案注入。 */
    let profile = {};
    /** 该站点的委托登录（由集成层注入）。 */
    let serviceLogin = null;
    /** 已读记录（`new` 用）。由调用方持久化。 */
    let seenStore = null;
    /** 缓存的客户端。 */
    let client = null;

    /**
     * 取客户端。
     *
     * `request` 每次现取：宿主上下文与出口都是惰性的（见 `sharedFetch` 的注释），
     * 在 `apply` 阶段缓存住服务实例会在装配顺序变化时永久失效。
     */
    const ensure = () => {
      client ??= new NoticeSource({
        request: requestOf(ctx),
        acquireServiceLogin: serviceLogin === null
          ? null
          : (input) => {
            if (serviceLogin === null) {
              throw new NoticeError(
                'AUTH_REQUIRED',
                '这个栏目的通知要统一身份认证：到「设置 → 浙大一卡通」登录后重试',
                { host: input.host },
              );
            }
            return serviceLogin(input);
          },
      });
      client.setProfile(profile);
      return client;
    };

    const service = {
      routePath: ROUTE_PATH,
      platform: 'notice',
      label: '校内通知',
      readOnly: true,
      methods: ['notice.list', 'notice.view', 'notice.new', 'notice.sources'],

      /**
       * 注入使用者信息（`{ level: 'undergrad' | 'grad', college }`）。
       *
       * `college` 写学院**全称**（如「计算机科学与技术学院」）。本包**不猜**：
       * 上游会从个人档案读、必要时从教务网课表读一次并落盘 30 天，那套身份推断
       * 有副作用，不该藏在数据源里。
       *
       * @param value - `{ level?, college? }`，或 null 取消。
       * @returns 撤销函数。
       */
      setProfile(value) {
        if (value !== null && value !== undefined && typeof value !== 'object') {
          throw new NoticeError('CONFIG', 'setProfile 需要一个 { level, college } 对象');
        }
        profile = value ?? {};
        client = null;
        return () => { if (profile === value) { profile = {}; client = null; } };
      },

      /**
       * 注入「把某站点的统一身份认证做完」的能力。
       *
       * 回调形状 `({ service, host }) => Promise<void>`：拿 CAS 的 `service` 地址
       * 走一遍认证，让之后的同源请求带上该站点的会话。CAS 的通用实现在
       * `@lybx-leyw/dsh-zju-source-login/cas`（tier 0），本包不重复实现。
       *
       * @param handler - 函数，或 null 取消注册。
       * @returns 撤销函数。
       */
      setServiceLoginProvider(handler) {
        if (handler !== null && handler !== undefined && typeof handler !== 'function') {
          throw new NoticeError('CONFIG', 'setServiceLoginProvider 需要一个返回 Promise 的函数');
        }
        serviceLogin = typeof handler === 'function' ? handler : null;
        client = null;
        return () => { if (serviceLogin === handler) { serviceLogin = null; client = null; } };
      },

      /**
       * 注入已读记录的持久化（`{ load, save }`）。
       *
       * @param store - 存储，或 null 取消。
       * @returns 撤销函数。
       */
      setSeenStore(store) {
        seenStore = store ?? null;
        return () => { if (seenStore === store) seenStore = null; };
      },

      /** 是否已接入统一身份认证（用于设置页的状态读数）。 */
      ready() { return serviceLogin !== null; },

      /** 清掉缓存（换账号、或用户点了「重新登录」）。 */
      reset() { client = null; },

      /* ── 只读接口 ── */

      /**
       * 通知列表。
       *
       * @param input - `{ keyword?, source?, since?, until?, limit?, profile? }`。
       */
      list(input = {}) {
        return ensure().list({ ...input, profile: input.profile ?? profile });
      },

      /**
       * 按链接（可多个，竖线分隔）或标题取全文。
       *
       * @param input - `{ title?, url? }`，二者择一。
       */
      view(input = {}) {
        return ensure().view({ ...input, profile: input.profile ?? profile });
      },

      /**
       * 上次查看之后新发布的通知。**会读写已读记录**（唯一的副作用，且只在调用方
       * 注入的存储里）。
       *
       * @param input - `{ reset?, source? }`。
       */
      async noticeNew(input = {}) {
        const seen = input.reset === true ? { sources: {} } : (seenStore?.load?.() ?? { sources: {} });
        const result = await ensure().new({ ...input, seen, profile: input.profile ?? profile });
        await seenStore?.save?.(result.seen);
        return result;
      },

      /** 已接入的来源、栏目与学院名录。**不联网。** */
      sources(input = {}) {
        return ensure().sources({ ...input, profile: input.profile ?? profile, seen: seenStore?.load?.() ?? { sources: {} } });
      },
    };

    const disposeService = ctx.provide('zhiyunNotice', service);

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
              list: () => service.list(input.input ?? {}),
              view: () => service.view(input.input ?? {}),
              new: () => service.noticeNew(input.input ?? {}),
              sources: () => service.sources(input.input ?? {}),
              status: () => ({ ready: service.ready(), routePath: ROUTE_PATH, methods: service.methods }),
            };
            const handler = handlers[action];
            if (!handler) throw new NoticeError('CONFIG', `不认识的操作：${action ?? '(空)'}`);
            res.end(JSON.stringify({ ok: true, value: await handler() }));
          } catch (error) {
            res.end(JSON.stringify({ ok: false, error: { code: error?.code ?? 'FAILED', message: String(error?.message ?? error) } }));
          }
        },
      });
    });

    return () => {
      removeRoute?.();
      disposeService?.();
    };
  }, 'zju: notice data source');
}

export { NoticeError, NoticeSource, SOURCES, catalogInfo, collegeSources, findCollege, hostTable, networkOf } from './notice.js';
