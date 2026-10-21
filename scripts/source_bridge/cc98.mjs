/**
 * CC98 论坛：OAuth2 密码模式 → Bearer。
 *
 * 凭证是 CC98 **自己的**账号（不是浙大统一认证），所以走 `readCc98` 那条记录。
 * 取数走 `cc98.*` 数据路由 —— 页面真正走的那条。
 */

import { mount, mountCampus, memoryCredentials, routeOf, rpcEnvelope } from './_base.mjs';

export const label = 'CC98 论坛';

/**
 * @param options.account - `{ username, password }`（CC98 账号）。
 * @param options.dataDir - 落盘目录。
 * @param options.card - 已 import 的 `dsh-zhiyun-source-card` 模块。
 * @returns 探针读数。
 */
export async function run({ account, dataDir, card }) {
  const creds = memoryCredentials();

  // ① 先装 campus：它 provide zhiyunEgress，cc98 的 sharedFetch(ctx) 指着它
  await mountCampus({ dataDir: `${dataDir}host/`, credentials: creds.service });

  // ② 再装 cc98 本身
  const { ctx, routes, warnings } = await mount('dsh-zhiyun-source-cc98', {
    dataDir,
    credentials: creds.service,
  });
  const hasEgress = typeof ctx.get('zhiyunEgress')?.fetch === 'function';
  await card.writeCc98(ctx, account);

  const route = routeOf(routes, '/api/zhiyun-cc98');

  const hot = await rpcEnvelope(route, 'cc98.hot', { range: 'today' });
  const boards = await rpcEnvelope(route, 'cc98.boards', {});
  const newest = await rpcEnvelope(route, 'cc98.newTopics', { size: 5 });

  const out = {
    hot: hot?.topics?.length ?? null,
    boards: boards?.groups?.reduce((n, group) => n + (group.boards?.length ?? 0), 0) ?? null,
    newTopics: newest?.topics?.length ?? null,
    // 出口是不是真的接上了。false 意味着静默退化成 globalThis.fetch，
    // 那会把「全局代理打不通国内站点」误报成「CC98 挂了」。
    viaSharedEgress: hasEgress,
  };

  // 顺带验一次「详情 + 楼层」与 UBB 清洗：这是本包最容易悄悄坏的地方
  const first = newest?.topics?.[0] ?? hot?.topics?.[0];
  if (first?.id) {
    const topic = await rpcEnvelope(route, 'cc98.topic', { topic_id: first.id, size: 3 });
    out.topic = {
      id: topic?.id ?? null,
      posts: topic?.posts?.length ?? null,
      total: topic?.total_floors ?? null,
    };
    out.topicTextSample = String(topic?.posts?.[0]?.text ?? '').slice(0, 80);
  }

  if (warnings.length) out.warnings = warnings.slice(0, 2);
  return out;
}
