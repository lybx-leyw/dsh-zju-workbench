/**
 * dsh-radar-hook-order —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**：只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**
 * （`@tengxiaohtx/dsh-plugin-hooks-ordering`），只从 `./upstream.js` 取锁版凭据。
 * `apply()` 直接抛错 —— 万一有人误挂，**立刻响**，而不是静默转成一个
 * 「看起来装了、顺序其实还靠加载时序」的包。
 *
 * ── 这个包想做什么（强化式集成，不是新建功能）───────────────────────
 *
 * 本仓的 hook 使用方式有一个隐性风险：**一个都还没用，但只要开始用，就会立刻踩到。**
 *
 * 实测（2026-11-10，`grep -rn "'agent/pre-step'" packages/` 等）：
 *
 *   agent/pre-step           0 处订阅
 *   tools/post-execute       0 处订阅
 *   llm/stream               0 处订阅
 *   system-prompt/assemble   0 处订阅
 *   agent/turn-stopping      0 处订阅
 *   prepend 关键字           0 处
 *
 * 这意味着两件事同时成立：
 *   ① 现在挂上**零风险**（全是空链，透明透传）；② 现在挂上**零收益**。
 *
 * 真正的价值在 ③：等 `dsh-radar-diff-approval`、通知、预算闸这些骨架陆续落地，
 * 它们会**同时**订阅 `tools/post-execute`；到那时谁先跑，由 Cordis 的注册时序决定，
 * 而注册时序受 `inject` 激活顺序影响 —— **不是任何人能声明的**。
 * 上游给的正是这个缺失的声明面：`before` / `after` + 稳定拓扑排序。
 *
 * ⇒ 三条判据：
 *   ① 仍是同一个面板 —— 上游**不新增任何面板、入口、命令**。它挂的是 Cordis service
 *      （`HookOrdering` / `SerialHookOrdering`），改变的是**既有 hook 的执行顺序**。
 *      用户界面上零变化，这在判据①里是最强的一种（连「嵌回原面板」都不需要）。
 *   ② 功能仍相似正交 —— 同一组 hook、同一批订阅者、同一份输出；正交的是**相对次序**。
 *   ③ 底层多调了更优质实现 —— 宿主的排序原语只有布尔 `prepend`（且「最后 prepend 者胜」），
 *      上游是 **bracket + 稳定拓扑排序 + 环检测**（`OrderingCycleError`）。
 *      这三样**不可能**靠本仓几行自研追平：环检测是正确性问题，不是风格问题。
 *
 * ── 为什么 `apply()` 抛错，而不是「先空着」───────────────────────────
 *
 * 空 `apply()` 在这里格外误导：排序是**隐式**的，装没装上都看不出来。
 * 评审会以为「已集成」，实际顺序还是老样子 —— 直到某天出问题才发现从没生效。
 *
 * ── TODO 一览（TODO-0 是真正的阻塞项）────────────────────────────────
 *
 *   TODO-0【阻塞 · R-1】「现状到底会不会乱」的实证。
 *         上游论证的是 **dsh 上游发行版**里 `agent/pre-step` 有十余个独立订阅者。
 *         **本仓不是那个发行版**：本仓 `agent/pre-step` 订阅数为 **0**。
 *         动作：拿本仓真实 profile 枚举 **已装包**（含 `packages/vendor/` 下的第三方）
 *         各自的 hook 订阅，列出「同一 hook 上有 ≥2 个互不知情的订阅者」的清单。
 *         若清单为空 ⇒ 本包**当前无收益**，应打成 🔵 留档而非推进；
 *         若非空 ⇒ 逐条核对它们是否**真的**顺序敏感（顺序错了结果会不会不同）。
 *         **不做这一步就接入，等于为一个还不存在的问题付故障面。**
 *
 *   TODO-1【阻塞 · R-2】apply LAST 的保证方式。
 *         上游 patch 注释明写：bracket 是 prepend 的，若在原生监听器注册**之前**加载，
 *         后注册的原生插件再 prepend 就会落到 bracket 外面，**逃出排序**。
 *         本包是 bundle patch，加载位次由 profile 叠加顺序决定。
 *         动作：确认本仓 profile 的叠加顺序能让本包**排在最后**；
 *         若不能，必须改由用户 `cordis.patch.yml` 末行插入（那就是部署文档问题，不是代码问题）。
 *
 *   TODO-2【阻塞 · R-3】控制面收窄的取舍。
 *         本包 `cordis.patch.yml` 只控 4 个 hook（不是上游的 13+1）。
 *         多控一个 hook = 多一份「本仓策略压过第三方隐式假设」的风险。
 *         动作：按 TODO-0 的清单**逐条放行**，并在 README 记「为什么放它」。
 *         默认只给「本仓确定会用、且确定顺序敏感」的，其余保持不控。
 *
 *   TODO-3 serial hook 要不要控。
 *         本仓 `agent/turn-stopping` 订阅数 0。空 serial coordinator 仍会注册两个
 *         coordinator（front prepended / back appended），有「短路整条 dispatch」的能力。
 *         ⇒ 当前配置 `serialHooks: []`。等真有订阅者再开。
 *
 *   TODO-4 观测：`log: './radar-hook-order-dag.json'` 会写约束 DAG。
 *         要确认两件事：写在哪（工作区根？会不会被 git 收进去？）、轮转策略。
 *         一个每次注册都写的 JSON，长期会变成又一个没人看的日志坟场。
 *         更好的落点可能是接进既有的插件页（`page-plugins`）作为一个只读视图，
 *         而不是放任它写文件 —— 但那是评审决策，骨架不替它决定。
 *
 *   TODO-5 与 `dsh-radar-plugin-graph` / `dsh-radar-plugin-caps` 的边界。
 *         那两个画的是「插件之间的依赖/能力关系」（静态、图上）。
 *         本包管的是「同一条 hook 上订阅者的**执行次序**」（动态、运行时）。
 *         二者可以在同一个视图里**并存**（依赖边 + 顺序边），但**不能合并成一个包** ——
 *         一个是描述，一个是干预。
 *
 *   TODO-6 锁版核对：运行时比对 `UPSTREAM_VERSION` 与
 *         `require('@tengxiaohtx/dsh-plugin-hooks-ordering/package.json').version`，
 *         不一致时**报警但不拦启动**（一条 bundle 抛错会让整个工作台起不来）。
 *         另注：上游 `engines.node` 是 `^22.19.0 || >=24.0.0`，本仓 Node 22.13.0
 *         **低于下限** —— 这是 R-4，不是小事。
 */

export const name = 'radar-hook-order';

/**
 * 上游是 Cordis service 插件，注入面取决于它挂哪个 service。
 * 骨架阶段刻意**只声明 `tools`**：声明越宽，越容易在「其实没装上」时看起来像装上了。
 */
export const inject = ['tools'];

export async function apply() {
  throw new Error(
    'dsh-radar-hook-order 是候选骨架，未评审、不可挂载。' +
      '评审通过后请按 README 的 TODO 顺序实现（先 TODO-0 实证「现状会不会乱」，再写代码）。',
  );
}
