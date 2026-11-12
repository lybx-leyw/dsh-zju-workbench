/**
 * 研究生教务网数据源的宿主入口。
 *
 * # 这个包做什么（D17：数据源只读）
 *
 * 提供一个 `zwYjsy` 服务，暴露「本人研究生课表」这一条能力。
 * **不注册 AI 工具**、**不含写操作** —— 写操作按 D17 归 `packages/tool/*`。
 * 与 `source/zdbk` 的注释同口径：「本包是数据包，不注册任何 AI 工具」。
 *
 * # 登录：注入优先，共享 CAS 兜底
 *
 * 研究生教务网要两跳：CAS 给 `service` 签票，再拿票换 `X-Access-Token`。
 * 第一跳是通用的（`source/login` 的 `casLoginFor`），**第二跳必须在本包做** ——
 * 只有本包知道 `dataapi` 前缀与两个入口。
 *
 * 这与 `tyys` / `sztz` / `notice` 同一条路：凭据与 CAS 流程都在 tier 0，
 * 数据源只说明自己要哪个 `service`。
 *
 * 早先这里只留了 `setTokenProvider` 注入点，而**全仓没有任何调用方** ——
 * 于是这个包挂得上、用不了（`abandoned.md` 的 A-4）。注入点仍然保留
 * （装配方可能有更完整的票据链，优先于共享 CAS）。
 */
