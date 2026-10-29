/**
 * dsh-radar-bbob —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**，
 * 只从 `./upstream.js` 取锁版凭据（那一个文件负责「上游长什么样」）。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 锁版引入 `@bbob/core@4.4.1` + `@bbob/preset-html5@4.4.1`
 * （JiLiZART/BBob，MIT，★200，push 2026-10-26），
 * 给 CC98 的**读侧正文转换**换一种中间表示：
 *
 *   (a) 现有底层：`packages/dsh-zhiyun-source-cc98/src/ubb.js` 的
 *       `ubbToText(content) → string` —— 78 行手写正则，输出**纯文本**。
 *       契约是 string，所以下面这些**结构上不可能保留**：
 *         · `[quote]` 的**嵌套深度**（两层与一层都压成行首一个 `> [引用]`）；
 *         · 每段文字对应**原文的哪个字符区间**（无处可锚，无法"点正文定位原句"）；
 *         · `[color=red]` / `[size=5]` 的**样式语义**（一律剥成空）；
 *         · `[图片: url]` 占位符与用户手打同一串字**不可区分**。
 *   (b) 升级后：`parse(content, opts) → AST`，每个 tag 节点带
 *       `start:{from,to}` / `end:{from,to}` 的**原文字符偏移**，`[quote]` 保留**真实嵌套**。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三问见 README）──────────
 *
 *   1. **仍是同一个面板** —— 4 个调用点（`reads.js:106 / :347 / :384 / :430`）都在
 *      `dsh-zhiyun-source-cc98` 内，服务同一条 CC98 正文读路径；不新增页面、不加插槽。
 *   2. **仍是相似正交的功能** —— 同一个输入（UBB 字符串）、同一个出口（正文），
 *      只把**中间表示**从 string 换成 AST。不是第二套渲染器，是同一层的升级。
 *   3. **底层多调了更优质实现** —— 「嵌套层级」与「字符偏移」本仓**为 0**；
 *      上游直接给。条件是 `[code]` 必须走本仓正则（见 README §风险）。
 *
 * ── ⚠ 一条硬约束（评审前必读）──────────────────────────────────
 *
 *   实测 `parse('[code]if [b]x[/b] > 1[/code]')` **默认会把 `[b]` 解析成真 bold 节点**。
 *   在 CC98 里代码块内容必须是字面量 —— 直接接管会**改坏正文**。
 *   用 `{ contextFreeTags: ['code'] }` 能修语义，但代价是**块内偏移失效**
 *   （内容被切成 `"["`, `"b]x"`, `"["`, `"/b]"` 等多个片段）。
 *   所以唯一的走法：**缝合层** —— `[code]` 段先由本仓正则摘出、原样保留，
 *   其余片段再交 BBob。见 `./upstream.js` 的 TODO-C1。
 */

/**
 * 候选占位：**故意抛错**，防止任何环境误挂载。
 *
 * @param {import('cordis').Context} _ctx
 */
export function apply(_ctx) {
  throw new Error(
    'dsh-radar-bbob 是候选骨架（未评审），不可直接挂载。' +
      '见 README.md：先完成 TODO-C1（[code] 缝合层）与 TODO-C2（偏移回指验证）。',
  );
}

/**
 * 读取锁版凭据。**评审通过前不要在实际转换路径里调用它。**
 *
 * @returns {{ package: string, version: string, license: string, repo: string }}
 */
export function upstreamManifest() {
  return {
    package: '@bbob/core',
    version: '4.4.1',
    license: 'MIT',
    repo: 'https://github.com/JiLiZART/BBob',
  };
}

/**
 * TODO（评审通过后逐条落实，**不在此骨架内实现**）
 *
 * TODO-C1 · `[code]` 缝合层（**前置条件**）
 *   - 先用 `/\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]/gi` 把 `[code]…[/code]` 整段**占位化**
 *     （与 `dsh-zhiyun-source-cc98/src/ubb.js` 的处理保持一致）；
 *   - 剩余片段交 `parse()`；未闭合的 `[code]`（站点历史写法）需单独兜底；
 *   - 重组时把占位符换回原文，并**重新计算**拼接点的偏移。
 *
 * TODO-C2 · 偏移回指验证
 *   - 断言：对任意节点，`content.slice(start.from, end.to)` 等于该节点的**原始标记**；
 *   - 这是「偏移可信」的唯一证明。**不得**用"看起来对"替代。
 *
 * TODO-C3 · `[upload]url` 无闭合写法
 *   - 实测 BBob 把它解析成 `{tag:"upload"}` **兄弟节点 + 后面的 URL 字符串**，
 *     而本仓 `ubb.js` 把它算成 `[文件: url]`。缝合层需按本仓语义**重组为同一节点**，
 *     否则会与现有输出不一致（属回归）。
 *
 * TODO-C4 · 表情编号
 *   - 本仓把 `[ac01]` 一律压成 `[表情]`（丢编号）；BBob 原样给 `{tag:"ac01"}`。
 *   - **先决定要不要保留编号**（关系到表情图能否显示），再决定是否沿用本仓行为。
 *
 * TODO-C5 · 富文本分支（`contentType === 1`）
 *   - 4 个调用点里 `contentType===1` 直用纯文本的分支**必须原样保留**，
 *     BBob 只接管 UBB 分支。改动越界会破坏已上线行为。
 */
