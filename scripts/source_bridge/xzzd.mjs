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
  const { ctx, routes } = await mount('dsh-zhiyun-source-campus', {
    dataDir,
    credentials: creds.service,
  });
  await card.writeCard(ctx, account);

  const route = routeOf(routes, '/api/zhiyun-campus', 'webServer');
  const data = await campusGet(route);

  // `todos.ok === false` 是**链路失败**（会话、权限、网络），不是"没有待办"。
  // 把它当空列表报"通过"会掩盖真问题 —— 这正是验收要看的。
  if (!data?.todos?.ok) {
    const error = data?.todos?.error ?? {};
    throw Object.assign(
      new Error(String(error.message ?? '学在浙大读取失败')),
      { code: error.code ?? 'XZZD_FAILED' },
    );
  }

  const rows = data.todos.rows ?? [];
  return {
    todos: rows.length,
    sample: String(rows[0]?.title ?? '').slice(0, 60),
    // 顺带把出口状态带出来，报告里能看出走的是直连还是网关
    egress: data.egress ?? null,
  };
}
