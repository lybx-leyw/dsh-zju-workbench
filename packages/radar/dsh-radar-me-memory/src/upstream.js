/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * A 类骨架的规则是「锁版挂载上游 + 外围兼容层，**绝不改上游源码**」。
 * 这里把「我们适配的到底是哪个版本、它长什么样」集中到一处，
 * 是为了让评审能一眼核对，而不是在 README 与 package.json 之间来回比。
 */

export const UPSTREAM_PACKAGE = 'dsh-auto-memory';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同（不写 `^`）。 */
export const UPSTREAM_VERSION = '0.9.0';

/** 上游许可证：MIT ✅（npm `license` 字段与仓内 LICENSE 实文一致，2026-10-20 核）。 */
export const UPSTREAM_LICENSE = 'MIT';

export const UPSTREAM_AUTHOR = 'AskTheWay';

export const UPSTREAM_REPOSITORY = 'https://github.com/AskTheWay/dsh-auto-memory';

/**
 * 上游**宿主侧**能给我们什么（评审时逐条核对；本骨架不替他证明）。
 *
 * 这三条来自上游 README 与 `lib/` 的对外形状，是**集成的前提**，
 * 而不是本包自己实现的东西：
 *
 *   1. **工具**：`memory_write` / `memory_read` / `memory_list` / `memory_delete`，
 *      经 `ctx.tools.register()` 注册，随插件 dispose 一并撤走。
 *   2. **提示段**：一段 systemPrompt section（order 4000），内容为 MEMORY.md 索引，
 *      **存储为空时整段消失**（自述「无记忆时零 token」—— 这一条本骨架没测过，见 README）。
 *   3. **写入纪律**：同一事实**原地更新**而非堆积（0.7 起的语义），
 *      跨进程锁 + 孤儿锁自愈。
 *
 * ⚠️ 上游**不是** SQLite/FTS5，是纯 Markdown 文件（`$DSH_HOME/memory/`）。
 * 这一点是本轮选它而没选 `Jesse-njx/dsh-memory` 的**主因**：
 * 后者的 FTS5 在无该编译选项的 `node:sqlite` 上**加载即抛错**（第四十二轮报告 §2.1 实测）。
 */
export const UPSTREAM_HOST_SURFACE = Object.freeze([
  '工具：memory_write / memory_read / memory_list / memory_delete',
  '提示段：systemPrompt section（order 4000，空存储时整段消失）',
  '写入纪律：同事实原地更新，跨进程锁 + 孤儿锁自愈',
]);

/**
 * 上游 **client 半边**必须**不挂**的东西 —— 这是判据①的落点，写死在这里防评审时顺手放开。
 *
 * 已核（读打包后 `lib/client.js:1589–1595`）：
 *   `ctx.slots.inject("main", …)` 注册 `MemoryPage`，`key = PANEL_ID`；
 *   `ctx.slots.inject("sidebar.panellist", …)` 注册 `MemoryPanelIcon`，`order = 50`。
 *
 * 即：一旦挂上游 client，「我的」页之外会**多出一个顶层页 + 一个侧栏项**，
 * 用户看到的是「两个记忆入口」，而不是「同一个面板里多了一块」。
 */
export const MUST_NOT_MOUNT = Object.freeze([
  'main（顶层页）',
  'sidebar.panellist（侧栏项）',
]);

/**
 * 本骨架**明确不从上游取**的东西。
 *
 * 写下来是因为「强化式集成」最常见的走形，不是接错了库，而是**顺手把上游的策略也一起接了**：
 *   · 不采用上游的**全机单库**布局 —— 本仓所有学习数据按 `accountId` / `courseId` 切分，
 *     记忆若全机一份，换账号就能看到别人的事实，这是隐私事故而不是配置问题；
 *   · 不采用上游的**默认提示预算**（promptMaxChars 默认 2000）—— 中文的一个字约等于
 *     英文一个 token 的数倍信息量，同一个字符数在中英两边**不是同一个预算**，须重测；
 *   · 不让记忆**回填**进知识库（`dsh-zhiyun-knowledge`）—— 「我记得」与「库里有」
 *     是两件事，混掉之后引用就不可复核。
 */
export const NOT_ADOPTED = Object.freeze([
  '全机单库布局（须按账号切分）',
  '默认提示预算 promptMaxChars=2000（中英不同量纲，须重测）',
  '记忆回填知识库（会毁掉「可复核」）',
]);
