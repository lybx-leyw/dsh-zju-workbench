/**
 * dsh-radar-knowledge-graph —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，**不含业务逻辑**。
 * 待人工评审通过后再逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把上游 `dsh-knowledge-graph`（MIT，npm `0.1.3`）**锁版挂载**进来，
 * 在**「笔记」页已有的那张 vault 图谱**上，补出它当前**结构性缺失**的那一半：
 *
 *   - 已有（`packages/dsh-zhiyun-core-vault`）：`[[链接]]` 构成的**链接图** ——
 *     反链、未解析链接、孤立节点、出入度。它回答「**我的笔记之间怎么连**」，
 *     边来自**用户自己写下**的 `[[…]]`。
 *   - 没有：**单篇源文内部**的知识结构 —— 概念、定义、例 / 反例、规则，
 *     以及「结论 ↔ 原文段落」的**双向锚点**。它回答「**这篇到底讲了什么**」，
 *     边来自**对正文的抽取**。
 *
 * 缺的这半边正是「考前翻笔记只看到标题、翻不到概念」的根因：链接图只连**篇**，
 * 不连**义**。
 *
 * ── 集成方式（A 类 · 锁版挂载 + 外围兼容层）──────────────────────
 *
 * 效法 `packages/dsh-zhiyun-host-paper`（上游 `@ggboy123/dsh-paper-reader` 锁版 `1.3.1`）
 * 与 `packages/dsh-zhiyun-page-paper`：
 *
 *   ❌ **绝不改上游源码**（上游 `lib/` 是构建产物，`dist/` 视情况随包发布）。
 *   ✅ `dependencies` 写**精确版本** `0.1.3`，**不用 `^`**（理由见 `./upstream.js`）。
 *   ✅ 由本包 `cordis.patch.yml` 把上游挂进 DSH 运行时。
 *   ✅ 主题注入 + 接管控件，在「笔记」页内承载，**不新增导航项**。
 *
 * ── 三条强化判据（同时成立才算强化式集成）──────────────────────
 *
 *   1. **仍是同一个面板** —— 「笔记」页（`dsh-zhiyun-page-notes`）。图谱是
 *      **vault 图谱的那张画布**，不是另起一页；上游自带的整页工作台
 *      **不整页挂载**（挂上去就违反本条，见 `./upstream.js` 的 (a)/(b)）。
 *   2. **功能仍相似正交** —— 同一批笔记、同一个问题「我刚才记的那个概念在哪」：
 *      vault 按**链接**找（我写过什么），上游按**语义**找（原文说了什么）。
 *   3. **底层多调了更优质实现** —— 本仓**没有任何**正文语义抽取能力：
 *      `dsh-zhiyun-core-vault` 只解析 `[[…]]` 与标签（纯函数、零 IO），
 *      `dsh-zhiyun-core-parser` 产出的是**逐句 ASR 转写 + 纠错**，不是概念级结构。
 *      自研等价物 = 本体设计 + 约束抽取 + 双向锚点 + 证据核验，规模不是「再写个解析器」。
 *
 * ── TODO（真正的适配点，评审前不要实现）────────────────────────
 *
 * 1. **挂载形状二选一（先定这一条，其余都取决于它）**
 *    (a) 只挂**宿主半边**（`/api/dsh-knowledge-graph` 路由 + `./store` 导出），
 *        由本包把「某篇笔记的语义图」喂给 vault 图谱画布；→ **推荐**，满足判据 1。
 *    (b) 整页挂载上游工作台（它自带 client UI）。→ **不满足**判据 1，
 *        评审应驳回，或改为在「笔记」页内**新增一个标签页**并明确记录这次让步。
 *
 * 2. **两张图的身份对齐（技术核心）** —— vault 的节点身份是**文件路径**
 *    （`vault.index()` 的键），上游的节点身份是**逻辑 `documentId`（随机 UUID）**
 *    + `sourceId`（全文 SHA-256）。两者**没有天然对应**：
 *    需在 `./upstream.js` 里建立「路径 ↔ documentId」映射，并定义
 *    「正文被改写（`sourceId` 变化）时旧锚点怎么办」——**这是本骨架最大的未知项**。
 *
 * 3. **写入边界** —— 上游会**写库**（抽取结果、审核记录、审计日志）。
 *    本仓「笔记」页的写入口是**用户自己的 Markdown 文件**。
 *    **禁止**让上游直接改写笔记正文；抽取产物只能落在上游自己的 store 里，
 *    由用户在页面上**确认后**才作为「附加视图」呈现（对齐本仓「不另开写入口」惯例）。
 *
 * 4. **持久化栈** —— 上游自带 SQLite（常驻模式保存全文 + canonical graph + checkpoint），
 *    而本仓 `dsh-zhiyun-core-knowledge` 的硬约束是「**持久化只用宿主存储栈**、
 *    一行文件 IO 都没有」（见该包 README 与 `tests/knowledge.test.mjs` 的自检）。
 *    这两件事**不能同时成立**：要么接受上游自带 SQLite（需评审明确豁免），
 *    要么只挂只读接口、放弃它的 checkpoint 续跑。
 *
 * 5. **成本与出口** —— 上游靠 LLM 抽取，且面向**书级正文（最长约 100 万字符）**。
 *    接进「笔记」页必须默认**按单篇、手动触发**，不得随打开页面自动跑；
 *    需在设置里给出「用哪个模型 / 是否只跑一次」的开关，并复用本仓既有的用量口径。
 *
 * 6. **样式与插图** —— 上游复用 `__ModuleLoader__` 与自身 UI；本仓页面用 `zpl-` / `zv-` 前缀。
 *    同页共存的层序需在接入前确认；上游「图片解读」依赖 DSH `attachments.saveImages()`，
 *    本仓笔记库目前不存图片附件（`![[图片.png]]` 只做嵌入解析）→ 首版**关掉图片路径**。
 */

export const name = 'dsh-radar-knowledge-graph';

/** 占位：本骨架**不实现任何业务逻辑**，仅登记元信息供评审。 */
export const RADAR_SKELETON = {
  status: 'candidate-skeleton',
  reviewed: false,
  wiredIntoProfile: false,
  upstream: 'dsh-knowledge-graph',
  upstreamVersion: '0.1.3',
  upstreamLicense: 'MIT',
  upstreamRepo: 'https://github.com/cwbcheng/dsh-knowledge-graph',
  integration: 'A · 锁版挂载 + 外围兼容层',
  enhances: 'dsh-zhiyun-page-notes / dsh-zhiyun-core-vault 的「链接图」→ 补「语义图」',
};

export function apply() {
  throw new Error(
    'dsh-radar-knowledge-graph 是候选骨架，尚未实现。见 README.md 与 ./upstream.js 的 TODO。',
  );
}

export default { name, apply };
