/**
 * 校园数据源（`dsh-zhiyun-source-campus`）：学在浙大待办 + 拼题A 题集的**本仓原生实现**。
 *
 * # 为什么不复用 `dsh-zhiyun-source-omni`
 *
 * omni 是移植来的（见它的 `ATTRIBUTION.md`），上游是为 **macOS** 写的。移植层改掉了
 * 凭据后端的强制依赖，但留下了几处结构性问题，且都落在我们每天要用的两条链路上：
 *
 * | 问题 | 具体表现 |
 * | --- | --- |
 * | **一次失败封锁 15 分钟** | `assertNoRecentFailure`：网络抖动也被记成"凭据被拒"，此后 15 分钟内直接抛错 —— 偶发失败被放大成"半天不可用" |
 * | **认证层带 webvpn 分支** | 每次取数前可能先探测网络模式（6s 超时兜底），再决定直连还是 webvpn |
 * | **macOS 残留** | `pbpaste \| npm run cli -- pta-cookie` 还印在用户可见的错误提示里；`DEFAULT_USER_AGENT` 声称是 Mac |
 * | **拼题A 的 N+1** | 每个题集再补一次 `/exams`（12 个题集 13 个请求），且被 200ms limiter 串起来 |
 *
 * 而这仓**已经有一套在 Windows 上跑通的** CAS 登录（`dsh-zhiyun-source-classroom` 的
 * `auth.js` / `transport.js` / `session.js`）。学在浙大要的正是同一套 CAS，
 * 所以那三份文件**原样复制**进了 `src/cas/`（见该目录与 ATTRIBUTION 的说明）。
 *
 * # 与上游的关系（如实陈述）
 *
 * - **接口契约**来自对公开网页与其 XHR 的观察，以及上游对这些接口的整理；
 * - **代码不复制上游**：HTTP、Cookie、CAS、超时都是本仓自己的一套；
 * - 学在浙大待办与拼题A 题集都是**登录后**的数据，**不是公开数据** ——
 *   不能写成"基于公开接口实现"。
 *
 * # 范围
 *
 * 只做 **xzzd（学在浙大待办）** 与 **pta（拼题A 题集）**。教务课表/成绩（`zdbk`）
 * 仍由 omni 提供 —— 那是「今天」页在用，本包不碰，避免一次性把那一页也卷进来。
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { sharedRead } from './reads.js';

import { Transport } from './cas/transport.js';
import { SessionStore } from './cas/session.js';
import { xzzdLogin } from './cas/login.js';
import { XzzdApi, hasXzzdSession, diffTodos } from './xzzd.js';
import { XzzdReader } from './xzzd-reads.js';
import { PtaApi, parsePtaCookie } from './pta.js';
import { CAMPUS_HOSTS, PTA_BASE, XZZD_BASE } from './hosts.js';
import { createEgress, loadUndici } from './egress.js';
import { WEBVPN_ORIGIN } from './webvpn/protocol.js';
import { webvpnLogin, hasWebvpnSession } from './webvpn/login.js';
// 「浙大一卡通」账号的唯一读取入口。
//
// 跨包引用走**包名**（`package.json` 的 `dependencies` + 工作区链接），
// 与 `dsh-zhiyun-core-study → dsh-zhiyun-core-lecture/quiz/notes` 的先例一致；
// 相对路径（`../../dsh-zhiyun-source-card/src/…`）能跑但会把两个包的文件树焊死，
// 而且 profile 里每个包是**独立链接**进 node_modules 的，跨包相对路径在
// 打包/安装后不成立。
//
// 为什么不再自己写 `readRecord('zhiyun-classroom/account')`：
// 记录形状（`kind: 'grant'`、payload 里的字段校验、读坏时的降级）是**共享层**
// 的知识。这里复制一份的后果已经发生过 —— 形状一改，两个包各按各的理解解析，
// 表现是"设置里明明配了，学在浙大还说没配"。读的人不许再猜形状。
import { readCard } from 'dsh-zhiyun-source-card';
// WebVPN 的「上网账号」是**另一份**凭据（与统一认证是两套系统），单独一个键。
import { readWebvpn } from 'dsh-zhiyun-source-card';

export const name = 'zhiyun-campus';

/** 只硬依赖 `profileContext`（数据目录）。凭据走 `ctx.get('credentials')` 惰性取。 */
export const inject = ['profileContext'];

