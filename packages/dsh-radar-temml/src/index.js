// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 temml（TeX → MathML，零依赖，MIT）封装成工作台可调用的**纯函数**能力，
//       用来把讲座要点 / 笔记 / 论文助手回答里已经存在的 `$...$` / `$$...$$`
//       从「原样显示的源码」变成「排好的公式」。
//
// 上游：https://github.com/ronkok/Temml
//       npm: temml（本骨架锁版 0.14.0，不用 ^；见 ./upstream.js）
//       许可证：MIT ✅（宽松白名单）
//
// 性质：B 类（其他 JS 项目）—— 能力提取 + 封装；不引入 DSH 上游包
//       （上游没有 dsh.bundle.patch / cordis.patch.yml，故本包不含上游 DSH 依赖）。
//
// # 集成判定：强化式集成（⚠ 但「基线为空」，人工评审请重点看这一条）
//
// 三条判据逐条对照：
//   ① 仍是同一个面板 —— 不新增页面。公式出现在它原本就出现的地方：
//      「学习」页的讲座要点、笔记正文、论文阅读页的助手回答。
//   ② 功能仍相似正交 —— 仍然是「把一段讲座/笔记文本呈现给人看」，
//      只是数学片段的呈现方式从「源码」变成「排版结果」。不新增导出、检索、编辑能力。
//   ③ 底层多调了更优质实现 —— 本仓**当前没有任何公式渲染器**（核对结论见
//      ./upstream.js 的 BASELINE_HAS_MATH_RENDERER），故这里的「更优」是
//      「无 → 有」，而不是「A 换 B」。
//
// ⚠ **这一条是本候选与「标准强化式集成」的唯一差别**：判据 ③ 的本意是
//    「已有实现、外部有更优底层」，本包是「本来没有、外部有可用底层」。
//    雷达按「同类内容渲染的质量升级」记为强化式集成，但这个定性**必须由人工确认**。
//    若评审认为「无基线即不算强化」，则本包应降级为「全新」并重新排优先级。
//
// # 为什么选 Temml 而不是 KaTeX / MathJax
//
//   1. **零依赖**：`dependencies: null`。KaTeX 带 `commander` 等构建期依赖；
//      MathJax 是体积与配置都可观的运行时。
//   2. **服务端出 MathML 字符串**：不需要在浏览器里注入 CSS + 字体包，
//      也不需要客户端 hydrate。宿主 `MarkdownText` 若能透传 HTML，接缝极窄。
//   3. **与本仓「无独立 API key、离线可跑」的基调一致**：纯函数，无网络。
//
//   代价：MathML 的字体兼容性弱于 KaTeX 的 HTML+CSS 方案（老浏览器、部分
//   移动端 WebView）。**这是本方案的主要风险**，见 TODO 3。
//
// # 与既有候选 `dsh-radar-better-markdown` 的关系（必须人工裁决，二者不要都上）
//
//   `dsh-radar-better-markdown` 锁版挂载的上游自带 **KaTeX**。若它先被采用，
//   则本包的 ③ 判据立刻塌掉（「已有更优底层」变成「已有另一个底层」），
//   本包应判 **⛔ 重复且无增益** 并删除。
//   **优先级判断**：论文阅读页是整篇 Markdown 流式渲染，KaTeX 随 Markdown 管线一起走
//   更顺；而讲座要点/笔记是**结构化字段**（标题、要点、公式），逐个片段渲染，
//   MathML 的「一个字符串塞进 DOM 就完事」更合适。故二者更可能是**分层**而非替代，
//   但那也意味着引入两套公式引擎 —— 人工评审时请一并裁掉其一。
//
// TODO（采用前必须完成）：
//   1. 只做薄封装：`temml.renderToString(tex, options)` → MathML 字符串。
//      **不要**重新实现解析、不要 fork、不要改上游产物。
//   2. 确认 `displayMode` 的取法：`$$...$$` → `{ displayMode: true }`；
//      `$...$` → 行内。分界符扫描**复用** `dsh-zhiyun-lecture/src/tree.js` 的
//      `looksLikeNotationOnly()` 已有正则，不要另写一套（两套分界符判定必然漂移）。
//   3. **降级必须有**：`throwOnError: false` + 上游的 `ParseError` 捕获；
//      渲染失败时**原样输出源码**，而不是空白或报错框 —— 讲座笔记里一条坏公式
//      不该毁掉整页（与 `dsh-zhiyun-parser` 的纠错策略同向）。
//   4. 注入目标要窄：只处理**已经由本仓产出**的结构化文本字段，
//      **不要**去改宿主 `MarkdownText` 的渲染管线（那是 `@deepseek-ai/dsh-client-ui-primitives`
//      的地盘，改它等于接管宿主 UI 主张）。
//   5. 安全：MathML 允许 `<maction>` 等带 href 的节点；上游 `\href` 可产出链接。
//      接入时须确认是否禁用 `\href` / `\url`（上游 options 有 `trust` 一类开关），
//      避免讲座转写文本里的公式注入外链。
//   6. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS。

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_REPOSITORY,
  BASELINE_HAS_MATH_RENDERER,
} from './upstream.js';

export const name = 'radar-temml';

/**
 * 锁版凭据在此取用 —— 让 `src/upstream.js` 不只是摆着的装饰。
 * 真实实现里这段应改为向宿主暴露一个 `temml` 服务：
 *
 *   ctx.provide('radarTemml', { render, version })
 *
 * 且在 `ctx.inject` 里只写**必须有**的宿主服务（本包理论上一个都不需要：
 * 它是纯函数，甚至可以是「被 import 的库」而不是「被挂载的插件」）。
 */
export const upstream = Object.freeze({
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  repository: UPSTREAM_REPOSITORY,
  /** 见 README「定性」一节：本仓无基线渲染器，「强化」是相对空缺而言。 */
  baselineHasRenderer: BASELINE_HAS_MATH_RENDERER,
});

// TODO: 薄封装上游 temml（示例，待实现）
// import temml from 'temml';
// export function render(tex, { displayMode = false } = {}) {
//   return temml.renderToString(tex, { displayMode, throwOnError: false, trust: false });
// }
