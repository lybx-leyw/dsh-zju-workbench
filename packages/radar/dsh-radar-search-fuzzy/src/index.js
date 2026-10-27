/**
 * dsh-radar-search-fuzzy —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**，
 * 只从 `./upstream.js` 取锁版凭据（那一个文件负责「上游长什么样」）。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 锁版引入 `fuse.js@7.5.0`（krisk/Fuse，Apache-2.0，★20,506），
 * 给「学习」页的分层检索**换掉最底层那一次文本比对**：
 *
 *   (a) 现有底层：`findIn(haystack, needle)` = `haystack.toLowerCase().indexOf(needle)`
 *       —— 纯字面子串（`layered-search.js` 文件头第 ⑥ 条自述）。一个字打错 / 音近写错，
 *       整条就**静默消失**，页面上只说「没有命中」。
 *   (b) 升级后：先字面（快路径，零回归），字面落空再走 Fuse 的 bitap 近似匹配，
 *       返回 `[start, end]`（闭区间）—— 正好能翻译成本仓 `matchStart/matchEnd` 的形状。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 不新增页面、不加插槽、不动导航。「学习」页的检索框
 *      与结果列表（`study-workspace.jsx` 的 `outcome = searchLesson(...)`）继续是
 *      唯一消费者，只是**同样的输入能多命中几条**。
 *   2. **仍是相似正交的功能** —— 现有：在 8 个层（终稿块 / 老师原话 / 图上的字 /
 *      术语表 / 讲义…）里做**同一套**字面检索；新增：**命中判据多了一种读法**
 *      （近似），层级、档位（`QueryMode`）、2×11 维筛选、`limit` 语义全部不变。
 *   3. **底层多调了更优质实现** —— 本仓只有 `indexOf`，**没有编辑距离、没有 bitap、
 *      没有逐条打分**；上游用 bitap + 模式预编译把「差一个字」也算命中，并回命中区间。
 *      差分证据见 README 的「实测差分」表（同一 `findIn` 语义、同一语料）。
 *
 * ── 边界（写在这里，免得实现时越界）────────────────────────────
 *
 *   - **不改 `QueryMode` 语义**。`titleOnly` / `tagFilter` 的「只在概述里找」「筛选只在
 *     标签档生效」由档位决定，替换底层**不得**顺手放宽。
 *   - **不引入排序**。Fuse 会按分数排序，但本仓**没有排序层** —— 接入时必须
 *     `throw` 掉分数、按 `(layer, 文档内偏移)` 原序重排，否则「结果条的先后」这一
 *     既有契约会被悄悄改掉。排序是 `dsh-radar-search-rank`（minisearch）那条轴的事。
 *   - **不做简繁 / 拼音**。那是 `dsh-radar-pinyin-match` 那条轴的事，本包只碰「近似」。
 *   - **不切词**。那是 `dsh-radar-search-segment`（jieba-wasm）那条轴的事。
 *   - **不替换写路径**（`renameLinks` / `resolve` 等），本包只碰 `findIn` 一处读路径。
 *
 * ── 三条已实测的硬约束（写进 TODO，不要在实现时忘掉）──────────────
 *
 *   R1. **命中集合必须 ⊇ 旧实现**。近似匹配只许「多出来」，不许「少下去」。
 *       所以字面那次 `indexOf` **不能删**，只能作为快路径前置。
 *   R2. **`minMatchCharLength` 不能固定**。固定 1 → 单字查询「的」在 8 条语料里
 *       命中 5 条（纯噪声）；固定 2 → 「傅利叶」这类**单字错拼**（换掉中间一个同音字）
 *       被漏掉，而那正是本包要解决的核心场景。→ 必须**分层扫描**，见 `scanOnce()`。
 *   R3. **`includeMatches` 的 `indices` 不保证有**。实测：多文档同一 `Fuse` 实例下
 *       `matches` 可能为 `undefined`，而单文档实例下稳定返回。所以**不能**假定
 *       `indices` 存在；取不到区间时只回「命中 / 未命中」，由调用方决定怎么给高亮。
 */

// 锁版凭据只从 `./upstream.js` 取 —— 骨架不在别处再写一遍版本号（否则会漂移）。
import { UPSTREAM_PACKAGE, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from './upstream.js';

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-search-fuzzy';

/** 让凭据在本模块可见（测试钉住三者与 `package.json` 一致）。 */
export const upstream = Object.freeze({
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  repository: UPSTREAM_REPOSITORY,
});

/**
 * 两档扫描参数 —— 数值来自本轮实测（README「实测差分」表），**评审时可调，但两档必须都在**。
 *
 * 为什么不只一档：单字错拼（「傅利叶」）与单字查询（「的」）对 `minMatchCharLength`
 * 的要求**相反**，一个固定值不可能同时满足 R2 的两半。
 */
export const SCAN = Object.freeze({
  /** 严格档：`minMatchCharLength = 2`。挡住单字噪声，覆盖「多字错拼 / 漏字」。 */
  strict: Object.freeze({ minMatchCharLength: 2, threshold: 0.4 }),
  /** 宽松档：`minMatchCharLength = 1`。**只在严格档零命中时启用**，覆盖「单字错拼」。 */
  relaxed: Object.freeze({ minMatchCharLength: 1, threshold: 0.4 }),
});

/**
 * 一次扫描（对**单个** haystack）。
 *
 * TODO-1 · 实现时按 `SCAN.strict` → 落空再 `SCAN.relaxed` → 最后并上字面命中。
 *
 *   为什么是「对单个 haystack」而不是「对整页建一个 Fuse 实例」：
 *   `searchLesson()` 的每一次 `findIn` 都是一个块 / 一句 / 一页，索引粒度天然是「一条」。
 *   对整页建实例会把**页内偏移**与**跨字段边界**搅在一起（R3 也提示多文档实例行为更不稳）。
 *   代价是每条建一次实例 —— 实测 1 条语料建实例约 0.02 ms，而一节课的候选文本量级是
 *   几百条，可接受；若评审认为不够，改成「每次 `searchLesson` 调用建一个实例、
 *   用 `setCollection()` 换语料」即可，但那样 R3 必须先复测。
 *
 * @param {string} haystack 被检索的文本（一个句子 / 一个块 / 一段讲义）
 * @param {string} needle   用户输入
 * @returns {{ tier: 'literal'|'strict'|'relaxed'|'miss', span: { matchStart: number, matchEnd: number } | null }}
 *   `span` 为本仓约定的**开区间**（`matchEnd` 不含）；`tier` 供 UI 说清「这次是猜的」。
 */
export function scanOnce(haystack, needle) {
  // 占位：评审通过后实现。
  //   1. literal：findIn(haystack, needle) 命中 → { tier:'literal', span }
  //   2. strict：new Fuse([haystack], {...SCAN.strict}) → 首条 → toLocalSpan()
  //   3. 落空则 relaxed
  //   4. 仍未命中 → { tier:'miss', span:null }
  throw new Error('候选骨架：scanOnce() 未实现（见 README，未评审）');
}

export async function apply(ctx, config = {}) {
  // 占位：**不要**在这里注册插槽、也不要在这里改 `layered-search.js`。
  // 评审通过后的正确落点是：把 `layered-search.js` 的 `findIn` 换成本包的 `scanOnce` 的
  // 「字面优先」变体，并让 `searchLesson` 的返回多带一个 `tier` 字段（供 UI 标注
  // 「近似匹配」）。那是改 `dsh-zhiyun-page-study` 的活，不属于本骨架。
  throw new Error('候选骨架：apply() 未实现（见 README，未评审）');
}
