/**
 * dsh-radar-pdf-dual · 插件入口（占位）
 *
 * 状态：**候选骨架 —— 未评审、未接入 profile、不可直接使用。**
 *
 * # 这个包想解决什么
 *
 * 本仓论文页现在有**两档**翻译，中间是空的：
 *
 *   ┌ 悬停翻译   `dsh-zhiyun-host-paper/src/selection.js`
 *   │            粒度＝**一句**（上限 1200 字），触发＝鼠标悬停，代价＝一次小调用
 *   │  ← 空档 →  「这一段在讲什么」—— 用户读一页纸的真实动作
 *   └ 整篇翻译   上游 `-zh.pdf` / `-dual.pdf`，babeldoc 异步批处理，产出新 PDF
 *                粒度＝**整篇**，代价＝分钟级，且要等作业跑完
 *
 * 用户读论文时既不想每句都悬停一次，也不想为了看一段译文等整篇跑完。
 * 上游 `dsh-pdf-math-reader@1.1.0` 的 `lib/translation.js` 正好落在这一档：
 * 段落级、最多 5 段 / 3800 字一批、带术语表与段落缓存。
 *
 * # 与现有功能的关系：**重复且可强化**
 *
 * 三条判据逐条核对（详见 README §判定依据）：
 *   ① 仍是同一个面板 —— 挂在论文页阅读器里，不新增导航项、不新增页面；
 *   ② 功能仍相似正交 —— 与悬停翻译同属「把英文变中文」，但触发与粒度不同
 *      （悬停/一句 vs 分栏/一段），与整篇翻译同属「整篇覆盖」，但时延差两个数量级；
 *   ③ 底层多调了更优质实现 —— 批内 JSON 对齐（`{"translations":[...]}` 等长数组）
 *      + 术语表强制译名 + 公式/DOI/编号原样保留的硬约束，本仓现有单句 prompt 都没有。
 *
 * # 现在还不能直接用：三个未决前提
 *
 *   1. **挂载面冲突**（最硬）：本仓阅读器是同源 `<iframe src="/paper-reader/">`（上游
 *      `@ggboy123/dsh-paper-reader@1.3.1`），外层脚本拿不到 iframe 内的段落节点。
 *      `dsh-radar-pdf-anchor` 已占用「在同一 textLayer 上做行内标记」这一格 ——
 *      本包**不碰文本层**，只挂在阅读器右侧抽屉（与 `AssistantDrawer` 同一挂点）。
 *   2. **宿主 LLM 通道**：上游 `lib/chat.js` 走自己的端点；本仓铁律是 AI 调用一律走
 *      `ctx.zhiyunParser.llm` 的窄接口。这一层适配写在 `src/upstream.js`，未实现。
 *   3. **段落切分来源**：上游按 PDF.js text content 自己重建双栏段落；本仓若复用
 *      `pdfjs-dist@6.4.299`（已在 `host-paper` 依赖里）可省一份运行时，但段落边界
 *      是否与上游一致未验证 —— 不一致则缓存 key 对不上，需自行接管切分。
 *
 * 未决之前，本文件只做注册占位：**不注册任何槽位、不暴露任何服务**。
 */

/** 插件显示名。上游 `dsh.bundle.patch` 的 `name` 字段必须与本包 package.json 一致。 */
export const name = 'dsh-radar-pdf-dual'

/** 骨架阶段不声明版本号语义，跟 package.json 同步即可。 */
export const VERSION = '0.0.0'

/**
 * 本包打算用的上游导出面（**只读**，不改上游源码）。
 *
 * 现在为空数组是刻意的：`src/upstream.js` 里每个符号都必须先在这里登记，
 * 才有资格被下游调 —— 避免「顺手 import 一个新的上游函数」这种无声扩散。
 *
 * TODO(spike-1) 从 `dsh-pdf-math-reader/lib/translation.js` 里只取这三个：
 *   - `translationPrompt(targetLanguage, sourceLanguage, glossary, segments)`
 *   - `normalizeGlossary(raw)`
 *   - `cacheKey(parts)`
 */
export const ALLOWED_UPSTREAM_EXPORTS = Object.freeze([])

/**
 * 占位 apply：故意什么都不做。
 *
 * 骨架不接入 profile，因此这个函数在生产里**不会被调用**；
 * 保留它是为了让评审能一眼看到「接入点是这里」而不是去翻上游。
 *
 * @param {object} _ctx Cordis 上下文（骨架阶段不使用）
 */
export function apply(_ctx) {
  // TODO(spike-2) 待 README §未决前提 1 解决后，在此处：
  //   ctx.plugin(阅读器抽屉挂点, { render: 'paragraph-pair' })
  // 在此之前保持空实现 —— 注册空槽位会让插件页出现一个点不开的入口。
}
