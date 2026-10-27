// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 `media-captions`（MIT，零依赖，VTT/SRT/SSA 解析器，锁版 1.0.4）
//       接进「字幕」页与「终稿」的**原文层**，让本仓第一次拥有「标准的字幕结构」。
//
// 上游：https://github.com/vidstack/captions     ★149（push 2026-09-09，活跃）
//       npm: media-captions@1.0.4（**必须写死**：dist-tags.latest 停在 2023 年的 0.0.18）
//       许可证：MIT ✅（GitHub metadata 与 npm `license` 两处一致）
//       体积：unpacked 162,428 B（≈159 KB），**零运行时依赖**，纯 ESM
//
// 性质：**B 类（其他 JS 项目）· 强化式集成**。上游不是 DSH 插件，没有 `dsh.bundle.patch`，
//       因此本包**没有** `cordis.patch.yml` —— 接入点在宿主页面内部，由人工评审决定挂哪。
//
// # 这个文件里**没有任何业务逻辑**，这是故意的
//
//   骨架的用途是「把评审要看的东西集中摆在一处」：缺口在哪、上游补哪一段、
//   哪一段必须自己写。所以下面四个 TODO **全部是空的**，函数体一律 throw。
//   评审通过后由人重写，而不是由机器猜。
//
// # 缺口（读代码得出，不是推测）
//
//   F-1  `dsh-zhiyun-study-core/src/workbench.js:325` 与 `:399` 用 **`join("")`**
//        拼接知识片段正文 —— 相邻字幕之间**没有任何分隔**。
//        上游字幕 '示例字幕1' + '示例字幕2' → '示例字幕1示例字幕2'；
//        真实课堂 '我们看这个矩阵' + '它的秩是三' → '我们看这个矩阵它的秩是三'。
//        终稿、讲义、出题、检索全部吃这串无分隔文本。
//   F-2  `dsh-zhiyun-parser/src/core.js:57 buildCleanSentences()` 只做「错字纠正 +
//        编辑距离上限」，**不做任何标点恢复**；返回的 `text` 就是上游那一行。
//   F-3  `dsh-zhiyun-classroom/src/models.js:62-64` 的 `subtitle()` 返回
//        `{ startMs, endMs, text, english }`，但全仓 `grep "\.english"` **0 命中**
//        —— 双语字幕（浙云课堂自带 TransText）被解析后**从未显示**。
//
// # 上游只补 F-3 的一半，F-1 / F-2 仍然要自己写
//
//   | 缺口 | 上游能补吗 | 说明 |
//   | --- | --- | --- |
//   | F-1 无分隔拼接 | ❌ | 上游按 cue 边界切，**不会**把两个 cue 连成一句 |
//   | F-2 标点丢失 | ❌ | 上游没有标点恢复能力（也不该有） |
//   | F-3 双语轨 | ⚠ 一半 | 上游能**承载**双语 cue（cue settings / 多条轨），但**不会**从浙云 JSON 里读 `TransText` |
//
// # 强化式集成的三条判据
//
//   ① 仍是同一个面板 —— 不新增导航项。「字幕」页是 `contentTabs` 第 5 项，照旧；
//      `video-panel.jsx` 的 `TranscriptLine` 照旧；`zy://section?…&t=` 时间链照旧。
//   ② 功能仍相似正交 —— 上游管「边界在哪」（格式 → cue），本仓管「边界之间怎么连」。
//      同一域的不同问题，不重叠。
//   ③ 底层多调了更优质实现 —— **本仓没有任何字幕解析器**：字幕是智云 API 的 JSON
//      （BeginSec/EndSec/Text），`dsh-zhiyun-classroom` 只做字段映射，没有「cue 树」这个概念。
//      上游带来了标准格式层（VTT region / voice / align 等 cue settings）。
//      ⚠ 判据③成立但**强度中等**：它增益的是「格式标准化」，不是「可读性」。
//
// # 四个 TODO（评审通过后由人实现，顺序不可换）
//
//   TODO-1  **信道适配**：浙云 `{BeginSec, EndSec, Text, TransText}` → 标准 cue 树。
//           必须**单测往返**：`toCue(subtitle(row))` 再 `back(cue)` 必须逐字段相等，
//           尤其是 `startMs` 的取整（上游 `models.js:62` 用 `Math.round(Number(BeginSec)*1000)`）。
//   TODO-2  **中文断句**：定义「什么样的 cue 序列算一个句子」。这是**本仓自己的规则**，
//           上游不提供。必须先定验收标准（参 2026-10-19 第三十轮：先定判据再选底层），
//           否则接任何库都无法验收。可能用到的信号：句尾标点、cue 间停顿（`endMs → startMs`）、
//           PPT 翻页边界（`slide.startMs`）、说话人切换。**禁止**用「长度阈值」假装断句。
//   TODO-3  **双语轨渲染**：把 `english` 落到「字幕」页与讲义。
//           ⚠ 这一项**不需要上游** —— 数据早就在 `subtitle()` 的返回值里。
//           若要立刻见效，这一项可以**独立先做**，不必等本骨架。
//   TODO-4  **替换 `join("")`**：`workbench.js:325` / `:399` 改为「按 TODO-2 的句子边界拼接」。
//           ⚠ **会改 `finalVersion` 摘要**（`workbench.js:64` 对 `record.sentences` 取 digest），
//           所有已落盘课堂会显示「需要重新整理」。**这是产品决策，不是技术决策**，
//           评审必须先拍板再做。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION, UPSTREAM_NOT_PROVIDED } from './upstream.js';

