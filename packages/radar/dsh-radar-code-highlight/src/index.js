// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 highlight.js（纯 JS 语法高亮，BSD-3-Clause，**零运行时依赖**）封装成
//       「**代码块着色**」这一层，替换本仓目前的「围栏代码块 = 一段等宽纯文本」。
//
// 上游：https://github.com/highlightjs/highlight.js
//       npm: highlight.js@11.12.0（锁版，不用 ^；见 ./upstream.js）
//       许可证：BSD-3-Clause ✅（宽松白名单）
//       实核：`dependencies` 为空；整个包**没有构建步骤**，`es/` 与 `lib/` 是可直接
//             import 的 ESM/CJS 源码 → 浏览器端可按语言**按需注册**，不必吃下 190 种语言。
//
// 性质：**B 类（其他 JS 项目）· 强化式集成**。上游没有 `dsh.bundle.patch`，
//       故本包不引入任何上游 DSH 包，`dependencies` 只有纯 JS 库。
//
// # 集成判定：强化式集成的三条判据（与 README 对照阅读）
//
//   ① 仍是同一个面板 —— 是。「论文」仍读 PDF、「讲义」仍读讲义、「笔记」仍写笔记。
//      不新增页面、不新增导航项、不新增 RPC。只改**这些面板里代码块的显示**。
//   ② 功能仍相似正交 —— 是，做的仍是同一件事：把一段代码**显示出来**。
//      不是新增「运行代码」、不是新增「代码编辑器」、不是新增「代码搜索」。
//   ③ 底层多调了更优质实现 —— 是：本仓当前**没有任何高亮层**（见 upstream.js BASELINE）。
//
// # 边界（评审前请确认这四条）
//
//   1. **只产出「token 区间 + 类名」，不产出整页 HTML。**
//      highlight.js 返回的是 `<span class="hljs-…">` 片段；本包把它拆成
//      `[{ text, cls }]` 交回调用方，由调用方用宿主组件渲染。
//      理由：`dsh-zhiyun-page-notes/src/client.jsx` 顶部注释已经写明
//      「正文用宿主的 MarkdownText，不自己写一套渲染」——本包不违背这条。
//   2. **不新增数据源**。代码文本由调用方传入（来自笔记正文 / 讲义段落 / 论文选中区）。
//   3. **失败必须降级为纯文本，而不是报错。** 语言未注册 / 语法解析异常 / 体积超限
//      → 返回 `null`，调用方按现状显示原文。任何情况下不得让正文变空白或丢字符。
//   4. **首屏不许变慢。** 语言包必须 `import()` 懒加载，且只注册**白名单内**的语言
//      （见 upstream.js LANGUAGE_WHITELIST）；`highlightAuto()` 一律禁用
//      （它要求全量语言包，与本条直接冲突）。
//
// # 本文件状态
//
// 只有签名与 TODO，**没有实现**。调用即抛错 —— 这是故意的，见 README 顶部声明。

/**
 * 把一段代码高亮为「分类文本片段」。
 *
 * @param {string} code - 源码文本（调用方已切好，不含围栏符号）。
 * @param {object} opts
 * @param {string} [opts.language] - 围栏上写的语言标识（`python` / `js` / `c` …）。
 * @param {AbortSignal} [opts.signal] - 传递取消（语言包 import 是异步的）。
 * @returns {Promise<Array<{ text: string, cls: string | null }> | null>}
 *          失败/不支持 → `null`（调用方回落纯文本）。
 */
export async function highlightCode(code, opts = {}) {
  void code; void opts;
  // TODO 1：语言名归一（`js`→`javascript`、`c++`→`cpp`、`py`→`python`）。
  //         ⚠ 归一表必须有**有限枚举**，不做模糊匹配；未知语言直接回 null。
  // TODO 2：按 upstream.js 的 LANGUAGE_WHITELIST 懒加载并 `registerLanguage()`。
  //         同一语言只注册一次（模块级 Set 去重）。
  // TODO 3：调 `hljs.highlight(code, { language, ignoreIllegals: true })`，
  //         再把返回的 HTML 串拆成片段。**不要**把 HTML 串直接交给 DOM。
  // TODO 4：体积超限（单段 > MAX_CHARS）直接回 null —— 宁可不亮，不可卡住讲义滚动。
  throw new Error('dsh-radar-code-highlight: 候选骨架，未实现（见 README 与 src/upstream.js）');
}

/**
 * 注册 Cordis 服务。**未接入 profile，不会被调用。**
 *
 * 评审通过后的接入形状（占位，不实现）：
 *   ctx.provide('radar.codeHighlight', { highlightCode })  ← 供 page-paper / page-notes 注入
 */
export function apply() {
  throw new Error('dsh-radar-code-highlight: 候选骨架，未实现（见 README）');
}
