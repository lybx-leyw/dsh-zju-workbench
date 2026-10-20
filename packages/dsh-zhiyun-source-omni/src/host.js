/**
 * 浙大校园数据源的**宿主半边**。
 *
 * # 这个包是什么（先读这段）
 *
 * 它是一个**数据包**，不是工具包。移植自 [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)
 * 的**数据层**（`auth/` + `core/` + `platforms/<平台>/{client,reads,parse}.ts`），
 * 补上本仓统一的 DSH 接入形状：
 *
 * ```
 *   上游：platforms/<平台>/tools.ts → app.ts → MCP server → AI 工具
 *   本仓：platforms/<平台>/reads.ts → 本文件 → connection 数据接口 → 页面 / 脚本 / 将来要接的 AI
 * ```
 *
 * 上游那半（MCP 工具注册）**已随移植删除**。理由不是它不好，而是它把「数据从哪来」
 * 和「谁来消费」绑在了一起：工具定义是面向某个具体客户端的适配，钉在包里，将来
 * 接页面时就得绕开它。数据层本身与消费方无关 —— 想当工具用、当页面数据源用、
 * 当脚本用，都是调用方的选择。
 *
 * # 暴露面
 *
 * 一个 `omni` 服务 + 一个同源数据路由（默认 `/api/zhiyun-omni`）：
 *
 *   GET  /api/zhiyun-omni            → 有哪些平台、每个平台有哪些可调用的方法
 *   POST /api/zhiyun-omni            → { method: 'zdbk.timetable', args: {...} }
 *
 * `method` 一律是 `<平台>.<函数名>`，函数名就是移植过来的读取器方法
 * （`zdbk.timetable` / `zdbk.grades` / `xzzd.assignments` / `cc98.hot` / `pta.problemSets` …）。
 * **不在这里逐个列举**：上游加平台、改方法名，这里不用跟着改；消费方用上面的
 * GET 自己发现即可。这正是「薄接入层」该有的样子。
 *
 * # 凭据
 *
 * Windows 上不能用上游的 macOS 钥匙串（见 `src/core/keychain.ts` 的文件头），
 * 本包改成了 **DPAPI**：密文落盘，只有同一台机器的同一 Windows 用户能解开。
 * 也可以用 `ZJU_USERNAME` / `ZJU_PASSWORD` 这类环境变量（优先级更高）。
 *
 * # 挂载失败不拦启动
 *
 * 整个 profile 里任何一条 bundle 抛错，起不来的是**整个工作台**
 * （CONTRIBUTING 3.1）。所以这里对上游代码的初始化一律「失败即降级 + 如实上报」，
 * 让用户至少还能打开其余页面。
 */

import path from 'node:path';

import { ALL_PLATFORMS, DEFAULT_PLATFORMS, loadConfig } from './core/config.ts';
import { createContext } from './core/context.ts';
import { createRuntime, PLATFORM_LABELS } from './platforms/index.ts';
import { authForget, authLogin, authStatus } from './auth/actions.ts';
import { safeError } from './core/errors.ts';
import * as cookiesModule from './core/cookies.ts';

export const name = 'zhiyun-omni';

/** 只硬依赖 `profileContext`（数据目录）。`connection` 走 `ctx.inject` 惰性取。 */
export const inject = ['profileContext'];

/**
 * 本包的数据路由。
 *
 * 用 `/api/` 前缀与本仓其他数据接口（`/api/zhiyun-study` 等）保持一致 ——
 * 它们都经宿主的 `connection` 走同一条受鉴权的通道，页面不必额外处理跨源。
 */
export const ROUTE_PATH = '/api/zhiyun-omni';

/** 平台读取器上不该被当作数据方法暴露的成员（内部工具函数）。 */
const INTERNAL_METHODS = new Set(['constructor', 'items', 'rows']);

