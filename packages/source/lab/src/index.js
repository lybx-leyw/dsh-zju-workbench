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
import { clearLab, readLab, writeLab } from '@lybx-leyw/dsh-zju-source-login';
import { createLabWrites } from './writes.js';
import { LAB_HOST, LabCourse, LabError, apiSign, jwtExpiresAt, parseOpenWeek } from './lab.js';

export const name = 'zju-source-lab';

/** 只需要出口；凭据与登录由调用方注入。 */
export const inject = [];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zw-lab';

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
     * 写操作集合（Prepare 与 Execute 共用同一份，见服务面里的说明）。
     *
     * 惰性构造：`createLabWrites` 需要已登录的客户端，而装配时往往还没登录。
     * 客户端被重置（`reset()` / 换账号）时这份要一起丢掉 —— 否则写会话还挂在
     * 旧客户端的令牌上。
     */
    let writesCache = null;
    const writes = async () => {
      const active = await client();
      if (!writesCache || writesCache.client !== active) {
        writesCache = { client: active, api: createLabWrites(active) };
      }
      return writesCache.api;
    };

    /**
     * 取一个已登录的客户端。
     *
     * @param options.fresh - 强制重新登录。
     * @returns `LabCourse` 实例。
     * @throws {LabError} 还没注入凭据提供者。
     */
    /**
     * 取凭据。
     *
     * # ⚠️ 本包是 `auth: "own"`，**不用 CAS**
     *
     * 实验课平台有自己的账号体系（`POST /api/login {username, password}`
     * 换 JWT）。它的账号**通常**是学号，但**密码与统一身份认证不是同一个**。
     *
     * 我一度把它改成 `readCard(ctx)`（读「浙大一卡通」）—— 那是错的：
     * 拿 CAS 的密码去登实验平台会一直失败，而且会让用户以为「一卡通密码填错了」。
     *
     * 所以这里只认注入。集成层要给它单独的账号来源
     * （见 README 的「配置」一节）。
     *
     * @returns `{ username, password } | null`。
     */
    const credentialsOf = async () => {
      if (typeof credentials === 'function') return credentials();
      // `auth: "own"`：读的是**实验课平台自己**那份账号（`zw-lab/account`），
      // 不是「浙大一卡通」。用户名通常是学号，但密码与统一身份认证**不是同一个**。
      return readLab(ctx);
    };

    const client = async ({ fresh = false } = {}) => {
      const account = await credentialsOf();
      if (!account) {
        throw new LabError(
          'CONFIG',
          '实验课平台还没接入登录：到「设置 → 浙大一卡通」配置后重试'
          + '（实验课平台用的是你的学号，与统一身份认证同一份记录）。',
        );
      }
      if (!cached) {
        cached = new LabCourse({ request: requestOf(ctx), credentials: async () => account, session });
        cached.restore();
      }
      if (fresh || !cached.hasToken) await cached.login(fresh);
      return cached;
    };

    const service = {
      routePath: ROUTE_PATH,
      platform: 'lab',
      label: '实验课平台',
      // 本包含写方法（选实验 / 退选），如实标 false。
      readOnly: false,
      methods: [
        'lab.terms', 'lab.currentTerm', 'lab.myCourses', 'lab.labs',
        'lab.weekStatus', 'lab.mySelections', 'lab.openStatus', 'lab.notices',
        'lab.myTimetable', 'lab.myInfo',
      ],
      /**
       * 写方法名（成对出现）。
       *
       * 与只读 `methods` 分开列，不混进去 —— 混在一起会让
       * 「能力清单里有 12 条读取」这种误解成立。
       */
      writeMethods: ['lab.selectLabPrepare', 'lab.selectLabExecute', 'lab.cancelLabPrepare', 'lab.cancelLabExecute'],
      site: `http://${LAB_HOST}:86/lab-course/selectCourse`,

      /**
       * 写操作的两个方法。
       *
       * `prepare` 算出「将要做什么」并缓存参数，`execute` 才真的发请求。
       * **审批不在这里** —— 那是 `packages/tool/campus-write` 的事。
       *
       * # 为什么用 `writes` 缓存而不是每次现造
       *
       * `createLabWrites` 内部为每个动作建一个 session（Prepare 存参数、
       * Execute 取参数）。若 Prepare 与 Execute 各造一份，Execute 会拿到
       * 一个**空 session** 并报 `NEED_PREPARE` —— 看起来像「用户没批准」，
       * 实际是接线错了。所以这里缓存一份，两个方法共用。
       */
      selectLabPrepare: async (input) => (await writes()).selectLab.prepare(input),
      selectLabExecute: async (signal) => (await writes()).selectLab.execute(signal),
      selectLabCancel: async () => (await writes()).selectLab.cancel(),
      cancelLabPrepare: async (input) => (await writes()).cancelLab.prepare(input),
      cancelLabExecute: async (signal) => (await writes()).cancelLab.execute(signal),
      cancelLabCancel: async () => (await writes()).cancelLab.cancel(),

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

      /** 是否已接入登录（`auth: "own"`：只认注入的平台账号，不读 CAS）。 */
      /**
       * 保存实验课平台的账号。
       *
       * `auth: "own"`：这份账号存在 `source/login` 的 `zw-lab/account` 记录里，
       * 与「浙大一卡通」分开（用户名通常同学号，但**密码不是同一个**）。
       *
       * @param input - `{ username, password }`。
       * @returns `{ configured, username }`。
       */
      async saveAccount(input = {}) {
        const username = String(input?.username ?? '').trim();
        const password = String(input?.password ?? '');
        if (!username || !password) {
          throw new LabError('CONFIG', '需要实验课平台的用户名与密码。');
        }
        await writeLab(ctx, { username, password });
        // 换了账号要丢掉旧客户端与旧 token。
        credentials = async () => ({ username, password });
        cached = null;
        return { configured: true, username };
      },

      /** 清掉实验课平台的账号。 */
      async clearAccount() {
        await clearLab(ctx);
        credentials = null;
        cached = null;
        return { configured: false, username: '' };
      },

      /**
       * 是否已接入登录。
       *
       * 两个来源都算：注入了 provider，**或者** `source/login` 里存着实验课平台
       * 自己的账号（`readLab`）。后者是常规路径 —— 用户在设置里填一次。
       */
      async ready() {
        if (typeof credentials === 'function') return true;
        return Boolean(await readLab(ctx));
      },

      /** 登录态快照（不联网）。 */
      /**
       * **真的登录一次**，回答「这份账号现在能不能用」。
       *
       * # 为什么不能只读 status()
       *
       * `status()` 只读内存里的 token 快照，**不联网** —— 拿它当「检测连接」
       * 等于什么都没测。要让用户知道「账号对不对」，就得真去换一次 JWT。
       *
       * `fresh: true` 强制重登（不吃上次的 token），所以这一下确实打到了平台。
       *
       * @returns `{ ok, name?, role?, error? }`。
       */
      async verify() {
        try {
          const active = await client({ fresh: true });
          const auth = active?.auth;
          return {
            ok: true,
            loggedIn: true,
            configured: true,
            username: auth?.username ?? '',
            ...(auth?.name ? { name: auth.name } : {}),
            ...(auth?.role ? { role: auth.role } : {}),
          };
        } catch (error) {
          return {
            ok: false,
            loggedIn: false,
            configured: Boolean(await credentialsOf()),
            code: error?.code ?? 'FAILED',
            error: String(error?.message ?? error),
          };
        }
      },

      /**
       * 登录状态 + 是否配过账号。
       *
       * # 为什么要带上 `configured` / `username`
       *
       * 设置页要回答两个不同的问题：「配了没有」与「登上了没有」。
       * 只给 `loggedIn` 时，配过但还没登录会显示成「未配置」—— 用户会以为
       * 自己刚才那次保存没生效。这两个状态必须分开报。
       *
       * @returns `{ loggedIn, configured, username, ... }`。
       */
      async status() {
        const auth = cached?.auth;
        const account = await credentialsOf();
        const username = auth?.username ?? account?.username ?? '';
        return {
          loggedIn: Boolean(auth),
          configured: Boolean(account),
          username,
          ...(auth ? { name: auth.name, role: auth.role, expiresAt: auth.expiresAt } : {}),
        };
      },

      /** 清掉缓存（换账号、或用户点了「重新登录」）。 */
      reset() { cached = null; },

      /**
       * 清掉本地实验课会话（对应上游 `lab session logout`）。
       *
       * # 它清的是什么
       *
       * 平台发的 JWT 缓存在本机（`setSession` 注入的 `{load, save}`）。这个方法
       * 丢掉内存里的登录态**并**让持久化层丢掉磁盘上那份 —— 只清内存的话，
       * 下次 `restore()` 又会把同一个 token 读回来，「已退出」是假的。
       *
       * # 它不做什么
       *
       * 不向平台发请求（平台没有注销端点），也**不动凭据** —— 账号密码还在
       * 「设置 → 实验课平台」，用户要删的是那份记录。
       *
       * @returns `{ cleared: boolean }` —— 之前有没有可清的会话。
       */
      async logout() {
        const had = Boolean(cached?.auth ?? (session?.load?.()?.token));
        cached = null;
        if (session && typeof session.clear === 'function') await session.clear();
        else if (session && typeof session.save === 'function') await session.save(null);
        return { cleared: Boolean(had) };
      },

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

    const disposeService = ctx.provide('zwLab', service);

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
              logout: () => service.logout(),
              // 凭据读写（`auth: "own"`：实验课平台自己的账号，不经 CAS）
              verify: () => service.verify(),
              'save-account': () => service.saveAccount(input.input ?? {}),
              'clear-account': () => service.clearAccount(),
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
