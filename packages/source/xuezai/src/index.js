/**
 * 学在浙大数据源（`@lybx-leyw/dsh-zju-source-xuezai`）。
 *
 * # 这个包从哪来
 *
 * 它是从 `@lybx-leyw/dsh-zju-source-campus` **拆出来**的，不是新建。
 * 那个包原先同时装着两个平台（学在浙大 + 拼题A），两者的凭据体系、
 * 错误码表、会话文件、写入面都不一样，却共用一份 `apply()`、一条路由、
 * 一个 `zhiyunCampus` 服务：
 *
 *   - 装拼题A 就得连带装上学在浙大的整套 CAS 与逐课抓取；
 *   - 任何一方要加能力，都得改同一个 924 行的 `index.js`；
 *   - `dsh.capability` 只能写一份（`auth` / `network` / `writes` 都是并集）。
 *
 * 现在两边各是各的包。本包只做**学在浙大**；拼题A 在
 * `@lybx-leyw/dsh-zju-source-pta`。
 *
 * # 本包提供什么（D17：数据源只读）
 *
 * 一个 `zhiyunXuezai` 服务 + 一条同源路由 `/api/zhiyun-xuezai`。
 * **不含任何写操作** —— 提交作业、撤回、点名签到那些按 D17 归
 * `packages/tool/campus-write`，本包的方法全部只发 GET。
 *
 * # 与上游 `vendor/zju-assistant/core/zju/lib/xuezai/` 的关系（如实陈述）
 *
 * | | 上游 | 本包 |
 * | --- | --- | --- |
 * | 出身 | 独立实现，`writes: true`，18 条 provides | **本仓原生实现**，从 campus 拆出 |
 * | 代码来源 | 自己的 `client.ts` / `homework.ts` … | 本仓的 `xzzd.js` + `xzzd-reads.js`，与上游无复制关系 |
 * | 接口契约 | 对公开网页与其 XHR 的观察 | 同一批端点（本仓 Flutter 版实测口径） |
 * | 覆盖 | 待办 / 课程 / 材料 / 作业 / **提交 / 撤回 / 点名** | 待办 / 深入读取（活动、作业、课件、我的提交），**不含写** |
 *
 * 也就是说：本包**不是上游的移植**，两边是各自独立实现——
 * 只是对着同一个平台、同一批端点。能力差集见 `README.md` 的「上游覆盖度」。
 *
 * # 登录
 *
 * 学在浙大要的是浙大统一身份认证（CAS），账号与智云课堂共用同一份
 * 「浙大一卡通」凭据。凭据的**读取**在 `@lybx-leyw/dsh-zju-source-login`，
 * CAS 流程在本包 `src/cas/login.js`（从 campus 逐字搬来，只改了 import 路径）。
 */

import path from 'node:path';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { Transport, SessionStore, sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import { readCard } from '@lybx-leyw/dsh-zju-source-login';

import { sharedRead } from './reads.js';
import { xzzdLogin } from './cas/login.js';
import { XzzdApi, hasXzzdSession, diffTodos } from './xzzd.js';
import { XzzdReader } from './xzzd-reads.js';
import { createXuezaiWrites } from './writes.js';
import { XZZD_BASE, CAS_HOST, XUEZAI_HOSTS } from './hosts.js';

export const name = 'zju-source-xuezai';

/** 只硬依赖 `profileContext`（数据目录）。凭据走 `ctx.get('credentials')` 惰性取。 */
export const inject = ['profileContext'];

/** 本包的数据路由。与 pta / campus 的路由并列，互不干扰。 */
export const ROUTE_PATH = '/api/zhiyun-xuezai';

/**
 * 写操作必须带的自定义头（跨站发不出，等于 CSRF 闸）。
 *
 * `xzzd-read` 虽然是只读，但它带 id 参数、且响应里有作业说明原文，
 * 所以照样走 POST + 自定义头，不塞进查询串（查询串会进代理日志与 Referer）。
 */
export const WRITE_HEADER = 'x-zhiyun-xuezai';

/**
 * 路由的 service 名。
 *
 * 与包名分开的常量：页面/脚本按**服务名**取能力，改名会让它们静默拿不到。
 */
export const SERVICE_NAME = 'zhiyunXuezai';

/** 重新导出，供别处（脚本/测试）直接构造。 */
export { XzzdApi, XzzdReader, hasXzzdSession, diffTodos };

/**
 * `xzzdRead` 认识的读取动作。
 *
 * 导出而不是写在闭包里：工具层与测试都要能回答「这个 source 能读什么」，
 * 而答案只有一个来源才不会漂。
 */
export const XZZD_READ_ACTIONS = Object.freeze([
  'courses', 'courseBundle', 'activities', 'assignments', 'activity', 'materials', 'submission', 'rollcallHistory',
]);
export { XZZD_BASE, XZZD_HOST, CAS_HOST, XUEZAI_HOSTS } from './hosts.js';

/**
 * 本包的统一错误形状。
 *
 * 与 `ClassroomError` 的区别：本包的 `fault()` 只用于**本包自己产生**的错
 * （配置缺失、参数非法、动作名未知）。从 `Transport` / `XzzdApi` 上来的错误
 * 保持原样（它们自带 code 与 details），最后统一经 `translateXzzdError()`
 * 翻成能上屏的一句。
 */
export class XuezaiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'XuezaiError';
    this.code = code;
  }
}

