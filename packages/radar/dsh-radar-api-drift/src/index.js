/**
 * 能力漂移骨架（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。`apply()` 只打一行日志，
 *    不注册页面、不注册 slot、不注册工具。评审驳回则整目录删除。
 *
 * # 一句话
 *
 * 本仓的「插件」页（`dsh-zhiyun-page-plugins`）回答的是**「关掉谁会不会连坐」**：
 * 它读 `ctx.loader` / `ctx.registry` / `ctx.reflect` 与宿主 `/api/zhiyun-plugins` 拿到的模块边，
 * 按 `orderByModuleGraph` 排拓扑序，标出叶包/支撑包，另有一份 `src/usage.js` 账本记「用没用过」。
 *
 * 它**不回答**：**宿主升了一版之后，这一排插件里谁的接口已经对不上了。**
 *
 * 这不是推断：全 `packages/` 内（除 `packages/radar/`）**零处** `registry.npmjs.org` 查询
 * （`grep -rln "registry.npmjs.org" packages/ --include=*.js --include=*.jsx` → 空），
 * 也**零处** `peerDependencies` / `engines` 求值。也就是说：一个插件声称只支持 `cordis <5`
 * 而宿主已经到 5，页面上看不出来；它照样是「已启用」，照样不挡任何人的路。
 *
 * # 定性：**强化式集成**（不是「全新」）
 *
 * | 判据 | 本包怎么满足 |
 * | --- | --- |
 * | ① 仍是同一个面板 | 上到 `zhiyun.plugins.content` 同一槽位，**不新增导航项** |
 * | ② 功能仍相似正交 | 现有答「依赖**包名**连坐」+「用没用过」；本条答「依赖**版本**是否还成立」 |
 * | ③ 底层多调了更优质实现 | ⚠ **待评审核实**（见 TODO-0）。若判定不成立 → 降为「重复且无增益」，整目录删 |
 *
 * 判据③是这一轮唯一没把握的地方：本包的计算是**纯函数**，上游 0.3.1 的检查项里有
 * 「version compatibility」，但它同时把 profile / bundle / patch / MCP 冲突四件事都做了，
 * 且**没有 npm 包**（404），能不能当作「更优的底层」要靠评审读源确认。
 * 读源前不假设成立 —— 这也是它只出骨架、不接 profile 的原因。
 *
 * # 不做什么
 *
 * - 不读上游源码、不摘码（npm 404 → 不可锁版）；
 * - 不动 `packages/radar/` 以外任何包；
 * - 不联网做任何写操作：本包想做的唯一网络动作是**读** registry 的 `dist-tags`，
 *   且**只在评审通过后**才会真的发（见 `src/drift.js` 的 `fetchLatest` 形状）。
 */
export function apply(ctx) {
  ctx?.logger?.info?.('[dsh-radar-api-drift] 候选骨架，未实现');
}

/**
 * TODO-0（**阻塞**，不定这条不该评审通过）：
 * `drift.js` 的输入真源取哪一份？
 *
 *   - **A. 宿主的模块图**（`ctx.modules.manifest.modules`）：零新路由、零网络，
 *     但**只有边、没有版本约束** → 只能做「谁依赖谁」，做不了「支持的版本还覆盖吗」。
 *   - **B. 每包 `package.json` 的 `peerDependencies` / `engines`**：这才是版本约束的真源。
 *     `dsh-zhiyun-page-plugins` 的宿主半边 `/api/zhiyun-plugins` **已经在读这两份 package.json**
 *     → 要么在那条路由上多返回两个字段，要么新开 `/api/zhiyun-plugin-drift` 并在
 *     `plugin-manager/changed` 时一起失效。**两者择一，不要各做一半**（同 r123 结论）。
 *
 * TODO-1：**默认关**。版本漂移对多数用户是噪声，只在「宿主刚升级完、某个插件行为变了」时才需要看。
 *
 * TODO-2：`fetchLatest()` 会联网。默认**不自动跑**；必须由用户点一次「检查更新」触发，
 *   且结果带时间戳 —— 与本仓「读不到就显示读不到，不显示 0」的既有口径一致。
 *
 * TODO-3：若评审结论是「内联即可」，删除本包，把 `src/drift.js` 的形状挪进
 *   `dsh-zhiyun-page-plugins`（它已经在读同一批 `package.json`，内联的边际成本最低）。
 */
