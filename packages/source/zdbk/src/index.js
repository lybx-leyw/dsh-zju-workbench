/**
 * 教务数据源（`@lybx-leyw/dsh-zju-source-zdbk`）：成绩 / GPA / 考试安排 / 课表的**本仓原生实现**。
 *
 * # 这个包从哪来
 *
 * 它是 `dsh-zhiyun-source-omni` 的 `platforms/zdbk/` 拆出来的一份：omni 是从
 * [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni) 移植的 TypeScript，为 macOS 写的，
 * 现在还留着几处与本仓结构不合的地方（一次失败封锁 15 分钟、认证层自带 webvpn
 * 分支、凭据后端要 macOS 钥匙串）。拆包时按平台一份一份重写成本仓原生的纯 JS，
 * 教务这一份就是本文件所在的包。
 *
 * 拆分的**接口契约**（哪四个方法、四个接口路径、GPA 口径）来自 omni；
 * **HTTP、Cookie、会话落盘**换成本仓自己的共享层：
 *
 * ```text
 *   @lybx-leyw/dsh-zju-source-http   → Transport / SessionStore / ClassroomError
 *   @lybx-leyw/dsh-zju-source-login          → 「浙大一卡通」账号（只读）
 * ```
 *
 * # 与学在浙大（campus）唯一的实质差别：CAS 带不带 `service`
 *
 * 学在浙大**不用** `service`（CAS 把票种在 `zjuam` 域上，业务站自己认）；
 * 教务**必须**带（`/jwglxt` 等的是服务端回调 `login_ssologin.html`）。
 * 所以本包不 import campus 的登录链，自己实现 `cas.js` —— 详见该文件头。
 *
 * # 暴露面
 *
 * 一个 `zhiyunZdbk` 服务 + 一条同源数据路由（默认 `/api/zhiyun-zdbk`）：
 *
 * ```text
 *   GET  /api/zhiyun-zdbk   → 有哪些数据方法（自描述）
 *   POST /api/zhiyun-zdbk   → { type:'client-request', rpcId, method:'zdbk.timetable', payload:{…} }
 * ```
 *
 * `method` 一律是 `zdbk.<方法名>`。这是 omni 时代的调用口径，刻意保留：
 * 「今天」页与脚本里已经写着 `zdbk.timetable`，改名的收益不够抵一次全线改名。
 *
 * # 网络出口：走**共享出口**，自动分域
 *
 * 教务站是校园域（`zdbk.zju.edu.cn`），请求经 `sharedFetch(ctx)` 借
 * `@lybx-leyw/dsh-zju-source-http` 提供的 `zhiyunEgress` 服务：
 *
 *   - 境内直连（**绕开宿主为 LLM 配的全局代理** —— 浙大站点经代理基本必失败）；
 *   - 校内直连、校外自动绕 WebVPN；
 *   - campus 没装时退回 `globalThis.fetch`（直连，校外会失败但不会启动报错）。
 *
 * 出口**只有一份**（所有权在 campus）。若本包自己再登录一次 WebVPN，
 * 会把 campus 那份会话踢掉 —— 与 CAS 双登录是同一类事故。
 */

import path from 'node:path';
import { createHash } from 'node:crypto';

