/**
 * 智云 Pro「插件」页的**生态工坊半边**（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。本文件只有占位与 TODO，
 *    **不写业务逻辑**。
 *
 * # 这个包要做的事（意图）
 *
 * 「插件」页目前只回答一半问题：`dsh-zhiyun-page-plugins` 从**运行时**读出本工作台
 * 自己的依赖图，让用户取消没有被依赖的叶包 —— 也就是「**我手上这几个包**谁依赖谁」。
 * 它答不了另一半：「**生态里还有什么**，以及它们怎么被分发」。
 *
 * > 这一判断与已在 `2026-10-14` 提出的 `packages/dsh-radar-market/` **完全相同**，
 * > 两个候选落在同一处能力缺口的**同一条缝**上。本包的 TODO 1 就是先做**取舍**：
 * > 二者**不应同时接入**。
 *
 * 上游 `dsh-web` 是 DSH 的 Web 插件聚合生态与创意工坊（★8754，Apache-2.0，
 * 2026-10-14 仍在推送）。它的**宿主半边**是本包拟挂载的资产；catalog / 工坊分发 /
 * 版本协商这一整套，本仓没有对应实现，也不应自己造。所以本包是一层**兼容层**，
 * 不是工坊的实现 —— 与 paper 包、market 包同构。
 *
 * # 与 dsh-radar-market 的分工（本包最关键的判断，须人工裁定）
 *
 * | 候选 | 上游 | 上游生态位 | 上游成熟度 |
 * | --- | --- | --- | --- |
 * | `dsh-radar-market` | `dshmarket` 1.66.21 | DSH **内**的可视化插件市场（浏览 / 搜索 / 一键安装） | 161 个版本，1.66.x 已稳定 |
 * | `dsh-radar-dsh-web`（本包） | `dsh-web` 0.0.1 | DSH **Web 端**的插件聚合生态，经「创意工坊」分发 | **仅 1 个版本，0.0.1** |
 *
 * 两者的差别不在功能描述，而在**上游的成熟度**：`dshmarket` 已经发到 1.66.x，
 * 协议形状被 161 次发版打磨过；`dsh-web` 包**只有 0.0.1**，锁版实际上锁不住任何东西
 * （下一次发版就是第一次真正的破坏性变更风险，见 `upstream.js`）。
 *
 * ⇒ **建议**：若二者只能取一，取 `dsh-radar-market`；`dsh-web` 留作线索源与
 *   协议对照组（它 Apache-2.0、体量大、话题热度高，生态情报价值仍在）。
 *   **本包在人工裁定之前不应继续推进**，也绝不与 market 包同时接入同一页。
 *
 * # 为什么不接它的客户端半边
 *
 * 与 `dsh-radar-market` 同一条理由（见 [`../dsh-radar-market/README.md`] 与
 * [`../dsh-zhiyun-paper/README.md`]）：上游若自带 `./client` 导出并声明
 * `dsh.client.inject`，它会**自己接管 settings 分组与布局主张**
 * （`sidebar.workspaces` / `shell.overlay`），与本仓外壳冲突。
 *
 * ⚠️ **本条尚未核实**：`npm view dsh-web` 返回的 `dsh` 字段为 `null`，即上游 npm 包
 * **没有声明 `dsh.bundle.patch` 或 `dsh.client`**，这与它在 GitHub 上的形态不一致
 * （仓库名 `dsh-web` 描述为「插件聚合生态」）。所以「它到底是不是原生 DSH 插件包」
 * 这个问题，在骨架阶段是**悬而未决**的 —— 这正是 TODO 1 的前置。
 *
 * # 挂载与拆卸
 *
 *   1. 以子插件形式挂上上游（`ctx.plugin`），把本仓定好的 `dataDir` 传给它；
 *   2. 运行时核对上游版本，与 `upstream.js` 的预期不符时**大声报警但不拦启动**；
 *   3. 注册本包自己的 `/zhiyun-workshop` 前缀路由，把工坊的能力以本仓的窄接口交给页面。
 *
 * 第 2 条为什么不拦启动：整个 profile 里任何一条 bundle 条目抛错，起不来的是**整个工作台**
 * （CONTRIBUTING 3.1）。用户至少还该能打开其余几个页面。版本不符写入状态接口与日志。
 */

import { join } from 'node:path';
import { createRequire } from 'node:module';

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-dsh-web';

/**
 * 只硬依赖 `profileContext`（数据目录）。`webServer` / `connection` / `remote`
 * 全部走 `ctx.inject` / `ctx.get` 惰性取 —— 可选宿主服务不写进 inject，
 * 否则对方没就绪时本插件会一直 pending。
 */
export const inject = ['profileContext'];