/** 造一个 XuezaiError。 */
export const fault = (code, message) => new XuezaiError(code, message);

/**
 * 学在浙大的错误码 → 用户能照做的**唯一**一张表。
 *
 * # 为什么这张表必须跟着数据源走
 *
 * 它原来长在 `page-planning/src/index.js`（`translateXzzdError`），后来搬进
 * campus 的 `index.js`。两处都错过同一件事：文案指向的是**凭据写入口**
 * （「设置 → 浙大一卡通」），写入口改名或搬家时，抄出去的那份不会跟着改 ——
 * 用户会被指向一个不存在的设置项。
 *
 * 所以翻译跟着数据源走：下游拿到 `NEED_LOGIN` 时 `message` 已经是能直接上屏
 * 的一句，不需要再映射一次。
 *
 * @param error - 任意 `{ code, message }`。
 * @returns `{ code, message }`，或 null。
 */
export function translateXzzdError(error) {
  if (!error) return null;
  const code = error.code ?? 'XZZD_FAILED';
  const message = typeof error.message === 'string' ? error.message : String(error.message ?? code);
  // 本包自己给出的指引已经指向「设置 → 浙大一卡通」时原样透传 ——
  // 用旧文案盖掉它，等于把上游修好的话又改回错的。
  if (message.includes('浙大一卡通')) return { code: 'NEED_LOGIN', message };
  if (code === 'NEED_LOGIN' || code === 'CONFIGURATION_REQUIRED' || code === 'LOGIN_REQUIRED') {
    return {
      code: 'NEED_LOGIN',
      message: '还没配置「浙大一卡通」：去「设置 → 浙大一卡通」填一次学号和密码，学在浙大与智云课堂会共用这一份。',
    };
  }
  if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTH_CHALLENGE_REQUIRED' || code === 'SESSION_EXPIRED') {
    return {
      code: 'NEED_LOGIN',
      message: '「浙大一卡通」的登录态已过期：去「设置 → 浙大一卡通」核对一次密码，课堂与学在浙大会各自重新登录。',
    };
  }
  // WebVPN 相关：出口层给的文案里已经写了「去配上网账号」，原样透传。
  if (String(code).startsWith('WEBVPN')) return { code: 'WEBVPN', message };
  if (code === 'UNREACHABLE' || code === 'NETWORK' || code === 'TIMEOUT' || code === 'WEBVPN') {
    return { code: 'UNREACHABLE', message };
  }
  return { code, message };
}

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文。
 * @param config - `{ dataDir, legacyDataDir, fetch, timeoutMs, readTtlMs, networkMode, verbose, protect }`。
 * @returns 卸载函数。
 */
