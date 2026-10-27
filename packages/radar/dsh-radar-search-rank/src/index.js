/**
 * dsh-radar-search-rank —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把「学习」页 §Layered 检索（`dsh-zhiyun-page-study/src/layered-search.js`）里
 * **「字面子串 + 按扫描顺序」** 这一层，换成 `minisearch@7.1.2` 的
 * **「字段加权 + 前缀 + 相关度排序」**。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）─────────────
 *
 *   1. **仍是同一个面板** —— 学习页正文检索框，不新增页面、不改导航、不改档位。
 *   2. **功能仍相似正交** —— 都是「在一节课的整理结果里找那句话」；
 *      旧实现答「有没有」，新层答「哪条更贴题」，不是两套并列能力。
 *   3. **底层多调了更优质实现** —— 本仓 `layered-search.js` 文件头第 ⑥ 条自述：
 *      > 匹配是**字面**子串（大小写不敏感、**不切词、不算相关度**），不是向量检索。
 *      minisearch 提供分词、字段加权（`summary` 10 / 正文 1）、前缀匹配与 BM25 类打分，
 *      这三样是现有实现**没有**的。
 *
 * 缺任何一条都只能算重复集成，应当拒绝。
 *
 * ── 现场证据（2026-10-20 实测，fixture 见 §报告 L-1）────────────────
 *
 * 直接 `import` 本仓真实的 `searchLesson()` 跑的（不是重写）：
 *
 *   | 现象 | 本仓现在 |
 *   | --- | --- |
 *   | 命中**顺序** = `blocks` 数组顺序 | 「均值不等式」在 block#1 的**摘要里**、在 block#0 的正文里 → 先出 block#0 |
 *   | 摘要（`tag.summary`）**只在 `titleOnly` 档位**参与匹配 | `titleBody` 档位下摘要命中不单独出条 |
 *   | 层被裁掉时**静默返回空** | `layers` 传空集 → 0 命中、`counts: {}`、**不报错** |
 *   | 无切词 | 「守恒」命中「动量守恒」「能量守恒」，但两者**同分并列**（都是子串） |
 *
 * 前两条是本骨架要解决的问题；第三条**必须**修正（见 TODO-0）。
 *
 * ── 集成方式（B 类：能力提取 + 封装）──────────────────────────────
 *
 *   ❌ 不改上游源码（`minisearch` 只作为依赖引入）。
 *   ❌ **不改 `layered-search.js` 的语义** —— 档位、2×11 维先筛后扫、
 *      「筛了维度只有块层出结果」这些规则是这个包**必须继承**的，不是可以优化的。
 *   ✅ 本包只做一件事：**对同一个命中集合重新排序**。
 *      并列规则完全交给页面侧，本包不替它决定。
 *
 * ── TODO（评审通过后再动）────────────────────────────────────────
 *
 *   [ ] TODO-0（**先修这个再谈接入**）：`defaultSearchLayers` 是 `Set`，但
 *       `layered-search.js` 的 `searchLesson()` 用 `layers instanceof Set ? layers : new Set(layers ?? [])` 归一化，
 *       传空集/未配置时**静默返回 `empty:true` 与零命中**。本仓
 *       `study-workspace.jsx` 的 `const wanted = layers ?? defaultSearchLayers;` 恰好绕过了它，
 *       但任何**新的调用方**（包括本包）都会踩。必须在页面侧或 `layers.js` 里
 *       把「未指定层」与「指定了空层」区分开，否则接入后会出现「明明有内容却搜不到」。
 *   [ ] TODO-1：中文 `tokenize` —— 用 `Intl.Segmenter('zh', {granularity:'word'})`
 *       （零依赖，Node 22 / Chromium 均可用）还是复用本仓已有的分词（若有）？
 *       两者都要过 `tests/` 里的中文夹具（覆盖「动量守恒」「∑a²」「p=mv」「a=b」四种形态）。
 *   [ ] TODO-2：字段与权重 —— 候选：`summary`(10) / `sentence.text`(1) / `lecture.title`(5) /
 *       `glossary.term`(8)。**权重必须用差分测试证明**：对同一批查询，
 *       新顺序与旧顺序的「先出的那条是不是用户要点的那条」计数比较，不能只凭手感。
 *   [ ] TODO-3：**层语义不得改变** —— 新增的排序只能调整顺序，**不得**让
 *       `tagFilter` 档位下出现页面层/主线层的命中（那会破坏 2×11 维的「先筛后扫」）。
 *       做法：由页面把已算好的 `outcome.hits` 交进来，本包**只排序、不增删**。
 *   [ ] TODO-4：`hitBlockIndexes()` / `counts` / `omitted` 三个读数必须与旧实现**逐字段一致**
 *       （排序会改变 `omitted` 截断的是谁，评审需确认这是有意的）。
 *   [ ] TODO-5：模糊/前缀的默认值 —— `prefix` 默认开（中文输入法常给半个词），
 *       `fuzzy` 默认**关**（会把「∑a²」打成噪声）。
 *   [ ] TODO-6：体积 —— minisearch 7.1.2 的 gzip 体积需实测并写进 README；
 *       本仓是**首屏敏感**的学习工作台，超过 30 KB gzip 需重新评估（或改按需 `import()`）。
 *   [ ] TODO-7：补 `tests/radar-search-rank.test.mjs`，断言「声明版本 === 安装版本」，
 *       并钉住 TODO-3 的不变量（排序不增删命中）。
 *
 * @module dsh-radar-search-rank
 */

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-search-rank';

/** 本包只 `provide` 一个服务，不 `inject` 任何宿主服务（与页面侧解耦，评审后可整体摘除）。 */
export const inject = [];

export function apply(ctx) {
  ctx.provide('radarSearchRank', {
    /** 上游标识（诊断用；不参与业务）。 */
    upstream: { package: UPSTREAM_PACKAGE, version: UPSTREAM_VERSION },
    /**
     * 对页面已算好的命中集**重新排序**；不增删、不改字段。
     *
     * @param {object} _outcome `searchLesson()` 的返回值（只读）
     * @returns {object} 同形状的 outcome，`hits` 顺序可能不同
     * @throws {Error} 未实现 —— 评审通过后按 TODO-2 / TODO-3 落实
     */
    rerank(_outcome) {
      throw Object.assign(new Error('radar-search-rank: 候选骨架，未实现（见 src/index.js TODO-2）'), {
        code: 'NOT_IMPLEMENTED',
      });
    },
  });
}
