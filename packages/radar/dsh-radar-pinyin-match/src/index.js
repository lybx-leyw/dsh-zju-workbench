/**
 * dsh-radar-pinyin-match —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑，也不 import 上游。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 锁版引入 `pinyin-match@1.2.10`（xmflswood/pinyin-match，MIT，★1072），
 * 给「学习」页的分层检索**换掉最底层那一次文本比对**：
 *
 *   (a) 现有底层：`findIn(haystack, needle)` = `haystack.toLowerCase().indexOf(needle)`
 *       —— 纯字面子串，**不切词、不算相关度**（`layered-search.js` 文件头第 ⑥ 条自述）。
 *   (b) 升级后：先字面（快路径，保持现状零回归），字面落空再走 `pinyin-match`：
 *       汉字 / 全拼（`cengjing`）/ 首字母（`dzdj`）/ 繁体（`lisao` 命中「離騷」）四路合一，
 *       且返回 `[start, end]` 字符区间 —— 正好是本仓 `matchStart/matchEnd` 要的形状。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 不新增页面、不加插槽、不动导航。「学习」页的检索框
 *      与结果列表（`study-workspace.jsx`）继续是唯一消费者，只是**同样的输入能多命中**。
 *   2. **仍是相似正交的功能** —— 现有：在 8 个层（终稿块 / 老师原话 / 图上的字 /
 *      术语表 / 讲义…）里做**同一套**字面检索；新增：**命中判据多了一种读法**
 *      （读音），层级、档位（`QueryMode`）、2×11 维筛选、`limit` 语义全部不变。
 *   3. **底层多调了更优质实现** —— 本仓只有 `indexOf`，**没有拼音表、没有多音字、
 *      没有首字母、没有繁简映射**；上游用 27KB 字典 + DP 切分（`wordBreak` / `getAllSolutions`）
 *      把「一串连续字母」切成若干音节再对齐汉字，这是本仓写不出来的量级。
 *      差分证据见 README 的「实测缺口」表。
 *
 * ── 边界（写在这里，免得实现时越界）────────────────────────────
 *
 *   - **不改 `QueryMode` 语义**。`titleOnly` / `tagFilter` 的「只在概述里找」「筛选只在
 *     标签档生效」这些规则由档位决定，替换底层**不得**顺手放宽。
 *   - **不引入相关度排序**。上游只回区间，不回分数；本仓也没有排序层。
 *     一引入排序就会改变「结果条的先后」这一既有契约，属于另一个议题。
 *   - **不做简繁自动转换后再索引**。`opencc-js` 可做「查前把库转繁 / 转简」的镜像索引，
 *     但那是**常驻 1.1MB 字典**，且会改变正文的显示形态。本轮只做「查询侧多一种读法」。
 *   - **不替换 `renameLinks` 等写路径**。本包只碰 `findIn` 一处读路径。
 */

/** 上游包名与锁定的版本（与 package.json 的 dependencies 必须逐字一致）。 */
export const UPSTREAM = 'pinyin-match';
export const UPSTREAM_VERSION = '1.2.10';

/** 上游两个入口：简体字典 / 繁体字典（繁版 86KB，按需动态加载）。 */
export const ENTRY_SIMPLIFIED = `${UPSTREAM}/lib/main.js`;
export const ENTRY_TRADITIONAL = `${UPSTREAM}/lib/traditional.js`;

export const name = 'dsh-radar-pinyin-match';

/**
 * 占位：评审通过前不注册任何东西。
 *
 * 候选骨架**不得**被 profile 引用，所以这里直接抛错 —— 万一有人误挂，
 * 应当当场失败，而不是静默加载一个半成品。
 */
export async function apply() {
  throw new Error(
    'dsh-radar-pinyin-match 是候选骨架（未评审、未接入 profile、不可直接使用）。'
    + ' 见 README「评审前必须回答的三个问题」。',
  );
}

/**
 * TODO-1 · 替换点只有一处：`layered-search.js` 的 `findIn()`。
 *
 *   ```
 *   // 现在
 *   export function findIn(haystack, needle) { … indexOf … }
 *   // 改后（示意，不是实现）
 *   export function findIn(haystack, needle) {
 *     const literal = literalFind(haystack, needle);
 *     if (literal) return literal;          // 快路径：保持现状，零回归
 *     return pinyinFind(haystack, needle);  // 慢路径：只在前者落空时走
 *   }
 *   ```
 *
 * ⚠ 快路径必须**先**走。上游 `match()` 是「整串按拼音切分 + 顺序对齐」，一对字符切不开
 * 就整体回 `false`（实测 `match('老子《道德经》…', 'lzdj') → false`）；且它对字面串也可能
 * 误切。若让它接管全部查询，就是**功能回退**。见 README「已知风险 R1」。
 */

/**
 * TODO-2 · 双字典选择。
 *
 *   实测（2026-10-19，`dist/main.js` 与 `dist/traditional.js`）：
 *
 *   | 文本 | 查询 | 简体入口 | 繁体入口 |
 *   | --- | --- | --- | --- |
 *   | 「老子《道德经》…」 | `ddj` | ✅ [3,5] | ✅ [3,5] |
 *   | 「離騷 屈原…」 | `lisao` | ❌ false | ✅ [0,1] |
 *   | 「離騷 屈原…」 | `離騷` | ✅ [0,1] | ✅ [0,1] |
 *
 *   结论：**简体入口只对含待匹配简体字的文本有效**，纯繁体文本的拼音查询需繁体入口。
 *   因此建议：默认只加载简体入口；繁体入口做成**懒加载**（拼音查询落空且文本含繁体字符
 *   时才 import）。⚠ 不要静态 import 两份（+86KB）。
 */

/**
 * TODO-3 · 与 `limit` 和 `branchFull()` 的交互。
 *
 *   `searchLesson()` 每个分支各自 `limit` 截断。拼音匹配会让命中数**变多**，
 *   同一 `limit` 下结果会「更早截断」—— 这是行为变化，必须在评审里显式说明，
 *   并补一条差分测试（同一 query 下，旧实现的命中集合 ⊆ 新实现的命中集合）。
 *   集合包含关系是「强化式集成」的可验证判据，不是口号。
 */

/**
 * TODO-4 · 性能与体积预算。
 *
 *   - 上游简体版 27KB（gzip ≈19KB），`lib/main.js` 28KB；**无运行时依赖**（npm 实测 deps = []）。
 *   - `match()` 对长串做了 DP 切分，最坏情况随 query 长度指数上升的风险在上游
 *     已用 `possible[]` 剪枝处理，但**本仓必须在浏览器主线程之外做一次基准**：
 *     取最长的老师原话块（实测有整页几百字的块），测 1000 次 `match` 的 P95。
 *   - 若 P95 超过 1ms，改为「只在字面落空且 query 全为小写字母时」才进入慢路径。
 */
