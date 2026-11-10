/**
 * 实验课平台数据源的宿主入口。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：**不注册 AI 工具**、**无写操作**。上游的 `select` / `cancel`
 * 两个写方法归 `packages/tool/`（见 README 的「写操作去哪了」）。
 *
 * # network 是 campus
 *
 * 平台在私网 IP `10.203.16.55` 上，校外必须经 WebVPN。主机表里这个 IP 被标 `campus`，
 * 上游 `module.json` 也声明 `network: campus`。
 *
 * # 凭据与会话
 *
 * 凭据由 `setCredentialProvider` 注入（本包不知道凭据从哪来）；
 * token 由 `setSession` 注入持久化（默认纯内存，进程重启要重新登录）。
 */
import { sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import { LAB_HOST, LabCourse, LabError, apiSign, jwtExpiresAt, parseOpenWeek } from './lab.js';

export const name = 'zju-source-lab';

/** 只需要出口；凭据与登录由调用方注入。 */
export const inject = [];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zhiyun-lab';

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
    /** 凭据提供者（由集成层注入）。 */
    let credentials = null;
    /** 会话持久化（可选）。 */
    let session = null;
    /** 缓存的客户端；账号变了要重建。 */
    let cached = null;

    /**
     * 取一个已登录的客户端。
     *
     * @param options.fresh - 强制重新登录。
     * @returns `LabCourse` 实例。
     * @throws {LabError} 还没注入凭据提供者。
     */
    const client = async ({ fresh = false } = {}) => {
      if (!credentials) {
        throw new LabError(
          'CONFIG',
          '实验课平台还没接入登录：到「设置 → 浙大一卡通」配置后重试'
          + '（若你是插件作者：调用 setCredentialProvider）。',
        );
      }
      if (!cached) {
        cached = new LabCourse({ request: requestOf(ctx), credentials, session });
        cached.restore();
      }
      if (fresh || !cached.hasToken) await cached.login(fresh);
      return cached;
    };

    const service = {
      routePath: ROUTE_PATH,
      platform: 'lab',
      label: '实验课平台',
      readOnly: true,
      methods: [
        'lab.terms', 'lab.currentTerm', 'lab.myCourses', 'lab.labs',
        'lab.weekStatus', 'lab.mySelections', 'lab.openStatus', 'lab.notices',
        'lab.myTimetable', 'lab.myInfo',
      ],
      site: `http://${LAB_HOST}:86/lab-course/selectCourse`,

      /** 注入凭据提供者（`() => Promise<{username, password}>`）。返回撤销函数。 */
      setCredentialProvider(handler) {
        if (handler !== null && typeof handler !== 'function') {
          throw new LabError('CONFIG', 'setCredentialProvider 需要一个返回 {username, password} 的函数');
        }
        credentials = handler;
        cached = null;
        return () => { if (credentials === handler) { credentials = null; cached = null; } };
      },

      /** 注入会话持久化（`{ load, save }`）。 */
      setSession(store) {
        session = store ?? null;
        cached = null;
        return () => { if (session === store) session = null; };
      },

      /** 是否已接入登录。 */
      ready() { return credentials !== null; },

      /** 登录态快照（不联网）。 */
      status() {
        const auth = cached?.auth;
        return auth
          ? { loggedIn: true, username: auth.username, name: auth.name, role: auth.role, expiresAt: auth.expiresAt }
          : { loggedIn: false };
      },

      /** 清掉缓存（换账号、或用户点了「重新登录」）。 */
      reset() { cached = null; },

      /* ── 只读接口 ── */
      async terms() { return (await client()).terms(); },
      async currentTerm() { return (await client()).currentTerm(); },
      async myCourses(input = {}) { return (await client()).myCourses(input.term); },
      async labs(input = {}) { return (await client()).labs(input.courseId); },
      async weekStatus(input = {}) { return (await client()).weekStatus(input.term); },
      async mySelections(input = {}) { return (await client()).mySelections(input.term); },
      async openStatus(input = {}) { return (await client()).openStatus(input.term); },
      async notices() { return (await client()).notices(); },
      async myTimetable(input = {}) { return (await client()).myTimetable(input.term); },
      async myInfo() { return (await client()).myInfo(); },
    };

    const disposeService = ctx.provide('zhiyunLab', service);

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
              terms: () => service.terms(),
              'current-term': () => service.currentTerm(),
              'my-courses': () => service.myCourses(input.input ?? {}),
              labs: () => service.labs(input.input ?? {}),
              'week-status': () => service.weekStatus(input.input ?? {}),
              'my-selections': () => service.mySelections(input.input ?? {}),
              'open-status': () => service.openStatus(input.input ?? {}),
              notices: () => service.notices(),
              'my-timetable': () => service.myTimetable(input.input ?? {}),
              'my-info': () => service.myInfo(),
              status: () => service.status(),
            };
            const handler = handlers[action];
            if (!handler) throw new LabError('CONFIG', `不认识的操作：${action ?? '(空)'}`);
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
  }, 'zju: lab data source');
}

export { LAB_HOST, LabError, apiSign, jwtExpiresAt, parseOpenWeek };
