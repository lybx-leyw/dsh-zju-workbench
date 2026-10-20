import path from 'node:path';
import { ClassroomSource } from './source.js';
import { STREAM_ROUTE_PREFIX, createStreamHandler } from './stream.js';
// 「只在还没有凭据时回填」走共享层，不再自己实现一遍"读—判断—写"。
// 跨包依赖走 package.json 的 dependencies + 包名（本仓惯例，见
// dsh-zhiyun-core-study → lecture/quiz/notes），不用相对路径。
import { savedAccountConnection } from './connection.js';
import { classroomNetwork } from './network.js';
import { readCard, fillCardIfEmpty } from 'dsh-zhiyun-source-card';
export const name = 'zhiyun-classroom';
// `webServer` 不进 inject：它是**可选**的宿主服务，只有直播播放需要它。
// 写进 inject 会让「宿主没起 HTTP 面」时整个课堂数据源一起 pending ——
// 回放、解析、课表全都用不了，只为了一条直播通路。
//
// `credentials` 同样**不进 inject**：没装凭据存储时课堂必须照常可用，
// 只是别的包读不到这份账号（见 host-credentials.js）。
export const inject = ['profileContext'];
export async function apply(ctx, config = {}) {
  const network = config.fetch ? null : classroomNetwork();
  // profileContext is owned by DSH, not a guessed global home/cwd.
  const source = new ClassroomSource({
    fetch: config.fetch ?? network.fetch,
    protect: config.protect,
    sessionFile: path.join(ctx.profileContext.dir, 'data', 'zhiyun-classroom', 'session.dpapi'),
    /**
     * 登录成功后把账号回填进宿主凭据服务。
     *
     * ⚠️ **只在还没有已存凭据时才写。**
     *
     * 凭据的权威来源现在是「设置 → 浙大一卡通」。如果每次登录都无条件回写，
     * 会出现这种覆盖：用户在设置里填了账号 A，某次代码路径用 B 登录成功，
     * 于是设置里那份被悄悄改成 B —— 用户下次看待办用的就不是自己配的账号了。
     *
     * 所以这里做的是"**补空缺**"而不是"**以我为准**"：`fillCardIfEmpty` 在宿主
     * `modifyRecord` 的**同一个锁内**完成判空与写入 —— 判空不能放在这里先做一遍。
     * 放在外面就是"读一次、再写一次"两步，中间那个窗口里用户在设置里点保存，
     * 回填照样会把它盖掉。两套口径也迟早会漂。
     *
     * 另外：现在**没有任何 UI** 会走到这条路上（个人页的登录表单已改为占位），
     * 保留它是为了 `controller.authenticate()` 这个公开 API 的语义完整。
     */
    onLogin: async ({ credentials }) => {
      const saved = await fillCardIfEmpty(ctx, credentials);
      if (saved) {
        ctx.logger?.info?.('zhiyun: 已把浙大一卡通账号存入宿主凭据（其他插件可复用）');
      } else {
        ctx.logger?.debug?.('zhiyun: 已有浙大一卡通凭据（或在保存时被抢先写入），这次不回填');
      }
    },
  });
  await source.ready;
  const getUser = source.getCurrentUser.bind(source);
  const connection = savedAccountConnection({ source, readAccount: () => readCard(ctx), getUser });
  source.ensureAuthenticated = () => connection.ensure();
  // Backend-only SSO sharing. Verify the authoritative account before exposing
  // its ticket; no ticket or credential is returned to an HTTP client.
  source.acquireSso = async (account) => {
    const own = await readCard(ctx);
    if (!own || own.username !== account.username || own.password !== account.password) return [];
    let failure;
    try { await connection.ensure(); } catch (error) { failure = error; }
    const cookies = (await source.transport.session.jar.getCookies('https://zjuam.zju.edu.cn/cas/login'))
      .filter(cookie => cookie.key === 'iPlanetDirectoryPro');
    // A classroom business API can fail after CAS has already issued a valid
    // ticket. Campus authorization can use that ticket independently.
    if (failure && !cookies.length) throw failure;
    return cookies;
  };
  source.getCurrentUser = async ({ connect = true } = {}) => {
    if (connect && !await connection.ensure()) return null;
    return getUser();
  };
  const logout = source.logout.bind(source);
  source.logout = async () => { await connection.suspend(); return logout(); };
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
  // Mounting is offline. The first state request restores the saved account.
  return async () => {
    try { await removeRoutes?.(); } finally { await source.dispose(); await network?.close(); }
  };
}