import { Transport, SessionStore, sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import { API, HOST, ENTRIES, YjsyError, openYjsy, timetable } from './yjsy.js';

/** CAS 主机。本包要它只是因为白名单要放行 —— CAS 流程在 `source/login` 里。 */
export const CAS_HOST = 'zjuam.zju.edu.cn';

/**
 * 用共享 CAS 换 `X-Access-Token` 的路径（相对 `API`）。
 *
 * 上游 `yjsy/index.ts:60`：CAS 给 `service` 签票之后，拿票换 token 走这一跳。
 * `result.token` 就是之后每个请求的 `X-Access-Token`。
 */
export const VALIDATE_LOGIN_PATH = 'sys/cas/client/validateLogin';

export const name = 'zju-source-yjsy';

/** 本包只要出口；凭据与 CAS 由调用方注入，所以不 inject 任何宿主服务。 */
export const inject = [];

/**
 * 本包暴露的数据路由。
 *
 * 与 `source/zdbk` / `source/cc98` 同构：一条同源路由，动作名 + 参数。
 * 只读，所以只有 `timetable` 一个动作。
 */
export const ROUTE_PATH = '/api/zw-yjsy';

/**
 * 把 `Transport` 的 `request` 适配成 `Yjsy` 期望的形状。
 *
 * `Transport.request` 返回 `{ status, headers, text }` —— 这里再包一层是为了让
 * `yjsy.js` 不依赖 `Transport` 的具体实现（它的单测可以传一个假的 `request`）。
 *
 * @param transport - 已建好的 Transport。
 * @returns `(url, init) => Promise<{status, text}>`。
 */
const requestOf = (transport) => (url, init) => transport.request(url, init);

/**
 * 把 `Transport` 层的错误翻译成本包的口径。
 *
 * # 为什么必须翻译
 *
 * `Transport` 抛的是 `ClassroomError`，文案写的是「**无法连接智云服务**」——
 * 对研究生教务网来说是**错站点名**。而 README 承诺数据源的 `message` 可以直接上屏
 * （`tests/source-error-contract.test.mjs` 的契约：数据源做好错误封装，下游直接调用）。
 *
 * 顺带把 `NETWORK` / `TIMEOUT` / `DISPOSED` / `CANCELLED` 收成本包的错误码，
 * 否则调用方要同时认两套码表。
 *
 * @param error - 抛出来的错误。
 * @returns 本包的 `YjsyError`，或原样返回（已经是本包的）。
 */
function translateTransportError(error) {
  if (error instanceof YjsyError) return error;
  const code = error?.code;
  if (code === 'TIMEOUT') {
    return new YjsyError('UNREACHABLE', '研究生教务网请求超时。检查网络，或（校外时）确认 WebVPN 是否可用。', { cause: code });
  }
  if (code === 'NETWORK') {
    return new YjsyError('UNREACHABLE', '连不上研究生教务网。检查网络，或（校外时）确认 WebVPN 是否可用。', { cause: code });
  }
  if (code === 'CANCELLED') {
    return new YjsyError('CANCELLED', '研究生教务网的请求已取消。', { cause: code });
  }
  if (code === 'DISPOSED') {
    return new YjsyError('CANCELLED', '数据源已关闭。', { cause: code });
  }
  return error;
}

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文。
 * @returns 卸载函数。
 */
export function apply(ctx) {
  /**
   * 当前的 token 提供者与它给的 token 缓存。
   *
   * 缓存是为了「同一份课表不要每次都重新登录」—— 研究生教务网的登录要过一次 CAS，
   * 每次几百毫秒。失效时（`Yjsy.expired`）才重换。
   *
   * ⚠️ 缓存里**必须记着 username**：同一进程里先查 A 的课表、再查 B，
   * 若不比对账号就复用，会把 A 的课表当成 B 的返回 —— 那是隐私泄露。
   * `zdbk/src/index.js:223-238` 用整段注释记过这个教训。
   */
  let acquireToken = null;
  let cached = null;

  return ctx.effect(() => {
    /**
     * 取一个已登录的客户端；必要时换 token。
     *
     * @param options.username - 学号（决定先试哪个入口）。
     * @param options.fresh - 强制重新换 token（调用方发现会话失效时用）。
     * @returns `Yjsy` 实例。
     */
    /**
     * 共享 CAS：没注入 `setTokenProvider` 时的兜底。
     *
     * # 为什么这不再是「装配层缺失」
     *
     * 研究生教务网要的是「CAS 票 → `X-Access-Token`」两跳。`casLoginFor` 已经
     * 给了第一跳（带回跳落地页），第二跳（`validateLogin`）**必须在本包做** ——
     * 只有本包知道 `API` 前缀与 `dataapi` 的存在。这与 `tyys` / `sztz` / `notice`
     * 的做法一致：凭据与 CAS 流程都在 tier 0，数据源只说明自己要哪个 `service`。
     *
     * @param input - `{ entry, service }`。
     * @returns `Promise<string>`：换到的 token。
     */
    const tokenFromSharedCas = async ({ entry, service }) => {
      const card = ctx.get?.('zwCard');
      if (typeof card?.casLoginFor !== 'function') {
        throw new YjsyError(
          'CONFIG',
          '研究生教务网还没接入登录：到「设置 → 浙大一卡通」配置学号密码后重试'
          + '（若你是插件作者：调用 setTokenProvider 注入取 token 的能力）。',
        );
      }
      const landing = await card.casLoginFor({ entry: service, hosts: [HOST, CAS_HOST] });
      const ticket = landing?.url?.searchParams?.get?.('ticket') ?? '';
      if (!ticket) {
        throw new YjsyError('AUTH_TICKET_MISSING', '统一身份认证没有给研究生教务网签票。');
      }
      const response = await sharedFetch(ctx)(
        `${API}/${VALIDATE_LOGIN_PATH}?${new URLSearchParams({ ticket, service })}`,
        { headers: { Accept: 'application/json' } },
      );
      const text = await response.text();
      let reply;
      try {
        reply = JSON.parse(text);
      } catch {
        throw new YjsyError('AUTH_REJECTED', `研究生教务网登录没有返回 JSON（HTTP ${response.status}）`);
      }
      if (!reply || typeof reply.success !== 'boolean') {
        throw new YjsyError('AUTH_REJECTED', '研究生教务网的登录响应不是 {success, code, message, result} 形状。');
      }
      if (reply.success && reply.result?.token) return String(reply.result.token);
      // 换不到时把平台的原话带出去 —— 本科生走研究生入口就是这一种。
      throw new YjsyError('AUTH_REJECTED', String(reply.message || `code ${reply.code}`));
    };

    const client = async ({ username, fresh = false } = {}) => {
      // 两条路都算「已接入」：注入的 provider，或宿主的共享 CAS。
      // 只认前者会把「装了 login、没手动注入」误报成「用户没配账号」。
      if (!acquireToken && typeof ctx.get?.('zwCard')?.casLoginFor !== 'function') {
        throw new YjsyError(
          'CONFIG',
          '研究生教务网还没接入登录：到「设置 → 浙大一卡通」配置学号密码后重试'
          + '（若你是插件作者：调用 setTokenProvider 注入取 token 的能力）。',
        );
      }

      // 账号变了就丢掉旧客户端 —— 否则会把上一个人的课表读给现在的人。
      if (cached && cached.username !== username) {
        cached.transport?.close?.();
        cached = null;
      }
      if (!fresh && cached && !cached.client.expired) return cached.client;

      // 换新 transport 前关掉旧的：`fresh` 路径会替换缓存，不关就漏一个
      // AbortController 集合与定时器。长进程里每次 AUTH_EXPIRED 重试都漏一个。
      cached?.transport?.close?.();

      const transport = new Transport({
        // ⚠️ 必须是真实的 SessionStore，不能是 `{ jar: null }`。
        // `Transport.request` 会无条件调 `this.session.jar.getCookies(url)`
        // （`http/src/transport.js:96`），`jar: null` 会抛 TypeError，
        // 被 catch 包成 `ClassroomError('NETWORK')` —— 表现是「一次请求也发不出去」。
        // 无 `file` 的 SessionStore 就是一次性内存 jar，本包不需要落盘 cookie。
        session: new SessionStore(),
        fetch: sharedFetch(ctx),
        timeoutMs: 20000,
        // 本包只碰研究生教务网一个域。白名单只列它是故意收窄的：
        // Transport 只对白名单主机读写 cookie，多列一个就多一份无谓的暴露面。
        hosts: new Set([HOST]),
        referer: `${ENTRIES.graduate}`,
      });

      const opened = await openYjsy({
        acquireToken: (entry, service) => (typeof acquireToken === 'function'
          // 注入优先：装配方可能自己有更完整的票据链（例如已经缓存过 token）。
          ? acquireToken({ entry, service, username })
          : tokenFromSharedCas({ entry, service })),
        username,
        request: requestOf(transport),
      });
      cached = { client: opened, transport, username };
      return opened;
    };

    /**
     * 取课表。
     *
     * @param input - `{ username, year?, term?, fresh? }`。
     * @returns 课表对象（见 `yjsy.js` 的 `timetable`）。
     */
    const readTimetable = async (input = {}) => {
      const run = async (fresh) => {
        const active = await client({ username: input.username, fresh });
        try {
          return await timetable(active, { year: input.year, term: input.term });
        } catch (error) {
          // Transport 层的错误码要翻译成本包的口径，且站点名不能错。
          // `ClassroomError` 的文案是「无法连接智云服务」—— 对研究生教务网是错站点名，
          // 而 README 承诺 message 可以直接上屏。
          throw translateTransportError(error);
        }
      };
      try {
        return await run(input.fresh === true);
      } catch (error) {
        // 会话失效时重换一次 token 再试 —— 这是唯一值得自动重试的错误。
        // `input.fresh === true` 时不再重试，重试上限固定为 1 次。
        if (error?.code === 'AUTH_EXPIRED' && input.fresh !== true) return run(true);
        throw error;
      }
    };

    const service = {
      routePath: ROUTE_PATH,
      platform: 'yjsy',
      label: '研究生教务网',
      readOnly: true,
      methods: ['yjsy.timetable'],
      /** 注入取 token 的能力。返回撤销函数。 */
      /**
       * 注入取 token 的能力。返回撤销函数。
       *
       * @param handler - `({ entry, service, username }) => Promise<string>`，或 null 取消注册。
       * @throws {YjsyError} 传了既不是函数也不是 null 的东西 —— 静默置 null 会让
       *   调用方以为注入成功，直到下一次请求才报「还没接入登录」。
       */
      setTokenProvider(handler) {
        if (handler !== null && handler !== undefined && typeof handler !== 'function') {
          throw new YjsyError('CONFIG', 'setTokenProvider 需要一个返回 token 字符串的函数');
        }
        acquireToken = typeof handler === 'function' ? handler : null;
        cached = null;
        return () => { if (acquireToken === handler) { acquireToken = null; cached = null; } };
      },
      /**
       * 当前是否已经接入登录。
       *
       * 两条路都算：注入的 provider，或宿主的共享 CAS（`source/login`）。
       * 只认前者会让「装了 login 但没手动注入」被报成「没配账号」——
       * 那正是本轮修掉的那类误导。
       */
      ready() {
        return acquireToken !== null || typeof ctx.get?.('zwCard')?.casLoginFor === 'function';
      },
      timetable: readTimetable,
      /** 清掉缓存的会话（换账号、或用户点了「重新登录」）。 */
      reset() {
        cached?.transport?.close?.();
        cached = null;
      },
    };

    const disposeService = ctx.provide('zwYjsy', service);

    // 同源数据路由：与 zdbk / cc98 同构，只读。
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
            if (input?.action !== 'timetable') throw new YjsyError('CONFIG', `不认识的操作：${input?.action ?? '(空)'}`);
            res.end(JSON.stringify({ ok: true, value: await readTimetable(input.input ?? {}) }));
          } catch (error) {
            res.end(JSON.stringify({ ok: false, error: { code: error?.code ?? 'FAILED', message: String(error?.message ?? error) } }));
          }
        },
      });
    });

    return () => {
      removeRoute?.();
      cached?.transport?.close?.();
      cached = null;
      disposeService?.();
    };
  }, 'zju: yjsy data source');
}
