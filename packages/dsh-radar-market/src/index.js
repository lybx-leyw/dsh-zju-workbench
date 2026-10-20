/**
 * 智云 Pro「插件」页的**生态检索半边**（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。本文件只有占位与 TODO，
 *    **不写业务逻辑**。与 `dsh-zhiyun-host-paper` 的区别在于：那一份已经是能跑的实现，
 *    这一份只是把「将来要怎么接」的形状摆出来，供人工评审判断方向是否成立。
 *
 * # 这个包要做的事（意图）
 *
 * 「插件」页现在只回答一半问题：`dsh-zhiyun-page-plugins` 从**运行时**读出本工作台
 * 自己的依赖图，让用户取消没有被依赖的叶包 —— 也就是「**我手上这几个包**谁依赖谁」。
 * 它答不了另一半：「**生态里还有什么没装**，能不能点一下就装」。
 *
 * 上游 `dshmarket` 的**宿主半边**正是这另一半的可用资产：catalog 拉取、registry 校验、
 * 安装与版本更新、pnpm / bundle 兼容、失败恢复。本仓没有对应实现，也不应自己造。
 * 所以本包是一层**兼容层**，不是市场的实现 —— 这一点与 paper 包完全同构。
 *
 * # 为什么不接它的客户端半边（本包最关键的判断）
 *
 * 上游的 `dsh.client.inject` 里列着 `@deepseek-ai/dsh-client-ui-settings`，
 * 且它自带 `./client` 导出 —— 它会**自己接管 settings 的 `plugins` 分组**。
 * 这与 `dsh-paper-reader` 的客户端半边刻意不引入是**同一条理由**（见
 * `packages/dsh-zhiyun-host-paper/README.md`）：它会抢本仓外壳的布局主张与设置分组。
 *
 * ⇒ **只挂宿主半边，UI 由 `dsh-zhiyun-page-plugins` 重写。**
 *   该重写**不在本骨架范围内**，是人工评审通过后、接入之前必须完成的前置工作。
 *
 * # 挂载与拆卸
 *
 *   1. 以子插件形式挂上上游（`ctx.plugin`），把本仓定好的 `dataDir` 传给它；
 *   2. 运行时核对上游版本，与 `upstream.js` 的预期不符时**大声报警但不拦启动**；
 *   3. 注册本包自己的 `/zhiyun-market` 前缀路由，把市场的能力以本仓的窄接口交给页面。
 *
 * 第 2 条为什么不拦启动：整个 profile 里任何一条 bundle 条目抛错，起不来的是**整个工作台**
 * （CONTRIBUTING 3.1）。用户至少还该能打开其余几个页面。版本不符写入状态接口与日志，
 * 让页面如实显示。
 */

import { join } from 'node:path';
import { createRequire } from 'node:module';

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-market';

/**
 * 只硬依赖 `profileContext`（数据目录）。`webServer` / `connection` / `remote`
 * 全部走 `ctx.inject` / `ctx.get` 惰性取 —— 可选宿主服务不写进 inject，
 * 否则对方没就绪时本插件会一直 pending（这条规矩见 dsh-zhiyun-host-paper 与
 * dsh-zhiyun-core-study 的 README）。
 */
export const inject = ['profileContext'];