/** 本包自有前缀。**不得**用上游可能占用的前缀，否则宿主 `webserver.register` 会抛错。 */
export const WORKSHOP_ROUTE_PREFIX = '/zhiyun-workshop';

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
//   1. 【人工裁定 · 先于一切】与 `packages/dsh-radar-market/` 二选一。二者面向同一个
//      「插件」页缺口的同一条缝，**不应同时接入**。裁定的依据是上面那张表：
//      上游成熟度（161 版本 vs 1 版本）、生态位（DSH 内市场 vs Web 端工坊），
//      以及哪一条更贴合本仓「插件」页既有的信息架构。本包在裁定前不应继续推进。
//
//   2. 【确认上游到底是不是原生 DSH 插件包】npm 上 `dsh-web@0.0.1` 的 `dsh` 字段为 `null`，
//      没有 `bundle.patch` 也没有 `client` —— 与 GitHub 仓库的形态不一致。
//      必须实际读一遍上游 `package.json`（`npm pack dsh-web` 后解包，**只读不改上游源码**），
//      确认：它是否带 `dsh.bundle.patch`？宿主半边导出什么？还是说它其实只是一个
//      被客户端插件使用的 Web GUI 工具库（其 npm 描述为 "Web GUI toolkit"）？
//      **若它只是工具库而非插件包，本包应废弃**，并把结论写回 registry。
//
//   3. 【上游能力盘点】确认上游宿主半边实际暴露了什么：哪些是 profile 内可调的纯函数
//      （保守起见优先走这一类），哪些只能走子进程 / CLI。**只读，不改上游源码。**
//
//   4. 【写入口克制】安装 / 卸载属于**写操作**，会改用户的 profile 与 `cordis.patch.yml`。
//      参照 `dsh-zhiyun-page-plugins` 的成例，本包**不另开写入口**：能用宿主既有 Remote
//      （如 `pluginManager`）的一律走宿主自己的路径，以保留只读保护与
//      `plugin-manager/changed` 通知。
//
//   5. 【数据目录】catalog 缓存 / 快照落哪里？默认拟用
//      `ctx.profileContext.dir/data/zhiyun-workshop`（可用 `config.dataDir` 覆盖）。
//      需确认离线时的降级行为。
//
//   6. 【版本核对】把 `status.upstream.installed !== UPSTREAM_VERSION` 的检查补上，
//      并且**只警告、不抛错**。注意上游只有 0.0.1，这个检查目前**永远不会触发**，
//      真正的价值在它下一次发版时。
//
//   7. 【窄接口】在本仓的 `/zhiyun-workshop` 前缀下只暴露页面真正需要的方法，
//      不把上游的整个 API 面透传出去 —— 透传等于把上游的协议形状变成本仓的公开承诺。
//
//   8. 【测试】在仓库根补 `tests/radar-packages.test.mjs` 的对应断言（若尚未覆盖本包），
//      断言 `package.json` 的依赖、`UPSTREAM_VERSION` 与磁盘实际三者逐字符一致
//      （照 `tests/paper.test.mjs` 的成例：锁版这件事必须有一条会红的测试）。
//
//   9. 【验证】接入前必须跑通 `npm test` 与 `npm run test:host`，并在真实宿主里
//      确认它**没有**抢占 settings 的分组与外壳布局。

export async function apply(ctx, config = {}) {
  const dataDir = config.dataDir ?? join(ctx.profileContext.dir, 'data/zhiyun-workshop');

  const status = {
    prefix: WORKSHOP_ROUTE_PREFIX,
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
    console.warn(`[radar-dsh-web] 上游版本与锁版不一致：期望 ${UPSTREAM_VERSION}，实际 ${seen}。`
      + '工坊仍会挂载，但协议可能已经变化，请核对 /zhiyun-workshop/api/status。');
  }

  // ── 挂载上游宿主半边 ──────────────────────────────────────────────────
  // TODO(2)：上游 npm 包的 `dsh` 字段为 null，形态待确认；确认前不得启用。
  //           TODO(1)：与 dsh-radar-market 的取舍未裁定前，本段不应实现。
  let upstreamFiber = null;
  try {
    // const upstream = await import(UPSTREAM_PACKAGE);
    // upstreamFiber = ctx.plugin(upstream, { ...config.upstream, dataDir });
    // await upstreamFiber;
    // status.upstream.mounted = true;
    console.warn('[radar-dsh-web] 骨架：上游挂载尚未实现（见 src/index.js 的 TODO 2）。');
  } catch (err) {
    status.upstream.error = err instanceof Error ? err.message : String(err);
    console.warn(`[radar-dsh-web] 上游挂载失败，插件页将提示不可用：${status.upstream.error}`);
  }

  // ── 本包自有路由 ──────────────────────────────────────────────────────
  // TODO(7)：只暴露页面需要的方法。
  ctx.inject(['webServer', 'connection'], (scope) => {
    scope.effect(() => {
      const dispose = scope.webServer.register({
        kind: 'prefix',
        path: WORKSHOP_ROUTE_PREFIX,
        handler: async () => {
          // 骨架阶段只答一处只读状态，够页面显示「未评审」横幅，不做任何写操作。
          const body = JSON.stringify({ ok: true, status });
          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        },
      });
      return dispose;
    }, 'radar: workshop routes');
  });

  const removeService = ctx.provide('radarWorkshop', {
    prefix: WORKSHOP_ROUTE_PREFIX,
    dataDir,
    skeleton: true,
    status: () => status,
  });

  return () => {
    // 先摘服务、再卸上游：顺序反过来时，上游拆卸过程中若还有人打 `radarWorkshop`，
    // 会打到一个已在拆卸中的对象上（与 paper 包同一条理由）。
    if (typeof removeService === 'function') removeService();
    if (upstreamFiber && typeof upstreamFiber.dispose === 'function') upstreamFiber.dispose();
  };
}
