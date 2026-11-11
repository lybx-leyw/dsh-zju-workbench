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
import { sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
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
    /** 登录提供者（由集成层注入）。 */
    let acquireSession = null;
    /** 已读记录（`newActivities` 用）。由调用方持久化。 */
    let seenStore = null;
    /** 缓存的客户端。 */
    let client = null;

    /** 取客户端（无状态，登录由 provider 负责）。 */
    const ensure = () => {
      client ??= new Sztz({
        request: requestOf(ctx),
        acquireSession: () => {
          if (!acquireSession) {
            throw new SztzError(
              'CONFIG',
              '素质拓展平台还没接入登录：到「设置 → 浙大一卡通」配置后重试'
              + '（若你是插件作者：调用 setSessionProvider）。',
            );
          }
          return acquireSession();
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
      cancelActivityPrepare: async (input) => writes().cancelActivity.prepare(input),
      cancelActivityExecute: async (signal) => writes().cancelActivity.execute(signal),

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
      ready() { return acquireSession !== null; },

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
