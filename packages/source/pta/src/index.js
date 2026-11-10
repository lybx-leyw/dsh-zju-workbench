/**
 * 拼题A 数据源（`@lybx-leyw/dsh-zju-source-pta`）：pintia.cn 题集的**只读**数据包。
 *
 * # 这个包是什么
 *
 * 一个 Cordis 插件 + 一条同源数据路由（`/api/zhiyun-pta`）。它把拼题A 的
 * **题集列表**、题集详情、题目列表、题面原文、做题进度读出来，交给页面 / 脚本 /
 * 规划页去消费。**不注册任何 AI 工具** —— 那是消费方的适配，钉在包里以后想换
 * 客户端就得绕开它（与 `source/yjsy` / `source/zdbk` 同口径）。
 *
 * # 这是拆包，不是新实现
 *
 * 拼题A 的实现此前住在 `@lybx-leyw/dsh-zju-source-campus` 里（那个包同时装着
 * 学在浙大）。`pta.js` 逐字搬来，只把站点常量换成本包自己的 `hosts.js`。
 * 实现口径来自本仓 Flutter 版（`zhiyun-pro` 的 `pta_data_source.dart`），
 * **不是**从 `packages/vendor/zju-assistant/core/zju/lib/pta/` 移植的。
 *
 * # 只读边界（产品口径，不是实现细节）
 *
 * 上游 pta 模块有 4 个写能力（`problem save` / `problem submit` /
 * `homework start` / `homework finish`）。按 D17 它们**归 `packages/tool/`**，
 * 本包一行写平台数据的代码都没有。
 *
 * 唯一的写操作是 `saveCookie` —— 它写的是**本机的会话文件**，不是拼题A 的数据，
 * 与 `source/xxt` 的 `importCookie` 同一性质。
 *
 * # 不做自动登录
 *
 * 拼题A 网页登录要过短信验证码。任何"自动化登录"最终都变成维护一个验证码识别器，
 * 每隔几周失效一次，而失效表现是"密码明明对的却登不上"。所以口径是：
 * 浏览器登录 → 复制 Cookie → 粘进来。过期了再粘一次。
 */

import path from 'node:path';

import { ClassroomError, SessionStore, Transport, sharedFetch } from '@lybx-leyw/dsh-zju-source-http';

import { PtaApi, normalizePta, parsePtaCookie, translatePtaError } from './pta.js';
import { createPtaWrites } from './writes.js';
import { PTA_BASE, PTA_HOST, PTA_HOSTS, isPtaHost } from './hosts.js';

export const name = 'zju-source-pta';

/** 只硬依赖 `profileContext`（数据目录）。`webServer` 走 `ctx.inject` 惰性取。 */
export const inject = ['profileContext'];

/** 本包的数据路由。与 `/api/zhiyun-campus`、`/api/zhiyun-xxt` 并列，互不干扰。 */
export const ROUTE_PATH = '/api/zhiyun-pta';

/**
 * 写操作必须带的自定义头。
 *
 * # 为什么换了名字（`x-zhiyun-campus` → `x-zhiyun-pta`）
 *
 * 原路由在 campus 上，用的是 `x-zhiyun-campus`。拆包后本包是**独立的路由**，
 * 继续收 campus 的域名会让"这条请求属于谁"在日志里读不出来。
 * 前端要跟着改（`source/campus/src/client.jsx` 那份设置分区会随 campus 退役）。
 *
 * 值必须是 `'1'`：跨站发不出自定义头，而硬带会触发浏览器预检 —— 本路由不响应
 * 预检，于是 CSRF 被挡住。这是**唯一**的 CSRF 防线，不要删。
 */
export const WRITE_HEADER = 'x-zhiyun-pta';

/** 客户端动作：不是读取方法，不进 `read()` 的白名单。 */
const CLIENT_ACTIONS = Object.freeze(['status', 'saveCookie', 'clearCookie']);

/** 读取动作白名单 —— 路由只认这几个词，不做任意属性访问。 */
const READ_ACTIONS = Object.freeze(['problemSet', 'problems', 'problem', 'progress']);

/** 默认会话文件相对数据目录的位置。 */
const SESSION_FILE = 'pta.session';

