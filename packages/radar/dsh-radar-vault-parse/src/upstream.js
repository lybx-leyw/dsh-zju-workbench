// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 上游封装占位。
// B 类（其他 JS 项目）只做「能力提取 + 封装」，因此这里做两件事：
//   1. 把锁版凭据收在一处（单一真源）；
//   2. 把「怎么把 markdown-it 的 token 树翻成区间表」写成**纯函数的形状说明**，
//      **但不实现**（实现留到评审通过之后）。
//
// ⚠ 本文件**不得**成为第二份「Markdown 语义真源」。
//   真正的语义只有一个来源：`dsh-zhiyun-vault/src/parse/links.js`（Obsidian 式双链/标签，
//   已逐条钉过测试）。本包只负责回答「**这段文字该不该参与解析**」，
//   不负责回答「`[[a#b|c]]` 里哪个是目标」—— 后者继续用 `splitWikilink()`。

export const LOCK = Object.freeze({
  // 与 package.json 的 dependencies 必须逐字一致（不用 ^）。
  'markdown-it': '14.1.0',
});

/** 上游许可证（直读 GitHub LICENSE，见 README「许可证」表）。 */
export const LICENSES = Object.freeze({
  'markdown-it': 'MIT',
});

/**
 * 本仓现有的「上下文排除」能力清单 —— 本候选存在的全部理由。
 *
 * 每一条都能在本仓源码里指到行；`missing: true` 的那些，就是换底层能补上的。
 * 评审若认为某条「其实不影响」，可以直接反驳这一项，这比讨论抽象优劣快。
 */
export const BASELINE = Object.freeze({
  // ✅ 已有：围栏代码块（``` / ~~~），且带零宽匹配保护。
  fencedCode: { present: true, where: 'dsh-zhiyun-vault/src/parse/links.js#CODE_FENCE_RE' },
  // ✅ 已有：行内代码。
  inlineCode: { present: true, where: 'dsh-zhiyun-vault/src/parse/links.js#INLINE_CODE_RE' },
  // ✅ 已有：行内数学 `$…$`。
  inlineMath: { present: true, where: 'dsh-zhiyun-vault/src/parse/links.js#INLINE_MATH_RE' },
  // ✅ 已有：URL（避免从 `https://x#y` 切出假标签）。
  url: { present: true, where: 'dsh-zhiyun-vault/src/parse/links.js#URL_RE' },
  // ✅ 已有（vault 侧）：`# 标题` 不被当成标签 —— `ATX_HEADING_RE` 在
  //    `parseNoteLinks()` 的标签循环里**有调用**（links.js L183）。
  //    ⚠ 但「笔记」页右栏 `NoteRelations` 的另一份正则**没有**这层判定
  //      （page-notes/client.jsx L220 起），两处口径不一致 —— 这属于页面侧问题，
  //      不是 vault 侧问题，接本包时顺手对齐即可。
  atxHeading: { present: true, where: 'dsh-zhiyun-vault/src/parse/links.js L183' },
  // ❌ 缺失：缩进式代码块（4 空格 / Tab）。CommonMark 一级语法。
  indentedCode: { present: false, where: '—' },
  // ❌ 缺失：setext 标题（`标题` 下一行 `====` / `----`）。
  setextHeading: { present: false, where: '—' },
  // ❌ 缺失：HTML 块 / 原始 HTML（`<pre>` 里写字会被当成正文）。
  htmlBlock: { present: false, where: '—' },
  // ❌ 缺失：围栏语言无关性 —— ```` ```md ```` 与 `~~~` 已认，但 `~~~` 的**闭合**
  //    要求同字符，嵌套/异常闭合的边界情况未覆盖。
  fenceEdgeCases: { present: false, where: 'dsh-zhiyun-vault/src/parse/links.js#CODE_FENCE_RE（自评）' },
});

/**
 * TODO · 纯函数形状（**未实现**）
 *
 *   excludedRanges(markdown) -> Array<[start, end]> | null
 *     入：整篇 Markdown 源码字符串
 *     出：需要排除的字符区间（半开），已合并、已排序；**解析失败返回 null**
 *     约束：
 *       · 与 dsh-zhiyun-vault/src/parse/links.js 里同名函数**签名与语义完全一致**
 *         （调用方 `links.js` L151 一行不改即可切换）。
 *       · 不得返回已经替换过内容的字符串 —— 替换会改变长度，下游按 index 定位会错位。
 *       · 行内定位不能靠 `indexOf` 回填：同一行里出现两次 `code` 会串位。
 *
 *   safeProtectedRanges(markdown) -> Array<{ line, colStart, colEnd }> | null
 *     供 page-paper/citations.js 使用（目前它只有单行版 `protectedRanges(line)`）。
 *     ⚠ 这是**破坏性签名变更**，评审需确认调用方只有 `linkLine` 一处。
 *
 *   probe(): boolean
 *     启动自检：用 4 条已知反例（缩进代码 / setext 标题 / `<pre>` / 嵌套围栏）
 *     断言本层判定与期望一致。**自检不过就不该被接线** —— 见 README「验收线」。
 */
