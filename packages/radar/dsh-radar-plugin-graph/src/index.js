// 候选骨架 · 未评审 · 未接入 profile · 不可直接使用。
//
// 这里刻意**没有业务逻辑**：只写清楚「接进来之后，哪一段数据从哪来、交给谁」，
// 好让下一位评审者能判断这个包到底该不该存在。真正的实现要等 TODO 被逐条回答之后才动手。
//
// ── 2026-10-27 r79 改写：本包**不能用 `inject` 等页面** ───────────────────────────
//
// r73 的第一版写了 `export const inject = ['slots']`，并在注释里论证「页面停用时本包无事可做」。
// r79 实跑（`buildView` 真输入）证明这个论证会把本包自己变成**空转**：
//   插槽图里，「声明插槽者」的 `dependents` 恰是「填内容者」——
//   也就是说**外壳依赖页面，页面不依赖外壳的 slots 服务**。页面这一侧在服务层面**不 inject 任何东西**，
//   它只是 `ctx.slots.inject('<插槽名>', …)` 的**调用者**。
//   因此 `inject: ['slots']` 等不到「页面已加载」；真机顺序上它甚至可能在本包加载后一直 pending，
//   或者反过来早于页面就绪 —— 两种都不是本包想要的那个触发点。
//   见 docs/ecosystem-radar/2026-10-27-r79.md §3 F-1 / F-2。
//
// 正确的触发点是**页面报上来的「图已读完」事件**，而不是 Cordis 服务。

export const name = 'radar-plugin-graph';

/**
 * 本包**不声明**任何硬依赖。
 *
 * 理由见文件头：要等的是「页面读完图」这一事件，而它不是一个服务。
 * 真正接进来时，触发方式应在 TODO-5 里二选一：
 *   (a) 订阅宿主 `plugin-manager/changed` 之类已有的变更事件，自己在宿主侧重算；
 *   (b) 由 `dsh-zhiyun-page-plugins/src/host.js` 在 `/api/zhiyun-plugins` 的 `graph` 返回前
 *       调一次本包的纯函数（**推荐**：零新增事件、零新增生命周期，且天然与页面同一份读数）。
 *
 * 在 (a)/(b) 定下来之前不要加 `inject` —— 加了就是在等一个不会到来的服务。
 */
export const inject = [];

export function apply(ctx) {
  // 评审期间本包不得对宿主产生任何副作用：不注册 slot、不注册 RPC、不改任何现有页面。
  ctx.logger?.info?.('[radar-plugin-graph] candidate skeleton loaded (no-op)');
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
//    `packages/` 下已有 90 个包、`node_modules` 上千个目录。skott 默认会 walk 整个 workspace；
//    首次实现必须用 `entrypoints` 收窄到 `packages/*/src/{index,host,client}.js*`，
//    并确认 `@parcel/watcher` 是否要跟着 watch（**建议先关掉 watch，改为手动刷新**）。
//
// 4. **「增强」到底增强在哪一格？（r79 已经给出一个候选答案，供评审否决）**
//    现有页面的 `buildView` 已经在做拓扑排序与环检测，所以「再来一个环检测」是**重复且无增益**。
//    真正缺的是**跨包的文件级证据**：「页面 X 依赖 core-study 的 S 服务」这条边在运行时只到包级，
//    页面想让人判断「停掉它会坏在哪个文件」时无话可说。skott 能补的正是这一格。
//    —— 如果评审认为「文件级」不值得 30 个包的 walk 成本，那这个骨架就不该存在（判 ⛔ 而非 🟡）。
//
// 5. **触发点（r79 新增，必须回答）**：
//    见文件头。推荐 (b)：在 `page-plugins/src/host.js` 的 `readHostPlane()` 之后追加一次纯函数调用，
//    把 skott 的文件级结果并进同一个信封。这样本包**根本不需要是插件**，可以退化成
//    「page-plugins 的一个可选依赖」—— 如果是这样，那这个骨架的形态也应当跟着改。
//
// 6. **浏览器半边的 `deps` 里不能出现上游包名**（r79 F-3）：`buildView` 会把提供者不在
//    `dsh-zhiyun-` 范围内的边**静默丢弃**，但**不丢弃该服务**，于是行上显示「依赖：—」而开关仍可点。
//    若评审决定「上游提供者也要显示」，改的是 `buildView`（提一个 `foreignProviders` 字段），
//    不是在本包里绕开。**本包不得私自扩大 `ZHIYUN_PREFIX` 的语义。**