/** 本包自有前缀。**不得**用上游可能占用的前缀，否则宿主 `webserver.register` 会抛错。 */
export const MARKET_ROUTE_PREFIX = '/zhiyun-market';

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
//   1. 【人工评审】确认「只挂宿主半边、客户端由 page-plugins 重写」这条判断成立。
//      这是本候选能否继续的前提，不成立则本包应废弃。
//
//   2. 【上游能力盘点】逐项确认上游宿主半边实际暴露了什么：哪些能力是 profile 内可调的
//      纯函数（保守起见优先走这一类），哪些只能走子进程 / CLI。**只读，不改上游源码。**
//
//   3. 【写入口克制】安装 / 卸载 / 更新属于**写操作**，且会改用户的 profile 与
//      `cordis.patch.yml`。参照 `dsh-zhiyun-page-plugins` 的成例，本包**不另开写入口**：
//      能用宿主既有 Remote（如 `pluginManager`）的一律走宿主自己的路径，
//      以保留只读保护与 `plugin-manager/changed` 通知。
//
//   4. 【数据目录】上游的 catalog 缓存 / 快照落哪里？默认拟用
//      `ctx.profileContext.dir/data/zhiyun-market`（可用 `config.dataDir` 覆盖）。
//      注意上游 `snapshot` 脚本会连网抓 registry，需确认离线时的降级行为。
//
//   5. 【版本核对】把 `status.upstream.installed !== UPSTREAM_VERSION` 的检查补上，
//      并且**只警告、不抛错**。
//
//   6. 【窄接口】在本仓的 `/zhiyun-market` 前缀下只暴露页面真正需要的方法，
//      不把上游的整个 API 面透传出去 —— 透传等于把上游的协议形状变成本仓的公开承诺。
//
//   7. 【测试】在仓库根补 `tests/radar-market.test.mjs`，断言
//      `package.json` 的依赖、`UPSTREAM_VERSION` 与本文件预期三者逐字符一致
//      （照 `tests/paper.test.mjs` 的成例：锁版这件事必须有一条会红的测试）。
//
//   8. 【验证】接入前必须跑通 `npm test` 与 `npm run test:host`，并在真实宿主里
//      确认它**没有**抢占 settings 的 `plugins` 分组。

export async function apply(ctx, config = {}) {
  const dataDir = config.dataDir ?? join(ctx.profileContext.dir, 'data/zhiyun-market');

  const status = {
    prefix: MARKET_ROUTE_PREFIX,
    /** 候选骨架：即使被误接入，也要让页面能显示「这是未评审的骨架」。 */
    skeleton: true,
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
    console.warn(`[radar-market] 上游版本与锁版不一致：期望 ${UPSTREAM_VERSION}，实际 ${seen}。`
      + '市场仍会挂载，但协议可能已经变化，请核对 /zhiyun-market/api/status。');
  }

  // ── 挂载上游宿主半边 ──────────────────────────────────────────────────
  // TODO(2)：确认上游宿主半边的导出形状与所需 config（尤其 dataDir 的落点）后再启用。
  //           上游客户端半边（`dshmarket/client`）**刻意不引入** —— 见文件头。
  let upstreamFiber = null;
  try {
    // const upstream = await import(UPSTREAM_PACKAGE);
    // upstreamFiber = ctx.plugin(upstream, { ...config.upstream, dataDir });
    // await upstreamFiber;
    // status.upstream.mounted = true;
    console.warn('[radar-market] 骨架：上游挂载尚未实现（见 src/index.js 的 TODO 2）。');
  } catch (err) {
    status.upstream.error = err instanceof Error ? err.message : String(err);
    console.warn(`[radar-market] 上游挂载失败，插件页将提示不可用：${status.upstream.error}`);
  }

  // ── 本包自有路由 ──────────────────────────────────────────────────────
  // TODO(6)：只暴露页面需要的方法。
  ctx.inject(['webServer', 'connection'], (scope) => {
    scope.effect(() => {
      const dispose = scope.webServer.register({
        kind: 'prefix',
        path: MARKET_ROUTE_PREFIX,
        handler: async (request) => {
          // 骨架阶段只答一处只读状态，够页面显示「未评审」横幅，不做任何写操作。
          const body = JSON.stringify({ ok: true, status });
          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        },
      });
      return dispose;
    }, 'radar: market routes');
  });

  const removeService = ctx.provide('radarMarket', {
    prefix: MARKET_ROUTE_PREFIX,
    dataDir,
    skeleton: true,
    status: () => status,
  });

  return () => {
    // 先摘服务、再卸上游：顺序反过来时，上游拆卸过程中若还有人打 `radarMarket`，
    // 会打到一个已在拆卸中的对象上（与 paper 包同一条理由）。
    if (typeof removeService === 'function') removeService();
    if (upstreamFiber && typeof upstreamFiber.dispose === 'function') upstreamFiber.dispose();
  };
}
