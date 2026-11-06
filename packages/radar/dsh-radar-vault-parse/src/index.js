// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 markdown-it（CommonMark 解析器，MIT，零运行时依赖）封装成
//       「**Markdown 结构判定**」这一层，替换本仓现有两处**正则估算**的语法判定：
//         · dsh-zhiyun-page-notes 右栏 NoteRelations —— `[[双链]]` / `#标签` 预览
//         · dsh-zhiyun-page-paper  citations.js     —— 「第 N 页」引用改写
//
// 上游：https://github.com/markdown-it/markdown-it
//       npm: markdown-it@14.1.0（锁版，不用 ^；见 ./upstream.js）
//       许可证：MIT ✅（宽松白名单）
//       实核：`dependencies: { argparse, entities, linkify-it, mdurl, punycode.js, uc.micro }`
//             —— **全部是零依赖 / 纯字符串工具**，整棵依赖树无原生模块、无构建步骤。
//
// 性质：**B 类（其他 JS 项目）· 强化式集成**。上游没有 dsh.bundle.patch，
//       故本包不引入任何上游 DSH 包，`dependencies` 只有纯 JS 库。
//
// # 集成判定：强化式集成的三条判据（与 README 对照阅读）
//
//   ① 仍是同一个面板 —— 是。「笔记」页仍是「笔记」页，「论文」页仍是「论文」页。
//      不新增页面、不新增导航项、不新增 RPC。
//   ② 功能仍相似正交 —— 是。做的仍是同一件事：判断「这段文字里的 `[[x]]` / `#x` /
//      `第 N 页` 到底是不是链接」。不是新增检索、不是新增编辑。
//   ③ 底层多调了更优质实现 —— **是，这是本候选存在的唯一理由**：
//      · 缩进式代码块（4 空格 / Tab）—— 本仓**完全没有**处理
//      · setext 标题（`标题` 下一行 `----`）—— 本仓**完全没有**处理
//      · HTML 块（`<pre>` 里写字会被当成正文）
//      · 围栏闭合的异常情形（本仓用一条正则吞整块，无嵌套/异常闭合的分级）
//      · 「哪一段是代码」这件事，上游是 **token 级**判定，本仓是**正则近似**
//      详见 README 的「现状 vs 上游」对照表，每条都能在本仓源码里指到行。
//
// # 边界（评审前请确认这四条）
//
//   1. **只做判定，不做渲染**。产出是「哪些区间可以解析」，**不是** HTML 字符串。
//      渲染仍归宿主的 `MarkdownText`（对齐 page-paper/citations.js 现有做法：
//      改写源码、交给宿主渲染器，绝不自己切 DOM）。
//   2. **不新增数据源**。本包不读正文：`draft` / 回答文本**由调用方传入**。
//   3. **失败必须降级到现状，而不是报错**。解析抛错 → 返回 `null`，调用方
//      回落到现有正则实现。任何情况下不得让右栏/回答变空白。
//   4. **每包只接一处**。首版只接「笔记」页右栏与「论文」页引用；
//      不顺手改「反馈」页（见 README「不做的事」第 3 条）。

export const NAME = 'dsh-radar-vault-parse';

// 上游常量是单一真源（版本号改动只改这里 + package.json）。
export const UPSTREAM = Object.freeze({
  pkg: 'markdown-it',
  version: '14.1.0',
});

/**
 * 本包的宿主半边（cordis 插件入口）。
 *
 * ⚠ 占位：**不实现任何业务逻辑**，调用即抛错 —— 防止「看起来能跑」的骨架被误用。
 * 真正的接线点在 TODO 1~5，评审通过后才写。
 */
export function apply(ctx) {
  throw new Error(
    '[dsh-radar-vault-parse] 候选骨架，未评审、未接入 profile、不可直接使用。' +
      '接线点见 src/index.js 的 TODO。',
  );
}

