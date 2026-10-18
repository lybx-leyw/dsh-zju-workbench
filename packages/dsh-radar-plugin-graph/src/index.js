// 候选骨架 · 未评审 · 未接入 profile · 不可直接使用。
//
// 这里刻意**没有业务逻辑**：只写清楚「接进来之后，哪一段数据从哪来、交给谁」，
// 好让下一位评审者能判断这个包到底该不该存在。真正的实现要等 §TODO 被逐条回答之后才动手。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-plugin-graph';

/**
 * 只声明硬依赖里的「必须存在」的那一个。
 *
 * `dsh-zhiyun-page-plugins` 是这张图的**消费者**（页面），本包只是把同一份图
 * 多算一层「循环依赖 / 未解析边 / 孤儿包」再交回去。它停用时本包无事可做，
 * 所以写进 inject、由 Cordis 决定 pending —— 而不是 `ctx.get` 惰性取。
 */
export const inject = ['slots'];

export function apply(ctx) {
  // 评审期间本包不得对宿主产生任何副作用：不注册 slot、不注册 RPC、不改任何现有页面。
  ctx.logger?.info?.(
    '[radar-plugin-graph] candidate skeleton loaded (no-op) · upstream %s@%s',
    UPSTREAM_PACKAGE,
    UPSTREAM_VERSION,
  );
}

// ── TODO（评审必须逐条回答，回答后才可以写第一行实现）────────────────────────────
//
// 1. **输入到底是哪一份图？**
//    `dsh-zhiyun-page-plugins/src/runtime.js` 已经把「模块边」与「Cordis 硬边」折成一张图，
//    但它的输入是**运行时**（`ctx.modules.manifest.modules` + `ctx.reflect.store`）。
//    skott 的输入是**文件系统**（源码 `import`/`require`）。两者粒度不同：
//       - 运行时图：包级，只含已加载的包，边来自 `inject`/`external`；
//       - skott 图：文件级，含全部 `packages/*/src/**`，边来自静态解析。
//    必须先裁定是「用 skott 补运行时图的盲区（未加载但有源码依赖）」还是
//    「只借 skott 的循环依赖判定算法对运行时图跑一遍」。**不要两条都做。**
//
// 2. **跑在哪一侧？**
//    skott 需要读 `node_modules` 与 `packages/*/src`，只能在**宿主侧**跑（`src/index.js` 的
//    apply 里），结果通过本包自己的 `/api/radar-plugin-graph` 交给页面。
//    **禁止**在浏览器半边引入 skott（会打进 webpack/vite 产物，体积与 `@parcel/watcher` 原生依赖都会炸）。
//
// 3. **增量还是全量？**
//    `packages/` 下已有 50 个包、`node_modules` 上千个目录。skott 默认会 walk 整个 workspace；
//    首次实现必须用 `entrypoints` 收窄到 `packages/*/src/{index,host,client}.js*`，
//    并确认 `@parcel/watcher` 是否要跟着 watch（**建议先关掉 watch，改为手动刷新**）。
//
// 4. **「增强」到底增强在哪一格？**
//    现有页面已能回答「谁依赖谁」与「层序违规」（`runtime.js` 的 `layerViolations`）。
//    本包**只能**补它答不了的：跨文件的循环依赖、`dsh-zhiyun-*` 之外的边（含 `node_modules`
//    里的上游）、以及「声明了 inject 但没有任何包提供该服务」的空边。**答得出来的不要重画。**
//
// 5. **性能门禁**：单次分析 ≤ 2s（冷）、≤ 300ms（热）；超过就退回「只读运行时图」。
//    没有这条门禁，这个包一定会把「插件」页拖慢，而那一页是本仓最常打开的诊断入口。
