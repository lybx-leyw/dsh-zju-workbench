/**
 * 电子图书数据源的宿主入口。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：只查找，不下载、不打开全文。**不注册 AI 工具**、无写操作。
 *
 * # network 是 campus
 *
 * 两个站都按 IP 认证：校外出口会被转到各自的登录页。所以 `network: campus` ——
 * 校外要经 WebVPN。这条与上游 `module.json` 一致，也是主机表里
 * `gk4pb6yy8y.search.serialssolutions.com` 与 `sslibrary.com` 都被标 campus 的原因。
 */
import { sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import { EbookError, searchEbooks } from './ebook.js';

export const name = 'zju-source-ebook';

/** 只需要出口；凭据由 IP 认证决定，不需要账号。 */
export const inject = [];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zhiyun-ebook';

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
    const service = {
      routePath: ROUTE_PATH,
      platform: 'ebook',
      label: '电子图书',
      readOnly: true,
      methods: ['ebook.search'],
      /**
       * 查一本书。
       *
       * @param input - `{ title?, isbn?, limit? }`，title 与 isbn 二选一。
       * @returns 查询结果。
       */
      search(input = {}) {
        return searchEbooks({
          request: requestOf(ctx),
          title: input.title,
          isbn: input.isbn,
          limit: input.limit,
        });
      },
    };

    const disposeService = ctx.provide('zhiyunEbook', service);

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
            if (input?.action !== 'search') throw new EbookError('CONFIG', `不认识的操作：${input?.action ?? '(空)'}`);
            res.end(JSON.stringify({ ok: true, value: await service.search(input.input ?? {}) }));
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
  }, 'zju: ebook data source');
}