// TODO 1 · 先决定「用哪个入口」，这决定了要不要 cordis.patch.yml
//   - 入口 A（推荐）：**纯库包**。`dsh-zhiyun-page-notes` 与 `dsh-zhiyun-page-paper`
//     直接 `import { excludedRanges } from 'dsh-radar-vault-parse'`。
//     走这条就把本包的 `dsh.bundle.patch` 与 `cordis.patch.yml` **删掉**，
//     package.json 的 `dsh` 字段也删 —— 否则会多出一行无意义的 bundle 记录。
//   - 入口 B：作为独立 bundle 行 insert，通过 ctx 暴露一个 `markdown-structure` 服务
//     供两端消费。**多一层运行时契约**，只有当两端都愿意改成 inject 时才值得。
//     ⚠ 本仓现有页面组件之间**没有**这种服务注入的先例（page-notes 直接 import
//     dsh-zhiyun-ui-primitives），所以默认选 A。
//
// TODO 2 · 实现 `excludedRanges(markdown)` 的 token 版（**替代**，不是叠加）
//   - 用 `md.parse(src, {})` 拿到 token 树，按 `token.map = [startLine, endLine]`
//     行号映射区间；行内 token 用 `token.children` 的 `text` / `` code_inline ``
//     / `math_inline` 做列内定位（**注意**：行内 token 没有列号，需按内容顺序回填，
//     不要用 indexOf 从头找 —— 会命中前一个相同的片段）。
//   - 输出形状**必须与现有 `excludedRanges` 完全一致**：`[[start, end], …]` 已合并、
//     半开区间、下标对应原文。调用方（`links.js` L151）不改一行代码就能切过去。
//   - 这是可验证的：把本仓 `packages/dsh-zhiyun-vault/test` 里现有链接解析用例
//     原样跑一遍做**双实现差分**，差异必须为零，否则不算完成。
//
// TODO 3 · 接「笔记」页右栏（替换 client.jsx L220 那段 useMemo）
//   - 现状：`matchAll(/\[\[([^\]\n]+)\]\]/g)` + 一段标签正则，**在 fenced code 里
//     也会命中**（例如笔记里写「用 [[双链]] 连过去」的说明文字）→ 右栏凭空多出
//     一个不存在的「指向」目标，用户点了才发现在库里不存在。
//   - 目标：链接/标签列表与 vault 的 `describe().unresolvedCount` **同源同口径**。
//     vault 已按语义解析（见 packages/dsh-zhiyun-vault/src/parse/links.js），
//     但页面**没有**调 `vault.invoke('parse')`，而是自己再猜一次 —— 本包让它猜得更准，
//     更强的做法是让页面直接调 `parse`（见 TODO 4，两者可并存）。
//   - ⚠ **不要**在这里顺手改 `NoteRelations` 的布局；只换数据来源。
//
// TODO 4 · 接「论文」页（重写 citations.js 的 `protectedRanges`）
//   - 现状：`protectedRanges(line)` 只处理**行内**反引号与已有链接，
//     围栏**跨行**跳过在 `linkCitations` 里做（`/^\s*(\`\`\`+|~~~+)/`）。
//     → **setext 标题**（`标题` 下一行 `----`）与 **4 空格缩进代码块**没有被排除，
//       里面写的「第 3 页」会被改写成链接 → 在代码里点出一个跳转。
//   - 目标：`protectedRanges(markdown) -> { line, colStart, colEnd }[]`，
//     按 token 判定改为**块级 + 行内**双向排除。
//   - ⚠ 现行单行 API 的调用点在 `linkLine`，本包改签名属于**破坏性变更**，
//     评审时请一并确认调用方只有一处。
//
// TODO 5 · 性能与降级
//   - `md.parse` 是 O(n)，但**每次按键都跑**（page-notes 的 useMemo 依赖 draft）会掉帧。
//     要求：> 40 KB 的正文改为 debounce 300ms，或在预览态才解析。
//   - 解析抛错 / 上游版本不匹配 → `excludedRanges` 返回 `null`，调用方回落现有正则。
//   - **不得**在本包里放缓存（同一份 draft 会被两个页面各解析一次，缓存键含正文，
//     等于把整篇笔记再存一份进内存）。