/** 本包的数据路由。与 omni 的 `/api/zhiyun-omni` 并列，互不干扰。 */
export const ROUTE_PATH = '/api/zhiyun-campus';

export { XzzdApi, PtaApi, parsePtaCookie, hasXzzdSession, diffTodos };
export { XZZD_BASE, PTA_BASE, XZZD_HOST, PTA_HOST, CAMPUS_HOSTS } from './hosts.js';

/**
 * 本包的统一错误形状。
 *
 * 与 omni 的 `ToolError` 不同：这里**只有 code + message**，没有 `details` 里那些
 * 层层嵌套的原始响应。错误信息是给用户看的，不是给日志看的。
 */
export class CampusError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CampusError';
    this.code = code;
  }
}

/** 造一个 CampusError。 */
export const fault = (code, message) => new CampusError(code, message);

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-campus] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  const dataDir = config.dataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-campus');

  /* ── 会话存储 ───────────────────────────────────────────────────────
   * 三份会话分开存：
   *   - 学在浙大（CAS 换来的，可自动重建）；
   *   - 拼题A（只能用户手动粘贴，丢了必须再粘一次）；
   *   - WebVPN 网关（**上网账号**，与统一认证是两套系统）。
   * 混在一个 jar 里会让"清除学在浙大会话"顺手把拼题A Cookie 与网关会话也清掉。
   */
  const xzzdSession = new SessionStore({ file: path.join(dataDir, 'xzzd.session'), protect: config.protect });
  const ptaSession = new SessionStore({ file: path.join(dataDir, 'pta.session'), protect: config.protect });
  const webvpnSession = new SessionStore({ file: path.join(dataDir, 'webvpn.session'), protect: config.protect });

  // Loading is shared as well: parallel page requests must not replace a jar
  // while another request is adding authentication cookies to it.
  let xzzdLoad, ptaLoad, webvpnLoad;
  const ensureXzzd = () => xzzdLoad ??= xzzdSession.load();
  const ensurePta = () => ptaLoad ??= ptaSession.load();
  const ensureWebvpn = () => webvpnLoad ??= webvpnSession.load();

  /**
   * 本包的出口。
   *
   * # 出口归谁管：**本包自己**（这一节的结论是真机实测出来的，别改回去）
   *
   * 宿主的 `globalThis.fetch` 走全局 dispatcher，而那份 dispatcher 来自启动时读的
   * `HTTPS_PROXY`。对海外目标是必要的，但浙大域名是**国内校园站点**：实测把它们
   * 交给本机代理（`127.0.0.1:7993`）会**全部 7 秒后 ECONNRESET**，直连则 0.1 秒
   * 返回 200。也就是「取数被全局代理打死」。
   *
   * # 三条曾经写错的路（都别写回去）
   *
   * 1. **指望 `dsh-zhiyun-source-netproxy` 接管** —— 它默认 `enabled: false`（刻意如此：
   *    装个插件不该顺手改全局网络行为）。用户没打开时，校园域名照样走全局代理。
   *    把可用性押在"用户记得去开另一个开关"上，等于把根因留在原地。
   * 2. **给 `globalThis.fetch` 传 `dispatcher`** —— Node 内置 fetch 直接抛
   *    `UND_ERR_INVALID_ARG`，选项根本不生效。
   * 3. **依赖 `NO_PROXY` 里有 `zju.edu.cn`** —— 用户机器上通常没有（实测只有
   *    `api.deepseek.com,localhost,127.0.0.1`），而且环境变量是进程级全局的。
   *
   * # 现在这条路（实测成立）
   *
   * 用 `undici.fetch` 并**逐请求**显式传 `dispatcher`：把全局 dispatcher 指到死端口后
   * 验证过，`globalThis.fetch` 报 ECONNREFUSED，而同一次
   * `undici.fetch(…, { dispatcher: new Agent() })` 返回 200。所以本包能完全自主
   * 决定出口，**不需要**改动宿主的全局策略 —— 别的包（LLM、web_fetch）怎么走还怎么走。
   *
   * 分域既然由本包掌握，WebVPN 就顺手落在同一层：校园域名在**校外**时自动绕网关，
   * 校内则直连。判定与改写见 `egress.js` / `webvpn/`。
   */
  const egress = createEgress({
    mode: config.networkMode ?? 'auto',
    log,
    undici: await loadUndici(),
    // 需要网关但会话不在时，用「上网账号」试一次；没配就让调用方去配。
    onWebvpnRequired: async () => {
      await ensureWebvpn();
      if (await hasWebvpnSession(webvpnSession)) return true;
      const account = await webvpnAccountOf();
      if (!account) {
        throw fault('WEBVPN_NOT_CONFIGURED', '当前在校外，访问学在浙大需要 WebVPN，但还没配「上网账号」：去「设置 → 浙大一卡通」的 WebVPN 一栏填一次。');
      }
      const transport = transportFor(webvpnSession, `${WEBVPN_ORIGIN}/login`, { direct: true });
      await webvpnLogin(transport, account);
      await webvpnSession.save();
      log('WebVPN 会话已建立');
      return true;
    },
  });

  /** 出口状态的一句人话，用于错误文案（用户需要知道"这次的请求走的是哪条路"）。 */
  const egressModeLabel = () => {
    const state = egress.state();
    const where = state.campus === 'inside' ? '校园网内'
      : state.campus === 'outside' ? '校外'
        : '未探测';
    return `${state.mode} · ${where}${state.viaWebvpn ? ' · 经 WebVPN' : ''}${state.degraded ? ' · 无 undici（受全局代理影响）' : ''}`;
  };

  /**
   * 本包的 `fetch`：走 `egress`（自动分域 + 校外绕 WebVPN）。
   *
   * `config.fetch` 仍是测试注入口 —— 单测注入假 fetch 时不该真的发网络请求。
   */
  const campusFetch = typeof config.fetch === 'function' ? config.fetch : egress.fetch;

  /**
   * 建一个只作用于本包的 Transport（不共享 classroom 的会话）。
   *
   * ⚠️ **必须显式传 `hosts`**。`Transport` 的默认白名单是 classroom 那一套
   * （`zjuam` / `tgmedia` / `classroom.*` …），里面**没有** `courses.zju.edu.cn`
   * 与 `pintia.cn`。而 `Transport` 只在主机命中白名单时才读写 cookie ——
   * 漏传的后果是：请求一个 cookie 都不带、回来的 `Set-Cookie` 也一个都不存，
   * 登录流程「成功」而会话永远是空的。这就是学在浙大"连不上"的根因。
   *
   * `direct: true` 让这个 Transport **绕过 WebVPN**：网关自己不能被改写，
   * 否则就是"网关的网关"无限套娃。
   */
  const transportFor = (session, referer, { direct = false } = {}) => new Transport({
    session,
    fetch: direct && typeof config.fetch !== 'function' ? egress.send : campusFetch,
    timeoutMs: config.timeoutMs ?? 20000,
    // 本包要碰的全部主机：CAS 域 + 学在浙大 + 拼题A
    hosts: CAMPUS_HOSTS,
    referer,
    log: config.verbose ? (entry) => log(`${entry.method} ${entry.host}${entry.path} → ${entry.status}`) : undefined,
  });

  /**
   * 取「浙大一卡通」账号（学号 + 密码）。
   *
   * 唯一的权威来源是**设置界面**写入的那一份记录（见 `dsh-zhiyun-source-card`）。
   * 本包**只读不写**：一个数据包不该替用户保存密码，否则「设置里配的是什么」
   * 和「实际在用的是什么」迟早分叉。
   *
   * 共享层的 `readCard` 自己负责：宿主没装凭据服务 → null、记录形状不对 → null、
   * 读坏 → null。这里不再重复校验一遍，避免两处口径漂移。
   *
   * ⚠️ **每次现读，不缓存**：凭据服务可能晚于本包就绪（profile 里 campus 排在
   * omni/classroom 之前是常态），把 null 缓存下来的后果是「配了也一直说没配」。
   *
   * @returns `{ username, password }`，或 null（没配 / 读不到）。
   */
  const accountOf = async () => readCard(ctx);

  /**
   * 取 WebVPN 的「上网账号」。
   *
   * # 为什么是**另一份**凭据
   *
   * WebVPN 网关用的是**上网账号**，与统一身份认证是两套系统：账号通常都是学号，
   * 但密码未必相同（有人改过其中一套）。拿统一认证密码去登网关，结果可能是
   * "密码错误"，而这个错误会把人引向错误的方向 —— 所以宁可让用户显式配一次，
   * 也不替他猜。
   *
   * 没配时返回 null，由调用方给出"去设置里填"的指引。
   *
   * @returns `{ username, password }` 或 null。
   */
  const webvpnAccountOf = async () => {
    try {
      return (await readWebvpn(ctx)) ?? null;
    } catch {
      return null;
    }
  };

  /**
   * 确保有学在浙大会话；没有就用 CAS 登一次。
   *
   * ⚠️ **不缓存失败**。omni 那边一次失败会封锁 15 分钟，于是偶发抖动变成
   * "半天用不了"。这里失败就是这一次失败 —— 下次调用照常再试，
   * 因为下一次的凭证/网络可能已经好了。
   *
   * @returns 可用的 Transport。
   */
  const openXzzdTransport = async (force = false) => {
    await ensureXzzd();
    const transport = transportFor(xzzdSession, `${XZZD_BASE}/user/index`);
    const account = await accountOf();
    if (!account) {
      // 这里说清"去哪配"，因为凭据已经**不在**「个人」页那个登录表单里了：
      // 个人页的表单改成了占位，写入口搬到「设置 → 浙大一卡通」。
      // 还写着"去个人页点连接课堂"会把用户指向一个不存在的按钮 —— 比不提示更糟。
      throw fault('NEED_LOGIN', '还没配「浙大一卡通」账号：去「设置 → 浙大一卡通」填一次学号和密码，学在浙大与智云课堂会共用这一份。');
    }
    const identity = createHash('sha256').update(account.username).digest('hex');
    if (!force && xzzdSession.accountKey === identity && await hasXzzdSession(transport)) return transport;
    await xzzdSession.clear();
    const classroom = ctx.get?.('zhiyunClassroom');
    if (typeof classroom?.acquireSso === 'function') {
      for (const cookie of await classroom.acquireSso(account)) {
        await xzzdSession.jar.setCookie(cookie.toString(), 'https://zjuam.zju.edu.cn/cas/login');
      }
    }
    try {
      await xzzdLogin(transport, account);
      xzzdSession.accountKey = identity;
      await transport.session.save();
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
      // 赶去反复改密码。现在只在**站点明确写出**错误文案时转述那句话（
      // `describeAuthFailure` 已按元素取文本），否则如实说"没给原因"。
      if (code === 'NEED_LOGIN') {
        throw fault(code, `浙大统一身份认证没有接受这次登录：${error?.message ?? '站点未给出原因'}`
          + ' 如果这句话确实是"用户名或密码错误"，去「设置 → 浙大一卡通」改一次；否则先看下面的网络与出口说明。'
          + `（出口：${egressModeLabel()}）`);
      }
      if (code === 'WEBVPN') {
        throw fault(code, `${error?.message ?? 'WebVPN 登录失败'}`
          + ' 去「设置 → 浙大一卡通」的 WebVPN 一栏检查上网账号。');
      }
      throw fault(code, error?.message ?? String(error));
    }
  };

  let xzzdAuthTask = null;
  const xzzdTransport = async (force = false) => {
    if (xzzdAuthTask) return xzzdAuthTask;
    const task = openXzzdTransport(force);
    xzzdAuthTask = task;
    try { return await task; } finally { if (xzzdAuthTask === task) xzzdAuthTask = null; }
  };
  const xzzdClient = async () => {
    const transport = await xzzdTransport();
    return new XzzdApi(transport, { refreshSession: async epoch => {
      if (xzzdSession.epoch === epoch) await xzzdTransport(true);
    } });
  };

  /**
   * 确保有拼题A 会话。
   *
   * 拼题A 无法自动登录（短信验证），所以这里的"没有会话"是**配置引导**，
   * 不是故障。
   */
  const ptaTransport = async () => {
    await ensurePta();
    const transport = transportFor(ptaSession, `${PTA_BASE}/`);
    const cookies = await transport.session.jar.getCookies(`${PTA_BASE}/`).catch(() => []);
    if (!cookies.length) {
      throw fault('COOKIE_IMPORT_REQUIRED', '拼题A 需要在设置里粘贴一次 Cookie（它登录要短信验证，无法自动登录）。');
    }
    return transport;
  };

  /**
   * 两类待办。**并发读**，各自带错误。
   *
   * 与 omni 版的关键差别：这里**每条链路自己 try/catch**，绝不让一个来源的失败
   * 冒到调用方 —— 那样页面会拿不到任何数据（这正是「规划」页显示"宿主侧没起来"
   * 那个坑的根源）。
   */
  const loadTodosUncached = async () => {
    /**
     * 是否收集耗时剖析。
     *
     * 只在**诊断**时打开（`ZHIYUN_PROFILE_TODOS=1`），生产不带这个变量，
     * 所以没有额外开销（`profile: null` 时代码只多一次 `if`）。
     *
     * 为什么用环境变量而不是给 `todos()` 加参数：`loadTodos` 被 `sharedRead`
     * 包了一层、又被网页路由和规划页共用，加参数要一路透传四五处；而这个
     * 开关只影响"记不记诊断数据"，不影响任何行为。
     */
    const wantProfile = process.env.ZHIYUN_PROFILE_TODOS === '1';
    /**
     * 待办数据源。
     *
     *   `fast`（默认）  官方聚合端点 `/api/todos?no-intercept=true`，**1 个请求**
     *   `slow`          逐课抓取，`5N` 个请求（旧行为，留作对照与兜底）
     *   `diff`          两条都跑并对比，把差异放进 `xzzd.diff`（诊断用）
     *
     * # 为什么默认改成 fast（2026-10-21 决策）
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
     */
    const todoMode = String(process.env.ZHIYUN_TODOS ?? 'fast').toLowerCase();
    const [xzzd, pta] = await Promise.all([
      (async () => {
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
          return { ok: false, rows: [], error: toError(error) };
        }
      })(),
      (async () => {
        try {
          const transport = await ptaTransport();
          const result = await new PtaApi(transport).problemSets({ includeEnded: false });
          return { ok: true, rows: normalizePta(result.problemSets), error: null };
        } catch (error) {
          return { ok: false, rows: [], error: toError(error) };
        }
      })(),
    ]);
    return { xzzd, pta };
  };

  // Local planning edits also ask for snapshots. They must not repeat a complete
  // campus crawl (five requests per course) or resubmit a rejected CAS login.
  const loadTodos = sharedRead(loadTodosUncached, {
    ttlMs: config.readTtlMs ?? 60000,
    key: async () => {
      await ensurePta();
      const cookies = await ptaSession.jar.getCookies(`${PTA_BASE}/`);
      return createHash('sha256').update(JSON.stringify([
        await accountOf(), cookies.map(c => [c.key, c.value]),
      ])).digest('hex');
    },
  });

  /** 拼题A 是否已配 Cookie（只回状态，不回值）。 */
  const ptaStatus = async () => {
    await ensurePta();
    try {
      const transport = transportFor(ptaSession, `${PTA_BASE}/`);
      const cookies = await transport.session.jar.getCookies(`${PTA_BASE}/`);
      return { configured: cookies.length > 0, names: cookies.map((cookie) => cookie.key) };
    } catch (error) {
      return { configured: false, error: String(error?.message ?? error) };
    }
  };

  /**
   * 存拼题A Cookie。
   *
   * 整串 Cookie 原样存进 jar —— PTA 用**整串**认证（不是挑单个 cookie 名），
   * 所以这里把解析出来的 `name=value` 对全部种进去，顺序也保持原样。
   *
   * @param raw - 用户粘贴的原文。
   * @returns `{ source, names }`。
   */
  const savePtaCookie = async (raw) => {
    const parsed = parsePtaCookie(raw);
    if (!parsed) {
      throw fault('INVALID_INPUT', '没有从输入里识别出 Cookie。请复制 pintia.cn 任一 /api 请求的 cURL 或 Cookie。');
    }
    await ensurePta();
    for (const pair of parsed.cookie.split(';')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name || !value) continue;
      try {
        await ptaSession.jar.setCookie(`${name}=${value}; Domain=.pintia.cn; Path=/; Secure`, `${PTA_BASE}/`);
      } catch {
        // 单个 cookie 不合规不该让整次导入失败 —— 用户粘的是一整段
      }
    }
    await ptaSession.save();
    log(`拼题A Cookie 已保存（来源：${parsed.source}，${parsed.names.length} 个键）`);
    return { source: parsed.source, names: parsed.names };
  };

  /** 学在浙大会话指纹：页面据此判断"换账号了要重读"。 */
  const fingerprint = async () => {
    await ensureXzzd();
    try {
      return createHash('sha256').update(JSON.stringify((await xzzdSession.jar.getCookies(`${XZZD_BASE}/`)).map(c => [c.key, c.value]))).digest('hex');
    } catch {
      return '';
    }
  };

  /* ── 路由 ────────────────────────────────────────────────────────── */

  /**
   * 出口状态：页面据此告诉用户"这次的请求走的是哪条路"。
   *
   * 为什么值得单列一个接口：用户看到"连不上"时，第一个要回答的问题就是
   * **走的是哪条路**。没有这一行，所有人都会先去怀疑密码。
   */
  const egressStatus = async ({ probe = false } = {}) => {
    if (probe) { egress.forget(); loadTodos.invalidate(); }
    if (probe) await egress.probeCampus();
    await ensureWebvpn();
    return {
      ...egress.state(),
      webvpn: {
        session: await hasWebvpnSession(webvpnSession),
        configured: Boolean(await webvpnAccountOf()),
      },
    };
  };

  /**
   * 看题：题集详情 / 题目列表 / 题目 / 我的进度。
   *
   * 统一走一个入口而不是四个动作名，是因为它们**共用同一份 Cookie 与会话**，
   * 而参数校验（题集 id、题型）也在同一层。页面只需传 `{ action, ...args }`。
   *
   * 全程只读：不提交代码、不开始考试。
   *
   * @param body - `{ action, problemSetId, problemId, problemType, page, limit, offset }`。
   * @returns 对应方法的结果。
   */
  const ptaRead = async (body = {}) => {
    const action = String(body?.action ?? '').trim();
    const api = new PtaApi(await ptaTransport());
    const signal = undefined;
    switch (action) {
      case 'problemSet':
        return api.problemSet(body.problemSetId, { signal });
      case 'problems':
        return api.problems(body.problemSetId, {
          problemType: body.problemType ?? null,
          page: Number(body.page ?? 1),
          limit: Number(body.limit ?? 50),
          signal,
        });
      case 'problem':
        return api.problem(body.problemSetId, body.problemId, {
          offset: Number(body.offset ?? 0),
          maxCharacters: Number(body.maxCharacters ?? 16000),
          signal,
        });
      case 'progress':
        return api.progress(body.problemSetId, { signal });
      default:
        throw fault('INVALID_INPUT', `未知的看题动作：${action || '(空)'}。可选 problemSet / problems / problem / progress`);
    }
  };

  /**
   * 学在浙大的深入读取：活动 / 作业 / 活动详情 / 课件 / 我的提交。
   *
   * 与 `ptaRead` 同构（一个动作名 + 参数），理由也一样：
   * 它们共用同一份会话，参数校验也该在同一层。
   *
   * @param body - `{ action, courseId, activityId, page, pageSize, withSubmissions }`。
   * @returns 对应方法的结果。
   */
  const xzzdRead = async (body = {}) => {
    const action = String(body?.action ?? '').trim();
    const api = await xzzdClient();
    const reader = new XzzdReader(api, XZZD_BASE);
    const signal = undefined;
    switch (action) {
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
      case 'submission':
        return reader.activitySubmission(
          { id: body.activityId, course_id: body.courseId, group_set_id: body.groupSetId, submit_by_group: body.isGroup },
          { signal },
        );
      default:
        throw fault('INVALID_INPUT', `未知的作业读取动作：${action || '(空)'}。可选 activities / assignments / activity / materials / submission`);
    }
  };


  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = async (req, res) => {
        const send = (status, payload) => {
          res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(JSON.stringify(payload));
        };

        const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
        if (host && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
          send(403, { error: '只接受回环访问' });
          return;
        }

        const action = String(req.url ?? '').split('?')[1] ?? '';

        try {
          if (req.method === 'GET') {
            send(200, { todos: await loadTodos(), pta: await ptaStatus(), egress: await egressStatus() });
            return;
          }
          if (req.method !== 'POST') {
            send(405, { error: '只支持 GET / POST' });
            return;
          }
          // 写操作要自定义头：跨站发不出自定义头，硬带会触发本路由不响应的预检
          if (String(req.headers['x-zhiyun-campus'] ?? '') !== '1') {
            send(403, { error: '缺少 x-zhiyun-campus 头' });
            return;
          }

          if (action === 'pta-cookie') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            const result = await savePtaCookie(body?.cookie);
            send(200, { ok: true, pta: await ptaStatus(), ...result });
            return;
          }

          // 看题：`?pta=problemSet|problems|problem|progress`，参数走 body。
          // 单独一条动作而不是塞进 GET —— 题面可能几十 KB，而且带 id 参数，
          // 放进查询串会被中间层（代理日志、Referer）记下来。
          if (action === 'pta-read') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            send(200, { ok: true, result: await ptaRead(body) });
            return;
          }

          // 学在浙大的深入读取：活动 / 作业 / 活动详情 / 课件 / 我的提交。
          if (action === 'xzzd-read') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            send(200, { ok: true, result: await xzzdRead(body) });
            return;
          }

          // 重新探测出口：用户换了网络（进/出校园网）之后点一下，不必重启。
          if (action === 'reprobe') {
            send(200, { ok: true, egress: await egressStatus({ probe: true }) });
            return;
          }

          send(400, { error: `未知动作 ${action || '(空)'}` });
        } catch (error) {
          const code = error?.code ?? 'CAMPUS_FAILED';
          const status = code === 'INVALID_INPUT' ? 400
            : code === 'NEED_LOGIN' || String(code).startsWith('WEBVPN_') ? 401
              : 500;
          send(status, { error: { code, message: String(error?.message ?? error) } });
        }
      };

      const dispose = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler });
      log(`数据路由：${ROUTE_PATH}（会话 ${dataDir}）`);
      return dispose;
    }, 'zhiyun: campus data route');
  });

  const removeService = ctx.provide('zhiyunCampus', {
    routePath: ROUTE_PATH,
    todos: loadTodos,
    ptaStatus,
    savePtaCookie,
    fingerprint,
    /** 出口状态（含校园网判定与 WebVPN 会话），供别的包/脚本查。 */
    egress: egressStatus,
    /** 给别处（脚本/测试）直接用的两个客户端构造器。 */
    xzzdClient,
    ptaClient: async () => new PtaApi(await ptaTransport()),
    /** 看题（题集详情 / 题目列表 / 题目 / 进度），只读。 */
    ptaRead,
    /** 学在浙大深入读取（活动 / 作业 / 课件 / 我的提交），只读。 */
    xzzdRead,
  });

  /**
   * **共享出口**：让其它 `source-*` 包也用同一套网络策略。
   *
   * # 为什么必须在 campus 里、而不是每个包各自建一个
   *
   * WebVPN 是**网关会话**：它是"一张登录票换所有校园站点"。如果 zdbk / cc98 /
   * xxt / classroom 各自 `webvpnLogin()` 一次，第二个登录会把第一个的票作废 ——
   * 这与本仓在 CAS 上踩过的"两个包各自登录、单点互踢"是同一类事故，只是换了层。
   *
   * 同样地，undici 的 `Agent`（直连 dispatcher）与校园网探测结果也只该有一份：
   * 每包一个 Agent 会各开一套连接池，每包探一次校园网会让首个请求多绕几跳。
   *
   * 所以出口**只有一份**，所有权在 campus，其它包通过这个服务借。
   *
   * # 各包怎么用
   *
   * ```js
   * // 在发请求时**惰性**取（不能在 apply 阶段缓存：campus 可能晚于本包就绪）
   * const fetch = (url, init) => ctx.get?.('zhiyunEgress')?.fetch(url, init)
   *   ?? globalThis.fetch(url, init);
   * ```
   *
   * 拿不到服务时会退回直连 —— campus 没装时其它包仍能用，只是校外走不通。
   */
  const removeEgressService = ctx.provide('zhiyunEgress', {
    /** 出口模式：`auto` / `direct` / `webvpn`。 */
    mode: egress.mode,
    /**
     * 带出口策略的 fetch：自动分域（非校园域直连、校园域按模式走）+ 校外自动绕
     * WebVPN + 直连失败后按条件升级一次。
     *
     * 签名与 `globalThis.fetch` 一致，可直接喂给 `Transport`。
     */
    fetch: egress.fetch,
    /** 只发不走策略（调用方已确定要直连时用，比如 WebVPN 网关自己的登录页）。 */
    send: egress.send,
    /** 逻辑地址 → 物理地址（WebVPN 改写）。需要自己拼请求的包可用。 */
    toPhysical: egress.toPhysical,
    /** 当前出口状态：`{ mode, campus, viaWebvpn, degraded }`。 */
    state: () => egress.state(),
    /** 主动探一次校园网（`true` 校内 / `false` 校外 / `null` 探不到）。 */
    probeCampus: () => egress.probeCampus(),
    /** 清探测缓存（换了网络、用户改了设置时用）。 */
    forget: () => egress.forget(),
  });

  return async () => {
    // 先摘服务与路由，再关 agent：反过来的话，卸载窗口里打进来的请求会打到一个
    // 已关闭的 dispatcher 上。
    if (typeof removeEgressService === 'function') removeEgressService();
    if (typeof removeService === 'function') removeService();
    await egress.close().catch(() => {});
  };
}