/**
 * 把 `ZJU_PLATFORMS` 收敛到本包支持的平台。
 *
 * 默认值**不在这里写**：它住在 `core/config.ts` 的 `DEFAULT_PLATFORMS`（单一真源）。
 * 早先这里自持一份，与 config.ts 那份内容不同（少了 `zhiyun`），于是
 * 「默认到底启用哪些平台」有两个答案 —— 直接调 `loadConfig()` 的代码看到的是含
 * `zhiyun` 的那份，而经本文件启动的实例看到的是不含的那份。测试当场抓到了它。
 */
function resolvePlatforms(env) {
  const raw = String(env.ZJU_PLATFORMS ?? '').trim();
  if (raw) return raw; // 用户显式写了就照他的（含 zhiyun 也行）
  return DEFAULT_PLATFORMS.join(',');
}

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-omni] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  /**
   * 宿主凭据服务的读取器。
   *
   * 记录键是 `zhiyun-classroom/account` —— **写入方是课堂包**，因为「登录课堂」
   * 才是用户提供浙大账号的那个时刻。本包只读，不写：一个数据包不该替用户保存密码。
   *
   * @returns 读取器；宿主没装凭据服务时 null（退回本包自己的 DPAPI）。
   */
  const hostCredentials = () => ({
    /**
     * 每次调用**现取**凭据服务，不在 apply 时缓存。
     *
     * ⚠️ 这是踩过的坑：本包在 profile 里排在 `dsh-zhiyun-source-classroom` **之前**加载
     * （omni=5，classroom=7），而 `inject` 只等 `profileContext`。于是 apply 那一刻
     * `ctx.get('credentials')` 往往还是 undefined —— 把它缓存成 null 之后，即使
     * 用户后来登录了课堂、凭据已经写进 `.credentials.yaml`，本包也永远读不到，
     * 表现为「明明登录了却一直说未配置」。
     */
    async readAccount() {
      const service = ctx.get?.('credentials');
      if (!service || typeof service.readRecord !== 'function') return null;
      try {
        const record = await service.readRecord('zhiyun-classroom/account');
        if (!record || record.kind !== 'grant') return null;
        const { username, password } = record.payload ?? {};
        if (typeof username !== 'string' || !username) return null;
        if (typeof password !== 'string' || !password) return null;
        return { username, password };
      } catch {
        // 凭据存储读坏不该让数据包起不来，退回本包后端即可
        return null;
      }
    },
  });
  const warn = (message) => {
    const line = `[zhiyun-omni] ${message}`;
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(line);
    else console.warn(line);
  };

  const routePath = config.routePath ?? ROUTE_PATH;
  const status = { platforms: [], route: routePath, dataDir: null, ready: false, error: null };

  // 数据目录跟着 profile 走：与本仓其他包一致，也能跟着 profile 一起被备份/清理。
  const dataDir = config.dataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-omni');
  const env = {
    ...process.env,
    ZJU_OMNI_DATA_DIR: dataDir,
    ZJU_PLATFORMS: resolvePlatforms(process.env),
  };

  let runtime = null;
  let auth = null;
  try {
    const cfg = loadConfig(env);
    runtime = createRuntime(createContext(cfg, {
      env,
      // 从**宿主凭据服务**读浙大账号。写入方是 `dsh-zhiyun-source-classroom`（用户
      // 在「个人」页登录时写）。同一个账号因此只需要登录一次，规划页的学在浙大
      // 待办就能直接读到，不必再去终端跑 configure。
      hostCredentials: hostCredentials(),
    }));
    auth = { authStatus, authLogin, authForget };
    status.platforms = [...cfg.platforms];
    status.dataDir = cfg.dataDir;
    status.network = cfg.network;
    status.ready = true;
    log(`数据源就绪：${status.platforms.map((id) => PLATFORM_LABELS[id] ?? id).join('、')}（数据目录 ${cfg.dataDir}）`);
  } catch (error) {
    status.error = safeError(error);
    warn(`数据源初始化失败，本包降级为不可用：${error?.message ?? error}`);
  }

  /**
   * 列举每个平台可调用的数据方法。
   *
   * 从读取器的原型上取 —— 也就是说**上游新增方法会自动出现在这里**，不需要本文件
   * 维护一份清单（清单一定会漂）。
   */
  const describe = () => {
    const available = {};
    for (const id of ALL_PLATFORMS) {
      const reader = runtime?.[id]?.reader;
      if (!reader) continue;
      available[id] = {
        label: PLATFORM_LABELS[id],
        methods: Object.getOwnPropertyNames(Object.getPrototypeOf(reader))
          .filter((key) => !INTERNAL_METHODS.has(key) && typeof reader[key] === 'function')
          .sort(),
      };
    }
    return {
      ready: status.ready,
      route: routePath,
      dataDir: status.dataDir,
      network: status.network ?? null,
      platforms: available,
      note: '数据包：下面的方法可直接调用，也可由页面/AI 自行封装。凭据保存在本机（Windows 为 DPAPI）。',
    };
  };

  /**
   * 调一个数据方法。
   *
   * `method` 形如 `zdbk.timetable`。拆成平台与方法名后**只从读取器原型上取** ——
   * 不做任意属性访问（`__proto__` / `constructor` 之类一律拒绝），
   * 因为这条路由是给同源页面用的，不该成为一个能拨动进程内部对象的口子。
   */
  async function invoke(method, args, signal) {
    if (!runtime) throw new Error(`数据源不可用：${status.error?.message ?? '初始化失败'}`);
    if (typeof method !== 'string' || !method.includes('.')) throw new Error(`方法名格式应为「平台.函数」，收到：${String(method)}`);
    const [platform, fn] = method.split('.');
    if (!ALL_PLATFORMS.includes(platform)) throw new Error(`未知平台：${platform}`);
    if (!fn || INTERNAL_METHODS.has(fn)) throw new Error(`未知数据方法：${method}`);
    const reader = runtime[platform]?.reader;
    if (!reader) throw new Error(`${PLATFORM_LABELS[platform] ?? platform} 未启用（检查 ZJU_PLATFORMS）`);
    if (typeof reader[fn] !== 'function' || !Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(reader), fn)) {
      throw new Error(`未知数据方法：${method}`);
    }
    const call = () => reader[fn]({ ...(args ?? {}), signal });

    /**
     * **必须包在会话里**（`withSession`）。
     *
     * 读取器内部调 `client.json()` → `this.http()`，而 `http()` 从 AsyncLocalStorage
     * 取当前会话，取不到就抛「平台请求必须在会话内执行」。上游把每个读取方法都包在
     * `withSession(fn)` 里；移植时删掉工具层后这层包装的调用点一并丢了 ——
     * 表现为**所有平台读取都失败**，而错误信息看起来像配置问题，极难归因。
     *
     * 拼题A 不走 CAS，它用 Cookie，会话由 `importCookie` 直接写好，所以单独放行。
     */
    const client = runtime[platform]?.client;
    if (platform === 'pta' || typeof client?.withSession !== 'function') return await call();
    // 读操作 readOnly=true：拼题A 之外这些平台都是只读取数，不做 preflight，避免多发一次请求
    return await client.withSession(call, { readOnly: true });
  }

  /** 认证类动作：与数据方法同一条通道，但走 auth/*。 */
  async function authAction(action, args) {
    if (!auth) throw new Error('数据源不可用（认证模块未初始化）');
    if (action === 'status') return await auth.authStatus(runtime, args ?? {});
    if (action === 'login') return await auth.authLogin(runtime, args?.platform ?? 'xzzd');
    if (action === 'forget') return await auth.authForget(runtime, args ?? {});
    throw new Error(`未知认证动作：${String(action)}`);
  }

  // ── 数据路由 ────────────────────────────────────────────────────────
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const remove = scope.connection.fetch.register({
        path: routePath,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const send = (value, status = 200) =>
            Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
          try {
            if (request.method === 'GET') return send({ ok: true, value: describe() });
            const body = await request.json();
            // 与 study-core 同一套信封：{ type, rpcId, method, payload }
            if (body?.type !== 'client-request' || typeof body.rpcId !== 'string') {
              throw Object.assign(new Error('invalid envelope'), { code: 'INPUT' });
            }
            const payload = body.payload ?? {};
            const value = payload.auth
              ? await authAction(payload.auth, payload.args)
              : await invoke(payload.method, payload.args, request.signal);
            return send({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } });
          } catch (error) {
            return send({
              type: 'server-response',
              rpcId: typeof error?.rpcId === 'string' ? error.rpcId : 'invalid-request',
              result: { ok: false, error: { ...safeError(error), details: {} } },
            });
          }
        },
      });
      log(`数据路由：${routePath}`);
      return remove;
    }, 'zhiyun: omni data route');
  });

  /**
   * 拼题A 的**客户端级**动作。
   *
   * `invoke()` 只暴露读取器（reader）上的方法，因为那才是「数据方法」。但拼题A 有两件
   * 事不属于读取：`status()`（我这配了没）与 `importCookie()`（存一份 Cookie）。
   * 它们挂在上游的 `PtaClient` 上，不在 reader 上 —— 用 `invoke('pta.status')` 会得到
   * 「未知数据方法」。这里是给宿主侧（规划页）用的窄口子，只放这两个动作。
   */
  async function ptaAction(action, args = {}) {
    const client = runtime?.pta?.client;
    if (!client) throw new Error('拼题A 未启用（检查 ZJU_PLATFORMS）');
    if (action === 'status') return await client.status();
    if (action === 'importCookie') {
      const input = typeof args.input === 'string' ? args.input.trim() : '';
      if (!input) throw new Error('没有收到 Cookie 内容');
      return await client.importCookie(input);
    }
    throw new Error(`未知拼题A 动作：${String(action)}`);
  }

  /**
   * 注入 SSO 票根，供**复用已有登录态**的调用方使用（如规划页的会话桥接）。
   *
   * 背景：用户在工作台登录课堂后，`dsh-zhiyun-source-classroom` 已经握有 CAS 票根，而 omni
   * 有自己的一套凭据。把票根交给 omni 后，`casLogin` 能**不提交密码**就换出本平台的
   * 会话 —— 这是「用户已登录却被告知去终端配置账号」这个问题的正解。
   *
   * 只接受 `StoredCookie` 数组（`{name, value, domain, path, ...}`），不接受 Cookie 串：
   * 调用方必须已经解析过，本函数不做格式猜测。
   *
   * @param cookies - 票根数组。
   * @returns 实际接受的条数（`rememberSso` 只保留 zju 域的）。
   */
  function rememberSso(cookies) {
    if (!runtime) throw new Error(`数据源不可用：${status.error?.message ?? '初始化失败'}`);
    if (!Array.isArray(cookies) || cookies.length === 0) throw new Error('没有收到 SSO cookie');
    const { CookieJar } = cookiesModule;
    const jar = CookieJar.from(cookies);
    runtime.ctx.network.rememberSso(jar);
    return jar.list().length;
  }

  const removeService = ctx.provide('zhiyunOmni', {
    routePath,
    dataDir,
    // 直接暴露原始能力：宿主侧代码（其他插件、脚本）可以绕过 HTTP 层直接用。
    runtime: () => runtime,
    describe,
    invoke,
    pta: ptaAction,
    auth: authAction,
    /**
     * 立即登录某个平台。
     *
     * 单独暴露（而不是让调用方拼 `auth('login')`）是因为会话桥接要的语义很明确：
     * 「我给了票根，你去换会话」。authLogin 内部会走 withSession 与自动重登。
     *
     * @param platform - 平台 id，默认 xzzd。
     */
    login: async (platform = 'xzzd') => {
      if (!runtime || !auth) throw new Error('数据源不可用（认证模块未初始化）');
      return await auth.authLogin(runtime, platform);
    },
    rememberSso,
    status: () => status,
  });

  return () => {
    if (typeof removeService === 'function') removeService();
    runtime = null;
    auth = null;
  };
}
