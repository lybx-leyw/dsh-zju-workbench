import path from 'node:path';
import { ClassroomSource } from './source.js';
import { STREAM_ROUTE_PREFIX, createStreamHandler } from './stream.js';
import { writeAccount } from './host-credentials.js';
export const name = 'zhiyun-classroom';
// `webServer` 不进 inject：它是**可选**的宿主服务，只有直播播放需要它。
// 写进 inject 会让「宿主没起 HTTP 面」时整个课堂数据源一起 pending ——
// 回放、解析、课表全都用不了，只为了一条直播通路。
//
// `credentials` 同样**不进 inject**：没装凭据存储时课堂必须照常可用，
// 只是别的包读不到这份账号（见 host-credentials.js）。
export const inject = ['profileContext'];
export async function apply(ctx) {
  // profileContext is owned by DSH, not a guessed global home/cwd.
  const source = new ClassroomSource({
    sessionFile: path.join(ctx.profileContext.dir, 'data', 'zhiyun-classroom', 'session.dpapi'),
    // 登录成功后把账号写进**宿主凭据服务**：dsh-zhiyun-omni 读同一份，
    // 于是用户只需要在「个人」页登录一次，规划页的学在浙大待办就能读到。
    // 这替代了"让用户去终端跑 npm run configure"那条路 ——
    // 那是把两个包各自存凭据的成本转嫁给用户。
    onLogin: async ({ credentials }) => {
      const saved = await writeAccount(ctx, credentials);
      ctx.logger?.info?.(saved
        ? 'zhiyun: 已把浙大账号存入宿主凭据（其他插件可复用）'
        : 'zhiyun: 宿主凭据服务不可用，账号只在本次会话生效');
    },
  });
  await source.ready;
  ctx.provide('zhiyunClassroom', source);
  // 直播流必须经过本机转发：浏览器直接吃智云 CDN 会同时撞上三件事 ——
  // CDN 校验 Referer、m3u8 里的分片是相对地址且带鉴权参数、以及跨域。
  // 这一层只做「拉取 + 改写 + 转发」，不碰登录态（凭据留在 transport 里）。
  //
  // ⚠ 这一层是**可选的**：没有 webServer（或测试里的最小 ctx）时课堂数据源
  //   仍然必须能用。回放/解析/课表不依赖转发端点，把它们绑在一起会让
  //   「直播装不上」升级成「整个课堂页打不开」—— 降级而不是连带失败。
  let removeRoutes = null;
  if (typeof ctx.inject === 'function') {
    removeRoutes = ctx.inject(['webServer'], (scope) => scope.effect(() => {
      const handler = createStreamHandler({ log: event => ctx.logger?.debug?.(`zhiyun: live ${JSON.stringify(event)}`) });
      const dispose = scope.webServer.register({ kind: 'prefix', path: STREAM_ROUTE_PREFIX, handler });
      ctx.logger?.info?.(`zhiyun: 直播流转发 ${STREAM_ROUTE_PREFIX}`);
      return dispose;
    }, 'zhiyun: live stream relay'));
  } else {
    ctx.logger?.debug?.('zhiyun: 没有 ctx.inject，跳过直播流转发端点');
  }
  // No automatic login or credential loading when mounting the plugin.
  return async () => {
    try { await removeRoutes?.(); } finally { await source.dispose(); }
  };
}