/**
 * 造一个本包的错误。
 *
 * 用共享层的 `ClassroomError`：全仓一套错误形状（`{ code, message, details }`），
 * 调用方不必再认第二种。`details` 只放安全元信息，不放原始响应。
 *
 * @param code - 错误码。
 * @param message - 给用户看的一句（可以直接上屏）。
 * @returns 错误对象。
 */
const fault = (code, message) => new ClassroomError(code, message);

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文。
 * @param config - `{ dataDir?, protect?, fetch?, timeoutMs?, now?, routePath?, verbose? }`。
 * @returns 卸载函数。
 */
export function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-pta] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  // 数据目录跟着 profile 走：能跟 profile 一起被备份/清理，也与其他数据包一致。
  const dataDir = config.dataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-pta');

  /**
   * 会话文件是**一份**。
   *
   * 拼题A 只有一个登录态。原先它和学在浙大、WebVPN 共用 campus 的一个数据目录
   * 但分三个文件，是为了让"清除学在浙大会话"不顺手清掉拼题A 的 Cookie。
   * 本包只碰拼题A，不需要再分。
   */
  const session = new SessionStore({
    file: path.join(dataDir, SESSION_FILE),
    // `protect` 是测试注入口：默认走 DPAPI（Windows），单测里注入恒等函数，
    // 免得每存一次就 spawn 一个 powershell。
    ...(typeof config.protect === 'function' ? { protect: config.protect } : {}),
  });

  /**
   * 会话只 `load()` 一次。
   *
   * 并发请求不该各读一遍文件；而读失败（文件坏了）不该让整个插件起不来 ——
   * 起不来的是整个工作台（见 CONTRIBUTING 3.1）。所以这里把失败**记下来**，
   * 按"没配"处理，用户重新粘一次即可，比让他去删文件友好。
   */
  let loaded = null;
  const ensureLoaded = () => loaded ??= session.load().then(
    () => null,
    (error) => {
      log(`会话文件无法读取，按未配置处理：${error?.message ?? error}`);
      return error;
    },
  );

  /**
   * 建一个 Transport。
   *
   * ⚠️ **必须显式传 `hosts`**。`Transport` 的默认白名单是 classroom 那一套，
   * 里面没有 `pintia.cn`。`Transport` 只在主机命中白名单时才读写 cookie ——
   * 漏传的后果是：请求一个 cookie 都不带、回来的 `Set-Cookie` 也一个都不存，
   * 于是"刚粘完 Cookie 又像没配"，且**不报错**。
   *
   * `fetch` 用共享出口：拼题A 是公网域，出口策略判定为直连 —— 关键作用是
   * **绕开宿主为 LLM 配的全局代理**（国内站点经代理基本必失败）。
   */
  const transport = (referer = `${PTA_BASE}/`) => new Transport({
    session,
    fetch: typeof config.fetch === 'function' ? config.fetch : sharedFetch(ctx),
    timeoutMs: config.timeoutMs ?? 20000,
    hosts: PTA_HOSTS,
    referer,
    log: config.verbose ? (entry) => log(`${entry.method} ${entry.host}${entry.path} → ${entry.status}`) : undefined,
  });

  /** 已种下的拼题A cookie（`jar.getCookies` 的原始行）。 */
  const cookies = async () => {
    await ensureLoaded();
    return session.jar.getCookies(`${PTA_BASE}/`).catch(() => []);
  };

  /**
   * 确保有会话；没有就是**配置引导**，不是故障。
   *
   * 拼题A 无法自动登录（短信验证），所以"没有 Cookie"的文案要说清
   * **去哪粘**，而不是说"登录失败"。
   */
  const openTransport = async () => {
    if ((await cookies()).length === 0) {
      throw fault('COOKIE_IMPORT_REQUIRED',
        '拼题A 还没配 Cookie：去「设置 → 拼题A」粘贴一次（它登录要短信验证，脚本无法自动登录）。');
    }
    return transport();
  };

  /** 读一次题集列表，返回 `PtaApi.problemSets()` 的原始结果。 */
  const problemSets = async ({ includeEnded = false, limit, now, signal } = {}) => {
    const api = new PtaApi(await openTransport());
    return api.problemSets({
      includeEnded,
      ...(limit === undefined ? {} : { limit }),
      now: now ?? config.now ?? (() => new Date()),
      signal,
    });
  };

  /**
   * 「待办」的拼题A 那一半。
   *
   * # 返回形状（`core/planning` 依赖它，别改）
   *
   * ```js
   * { ok: true,  rows: NormalizedRow[], error: null }
   * { ok: false, rows: [], error: { code, message } }
   * ```
   *
   * `error.message` **已经翻译过**（`translatePtaError`），下游拿到直接上屏，
   * 不需要再按 `code` 映射一次。`rows` 是 `normalizePta()` 的结果：
   * `{ source:'pta', sourceLabel:'拼题A', id, title, detail, due, dueText, url, kind:'problemSet' }`。
   *
   * ⚠️ 失败时**绝不**冒到调用方：一个来源的失败不该让另一个来源（学在浙大）
   * 也拿不到数据。所以这里自己 try/catch。
   */
  const ptaTodos = async () => {
    try {
      const result = await problemSets({ includeEnded: false });
      return { ok: true, rows: normalizePta(result.problemSets), error: null };
    } catch (error) {
      return { ok: false, rows: [], error: translatePtaError(toError(error)) };
    }
  };

  /**
   * 待办（与 `campus.todos()` 同形的**单源**版本）。
   *
   * 保留 `todos()` 这个名字是为了让 `core/planning` 的 shim 只改一行：
   * 它期望 `campus.todos()` 返回 `{ xzzd, pta }`，本包只拥有 pta 那一半，
   * 所以这里回 `{ pta }`，由集成层与学在浙大那一半合并。
   *
   * @returns `{ pta: { ok, rows, error } }`。
   */
  const todos = async () => ({ pta: await ptaTodos() });

  /**
   * 拼题A 是否已配 Cookie（只回状态，不回值）。
   *
   * 形状与 campus 的 `ptaStatus()` 一致：`{ configured, names }`。
   * 读不到时多一个 `error` 字段，且 `configured: false` —— **不冒充**"没配"。
   *
   * ⚠️ 它只说明「Cookie 在不在」，**不是**「能不能用」。后者要真发一次请求
   * （把网络抖动误报成"过期"，是这一页最容易骗到人的错误）。
   *
   * @returns `{ configured: boolean, names: string[] }`。
   */
  const ptaStatus = async () => {
    try {
      const rows = await cookies();
      return { configured: rows.length > 0, names: rows.map((cookie) => cookie.key) };
    } catch (error) {
      return { configured: false, names: [], error: String(error?.message ?? error) };
    }
  };

  /**
   * 存拼题A Cookie。
   *
   * 整串 Cookie 原样种进 jar —— 拼题A 用**整串**认证（不是挑单个 cookie 名），
   * 所以这里把解析出来的 `name=value` 对全部种进去，顺序也保持原样。
   *
   * # 空输入 = 清除
   *
   * 设置面板的「清除」按钮发的就是空串。原实现把它当成"没识别出 Cookie"
   * 直接抛错 —— 用户点「清除」得到一条红字，而会话其实没被清掉。
   * 这里把它解释成清除，并回 `{ cleared: true }`。
   *
   * @param raw - 用户粘贴的原文（Cookie 串 / cURL / 请求头 / DevTools 表格）。
   * @returns `{ source, names, cleared }`。
   */
  const saveCookie = async (raw) => {
    await ensureLoaded();
    const text = String(raw ?? '').trim();
    if (text.length === 0) {
      await session.clear({ persist: true });
      log('拼题A Cookie 已清除');
      return { source: null, names: [], cleared: true };
    }

    const parsed = parsePtaCookie(text);
    if (!parsed) {
      throw fault('INVALID_INPUT',
        '没有从输入里识别出 Cookie。请复制 pintia.cn 任一 /api 请求的 cURL，或它的 Cookie 请求头。');
    }

    // 换 Cookie 前先清空：留着上一个人的键会让"这两个键是谁的"变得不可判断。
    await session.clear();
    for (const pair of parsed.cookie.split(';')) {
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const key = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (!key || !value) continue;
      try {
        await session.jar.setCookie(`${key}=${value}; Domain=.${PTA_HOST}; Path=/; Secure`, `${PTA_BASE}/`);
      } catch {
        // 单个 cookie 不合规不该让整次导入失败 —— 用户粘的是一整段。
      }
    }
    await session.save();
    log(`拼题A Cookie 已保存（来源：${parsed.source}，${parsed.names.length} 个键）`);
    return { source: parsed.source, names: parsed.names, cleared: false };
  };

  /**
   * 看题：题集详情 / 题目列表 / 题目 / 我的进度。
   *
   * 统一走一个入口而不是四个服务方法，是因为它们**共用同一份 Cookie 与会话**，
   * 而参数校验（题集 id、题型）也在同一层。页面只需传 `{ action, ...args }`。
   *
   * 全程只读：不提交代码、不开始考试、不创建提交记录。
   *
   * @param body - `{ action, problemSetId, problemId, problemType, page, limit, offset, maxCharacters }`。
   * @returns 对应方法的结果。
   */
  const read = async (body = {}) => {
    const action = String(body?.action ?? '').trim();
    if (!READ_ACTIONS.includes(action)) {
      throw fault('INVALID_INPUT',
        `未知的看题动作：${action || '(空)'}。可选 ${READ_ACTIONS.join(' / ')}`);
    }
    const api = new PtaApi(await openTransport());
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
      default:
        return api.progress(body.problemSetId, { signal });
    }
  };

  /* ── 路由 ────────────────────────────────────────────────────────── */

  const routePath = config.routePath ?? ROUTE_PATH;

  /** GET 的响应体：只有状态，不含任何 Cookie 值。 */
  const describe = async () => ({
    ok: true,
    route: routePath,
    dataDir,
    platform: { id: 'pta', label: '拼题A', host: PTA_HOST, base: PTA_BASE },
    host: PTA_HOST,
    pta: await ptaStatus(),
    reads: [...READ_ACTIONS],
    actions: [...CLIENT_ACTIONS],
    note: '只读数据包：题集/题目/进度四个读取动作 + 状态/导入 Cookie。拼题A 不做自动登录，Cookie 失效后需要重新粘贴。',
  });

  /**
   * HTTP 状态码映射。
   *
   * 拼题A 的码表与 HTTP 不是一一对应：`COOKIE_EXPIRED` 是"要用户动手"，
   * 用 401 让前端能一眼分开"该弹配置引导"和"真的坏了"。
   *
   * @param code - 错误码。
   * @returns HTTP 状态码。
   */
  const statusOf = (code) => (code === 'INVALID_INPUT' || code === 'INVALID_ID' ? 400
    : code === 'COOKIE_IMPORT_REQUIRED' || code === 'COOKIE_EXPIRED' || code === 'COOKIE' ? 401
      : code === 'FORBIDDEN' ? 403
        : code === 'RATE_LIMITED' ? 429
          : 500);

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

        // 只接受回环访问：这条路由能读题面、能改 Cookie，不该暴露给局域网。
        const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
        if (host && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
          send(403, { error: '只接受回环访问' });
          return;
        }

        const action = String(req.url ?? '').split('?')[1] ?? '';

        try {
          if (req.method === 'GET') {
            send(200, await describe());
            return;
          }
          if (req.method !== 'POST') {
            send(405, { error: '只支持 GET / POST' });
            return;
          }
          // 写操作要自定义头：跨站发不出自定义头，硬带会触发本路由不响应的预检。
          if (String(req.headers[WRITE_HEADER] ?? '') !== '1') {
            send(403, { error: `缺少 ${WRITE_HEADER} 头` });
            return;
          }

          // `pta-cookie` / `pta-read` 是拆包前的旧动作名，保留别名让调用方
          // 不必与包的重命名同步上线；新代码用 `cookie` / `read`。
          if (action === 'cookie' || action === 'pta-cookie') {
            const body = await readJson(req);
            const result = await saveCookie(body?.cookie);
            send(200, { ok: true, pta: await ptaStatus(), ...result });
            return;
          }

          if (action === 'read' || action === 'pta-read') {
            const body = await readJson(req);
            send(200, { ok: true, result: await read(body) });
            return;
          }

          if (action === 'status') {
            send(200, await describe());
            return;
          }

          send(400, { error: `未知动作 ${action || '(空)'}。可选 cookie / read / status` });
        } catch (error) {
          const code = error?.code ?? 'PTA_FAILED';
          send(statusOf(code), { error: { code, message: String(error?.message ?? error) } });
        }
      };

      const dispose = scope.webServer.register({ kind: 'exact', path: routePath, handler });
      log(`数据路由：${routePath}（会话 ${dataDir}）`);
      return dispose;
    }, 'zhiyun: pta data route');
  });

  /**
   * 写操作集合（Prepare 与 Execute 共用一份）。
   *
   * 缓存键是客户端实例：`client()` 每次新建一个，所以这里按「打开的连接」缓存。
   * 换 Cookie / 换账号后 `openTransport()` 会重建，写会话不会跟过去。
   */
  let writesCache = null;
  const writes = async () => {
    const active = await openTransport().then((transport) => new PtaApi(transport));
    if (!writesCache || writesCache.client !== active) {
      writesCache = { client: active, api: createPtaWrites(active) };
    }
    return writesCache.api;
  };

  const removeService = ctx.provide('zhiyunPta', {
    routePath,
    dataDir,
    platform: 'pta',
    label: '拼题A',
    // 本包含写方法（保存 / 提交答案），如实标 false。
    readOnly: false,
    /** 读取动作与客户端动作的名字（服务自述，给脚本/测试核对）。 */
    reads: [...READ_ACTIONS],
    actions: [...CLIENT_ACTIONS],
    /** 写方法名（成对出现），与只读动作分开列。 */
    writeMethods: ['pta.saveAnswerPrepare', 'pta.saveAnswerExecute',
      'pta.submitAnswerPrepare', 'pta.submitAnswerExecute'],
    /** 状态（`{ configured, names }`），与 campus 的 `ptaStatus()` 同形。 */
    ptaStatus,
    status: ptaStatus,
    /** 待办（`{ pta: { ok, rows, error } }`）——`campus.todos()` 的 pta 半。 */
    todos,
    ptaTodos,
    /** 存 / 清 Cookie（写的是本机会话文件，不是拼题A 的数据）。 */
    saveCookie,
    savePtaCookie: saveCookie,
    clearCookie: () => saveCookie(''),
    /** 读题集列表（原始形状，不归一）。 */
    problemSets,
    /** 看题统一入口（题集详情 / 题目列表 / 题目 / 进度）。 */
    read,
    /** 直接拿客户端（宿主侧代码可以绕过 HTTP 层）。 */
    client: async () => new PtaApi(await openTransport()),
    /** 原始会话（脚本需要自己发请求时用）。 */
    session: () => session,
    /** 主机表与站点常量，供诊断/测试核对。 */
    hosts: { base: PTA_BASE, host: PTA_HOST, all: [...PTA_HOSTS], isPtaHost },

    /**
     * 写操作的两个方法。
     *
     * `prepare` 算参数与说明，`execute` 才发请求。**审批不在这里** ——
     * 那是 `packages/tool/campus-write` 的事。
     */
    saveAnswerPrepare: async (input) => (await writes()).saveAnswer.prepare(input),
    saveAnswerExecute: async (signal) => (await writes()).saveAnswer.execute(signal),
    submitAnswerPrepare: async (input) => (await writes()).submitAnswer.prepare(input),
    submitAnswerExecute: async (signal) => (await writes()).submitAnswer.execute(signal),
  });

  return async () => {
    if (typeof removeService === 'function') removeService();
    // 挂起的落盘先刷下去：否则进程退出会默默丢掉刚粘的 Cookie。
    await session.flush?.().catch(() => {});
  };
}

/* ── 归一化与错误（纯函数，供服务与测试共用） ─────────────────────── */

/**
 * 把任意错误收成 `{ code, message }`。
 *
 * @param error - 任意错误。
 * @returns 页面能直接显示的形状。
 */
export function toError(error) {
  const code = error?.code ?? 'PTA_FAILED';
  return { code, message: String(error?.message ?? error) };
}

/**
 * 读请求体并解析成对象。
 *
 * 空体按 `{}` 处理（设置面板的「清除」就发空 JSON）。
 *
 * @param req - 可读流请求。
 * @returns 解析后的对象。
 */
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))).toString('utf8');
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw fault('INVALID_INPUT', '请求体不是合法 JSON');
  }
}

export { PtaApi, normalizePta, parsePtaCookie, translatePtaError, PTA_BASE, PTA_HOST, PTA_HOSTS, isPtaHost };
export {
  PTA_PAGE_LIMIT, PTA_ORDER_BY, PTA_PROBLEM_TYPES, PTA_TYPE_LABELS,
  ptaId, yesterdayUtcMidnight, normalizeDeadline, isPendingProblemSet,
} from './pta.js';
