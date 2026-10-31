/**
 * 「今日」页的**到点通知**（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。本文件只有占位与 TODO，
 *    **不写业务逻辑**。它把「将来要怎么接」的形状摆出来，供人工评审判断方向是否成立。
 *
 * # 这个包要做的事（意图）
 *
 * 本仓的「今日」页（`dsh-zhiyun-page-today` + `dsh-zhiyun-page-planning`）已经能
 * 算出**今天有哪些事、哪些已过期**：`time.js:113` 明确写着「只统计**没做**的条目 ——
 * 勾掉的已完成内容不该进任何提醒」，`ticks.js` 甚至把「不需要再被提醒了」做成了
 * 持久化的本机标记。**但这条提醒只活在用户自己打开这个页面的那几秒里。**
 * 用户不打开工作台，就永远收不到它 —— 全仓 `new Notification` / `requestPermission`
 * **一处都没有**。
 *
 * 上游 `dsh-plugin-notifications` 补的正是这一段：把「窗口不在前台」时的消息
 * 送到桌面，且自带排队、重启不丢不重、无窗可发时留盘。本仓没有对应实现，
 * 也不应自己造（一套跨平台桌面通知的排队与恢复，是另一个产品的工作量）。
 *
 * # 强化式集成：三条同时成立
 *
 *   ① **仍是同一个面板** —— 不新增页面、不新增设置分组、不改「今日」页的清单排序；
 *      通知**只是**这一页既有内容的另一个出口。
 *   ② **功能仍相似正交** —— 还是「今天要做什么、哪件过期了」；通知不参与判定
 *      做什么、哪件算过期，它只负责送达。
 *   ③ **底层多调了更优质实现** —— 原来是「零送达」（只有打开页面才看见），
 *      接入后是上游的桌面通知栈（发送器降级链 + 落盘队列 + 去重）。
 *
 *   三条缺一条这个包就该废。尤其是 ①：如果评审发现「今日」页需要一个
 *   **通知设置面板**，那已经是新面板，得先回到产品层讨论，而不是由本包顺手加上。
 *
 * # 挂载与拆卸
 *
 *   1. 以子插件形式挂上上游宿主半边（`ctx.plugin`），把本仓定好的 `dataDir` 传给它；
 *   2. 运行时核对上游版本，与 `upstream.js` 的预期不符时**大声报警但不拦启动**；
 *   3. 注册本包自己的 `/zhiyun-zone-notify` 前缀路由，把「发一条」以本仓的窄接口
 *      交给「今日」页调用。
 *
 * 第 2 条为什么不拦启动：整个 profile 里任何一条 bundle 条目抛错，起不来的是
 * **整个工作台**（CONTRIBUTING 3.1）。用户至少还该能打开其余几个页面。
 */

import { join } from 'node:path';
import { createRequire } from 'node:module';

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION, CLIENT_HALF_MOUNTED } from './upstream.js';

export const name = 'radar-zone-notify';

/**
 * 只硬依赖 `profileContext`（数据目录）。`webServer` / `connection` / `remote`
 * 全部走 `ctx.inject` / `ctx.get` 惰性取 —— 可选宿主服务不写进 inject，
 * 否则对方没就绪时本插件会一直 pending。
 *
 * ⚠️ 上游宿主服务（预期名 `notifications`）**同样不写进 inject**：它由本插件
 * 自己挂在下面，写进 inject 会变成「等一个由我提供的服务」的死锁。
 */
export const inject = ['profileContext'];

/** 本包自有前缀。**不得**用上游可能占用的前缀，否则宿主 `webserver.register` 会抛错。 */
export const ZONE_NOTIFY_ROUTE_PREFIX = '/zhiyun-zone-notify';