import { Transport, SessionStore, sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import { readCard } from '@lybx-leyw/dsh-zju-source-login';

import { createZdbkWrites } from './writes.js';
import { ZdbkClient } from './client.js';
import { ZdbkReader } from './reads.js';
import { casLogin } from './cas.js';
import { ZDBK_BASE, ZDBK_HOST, ZDBK_HOSTS, ZDBK_PATHS } from './hosts.js';
import { ZdbkError, fault } from './errors.js';

export const name = 'zhiyun-zdbk';

/** 只硬依赖 `profileContext`（数据目录）。`connection` 走 `ctx.inject` 惰性取。 */
export const inject = ['profileContext'];

/** 本包的数据路由。与 campus 的 `/api/zhiyun-campus` 并列，互不干扰。 */
export const ROUTE_PATH = '/api/zhiyun-zdbk';

export { ZdbkClient } from './client.js';
export { ZdbkReader } from './reads.js';
export {
  ZDBK_HOST, ZDBK_BASE, ZDBK_HOSTS, ZDBK_PATHS, ZDBK_MODULES, ZDBK_PLAN_PATHS,
  ZDBK_SELECTION_PATHS, ZDBK_SERVICE, ZDBK_CAS_ENTRY, CAS_HOST, planPdfUrl,
} from './hosts.js';
export {
  TERMS, PERIOD_TIMES, checkAcademicYear, courseCodeOfKey, currentTerm, gpaOf, parseExamTime,
  parseExams, parseGrade, parseSession, semesterOfCourseKey, semesterOfTerm, termCode,
} from './parse.js';
export { PLAN_PAGE_SIZE, parsePlan, splitCourses } from './plan.js';
export {
  SELECTION_SEARCH_FIELDS, SELECTION_SEARCH_OPERATORS, assertSelectionTerm, courseView,
  decodeEntities, flatten, ownedView, parseCapacity, parseMyPlan, parseSelectionContext,
  parseSelectionInputs, parseSelectionRow, preferenceGroup, sectionView, selectionPageForm,
  selectionSearchForm, selectionState,
} from './selection.js';
export {
  authUrlGuard, casForm, casLogin, describeAuthFailure, encryptCasPassword, hasCasForm,
} from './cas.js';

/**
 * 本包的统一错误形状。
 *
 * 定义在 `src/errors.js`（读取层也要抛它，反向 import `index.js` 会成环）。
 * 这里原样再导出一次：对外的 `ZdbkError` / `fault` 身份不变。
 */
export { ZdbkError, fault };

/**
 * 对外暴露的数据方法（`zdbk.<key>` → 读取器上的同名方法）。
 *
 * ⚠️ **必须是一张写死的表**，不能从读取器原型上现取。这条路由是给同源页面用的，
 * 原型上还有 `constructor` / `rows` / `items` / `selectionPages`，现取就等于让调用方能拨动
 * 内部对象（omni 的测试里专门钉过这一条）。
 *
 * 插入顺序即 `describe()` 里列举的顺序 —— 用数组而不是 Set，
 * 是为了让「暴露面」这件事在自描述里也是稳定的。
 *
 * # 17 条上游 provides 在这一张表里的位置
 *
 * | 上游 | 本表 | 说明 |
 * | --- | --- | --- |
 * | `zdbk timetable/exams/grades` | `timetable` / `exams` / `grades` | 已有 |
 * | `zdbk plan view` | `planView` | 本次新增 |
 * | `zdbk plan list` | `planList` | 本次新增 |
 * | `zdbk selection context/courses/search/sections/selected/credits` | 同名 camelCase | 本次新增 |
 * | `zdbk selection select/reorder/drop` | **不在这张表里** | 写操作，归 `packages/tool/campus-write` |
 * | `zdbk session login/status/logout` | 服务面 `login` / `status` / `logout` | 已有（见下面的服务） |
 *
 * ⚠️ 方法名与路由 `action` 名必须**同一份**（`READ_METHODS` 只有一个来源），
 * 这里曾经出过错：表里叫 `selectionContext`、文档里写 `selection.context`，
 * 于是「文档能用、代码报 INVALID_METHOD」。
 */
const READ_METHODS = [
  'grades', 'gpaSummary', 'exams', 'timetable',
  'planList', 'planView',
  'selectionContext', 'selectionCourses', 'selectionSearch',
  'selectionSections', 'selectionSelected', 'selectionCredits',
];

/** 每个方法接受哪些参数（只做说明，不参与校验）。 */
const ARGS_OF = {
  grades: { academic_year: '2025-2026', semester: 1, major_only: false },
  gpaSummary: {},
  exams: { academic_year: '2025-2026', semester: 1, upcoming_only: false },
  timetable: { academic_year: '2025-2026', term: '秋' },
  planList: { year: '2025', college: '计算机', major: '软件工程' },
  planView: { year: '2025', major: '软件工程' },
  selectionContext: {},
  selectionCourses: { category: 'xk_1', name: '通识核心课程' },
  selectionSearch: { keyword: '高等数学', field: 'kcmc', only_available: false },
  selectionSections: {
    course: 'CS1001G', pool: '(2025-2026-1)-CS1001G-0012345-1', category: 'xk_1',
  },
  selectionSelected: { with_credits: true },
  selectionCredits: {},
};

/**
 * 把错误收成 `{ code, message }`。
 *
 * @param {unknown} error - 任意错误。
 * @returns {{code: string, message: string}} 页面能直接显示的形状。
 */
export function toError(error) {
  return { code: error?.code ?? 'ZDBK_FAILED', message: String(error?.message ?? error) };
}

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-zdbk] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  const dataDir = config.dataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-zdbk');

  /* ── 会话存储 ───────────────────────────────────────────────────────
   * 与 campus 的三个 jar 分开存：教务的会话是**自己的** `JSESSIONID`，
   * 混在一个文件里会让「清除教务会话」顺手动掉学在浙大的登录态。
   *
   * `protect` 必须可注入：单测与 CI 里不能碰 DPAPI（它会 spawn 一个 PowerShell 子进程，
   * 而本机沙箱禁止 spawn）。
   */
  const session = new SessionStore({ file: path.join(dataDir, 'zdbk.session'), protect: config.protect });

  // Loading is shared: 并发的页面请求不能在别人的请求正往 jar 里塞 cookie 时把它换掉。
  let loadTask;
  const ensureSession = () => (loadTask ??= session.load());

  /**
   * 本包的 `fetch`。
   *
   * `config.fetch` 是测试注入口 —— 单测注入假 fetch 时不该真的发网络请求。
   *
   * 生产路径走**共享出口**（`zhiyunEgress`，由 `@lybx-leyw/dsh-zju-source-http` 提供）：
   * 教务站是校园域，自动出口会在校内直连、在校外绕 WebVPN，并且**绕开宿主为
   * LLM 配的全局代理**（浙大站点经那个代理基本必失败）。
   *
   * `sharedFetch` 是惰性的：每次请求时才查服务，所以 campus 晚于本包装配也没关系。
   * 拿不到服务（没装 campus）时退回 `globalThis.fetch` —— 直连，校外会失败，
   * 但至少不会把"没装包"变成启动错误。
   */
  const fetcher = typeof config.fetch === 'function' ? config.fetch : sharedFetch(ctx);

  /**
   * 建一个只作用于本包的 Transport。
   *
   * ⚠️ **必须显式传 `hosts`**。`Transport` 的默认白名单是智云课堂那一套，
   * 里面**没有** `zdbk.zju.edu.cn`；而它只在主机命中白名单时才读写 cookie。
   * 漏传的后果不报错：请求一个 cookie 都不带、回来的 `Set-Cookie` 也一个都不存 ——
   * 登录「成功」，会话永远是空的，下一次读立刻回到未登录。
   */
  const transportFor = () => new Transport({
    session,
    fetch: fetcher,
    timeoutMs: config.timeoutMs ?? 20000,
    hosts: ZDBK_HOSTS,
    referer: ZDBK_BASE,
    log: config.verbose ? (entry) => log(`${entry.method} ${entry.host}${entry.path} → ${entry.status}`) : undefined,
  });

  /**
   * 取「浙大一卡通」账号。**每次现读，不缓存**。
   *
   * 凭据服务可能晚于本包就绪（profile 里 zdbk 排在 card 之前是常态），
   * 把 null 缓存下来的后果是「配了也一直说没配」。
   */
  const accountOf = async () => readCard(ctx);

  /**
   * 会话看起来还在吗（只看 cookie，不发请求）。
   *
   * 判据是 `JSESSIONID`：教务的会话就是这个 cookie。只有 CAS 票不算 ——
   * 那只说明统一认证那边有票，不代表 `/jwglxt` 认你。
   */
  const hasSession = async () => {
    await ensureSession();
    try {
      const cookies = await session.jar.getCookies(`${ZDBK_BASE}/`);
      return cookies.some((cookie) => cookie.key === 'JSESSIONID' && cookie.value);
    } catch {
      return false;
    }
  };

  /**
   * 确保有可用会话；没有就登一次。
   *
   * ⚠️ **不缓存失败**。omni 那边一次失败会封锁 15 分钟，于是网络抖动被放大成
   * 「半天用不了」。这里失败就是这一次失败 —— 下次调用照常再试，因为下一次的
   * 凭据与网络可能已经好了。
   *
   * @param {boolean} [force] - 强制重登（会话被服务端判失效时用）。
   * @returns {Promise<Transport>} 可用的传输层。
   */
  const openTransport = async (force = false) => {
    await ensureSession();
    const transport = transportFor();

    /* ── 先判「还是不是同一个人」，再决定要不要复用会话 ──────────────
     *
     * ⚠️ 顺序不能反。这里曾经是「先 `hasSession()` 命中就直接 return」，
     * 账号变更的检查写在后面 —— 于是用户改了「浙大一卡通」之后，
     * **旧会话仍然会被直接拿去读数据**，把上一个人的成绩读给现在的人看。
     * 会话文件里没有账号绑定信息（`accountKey` 只有在我们自己写入时才有），
     * 所以这里改为「先读凭据 → 身份一致才复用」，代价是一次凭据读取（本地操作）。
     */
    const account = await accountOf();
    const identity = account ? createHash('sha256').update(account.username).digest('hex') : null;
    const switched = Boolean(identity && session.accountKey && session.accountKey !== identity);

    // 有会话且身份没变就直接用：CAS 单点会话下，同号再登一次会**作废前一张票**，
    // 也就是"为了让别处失效而把自己踢下线"。能不重登就不重登。
    if (!force && !switched && await hasSession()) return transport;

    if (!account) {
      throw fault('NEED_LOGIN', '还没配「浙大一卡通」账号：去「设置 → 浙大一卡通」填一次学号和密码，教务、学在浙大与智云课堂共用这一份。');
    }
    // 换账号时**必须先把 jar 清空**：留着上一个人的 CAS 票，登录会直接
    // 用那张票换出**上一个人**的教务会话。
    if (switched) {
      await session.clear();
      log('账号已变更，旧教务会话已清除');
    }
    try {
      await casLogin(transport, {
        hosts: [ZDBK_HOST],
        upgradeHttpHosts: [ZDBK_HOST],
        credentials: async () => account,
        signal: config.signal,
      });
      session.accountKey = identity;
      await session.save();
      log('教务会话已建立');
      return transport;
    } catch (error) {
      // 错误码必须能被页面分派：CAS 拒绝要能和网络问题分开（前者用户改密码，
      // 后者只需重试；验证码/二次验证则要求人工介入）。
      const code = error?.code === 'AUTH_REJECTED' || error?.code === 'CREDENTIALS' ? 'NEED_LOGIN'
        : error?.code === 'NETWORK' || error?.code === 'TIMEOUT' || error?.code === 'AUTH_NETWORK_ERROR' ? 'UNREACHABLE'
          : error?.code ?? 'LOGIN_FAILED';
      if (code === 'NEED_LOGIN') {
        // 只在站点明确写出错误文案时转述那句话，否则如实说"没给原因" ——
        // 把网络失败一律说成密码错，会把用户赶去反复改一个正确的密码。
        throw fault(code, `浙大统一身份认证没有接受这次登录：${error?.message ?? '站点未给出原因'}`
          + ' 如果这句话确实是"用户名或密码错误"，去「设置 → 浙大一卡通」改一次；否则先看网络与出口。');
      }
      throw fault(code, error?.message ?? String(error));
    }
  };

  /**
   * 登录串行化。
   *
   * 并发的页面请求若各自登一次，第二个 POST 会作废第一个刚拿到的票 ——
   * 表现是"偶尔能读、偶尔又未登录"。所以同一时刻只跑一条认证任务。
   */
  let authTask = null;
  const transport = async (force = false) => {
    if (authTask) return authTask;
    const task = openTransport(force);
    authTask = task;
    try { return await task; } finally { if (authTask === task) authTask = null; }
  };

  /**
   * 读一次数据；会话被判失效时**重登一次再读**，不递归。
   *
   * 为什么允许重登一次：教务的 `JSESSIONID` 会过期（或在别处登录后被作废），
   * 而 CAS 票通常还在 —— 重登能把用户从"永远读不到"里救出来。
   * 为什么只一次：再失败就是真的有问题（权限、页面结构），重试只会把同一次
   * 失败打两遍。
   *
   * @param {(api: ZdbkClient) => Promise<any>} run - 实际读取动作。
   * @returns {Promise<any>} 读取结果。
   */
  const readWithRetry = async (run) => {
    const client = (current) => new ZdbkClient(current, { signal: config.signal, retryDelayMs: config.retryDelayMs });
    try {
      return await run(client(await transport()));
    } catch (error) {
      if (error?.code !== 'LOGIN_REQUIRED') throw error;
      return run(client(await transport(true)));
    }
  };

  /**
   * 建一个读取器。
   *
   * ⚠️ 每次现建而不是 apply 时建一个：读取器本身无状态，但它内部持有
   * 一个 `ZdbkClient`，而客户端绑定的是「这一次登录拿到的 Transport」。
   * 把读取器缓存下来，重登之后它还会用旧 jar 发请求。
   */
  const readerOf = (api) => new ZdbkReader(api, config.now ?? (() => new Date()));

  /**
   * 写操作集合（Prepare 与 Execute 共用同一份）。
   *
   * # 为什么不能每次新建 reader
   *
   * 写会话把 Prepare 算好的表单存在 reader 的闭包里，Execute 要取同一份。
   * 若两个方法各调一次 `readerOf()`，Execute 会拿到空会话并报 `NEED_PREPARE` ——
   * 看起来像「用户没批准」，实际是接线错了。
   *
   * 缓存键是 `api` 实例：换账号 / 会话重置后重新建，不会把旧会话带过去。
   */
  let writesCache = null;
  const writes = async () => {
    const api = new ZdbkClient(await transport(), {
      ...(config.retryDelayMs !== undefined ? { retryDelayMs: config.retryDelayMs } : {}),
    });
    if (!writesCache || writesCache.api !== api) {
      writesCache = { api, list: createZdbkWrites(readerOf(api)) };
    }
    return writesCache.list;
  };

  /**
   * 一次「登录 + 真读一次」的登录验证。
   *
   * 为什么不靠 CAS 的状态码：CAS 登成功不等于 `/jwglxt` 认你（回调可能没走完）。
   * 唯一有证据的判据是**真的读一次业务接口**。这里读一条成绩（`showCount=1`），
   * 代价一个请求，换来「已登录」这个结论是可信的。
   *
   * @returns {Promise<boolean>} 会话是否真的可用。
   */
  const verify = async () => {
    const api = new ZdbkClient(await transport(true), { signal: config.signal });
    try {
      const data = await api.post(ZDBK_PATHS.grades, { query: { doType: 'query', 'queryModel.showCount': 1 } });
      if (!data || !Array.isArray(data.items)) throw new ZdbkError('SCHEMA_CHANGED', '教务接口没有返回 items 数组。');
      return true;
    } catch (error) {
      if (error?.code === 'LOGIN_REQUIRED' || error?.code === 'SCHEMA_CHANGED') {
        throw fault('ZDBK_AUTH_UNVERIFIED', '统一认证流程结束，但教务系统接口尚未确认登录。', { cause: error.code });
      }
      throw error;
    }
  };

  /**
   * 自描述：有哪些数据方法。
   *
   * 页面与脚本先用它发现能力，不在别处维护第二份清单 —— 清单一定会漂。
   */
  const describe = () => ({
    route: ROUTE_PATH,
    platform: 'zdbk',
    label: '教务系统',
    dataDir,
    methods: READ_METHODS.map((key) => ({ method: `zdbk.${key}`, args: ARGS_OF[key] })),
    note: '教务数据（成绩/GPA/考试/课表/培养方案/选课查询）。只读；选课的选/退/排序是写操作，归 packages/tool/campus-write。凭据与学在浙大共用一份「浙大一卡通」；会话保存在本机。',
  });

  /**
   * 调一个数据方法。
   *
   * `method` 形如 `zdbk.timetable`。只认 `READ_METHODS` 这张写死的表 ——
   * 不做任意属性访问（`__proto__` / `constructor` 之类一律拒绝），
   * 因为这条路由是给同源页面用的，不该成为能拨动进程内部对象的口子。
   *
   * @param {unknown} method - 方法名。
   * @param {object} args - 参数。
   * @returns {Promise<any>} 数据。
   */
  const invoke = async (method, args = {}) => {
    if (typeof method !== 'string' || !method.startsWith('zdbk.')) {
      throw fault('INVALID_METHOD', `方法名格式应为「zdbk.函数」，收到：${String(method)}`);
    }
    const key = method.slice('zdbk.'.length);
    if (!READ_METHODS.includes(key)) throw fault('INVALID_METHOD', `未知数据方法：${String(method)}`);
    // 参数只接受普通对象：数组会被展开成 `0/1/…` 这些奇怪的关键字传进读取器。
    const safe = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    return readWithRetry((api) => readerOf(api)[key](safe));
  };

  // ── 数据路由 ────────────────────────────────────────────────────────
  //
  // 走宿主的 `connection.fetch`（与 study / vault / notes 同一条受鉴权通道），
  // 不用裸 `webServer`：页面不必处理跨源，也不会多开一个只靠回环地址防护的口子。
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const remove = scope.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const send = (value, status = 200) =>
            Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
          let rpcId = 'invalid-request';
          try {
            if (request.method === 'GET') return send({ ok: true, value: describe() });
            const body = await request.json();
            // 与 study / vault / notes 同一套信封：{ type, rpcId, method, payload }
            if (body?.type !== 'client-request' || typeof body.rpcId !== 'string') {
              throw Object.assign(new Error('invalid envelope'), { code: 'INPUT' });
            }
            rpcId = body.rpcId;
            // `method` 既接受顶层（本包约定的形态），也接受 `payload.method`
            // （omni 时代的口径）—— 两种信封都已在用的调用方不该为一个字段改名。
            const method = typeof body.method === 'string' ? body.method : body.payload?.method;
            const args = body.payload?.args ?? (body.method ? body.payload : undefined) ?? {};
            const value = await invoke(method, args);
            return send({ type: 'server-response', rpcId, result: { ok: true, value } });
          } catch (error) {
            return send({
              type: 'server-response',
              rpcId,
              result: {
                ok: false,
                error: { code: error?.code ?? 'ZDBK_FAILED', message: String(error?.message ?? error), details: error?.details ?? {} },
              },
            });
          }
        },
      });
      log(`数据路由：${ROUTE_PATH}（会话 ${dataDir}）`);
      return remove;
    }, 'zhiyun: zdbk data route');
  });

  /**
   * 服务面：给宿主侧代码（别的插件、脚本）绕过 HTTP 层直接用。
   *
   * # `session status` / `session logout` 的落点
   *
   * 上游把登录态做成三条 `zdbk session …` provides。本包对应的是下面三样：
   *
   *   - `login()` —— 真登一次并读一次业务接口（`verify`）；
   *   - `status()` —— **不联网**，只看磁盘上那份会话；
   *   - `logout()` —— 清掉本地会话文件。
   *
   * 它们**不在 `READ_METHODS` 里**，因为那张表走的是「每次调用都读一次业务数据」
   * 那条链（`readWithRetry` + 新建客户端）。登录态没有业务数据可读，硬塞进去
   * 会让「查登录状态」触发一次 CAS 登录 —— 那正好是这条接口要避免的事。
   */
  const removeService = ctx.provide('zhiyunZdbk', {
    routePath: ROUTE_PATH,
    platform: 'zdbk',
    label: '教务系统',
    // 本包含写方法（选课 / 退课 / 调整志愿顺序），如实标 false。
    readOnly: false,
    methods: READ_METHODS.map((key) => `zdbk.${key}`),
    /** 写方法名（成对出现），与只读 `methods` 分开列。 */
    writeMethods: ['zdbk.selectCoursePrepare', 'zdbk.selectCourseExecute',
      'zdbk.dropCoursePrepare', 'zdbk.dropCourseExecute',
      'zdbk.reorderCoursePrepare', 'zdbk.reorderCourseExecute'],
    describe,
    invoke,
    /* ── 上游 5 + 6 条只读 provides ── */
    grades: (filter = {}) => invoke('zdbk.grades', filter),
    gpaSummary: () => invoke('zdbk.gpaSummary'),
    exams: (filter = {}) => invoke('zdbk.exams', filter),
    timetable: (args = {}) => invoke('zdbk.timetable', args),
    planList: (options = {}) => invoke('zdbk.planList', options),
    planView: (options = {}) => invoke('zdbk.planView', options),
    selectionContext: () => invoke('zdbk.selectionContext'),
    selectionCourses: (options = {}) => invoke('zdbk.selectionCourses', options),
    selectionSearch: (options = {}) => invoke('zdbk.selectionSearch', options),
    selectionSections: (options = {}) => invoke('zdbk.selectionSections', options),
    selectionSelected: (options = {}) => invoke('zdbk.selectionSelected', options),
    selectionCredits: () => invoke('zdbk.selectionCredits'),

    /**
     * 写操作的两个方法。
     *
     * `prepare` 算参数与说明，`execute` 才发请求。**审批不在这里** ——
     * 那是 `packages/tool/campus-write` 的事。
     *
     * 与服务面其它方法一样经 `invoke` 风格的惰性取服务：`reader` 在登录后才有，
     * 而写会话要挂在**同一个** reader 上（Prepare 存的参数 Execute 要用）。
     */
    selectCoursePrepare: async (input) => (await writes()).selectCourse.prepare(input),
    selectCourseExecute: async (signal) => (await writes()).selectCourse.execute(signal),
    selectCourseCancel: async () => (await writes()).selectCourse.cancel(),
    dropCoursePrepare: async (input) => (await writes()).dropCourse.prepare(input),
    dropCourseExecute: async (signal) => (await writes()).dropCourse.execute(signal),
    dropCourseCancel: async () => (await writes()).dropCourse.cancel(),
    reorderCoursePrepare: async (input) => (await writes()).reorderCourse.prepare(input),
    reorderCourseExecute: async (signal) => (await writes()).reorderCourse.execute(signal),
    reorderCourseCancel: async () => (await writes()).reorderCourse.cancel(),

    /* ── 会话（对应上游 zdbk session login / status / logout） ── */
    /** 会话是否看起来还在（只看 cookie，不发请求、不登录）。 */
    hasSession,
    /**
     * 登录态快照（**不联网**）。
     *
     * 与 `hasSession()` 的差别：那个只回答「jar 里有没有 JSESSIONID」，
     * 这个还带上账号与会话文件位置 —— 页面上的「连接状态」用它更好，因为它能
     * 区分「从没登录过」和「登录过、但凭据被清掉了」。
     *
     * ⚠️ **不许为它发请求**。`shared Source http` 的 `SessionStore` 没有 `status()`，
     * 过期判断要读文件时间 —— 那件事由 `hasSession()`（读 jar）+ 文件是否存在回答。
     *
     * @returns {Promise<object>} 会话快照。
     */
    status: async () => {
      const present = await hasSession();
      const account = await accountOf().catch(() => null);
      return {
        logged_in: present,
        account_known: Boolean(account),
        account: account?.username ?? null,
        session_file: session.file ?? null,
        using_cached_session: present,
        note: '只看本机会话文件与 cookie，不联网。logged_in=false 时下一次读取会自动走一次 CAS 登录。',
      };
    },
    /** 强制走一次完整登录 + 业务验证（对应上游 `zdbk session login`）。 */
    login: async (options = {}) => {
      const force = options.fresh !== false;
      if (force) await session.clear().catch(() => {});
      const ok = await verify();
      return { logged_in: ok, forced: force };
    },
    /**
     * 清掉本地会话（对应上游 `zdbk session logout`）。
     *
     * **不碰凭据**：密码在「设置 → 浙大一卡通」，这里只是丢掉磁盘上的会话，
     * 下次调用会重新走 CAS。
     *
     * ⚠️ 必须 `persist: true`（立即落盘）。`SessionStore.clear()` 默认是**延迟**
     * 落盘的（为了登录前那次清空不必白等一次 DPAPI 子进程）；登出若也跟着延迟，
     * 进程恰好退出时磁盘上的旧会话就会**复活** —— 那是安全问题，不是性能问题。
     *
     * @returns {Promise<{cleared: boolean}>} 清完的结论。
     */
    logout: async () => {
      try {
        await session.clear({ persist: true });
      } catch (error) {
        throw fault('LOGOUT_FAILED', `清除本地教务会话失败：${String(error?.message ?? error)}`);
      }
      loadTask = undefined;
      return { cleared: true };
    },
    /** 建一个读取器（调用方自己拿去用，不再经过路由）。惰性 —— 取它不会触发登录。 */
    reader: async (options = {}) => readerOf(new ZdbkClient(await transport(), { ...options, signal: config.signal })),
  });

  return async () => {
    // 摘服务：反过来的话，卸载窗口里打进来的请求会一直走到一个已注销的服务上。
    if (typeof removeService === 'function') removeService();
  };
}
