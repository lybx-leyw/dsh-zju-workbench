/**
 * 学在浙大：CAS（**不带** service）→ 待办。
 *
 * 取数走 campus 路由的 GET —— 那正是「规划」页用的那条：
 * 回 `{ todos, pta, egress }`，其中 `todos` 里已经含有 `ok / rows / error`。
 * 这条 GET 会把学在浙大与拼题A **并发**跑，所以它同时也验证了两条链路。
 */

import { mount, memoryCredentials, routeOf, campusGet } from './_base.mjs';

export const label = '学在浙大';

/**
 * @param options.account - `{ username, password }`（浙大一卡通）。
 * @param options.dataDir - 落盘目录。
 * @param options.card - 已 import 的 card 模块。
 * @returns 探针读数。
 */
export async function run({ account, dataDir, card }) {
  const creds = memoryCredentials();

  // 让 campus 在这一轮把耗时剖析挂在结果上（只影响"记不记诊断数据"）
  process.env.ZHIYUN_PROFILE_TODOS = '1';

  const { ctx, routes } = await mount('dsh-zhiyun-source-campus', {
    dataDir,
    credentials: creds.service,
  });
  await card.writeCard(ctx, account);

  const route = routeOf(routes, '/api/zhiyun-campus', 'webServer');
  const data = await campusGet(route);

  /**
   * ⚠️ 形状是 `{ todos: { xzzd, pta }, pta: <status>, egress }` —— 注意
   * `todos` 底下是**两个子对象**，不是 `{ok,rows,error}` 平铺。
   *
   * 这里踩过一次：写成 `data.todos.ok`，于是永远 falsy，误报成
   * 「学在浙大读取失败 / XZZD_FAILED」，而真正的错误信息藏在
   * `data.todos.xzzd.error` 里、根本没被读出来。报告只有一句空 evidence。
   */
  const xzzd = data?.todos?.xzzd ?? null;

  // `xzzd.ok === false` 是**链路失败**（会话、权限、网络），不是"没有待办"。
  // 把它当空列表报"通过"会掩盖真问题 —— 这正是验收要看的。
  if (!xzzd) {
    throw Object.assign(new Error('campus 的 GET 没有返回 todos.xzzd'), { code: 'XZZD_SHAPE' });
  }
  if (!xzzd.ok) {
    const error = xzzd.error ?? {};
    throw Object.assign(
      new Error(String(error.message ?? '学在浙大读取失败')),
      { code: error.code ?? 'XZZD_FAILED' },
    );
  }

  const rows = xzzd.rows ?? [];

  return {
    todos: rows.length,
    sample: String(rows[0]?.title ?? '').slice(0, 60),
    // 顺带把出口状态带出来，报告里能看出走的是直连还是网关
    egress: data.egress ?? null,
    /**
     * 性能剖析。**不再单独爬一遍** —— campus 在 `ZHIYUN_PROFILE_TODOS=1` 时
     * 会把 `todos()` 的 profile 挂在 `xzzd.profile` 上（见 `loadTodosUncached`）。
     *
     * 早先这里写的是「再调一次 `xzzdClient().todos({profile:true})`」，
     * 那会让探针把同样的 150 个请求发两遍、耗时翻倍 —— 测量本身污染测量。
     */
    profile: xzzd.profile ?? null,
  };
}