export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-xuezai] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  const dataDir = config.dataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-xuezai');

  /**
   * 旧会话目录：`source/campus` 时期的学在浙大会话文件。
   *
   * # 为什么要迁
   *
   * 拆包前，学在浙大的 `session` cookie 落在
   * `data/zhiyun-campus/xzzd.session`（DPAPI 加密、按 Windows 用户绑定）。
   * 拆包后如果只认新目录，**所有已有用户会在升级那一刻被踢下线**，
   * 必须重新输一次密码 —— 而他们并没有改过密码。
   *
   * 所以这里做一次性搬移：新文件不存在、旧文件存在 → **字节复制**过去。
   * 文件是 DPAPI 密文（同一台机器、同一个 Windows 用户），复制后原样可解密，
   * 不需要解密再加密（那会多一次 `powershell.exe` 子进程，约 1.2 秒）。
   *
   * 只复制、不删除旧文件：campus 的退役由 OWNER 统一处理，本包不去动它的目录。
   */
  const migrateLegacySession = () => {
    try {
      const legacyDir = config.legacyDataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-campus');
      const target = path.join(dataDir, 'xzzd.session');
      const legacy = path.join(legacyDir, 'xzzd.session');
      if (existsSync(target) || !existsSync(legacy)) return false;
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      copyFileSync(legacy, target);
      log(`已沿用旧会话文件（${legacy} → ${target}）`);
      return true;
    } catch (error) {
      // 迁移失败不是故障：大不了重登一次。绝不因此让插件起不来。
      log(`旧会话迁移失败（${error?.code ?? error?.message}），将按未登录处理`);
      return false;
    }
  };
  migrateLegacySession();

  const session = new SessionStore({ file: path.join(dataDir, 'xzzd.session'), protect: config.protect });

  // Loading is shared: parallel page requests must not replace a jar while
  // another request is adding authentication cookies to it.
  let loading;
  const ensureSession = () => loading ??= session.load();

  /**
   * 本包的 `fetch`。
   *
   * # 为什么用 `sharedFetch` 而不是 `globalThis.fetch`
   *
   * 宿主的 `globalThis.fetch` 走全局 dispatcher，而那份 dispatcher 来自启动时
   * 读的 `HTTPS_PROXY`。对海外目标那是对的，但浙大域名是**国内校园站点**：
   * 实测把它们交给本机代理会全部 7 秒后 ECONNRESET，直连 0.1 秒返回 200。
   *
   * `sharedFetch(ctx)` 去取 `zhiyunEgress` 服务（由 tier 0 的
   * `@lybx-leyw/dsh-zju-source-http` 提供）：非校园域直连、校园域按策略选路。
   * 拿不到服务时它自己退回宿主 fetch —— 所以这里不需要再判一次。
   *
   * # 为什么不自己建一份出口
   *
   * campus 时期自己建过（`src/egress.js`）。代价是每个数据包都开一套
   * undici Agent、各自探测校园网、各自登录 WebVPN —— 而 WebVPN 会话是
   * **互斥**的，两个包各登一次会互相作废。
   *
   * `config.fetch` 仍是测试注入口：单测注入假 fetch 时不该真的发网络请求。
   */
  const xuezaiFetch = typeof config.fetch === 'function'
    ? config.fetch
    : sharedFetch(ctx);

  /**
   * 建一个只作用于本包的 Transport。
   *
   * ⚠️ **必须显式传 `hosts`**。`Transport` 的默认白名单是从 `source/classroom`
   * 复制的（只含智云课堂的域），里面**没有** `courses.zju.edu.cn`。而
   * `Transport` 只在主机命中白名单时才读写 cookie —— 漏传的后果是：请求一个
   * cookie 都不带、回来的 `Set-Cookie` 也一个都不存，登录流程「成功」而会话
   * 永远是空的。这就是学在浙大"连不上"的历史根因。
   *
   * @param referer - 该次请求的 Referer。
   * @returns Transport。
   */
  const xuezaiTransport = (referer) => new Transport({
    session,
    fetch: xuezaiFetch,
    timeoutMs: config.timeoutMs ?? 20000,
    hosts: XUEZAI_HOSTS,
    referer,
    log: config.verbose ? (entry) => log(`${entry.method} ${entry.host}${entry.path} → ${entry.status}`) : undefined,
  });

  /**
   * 取「浙大一卡通」账号（学号 + 密码）。
   *
   * 唯一的权威来源是**设置界面**写入的那一份记录（见
   * `@lybx-leyw/dsh-zju-source-login`）。本包**只读不写**：一个数据包不该替
   * 用户保存密码，否则「设置里配的是什么」和「实际在用的是什么」迟早分叉。
   *
   * 共享层的 `readCard` 自己负责：宿主没装凭据服务 → null、记录形状不对 → null、
   * 读坏 → null。这里不再重复校验一遍，避免两处口径漂移。
   *
   * ⚠️ **每次现读，不缓存**：凭据服务可能晚于本包就绪（profile 里本包排在
   * login 之前是常态），把 null 缓存下来的后果是「配了也一直说没配」。
   *
   * @returns `{ username, password }`，或 null（没配 / 读不到）。
   */
  const accountOf = async () => readCard(ctx);

  /**
   * 上次登录的分段耗时（诊断用）。
   *
   * ⚠️ 贴在 **`session`** 上，不是 transport。踩过两次：
   *   1. 起初挂在 `transport.loginProfile` —— `xuezaiTransport()` 每次都
   *      `new Transport`，探针事后调 `xzzdClient()` 拿到的是另一个实例，
   *      永远读到 undefined；
   *   2. 挪到 session 后仍读不到 —— 因为赋值写在 `try` 末尾，**登录一抛异常
   *      就跳过了**。而"登录慢/失败"恰恰是最需要看分段的场景。
   *
   * 所以放在 `finally` 里：成功、失败、超时都能拿到。
   */
  const loginMarksEnabled = () => process.env.ZHIYUN_PROFILE_TODOS === '1';

  /**
   * 确保有学在浙大会话；没有就用 CAS 登一次。
   *
   * ⚠️ **不缓存失败**。omni 那边一次失败会封锁 15 分钟，于是偶发抖动变成
   * "半天用不了"。这里失败就是这一次失败 —— 下次调用照常再试，
   * 因为下一次的凭证/网络可能已经好了。
   *
   * @param force - 强制重新登录（会话失效时用）。
   * @returns 可用的 Transport。
   */
  const openTransport = async (force = false) => {
    await ensureSession();
    const transport = xuezaiTransport(`${XZZD_BASE}/user/index`);
    const account = await accountOf();
    if (!account) {
      // 这里说清"去哪配"，因为凭据已经**不在**「个人」页那个登录表单里了：
      // 个人页的表单改成了占位，写入口搬到「设置 → 浙大一卡通」。
      // 还写着"去个人页点连接课堂"会把用户指向一个不存在的按钮 —— 比不提示更糟。
      throw fault('NEED_LOGIN', '还没配「浙大一卡通」账号：去「设置 → 浙大一卡通」填一次学号和密码，学在浙大与智云课堂会共用这一份。');
    }
    const identity = createHash('sha256').update(account.username).digest('hex');
    if (!force && session.accountKey === identity && await hasXzzdSession(transport)) return transport;

    /**
     * 登录分段计时（只在诊断时收集）。
     *
     * 为什么需要：`semestersMs`/`crawlMs` 都从 `todos()` 内部起算，
     * **不含登录**。于是「登录与读取 4482ms、其中待办只发 1 个请求」这种情形
     * 完全看不出 4 秒花在哪。
     */
    const wantProfile = loginMarksEnabled();
    const mark = () => (wantProfile ? { at: Date.now(), timings: transport.timings?.length ?? 0 } : null);
    const marks = {};
    const stage = (label) => { const m = mark(); if (m) marks[label] = m; };

    stage('start');
    await session.clear();

    /**
     * 若智云课堂恰好已经有一张 SSO 票，就直接拿来用 —— 省掉一整条 CAS。
     *
     * 这是**运行时软依赖**（`ctx.get`），不是 import：没装 classroom 时
     * `classroom` 是 undefined，这段整体跳过，照常走完整 CAS。
     * 同一学号两次 CAS 登录会互相作废 ticket，所以能复用就复用。
     */
    const classroom = ctx.get?.('zhiyunClassroom');
    if (typeof classroom?.acquireSso === 'function') {
      for (const cookie of await classroom.acquireSso(account)) {
        await session.jar.setCookie(cookie.toString(), `https://${CAS_HOST}/cas/login`);
      }
    }
    stage('acquireSso');

    const captureLoginProfile = () => {
      if (!marks.start) return;
      const span = (a, b) => (marks[a] && marks[b]
        ? { ms: marks[b].at - marks[a].at, requests: marks[b].timings - marks[a].timings }
        : null);
      const last = marks.save ?? marks.casLogin ?? marks.acquireSso ?? marks.start;
      session.loginProfile = {
        prelude: span('start', 'acquireSso'),
        casLogin: span('acquireSso', 'casLogin'),
        save: span('casLogin', 'save'),
        total: last.at - marks.start.at,
        totalRequests: last.timings - marks.start.timings,
        /** 登录是否成功走完（失败时 total 只覆盖到出错的那一段）。 */
        completed: Boolean(marks.save),
      };
    };
    try {
      await xzzdLogin(transport, account);
      stage('casLogin');
      session.accountKey = identity;
      await transport.session.save();
      stage('save');
      log('学在浙大会话已建立');
      return transport;
    } catch (error) {
      // CAS 拒绝要能和网络问题分开：前者用户改密码，后者只需重试
      const code = error?.code === 'AUTH_REJECTED' ? 'NEED_LOGIN'
        : error?.code === 'NETWORK' || error?.code === 'TIMEOUT' ? 'UNREACHABLE'
          : error?.code === 'WEBVPN_REQUIRED' || String(error?.code ?? '').startsWith('WEBVPN_') ? 'WEBVPN'
            : 'LOGIN_FAILED';
      // ⚠️ 错误码**不变**（页面按 NEED_LOGIN / SESSION_EXPIRED / AUTH_REJECTED /
      // UNREACHABLE 分派）。文案只做一件事：**转述 CAS 自己给的证据**。
      //
      // 这里曾经无条件写「学号或密码不对」。那是错的：CAS 回登录页的原因有很多
      // （网络、会话、页面结构、真的凭据被拒），把它一律说成密码错，会把用户
      // 赶去反复改密码。现在只在**站点明确写出**错误文案时转述那句话
      // （`describeAuthFailure` 已按元素取文本），否则如实说"没给原因"。
      if (code === 'NEED_LOGIN') {
        throw fault(code, `浙大统一身份认证没有接受这次登录：${error?.message ?? '站点未给出原因'}`
          + ' 如果这句话确实是"用户名或密码错误"，去「设置 → 浙大一卡通」改一次；否则先看下面的网络与出口说明。');
      }
      if (code === 'WEBVPN') {
        throw fault(code, `${error?.message ?? 'WebVPN 登录失败'}`
          + ' 去「设置 → 浙大一卡通」的 WebVPN 一栏检查上网账号。');
      }
      throw fault(code, error?.message ?? String(error));
    } finally {
      // 成功、失败、超时都记一次 —— 见 captureLoginProfile 上的说明
      captureLoginProfile();
    }
  };

  /**
   * 同一时刻只允许一次登录。
   *
   * 并发页面请求不该各自触发一次 CAS —— 那会**互相作废 ticket**
   * （同号两次登录会作废前一张），表现是「明明登录成功却又被踢回登录页」。
   */
  let authTask = null;
  const transport = async (force = false) => {
    if (authTask) return authTask;
    const task = openTransport(force);
    authTask = task;
    try { return await task; } finally { if (authTask === task) authTask = null; }
  };

  const xzzdClient = async () => {
    const ready = await transport();
    return new XzzdApi(ready, { refreshSession: async epoch => {
      if (session.epoch === epoch) await transport(true);
    } });
  };

  /**
   * 学在浙大待办。
   *
   * # 数据源两条路（`ZHIYUN_TODOS` 环境变量）
   *
   *   `fast`（默认）  官方聚合端点 `/api/todos?no-intercept=true`，**1 个请求**
   *   `slow`          逐课抓取，`5N` 个请求（旧行为，留作对照与兜底）
   *   `diff`          两条都跑并对比，把差异放进 `xzzd.diff`（诊断用）
   *
   * # 为什么默认 fast（2026-10-21 决策）
   *
   * 真机数据说话：逐课 11 门课 42 请求、单请求 p50 = 2112ms、总计 48 秒。
   * 每门课 ≈ 2 × 2112ms，正是「三个必看端点 + 按需补两个过滤器」两阶段的
   * 两个 RTT。也就是说**瓶颈是单请求延迟本身**（2 秒/请求），不是并发不够
   * —— 在这种链路上，唯一有效的手段就是少发请求。
   *
   * 而 `/api/todos` 只发 1 个。桌面的 `zju-mcp`（`courses_list_todos.py`）
   * 用它「几秒就返回」，可作为这条链路确实能快的实证。
   *
   * 「会漏」那条断言：只有结论没有证据（上游只写"避免 bug"），且 `zju-mcp`
   * 是反例实现。`diff` 模式保留着，要核实随时可跑。
   *
   * @returns `{ xzzd: { ok, rows, error, ... }, pta: { ... } }`。
   */
  const loadTodosUncached = async () => {
    const wantProfile = loginMarksEnabled();
    const todoMode = String(process.env.ZHIYUN_TODOS ?? 'fast').toLowerCase();

    const xzzd = await (async () => {
      try {
        const api = await xzzdClient();

        if (todoMode === 'slow') {
          const result = await api.todos({ profile: wantProfile });
          return { ok: true, rows: normalizeXzzd(result.todos), error: null, ...(wantProfile ? { profile: result.profile } : {}) };
        }

        // fast / diff 都先走聚合端点（1 个请求）
        const fast = await api.todosFast();

        // 对账模式：再跑一次逐课的，把差异交出去（只在诊断时发生）
        if (todoMode === 'diff') {
          const slow = await api.todos({ profile: wantProfile });
          const slowRows = normalizeXzzd(slow.todos);
          return {
            ok: true,
            rows: normalizeXzzd(fast.todos),
            error: null,
            diff: diffTodos(fast.todos, slow.todos),
            slowCount: slowRows.length,
            ...(wantProfile && slow.profile ? { profile: slow.profile } : {}),
          };
        }

        return { ok: true, rows: normalizeXzzd(fast.todos), error: null };
      } catch (error) {
        // 在这里就翻成用户能照做的一句：下游（页面/脚本/AI）拿到 `error`
        // 直接上屏，不需要再按 error.code 映射一次。
        return { ok: false, rows: [], error: translateXzzdError(toError(error)) };
      }
    })();

    /**
     * ⚠️ `pta` 这一半**不在本包**。
     *
     * 拆包之前 `todos()` 同时返回 `{ xzzd, pta }`，因为它属于 campus。
     * 拆开之后本包只拥有 `xzzd` 那一半，而 `core/planning` 期待的是一份
     * **合并结果**。合并由集成层做（它同时持有 `zhiyunXuezai` 与
     * `zhiyunPta` 两个服务）。
     *
     * 这里仍然**返回这个键**，理由是让合并方不必先判形状：
     *
     *   - `code: 'NOT_IN_THIS_PACKAGE'` 是**哨兵**，合并方据此丢弃这一半，
     *     而不是把它当成"拼题A 读取失败"显示给用户；
     *   - `providedBy` 说明该去哪取。
     *
     * 若把这一半直接删掉，合并方就得写 `if ('pta' in result)` 之类的判断，
     * 而漏判的表现是页面静默少掉一整类待办 —— 比一个能被识别的哨兵更糟。
     */
    const pta = {
      ok: false,
      rows: [],
      notInThisPackage: true,
      providedBy: '@lybx-leyw/dsh-zju-source-pta',
      error: {
        code: 'NOT_IN_THIS_PACKAGE',
        message: '拼题A 不在学在浙大数据包里（拆包后归 @lybx-leyw/dsh-zju-source-pta）。',
      },
    };

    return { xzzd, pta };
  };

  /**
   * 待办缓存 10 分钟。
   *
   * 为什么是 10 分钟而不是 60 秒：学在浙大上的待办变化并不频繁（老师
   * 不会每分钟发一次作业），而每次刷新规划页都重拉一遍，等于把网络延迟
   * 重复加到首屏上。实测单次冷拉 2–5 秒，用户感知很明显。
   *
   * 失效条件仍然严格：`key` 里含**账号**，换账号立刻失效；
   * `invalidate()` 供手动刷新。
   *
   * ⚠️ 只影响"读平台数据"这一层。用户在规划页**自己新增/勾选/删除**的条目
   * 存在别处，与这个缓存无关，永远即时生效。
   */
  const loadTodos = sharedRead(loadTodosUncached, {
    ttlMs: config.readTtlMs ?? 10 * 60 * 1000,
    key: async () => createHash('sha256').update(JSON.stringify([
      await accountOf(),
    ])).digest('hex'),
  });

  /** 会话指纹：页面据此判断"换账号了要重读"。 */
  const fingerprint = async () => {
    await ensureSession();
    try {
      return createHash('sha256').update(JSON.stringify(
        (await session.jar.getCookies(`${XZZD_BASE}/`)).map(c => [c.key, c.value]),
      )).digest('hex');
    } catch {
      return '';
    }
  };

  /**
   * 出口状态：页面据此告诉用户"这次的请求走的是哪条路"。
   *
   * 为什么值得单列一个接口：用户看到"连不上"时，第一个要回答的问题就是
   * **走的是哪条路**。没有这一行，所有人都会先去怀疑密码。
   *
   * 出口由 `zhiyunEgress`（tier 0）提供，本包只**转述**它的状态，不改它。
   * 没装那个服务时如实返回 `{ mode: 'unavailable' }`。
   */
  const egressStatus = async ({ probe = false } = {}) => {
    const egress = (() => { try { return ctx.get?.('zhiyunEgress') ?? null; } catch { return null; } })();
    if (!egress) return { mode: 'unavailable', reason: 'zhiyunEgress 服务未注册（@lybx-leyw/dsh-zju-source-http 未启用）' };
    try {
      if (probe) { await egress.forget?.(); loadTodos.invalidate(); }
      if (probe) await egress.probe?.();
      return await egress.state();
    } catch (error) {
      return { mode: 'unavailable', reason: String(error?.message ?? error) };
    }
  };

  /**
   * 学在浙大的深入读取：活动 / 作业 / 活动详情 / 课件 / 我的提交。
   *
   * 一个动作名 + 参数，而不是五个动作名：它们**共用同一份会话**，
   * 参数校验也该在同一层。
   *
   * 全程只读：不提交作业、不改任何平台数据。
   *
   * @param body - `{ action, courseId, activityId, page, pageSize, withSubmissions, type }`。
   * @returns 对应方法的结果。
   */
  const xzzdRead = async (body = {}) => {
    const action = String(body?.action ?? '').trim();
    /**
     * ⚠️ 动作名**先校验，再取会话**。
     *
     * 反过来的写法（先 `xzzdClient()`）有两个问题：
     *   1. 一个拼错的动作名会先触发一次 CAS 登录，然后才回 400 ——
     *      用户看到一个 401/`NEED_LOGIN`，以为"没配账号"，其实是参数打错了；
     *   2. 集成层测试里"非法动作"这条永远撞在 `NEED_LOGIN` 上，
     *      于是"动作分派是否正确"根本测不到。
     *
     * 参数错误是调用方的错，与凭据状态无关，所以它该先报。
     */
    // `rollcallHistory` 是纯读（上游 rollcall-cli.ts:52 明写「只查看，不签到」）。
    // 先前被一句「上游和签到绑定」的假理由漏掉了，审计查出后补回。
    if (!XZZD_READ_ACTIONS.includes(action)) {
      throw fault('INVALID_INPUT', `未知的作业读取动作：${action || '(空)'}。可选 ${XZZD_READ_ACTIONS.join(' / ')}`);
    }
    // ⚠️ `courseBundle` 的 courseId 也在这里校验，**早于** `xzzdClient()`。
    // 反过来的话，一个非法的 id 会先触发一次 CAS 登录，然后才回 400 ——
    // 用户看到的延迟与「好像很慢」全归因错了，与上面动作名那条是同一类。
    if (action === 'courseBundle') {
      const id = Number(body.courseId);
      if (!Number.isFinite(id) || id <= 0) throw fault('INVALID_INPUT', 'courseBundle 需要正整数 courseId');
    }

    const api = await xzzdClient();
    const reader = new XzzdReader(api, XZZD_BASE);
    const signal = undefined;
    switch (action) {
      /**
       * 本人课程列表（上游 `xuezai course list`）。
       *
       * 不给 `semester` 时取「正在上的学期」—— 判据在
       * `XzzdApi.activeSemesterIds()` 里（含短学期与相邻 id），这里是它的唯一消费者
       * 之外的第二个入口，**不复制那份判断**。
       *
       * 为什么不在这里做关键词/简称匹配：那是「用户手里有个说法，要找到哪门课」
       * 的解析，属于**工具层**（`tool/xuezai` 的 course 参数）。source 只回答
       * 「我有哪些课、id 是什么」。
       */
      case 'courses': {
        const ids = body.semester === undefined
          ? await api.activeSemesterIds({ signal })
          : [Number(body.semester)];
        const rows = await api.courses(ids, { signal });
        return { count: rows.length, courses: rows, semesterIds: ids };
      }
      /**
       * 一门课的原始数据（`courseBundle`）：活动 / 测验 / 作业提交状态 / 课堂互动。
       *
       * 上游 `xuezai course view` 把这份数据加上章节树拼成「简介 + 章节 + 每章的
       * 活动」。章节树与视图拼装在**工具层**（`tool/xuezai`），因为那是
       * 「给模型看什么形状」的决定，不是数据源的事实。
       */
      case 'courseBundle':
        // id 已在上面（取会话之前）校验过，这里直接用。
        return api.courseBundle(Number(body.courseId), { signal });
      case 'activities':
        return reader.activities(body.courseId, {
          page: Number(body.page ?? 1),
          pageSize: Number(body.pageSize ?? 30),
          type: body.type ?? null,
          signal,
        });
      case 'assignments':
        return reader.assignments(body.courseId, {
          page: Number(body.page ?? 1),
          pageSize: Number(body.pageSize ?? 30),
          withSubmissions: Boolean(body.withSubmissions),
          signal,
        });
      case 'activity':
        return reader.activity(body.activityId, { signal });
      case 'materials':
        return reader.materials(body.courseId, {
          page: Number(body.page ?? 1),
          pageSize: Number(body.pageSize ?? 30),
          signal,
        });
      case 'rollcallHistory':
        return reader.rollcallHistory({ courseId: body.courseId, userId: body.userId, signal });
      case 'submission':
        return reader.activitySubmission(
          { id: body.activityId, course_id: body.courseId, group_set_id: body.groupSetId, submit_by_group: body.isGroup },
          { signal },
        );
      default:
        // 上面的 ACTIONS 白名单已经拦住了所有非法值，走到这里只能是代码不一致。
        throw fault('INVALID_INPUT', `未知的作业读取动作：${action || '(空)'}`);
    }
  };

  /**
   * 清掉会话并让缓存失效。
   *
   * 用户点「重新登录」、或换了账号时用。**不碰凭据** —— 密码在设置里，
   * 这里只是把磁盘上的会话丢掉，下次调用会重新走 CAS。
   */
  const reset = async () => {
    loadTodos.invalidate();
    try { await session.clear(); } catch { /* 清不掉也不该抛给页面 */ }
    return { ok: true };
  };

  /* ── 路由 ────────────────────────────────────────────────────────── */

  /** 路由处理函数。 */
  const handler = async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(payload));
    };

    // 只接受回环访问：这条路由能读作业内容与我的提交，不该从别的主机可达。
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (host && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
      send(403, { error: '只接受回环访问' });
      return;
    }

    const action = String(req.url ?? '').split('?')[1] ?? '';
    /** 读完请求体（POST 才有）。 */
    const readBody = async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    };

    try {
      if (req.method === 'GET') {
        send(200, { todos: await loadTodos(), egress: await egressStatus() });
        return;
      }
      if (req.method !== 'POST') {
        send(405, { error: '只支持 GET / POST' });
        return;
      }
      // 写操作要自定义头：跨站发不出自定义头，硬带会触发本路由不响应的预检
      if (String(req.headers[WRITE_HEADER] ?? '') !== '1') {
        send(403, { error: `缺少 ${WRITE_HEADER} 头` });
        return;
      }

      // 学在浙大的深入读取：活动 / 作业 / 活动详情 / 课件 / 我的提交。
      if (action === 'xzzd-read') {
        send(200, { ok: true, result: await xzzdRead(await readBody()) });
        return;
      }

      // 重新探测出口：用户换了网络（进/出校园网）之后点一下，不必重启。
      if (action === 'reprobe') {
        send(200, { ok: true, egress: await egressStatus({ probe: true }) });
        return;
      }

      // 丢掉本地会话（用户点「重新登录」）。
      if (action === 'reset') {
        send(200, await reset());
        return;
      }

      send(400, { error: `未知动作 ${action || '(空)'}` });
    } catch (error) {
      const code = error?.code ?? 'XUEZAI_FAILED';
      const status = code === 'INVALID_INPUT' ? 400
        : code === 'NEED_LOGIN' || String(code).startsWith('WEBVPN') ? 401
          : 500;
      send(status, { error: { code, message: String(error?.message ?? error) } });
    }
  };

  /**
   * 注册路由。
   *
   * ⚠️ `scope.effect` 不一定在：真实的 Cordis 注入作用域上有它，而最小替身
   * （测试、或别的宿主）可能只给了 `webServer.register`。所以这里两种形态都接 ——
   * 缺 `effect` 就直接注册，把它当成"调用方自己管生命周期"。
   * 硬要 `scope.effect` 的写法会让替身上直接抛 TypeError，而那个错误看起来
   * 像"路由注册失败"，排查方向从一开始就是错的。
   */
  let disposeRoute = null;
  ctx.inject(['webServer'], (scope) => {
    const register = () => {
      disposeRoute = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler });
      log(`数据路由：${ROUTE_PATH}（会话 ${dataDir}）`);
      return disposeRoute;
    };
    if (typeof scope?.effect === 'function') scope.effect(register, 'zhiyun: xuezai data route');
    else register();
  });

  /**
   * 写操作集合（Prepare 与 Execute 共用一份）。
   *
   * # 为什么缓存
   *
   * 写会话把 Prepare 算好的参数存在闭包里，Execute 要取同一份。若两个方法
   * 各建一次，Execute 会拿到空会话并报 `NEED_PREPARE` —— 看起来像
   * 「用户没批准」，实际是接线错了。
   *
   * 缓存键是 `xzzdClient()` 的实例：换账号后重新建，旧会话不跟过去。
   */
  let writesCache = null;
  const writes = async () => {
    const client = await xzzdClient();
    if (!writesCache || writesCache.client !== client) {
      writesCache = { client, api: createXuezaiWrites(client) };
    }
    return writesCache.api;
  };

  const removeService = ctx.provide(SERVICE_NAME, {
    routePath: ROUTE_PATH,
    platform: 'xzzd',
    label: '学在浙大',
    // 本包含写方法（交作业 / 撤回 / 签到），如实标 false。
    readOnly: false,
    /** 写方法名（成对出现），与只读方法分开列。 */
    writeMethods: ['xzzd.submitHomeworkPrepare', 'xzzd.submitHomeworkExecute',
      'xzzd.retractHomeworkPrepare', 'xzzd.retractHomeworkExecute',
      'xzzd.rollcallPrepare', 'xzzd.rollcallExecute'],
    /**
     * 待办：`{ xzzd: { ok, rows, error }, pta: { …哨兵, notInThisPackage: true } }`。
     *
     * ⚠️ `pta` 那一半**不在本包**，见 `loadTodosUncached` 的说明。
     */
    todos: loadTodos,
    /** 学在浙大深入读取（活动 / 作业 / 课件 / 我的提交），只读。 */
    xzzdRead,
    /** 会话指纹（换账号时变化）。 */
    fingerprint,
    /** 出口状态（校园网判定与是否经 WebVPN），供别的包/脚本查。 */
    egress: egressStatus,
    /** 给别处（脚本/测试）直接用的客户端构造器。 */
    xzzdClient,
    /** 上次登录的分段耗时（诊断用）。 */
    loginProfile: () => session.loginProfile ?? null,
    /** 丢掉本地会话，下次调用重新走 CAS。不碰凭据。 */
    reset,
    /** 待办缓存失效（不重登，只重读）。 */
    invalidate: () => loadTodos.invalidate(),

    /**
     * 写操作的两个方法。
     *
     * `prepare` 算参数与说明，`execute` 才发请求。**审批不在这里** ——
     * 那是 `packages/tool/campus-write` 的事。
     */
    submitHomeworkPrepare: async (input) => (await writes()).submitHomework.prepare(input),
    submitHomeworkExecute: async (signal) => (await writes()).submitHomework.execute(signal),
    submitHomeworkCancel: async () => (await writes()).submitHomework.cancel(),
    retractHomeworkPrepare: async (input) => (await writes()).retractHomework.prepare(input),
    retractHomeworkExecute: async (signal) => (await writes()).retractHomework.execute(signal),
    retractHomeworkCancel: async () => (await writes()).retractHomework.cancel(),
    rollcallPrepare: async (input) => (await writes()).rollcall.prepare(input),
    rollcallExecute: async (signal) => (await writes()).rollcall.execute(signal),
    rollcallCancel: async () => (await writes()).rollcall.cancel(),
  });

  return async () => {
    if (typeof removeService === 'function') removeService();
    try { disposeRoute?.(); } catch { /* 路由可能已被宿主摘掉 */ }
  };
}

/* ── 归一化（与「规划」页的期望形状对齐） ─────────────────────────── */

/**
 * 把错误收成 `{ code, message }`。
 *
 * @param error - 任意错误。
 * @returns 能直接显示的形状。
 */
function toError(error) {
  const code = error?.code ?? 'XZZD_FAILED';
  return { code, message: String(error?.message ?? error) };
}

/**
 * 学在浙大待办 → 页面统一形状。
 *
 * `XzzdApi.todos()` 已经给出 `due` / `dueText` / `courseName`，这里只补来源标签
 * 与 `kind`。**不再做二次换算** —— 时间口径（有没有时区）在 `xzzd.js` 里就定死了。
 *
 * @param rows - `XzzdApi.todos()` / `todosFast()` 的结果。
 * @returns 待办数组。
 */
export function normalizeXzzd(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    source: 'xzzd',
    sourceLabel: '学在浙大',
    id: row.id,
    title: row.title,
    detail: row.courseName ?? '',
    due: row.due ?? null,
    dueText: row.dueText ?? null,
    url: row.url ?? null,
    kind: 'todo',
  }));
}