/* ── 归一化（与「规划」页的期望形状对齐） ─────────────────────────── */

/**
 * 把错误收成 `{ code, message }`。
 *
 * @param error - 任意错误。
 * @returns 页面能直接显示的形状。
 */
function toError(error) {
  const code = error?.code ?? 'CAMPUS_FAILED';
  return { code, message: String(error?.message ?? error) };
}

/**
 * 学在浙大待办 → 页面统一形状。
 *
 * `XzzdApi.todos()` 已经给出 `due` / `dueText` / `courseName`，这里只补来源标签
 * 与 `kind`。**不再做二次换算** —— 时间口径（有没有时区）在 `xzzd.js` 里就定死了。
 *
 * @param rows - `XzzdApi.todos()` 的结果。
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

/**
 * 拼题A 题集 → 页面统一形状。
 *
 * @param rows - `PtaApi.problemSets()` 的结果。
 * @returns 题集数组。
 */
export function normalizePta(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    source: 'pta',
    sourceLabel: '拼题A',
    id: row.id,
    title: row.name,
    detail: row.ended === true ? '已结束' : '未结束',
    due: row.endsAt?.iso ?? null,
    dueText: row.endsAt?.text ?? null,
    url: row.url ?? null,
    kind: 'problemSet',
  }));
}

