/**
 * dsh-radar-cost-guard —— 候选骨架，未评审。
 *
 * 做的事情：把上游 `@tomjerrygit/dsh-cost-guard@0.1.0` 锁版挂载进来，
 * 用它那把**价格表 + 缓存命中口径**，给本仓「已有用量、但没有钱数」的
 * 账本补上成本维度，并**渲染进既有页面**（不是新开一个侧边栏面板）。
 *
 * 本文件只做三件事：
 *   1. 声明包的身份；
 *   2. 提供 `apply()` 占位（当前只打日志，**不注册任何服务、不改任何行为**）；
 *   3. 把 TODO 列清楚，供评审逐条裁定。
 *
 * ⚠ 这里刻意不 import 上游 —— 骨架阶段任何 `import` 都可能让宿主在
 *    profile 里误加载它。真正的接入点见 TODO-1。
 */

/** 包名，和 package.json 的 `name` 必须一致。 */
export const name = 'dsh-radar-cost-guard';

/** 上游锁版坐标（单一真源在 src/upstream.js，这里只引用不复制）。 */
export const UPSTREAM = '@tomjerrygit/dsh-cost-guard@0.1.0';

/**
 * Cordis 插件入口。骨架阶段**只打日志**。
 *
 * TODO-1：把 `src/upstream.js` 里的封装接进来 —— 只取「读用量 + 折算成本」
 *         两条纯逻辑，**不接管**上游的 `/cost-guard/*` 只读路由与
 *         `sidebar.panellist` 注册（那会多出一个侧边栏入口，违反「仍是同一个面板」）。
 * TODO-2：上游数据源是宿主 `storages/session_projcache/sessions/*.json` 的
 *         `record.rows.tokenUsage.val.totals`（`uncachedInputTokens` /
 *         `cacheWriteTokens` / `cacheReadTokens` / `outputTokens`）。
 *         本仓现有账本（`classroom-studio/src/upstream/usage-storage.js`）读的是
 *         `data/usage/*.jsonl`，**两个数据源不是同一份** —— 评审须先裁定用哪一个，
 *         或在 `core/tool` 里做一次归一化合并。
 * TODO-3：价格表默认值与「模型 → 单价」映射必须可配置，且**不得**写死 DeepSeek 单价
 *         （本仓还会走浙大校内网关与自建端点，单价与官方不同）。
 * TODO-4：输出口只允许是既有页面（候选：「插件」页 `page-plugins` 的只读表列，
 *         或 `page-today` 的当日用量卡）；**不新增导航条目**。
 * TODO-5：上游 0.1.0 是 2026-11-11 当天首版（3 次提交，含一次「修 BOM」），
 *         无 peerDependencies、无测试。锁版前须在沙箱里跑一次真实读取，
 *         确认 `totals` 字段名与 DSH 0.2.x 一致。
 *
 * @param ctx Cordis 上下文
 */
export function apply(ctx) {
  const logger = ctx?.logger?.('radar-cost-guard');
  logger?.info?.(
    '[dsh-radar-cost-guard] 候选骨架：未评审、未接入 profile、不可直接使用',
  );
}