/** 骨架标识：只用于日志，不注册任何槽位 / RPC / 路由。 */
export const name = 'radar-media-captions';

/** 骨架版本（与 `package.json` 的 `0.0.0` 对齐，表示「未发布」）。 */
export const SKELETON = Object.freeze({
  status: 'candidate-skeleton',
  reviewed: false,
  wiredIntoProfile: false,
  upstream: `${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}`,
  notProvided: UPSTREAM_NOT_PROVIDED,
});

/**
 * TODO-1 信道适配：浙云课堂字幕行 → 上游 cue。
 *
 * @param {{ startMs: number, endMs: number, text: string, english?: string }} _line
 *   来自 `dsh-zhiyun-classroom/src/models.js` 的 `models.subtitle(row)`。
 * @returns {never} 骨架不实现。
 */
export function toCue(_line) {
  throw new Error('TODO-1：候选骨架未实现（信道适配需先补往返单测）');
}

/**
 * TODO-2 中文断句：cue 序列 → 句子序列。
 *
 * @param {ReadonlyArray<{ startMs: number, endMs: number, text: string }>} _cues
 * @param {{ slideBoundaries?: ReadonlyArray<number> }} [_context]
 * @returns {never} 骨架不实现。
 */
export function mergeIntoSentences(_cues, _context = {}) {
  throw new Error('TODO-2：候选骨架未实现（先定「断对了」的验收标准，再写规则）');
}

/**
 * TODO-3 双语轨：把 `english` 拼回句子。
 *
 * @param {ReadonlyArray<{ startMs: number, endMs: number, text: string, english?: string }>} _sentences
 * @returns {never} 骨架不实现。
 */
export function withBilingual(_sentences) {
  throw new Error('TODO-3：候选骨架未实现（此项不依赖上游，可独立先做）');
}

/**
 * TODO-4 替换 `join("")`。⚠ 会改 `finalVersion`，须先拍板。
 *
 * @param {ReadonlyArray<{ text: string }>} _sentences
 * @returns {never} 骨架不实现。
 */
export function joinSentences(_sentences) {
  throw new Error('TODO-4：候选骨架未实现（会改 finalVersion，属产品决策）');
}