/** 读已安装上游包的版本号。 */
function installedUpstreamVersion() {
  try {
    const require = createRequire(import.meta.url);
    const file = require.resolve(`${UPSTREAM_PACKAGE}/package.json`);
    return { version: createRequire(file)(file).version, file };
  } catch (err) {
    return { version: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// TODO(接入前必须完成，按依赖顺序)：
//
//   1. 【人工评审】确认「仍是同一个面板」这条判断成立 —— 见文件头 ①。
//      若「今日」页需要通知设置面，本包应废弃、回产品层重议。
//
//   2. 【上游能力盘点】核对 `src/upstream.js` 的 `EXPECTED_HOST_API`：服务名、
//      方法签名、无窗可发时的行为。**只读，不改上游源码。**
//      上游尚未发布到 npm（`registry.npmjs.org/dsh-plugin-notifications` → 404），
//      接入前必须先解决「从哪拿包」：要么等上游发版，要么锁 git 引用并接受构建步骤。
//      这一条**未解决前本包不可能跑起来**。
//
//   3. 【触发口径】只由「今日」页已有的**过期条目**触发，不新造判定：
//      复用 `dsh-zhiyun-page-planning/src/time.js` 的「未完成」口径，
//      并尊重 `ticks.json` 里「不需要再提醒了」的标记 —— 勾掉的**一律不发**。
//
//   4. 【节流与静默】同一节课/同一条待办在多久内只提醒一次、夜间是否静默、
//      用户关掉之后多久内不再打扰 —— 这三条是**产品决策**，骨架不预设。
//      宁可先不实现，也不要写一个「每小时弹一次」的默认值。
//
//   5. 【写入口克制】本包只**发**通知，不改「今日」页的任何数据；也不得替用户勾选
//      `ticks` —— 那条标记的含义写在 `ticks.js` 文件头，是用户的意愿，不是插件的。
//
//   6. 【客户端半边】**不引入**（见 `upstream.js` 的 `CLIENT_HALF_MOUNTED`）。
//      若将来确实需要通知历史页，必须由 `dsh-zhiyun-page-today` 重写，
//      而不是把上游的 settings 分组接进来。
//
//   7. 【数据目录】上游的待发队列落哪里？拟用
//      `ctx.profileContext.dir/data/zhiyun-zone-notify`（可用 `config.dataDir` 覆盖）。
//      需确认离线 / 权限不足时的降级行为：**提醒发不出去，不能拖垮页面**。
//
//   8. 【窄接口】在 `/zhiyun-zone-notify` 前缀下只暴露页面真正需要的方法
//      （拟：`send` + `status`），不把上游的整个 API 面透传出去 ——
//      透传等于把上游的协议形状变成本仓的公开承诺。
//
//   9. 【验证】接入前必须在真实宿主里确认三件事：窗口在前台时**不弹**、
//      窗口隐藏时**弹且点击回到对应条目**、重启后**不重发**。

export async function apply(ctx, config = {}) {
  const dataDir = config.dataDir ?? join(ctx.profileContext.dir, 'data/zhiyun-zone-notify');

  const status = {
    prefix: ZONE_NOTIFY_ROUTE_PREFIX,
    /** 候选骨架：即使被误接入，也要让页面能显示「这是未评审的骨架」。 */
    skeleton: true,
    /** 恒为 false：客户端半边**刻意**不引入（见 upstream.js）。 */
    clientHalf: CLIENT_HALF_MOUNTED,
    upstream: {
      package: UPSTREAM_PACKAGE,
      expected: UPSTREAM_VERSION,
      installed: installedUpstreamVersion().version,
      mounted: false,
      error: null,
    },
  };

  if (status.upstream.installed !== UPSTREAM_VERSION) {
    const seen = status.upstream.installed ?? '(未安装)';
    console.warn(`[radar-zone-notify] 上游版本与锁版不一致：期望 ${UPSTREAM_VERSION}，实际 ${seen}。`
      + '到点提醒将不可用，请核对 /zhiyun-zone-notify/api/status。');
  }

  // ── 挂载上游宿主半边 ──────────────────────────────────────────────────
  // TODO(2)：确认上游宿主半边的导出形状与所需 config（尤其 dataDir 的落点）后再启用。
  //           上游客户端半边（`dsh-plugin-notifications/client`）**刻意不引入**。
  let upstreamFiber = null;
  try {
    // const upstream = await import(UPSTREAM_PACKAGE);
    // upstreamFiber = ctx.plugin(upstream, { ...config.upstream, dataDir });
    // await upstreamFiber;
    // status.upstream.mounted = true;
    console.warn('[radar-zone-notify] 骨架：上游挂载尚未实现（见 src/index.js 的 TODO 2）。');
  } catch (err) {
    status.upstream.error = err instanceof Error ? err.message : String(err);
    console.warn(`[radar-zone-notify] 上游挂载失败，到点提醒将不可用：${status.upstream.error}`);
  }

  // ── 本包自有路由 ──────────────────────────────────────────────────────
  // TODO(8)：只暴露页面需要的方法。
  ctx.inject(['webServer', 'connection'], (scope) => {
    scope.effect(() => {
      const dispose = scope.webServer.register({
        kind: 'prefix',
        path: ZONE_NOTIFY_ROUTE_PREFIX,
        handler: async (request) => {
          // 骨架阶段只答一处只读状态，够页面显示「未评审」横幅，不做任何发通知动作。
          const body = JSON.stringify({ ok: true, status });
          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        },
      });
      return dispose;
    }, 'radar: zone-notify routes');
  });

  const removeService = ctx.provide('radarZoneNotify', {
    prefix: ZONE_NOTIFY_ROUTE_PREFIX,
    dataDir,
    skeleton: true,
    // TODO(3)(4)：填入触发口径与节流后，才允许这里出现真正的 `send`。
    send: async () => {
      throw new Error('radar-zone-notify 是候选骨架：send() 尚未实现（见 src/index.js TODO 3/4）。');
    },
    status: () => status,
  });

  return () => {
    // 先摘服务、再卸上游：顺序反过来时，上游拆卸过程中若还有人打 `radarZoneNotify`，
    // 会打到一个已在拆卸中的对象上（与 paper / market 包同一条理由）。
    if (typeof removeService === 'function') removeService();
    if (upstreamFiber && typeof upstreamFiber.dispose === 'function') upstreamFiber.dispose();
  };
}
