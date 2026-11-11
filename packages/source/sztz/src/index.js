/**
 * 素质拓展数智平台数据源的宿主入口。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：**不注册 AI 工具**、**无写操作**。上游的 `signUp` / `cancelSignUp` /
 * `setFavorite` 三个写方法归 `packages/tool/`。
 *
 * # network 是 campus
 *
 * 主机只解析到校内地址（`10.203.15.167`），校外必须经 WebVPN。
 *
 * # 登录
 *
 * 平台用统一身份认证的 **service 委托**：先 `login/getLoginUrl` 拿到带 `service`
 * 的 CAS 地址，走完 CAS 再回跳。这段流程由 `setSessionProvider` 注入 ——
 * D18 之后 CAS 通用实现在 `source/login/src/cas.js`，本包不重复一份。
 */
import { CAS_HOST, sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import {
  BASE, HOST, Sztz, SztzError, activityView, beijing, category, freshActivities, points, recordView, statusOf,
} from './sztz.js';
import { createSztzWrites } from './writes.js';

export const name = 'zju-source-sztz';

/** 只需要出口；登录由调用方注入。 */
export const inject = [];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zhiyun-sztz';

/**
 * 取一个**已登录**的请求函数。
 *
 * # 登录归 `source/login`（D18 的 B 方案：共享 CAS 会话）
 *
 * 先前本包只留了 `setSessionProvider` 注入点，而**全仓没有任何调用方** ——
 * 于是它虽然挂在 profile 里，却永远拿不到会话，任何一次读取都报
 * 「还没接入登录」。那不是「用户没配账号」，是「没人给它喂账号」。
 *
 * 现在改成向 tier 0 的 `zhiyunCard` 要一份已带 CAS 票的传输层：
 * 由 `login` 统一走 CAS、统一持有会话，本包只说明自己的入口与主机。
 *
 * 两个来源按优先级：
 * 1. 注入了 `setSessionProvider`（测试与特殊部署）→ 用它；
 * 2. 否则 → `ctx.get('zhiyunCard').casTransport({ entry, hosts })`。
 *
 * @param ctx - 宿主上下文。
 * @param getProvider - 返回当前注入的 provider（可能为 null）。
 * @returns `(url, init) => Promise<{status, text}>`。
 */
const requestWithLogin = (ctx, getProvider) => async (url, init = {}) => {
  const provider = getProvider();
  if (typeof provider === 'function') {
    // 注入的 provider 只负责「让会话生效」，实际请求仍走 sharedFetch。
    await provider();
    const response = await sharedFetch(ctx)(url, init);
    return { status: response.status, text: await response.text() };
  }
  // 没注入就向 `login` 要共享会话（它会替我们走一次 CAS）。
  const card = ctx.get?.('zhiyunCard');
  if (typeof card?.casTransport !== 'function') {
    throw new SztzError(
      'CONFIG',
      '素质拓展平台需要「浙大一卡通」的共享会话，但 `source/login` 没有装配。'
      + '请启用该数据源包，或在「设置 → 浙大一卡通」配置账号。',
    );
  }
  const transport = await card.casTransport({ entry: `${BASE}/`, hosts: [HOST, CAS_HOST] });
  const result = await transport.request(url, { ...init });
  return { status: result.status, text: result.text };
};

/**
 * 把 `sharedFetch` 适配成数据层期望的形状（**不登录**，用于公开页面）。
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
    /** 登录提供者（由集成层注入）。 */
    let acquireSession = null;
    /** 已读记录（`newActivities` 用）。由调用方持久化。 */
    let seenStore = null;
    /** 缓存的客户端。 */
    let client = null;

    /** 取客户端（无状态，登录由 provider 或共享 CAS 会话负责）。 */
    const ensure = () => {
      client ??= new Sztz({
        // 用带登录的那个：没注入 provider 时它会向 `zhiyunCard` 要共享会话。
        request: requestWithLogin(ctx, () => acquireSession),
        acquireSession: () => {
          if (typeof acquireSession === 'function') return acquireSession();
          // 走共享 CAS 的路径不需要在这里做任何事 —— `requestWithLogin`
          // 在发第一个请求前已经把票拿好了。
          if (typeof ctx.get?.('zhiyunCard')?.casTransport === 'function') return Promise.resolve();
          throw new SztzError(
            'CONFIG',
            '素质拓展平台还没接入登录：到「设置 → 浙大一卡通」配置后重试'
            + '（它用的是统一身份认证的共享会话）。',
          );
        },
      });
      return client;
    };

    /**
     * 写操作集合（Prepare 与 Execute 共用一份，见下面的说明）。
     *
     * 惰性构造 + 随客户端重置：`createSztzWrites` 需要已登录的实例，
     * 而换账号后那份会话不该还挂着旧客户端。
     */
    let writesCache = null;
    const writes = () => {
      const active = ensure();
      if (!writesCache || writesCache.client !== active) {
        writesCache = { client: active, api: createSztzWrites(active) };
      }
      return writesCache.api;
    };

    const service = {
      routePath: ROUTE_PATH,
      platform: 'sztz',
      label: '二三四课堂',
      // 本包含写方法（报名 / 取消报名），如实标 false。
      readOnly: false,
      methods: [
        'sztz.activities', 'sztz.projects', 'sztz.newActivities',
        'sztz.myActivities', 'sztz.myCredits', 'sztz.bulletins',
      ],
      /** 写方法名（成对出现），与只读 `methods` 分开列。 */
      writeMethods: ['sztz.signupActivityPrepare', 'sztz.signupActivityExecute',
        'sztz.cancelActivityPrepare', 'sztz.cancelActivityExecute'],
      site: `${BASE}/`,

      /**
       * 写操作的两个方法。
       *
       * `prepare` 算参数与说明，`execute` 才发请求。**审批不在这里** ——
       * 那是 `packages/tool/campus-write` 的事。
       */
      signupActivityPrepare: async (input) => writes().signupActivity.prepare(input),
      signupActivityExecute: async (signal) => writes().signupActivity.execute(signal),
      signupActivityCancel: async () => (await writes()).signupActivity.cancel(),
      cancelActivityPrepare: async (input) => writes().cancelActivity.prepare(input),
      cancelActivityExecute: async (signal) => writes().cancelActivity.execute(signal),
      cancelActivityCancel: async () => (await writes()).cancelActivity.cancel(),

      /** 注入登录能力（`() => Promise<void>`）。返回撤销函数。 */
      setSessionProvider(handler) {
        if (handler !== null && handler !== undefined && typeof handler !== 'function') {
          throw new SztzError('CONFIG', 'setSessionProvider 需要一个返回 Promise 的函数');
        }
        acquireSession = typeof handler === 'function' ? handler : null;
        client = null;
        return () => { if (acquireSession === handler) { acquireSession = null; client = null; } };
      },

      /** 注入已读记录的持久化（`{ load, save }`）。 */
      setSeenStore(store) {
        seenStore = store ?? null;
        return () => { if (seenStore === store) seenStore = null; };
      },

      /** 是否已接入登录。 */
      /**
       * 是否已接入登录。
       *
       * 两个来源都算：注入了 provider，**或者** source/login 已装配
       * （共享 CAS 会话由它负责）。先前只认前者，而那个注入点全仓没人调用。
       */
      ready() {
        return typeof acquireSession === 'function'
          || typeof ctx.get?.('zhiyunCard')?.casTransport === 'function';
      },

      /* ── 只读接口 ── */

      /**
       * 活动中心。
       *
       * @param input - `{ keyword?, date?, includeEnded?, limit? }`。
       */
      activities(input = {}) {
        return ensure().listActivities(input);
      },

      /**
       * 项目库。
       *
       * @param input - `{ keyword?, category? }`。
       */
      projects(input = {}) {
        return ensure().listProjects(input);
      },

      /**
       * 新出现的活动。**会写已读记录**（这是它唯一的副作用，且只写本地）。
       *
       * @param input - `{ reset? }`；`reset: true` 清空已读记录。
       */
      async newActivities(input = {}) {
        const seen = input.reset ? {} : (seenStore?.load?.() ?? {});
        const result = await ensure().newActivities({ seen });
        await seenStore?.save?.(result.seen);
        return result;
      },

      /** 本人报名的、收藏的、已认定的活动。 */
      myActivities() {
        return ensure().myActivities();
      },

      /** 本人记点与成绩单。 */
      myCredits() {
        return ensure().myCredits();
      },

      /** 平台通知。 */
      bulletins() {
        return ensure().listBulletins();
      },
    };

    const disposeService = ctx.provide('zhiyunSztz', service);

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
              activities: () => service.activities(input.input ?? {}),
              projects: () => service.projects(input.input ?? {}),
              'new-activities': () => service.newActivities(input.input ?? {}),
              'my-activities': () => service.myActivities(),
              'my-credits': () => service.myCredits(),
              bulletins: () => service.bulletins(),
            };
            const handler = handlers[action];
            if (!handler) throw new SztzError('CONFIG', `不认识的操作：${action ?? '(空)'}`);
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
  }, 'zju: sztz data source');
}

export { BASE, HOST, SztzError, activityView, beijing, category, freshActivities, points, recordView, statusOf };
