/**
 * 知网数据源的宿主入口。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：检索与全文下载都是取数据。**不注册 AI 工具**、无写操作。
 *
 * # network 是 campus
 *
 * 知网按出口 IP 认机构（浙大图书馆）。校外必须经 WebVPN，否则拿到的是未订阅结果。
 * 主机表里 `cnki.net` 被标 `campus`，正是同一条事实。
 *
 * # 登录状态存在哪
 *
 * `profileContext.dir` 下的 `cnki-session.json`。约 20 分钟有效，
 * 过期后自动重登 —— IP 登录不需要账号，所以重登零成本。
 */
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { SessionStore, Transport, sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import { CnkiError, CnkiSession, searchPapers } from './cnki.js';

export const name = 'zju-source-cnki';

/** 需要出口与数据目录。 */
export const inject = ['profileContext'];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zhiyun-cnki';

/** 知网要碰的主机。**必须完整**：Transport 只对这些主机读写 cookie。 */
const CNKI_HOSTS = new Set(['kns.cnki.net', 'login.cnki.net', 'www.cnki.net', 'cnki.net']);

/**
 * 造一个带 Cookie 的传输层。
 *
 * # 为什么必须有 Cookie（这是我第一版最大的缺陷）
 *
 * 知网的「IP 登录」不是一个令牌，而是**往会话里种 cookie**：CAS 把票写进 jar，
 * 后续每个检索请求带着它。我第一版用 `sharedFetch` 直接发请求 —— 它是个无状态的
 * `fetch` 包装，**没有 jar**，于是登录「成功」了但检索仍然是无票裸请求，
 * 站点照样把你带去滑块验证。
 *
 * `Transport` 是唯一带 cookie 的那一层（`transport.js:96` 每次请求都会
 * `getCookies(url)` 并回写 `Set-Cookie`）。它的两个前提：
 *
 *   1. `session` 必须是真实的 `SessionStore`（`{ jar: null }` 会抛 TypeError）；
 *   2. `hosts` 白名单要列全 —— 漏一个主机，那个主机的 cookie 就不存也不发。
 *
 * @param ctx - 宿主上下文。
 * @param sessionFile - cookie 落盘路径。
 * @returns Transport。
 */
const makeTransport = (ctx, sessionFile) => new Transport({
  session: new SessionStore({ file: sessionFile }),
  fetch: sharedFetch(ctx),
  timeoutMs: 20_000,
  hosts: CNKI_HOSTS,
  referer: 'https://kns.cnki.net/',
});

/**
 * 把 `Transport.request` 适配成数据层期望的形状。
 *
 * @param transport - 已建好的 Transport。
 * @returns `(url, init) => Promise<{status, text}>`。
 */
const requestOf = (transport) => async (url, init = {}) => {
  const response = await transport.request(String(url), init);
  return { status: response.status, text: response.text };
};

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文。
 * @returns 卸载函数。
 */
export function apply(ctx) {
  return ctx.effect(() => {
    const file = path.join(ctx.profileContext.dir, 'cnki-session.json');
    // cookie 与「登录记录」分开存：前者是 Transport 的 jar（知网认的是它），
    // 后者只是「上次登录到什么时候」的元数据，给 loginStatus() 用。
    const jarFile = path.join(ctx.profileContext.dir, 'cnki-cookies.json');

    const transport = makeTransport(ctx, jarFile);

    const session = new CnkiSession({
      request: requestOf(transport),
      load: () => {
        try {
          return JSON.parse(readFileSync(file, 'utf8'));
        } catch {
          // 没有记录或文件损坏都当作「没登录过」——IP 登录零成本，重登比猜安全。
          return undefined;
        }
      },
      // 原子写：非原子写在中途崩溃会留下截断 JSON，`load` 的 catch 会把它
      // 当成「没登录过」→ 白登一次（可接受），但没必要制造这个情况。
      save: async (login) => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, JSON.stringify(login));
      },
    });

    const service = {
      routePath: ROUTE_PATH,
      platform: 'cnki',
      label: '知网',
      readOnly: true,
      methods: ['cnki.search', 'cnki.login', 'cnki.logout'],
      /** 当前登录状态（不联网）。 */
      loginStatus() {
        const login = session.current();
        return login
          ? { loggedIn: true, institution: login.institution, expiresAt: login.expiresAt, msLeft: login.expiresAt - Date.now() }
          : { loggedIn: false };
      },
      /**
       * 主动登录（或强制重登）。
       *
       * @param input - `{ fresh? }`。
       * @returns 登录记录。
       */
      login(input = {}) {
        return session.ensure(input.fresh === true);
      },
      /** 清除本地登录态与 cookie（换网络后想重来）。 */
      async logout() {
        session.login = null;
        await transport.session.clear({ persist: true });
        return { loggedIn: false };
      },
      /**
       * 检索文献。
       *
       * @param input - `{ keyword?, title?, author?, source?, type?, years?, core?, sort?, limit? }`。
       * @returns 检索结果。
       */
      search(input = {}) {
        return searchPapers({ session, query: input });
      },
    };

    const disposeService = ctx.provide('zhiyunCnki', service);

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
            if (action === 'search') {
              res.end(JSON.stringify({ ok: true, value: await service.search(input.input ?? {}) }));
            } else if (action === 'login-status') {
              res.end(JSON.stringify({ ok: true, value: service.loginStatus() }));
            } else if (action === 'login') {
              res.end(JSON.stringify({ ok: true, value: await service.login(input.input ?? {}) }));
            } else if (action === 'logout') {
              res.end(JSON.stringify({ ok: true, value: await service.logout() }));
            } else {
              throw new CnkiError('CONFIG', `不认识的操作：${action ?? '(空)'}`);
            }
          } catch (error) {
            res.end(JSON.stringify({ ok: false, error: { code: error?.code ?? 'FAILED', message: String(error?.message ?? error) } }));
          }
        },
      });
    });

    return () => {
      removeRoute?.();
      disposeService?.();
      // 关掉 transport：不关会漏 AbortController 集合与定时器。
      transport.close?.();
    };
  }, 'zju: cnki data source');
}
