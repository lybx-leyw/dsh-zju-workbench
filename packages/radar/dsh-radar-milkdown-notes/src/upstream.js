// 候选骨架：未评审、未接入 profile、不可直接使用。
//
// # 这一层为什么必须存在
//
// Milkdown 是「Markdown ⇄ ProseMirror 文档」的有损往返器。拿本仓笔记页的真实写法
// 喂它（`@milkdown/kit@7.23.0` + commonmark + gfm，2026-11-03 实测，jsdom 环境），
// 逐项结果如下 —— 前四条是**安全的**，后四条会**改坏用户的字**：
//
//   ✅ ```js 围栏代码   原样返回
//   ✅ 1. / 2. 有序列表 原样返回
//   ✅ # / ## 标题      原样返回
//   ✅ > 引用           原样返回
//   ❌ 见 [[线性代数]]  →  见 \[\[线性代数]]        ← 本仓「反链」靠它，**这是致命的**
//   ❌ 甲\n\n\n\n乙     →  甲\n\n乙                  ← 连续空行被折叠
//   ❌ 甲··\n乙（行尾两空格 = 硬换行） → 甲\\\n乙     ← 硬换行被改写成反斜杠形式
//   ❌ ---\ntags: [a]\n---  →  ***\n\n## tags: \[a]  ← frontmatter 被当成「分隔线 + 标题」
//
// 也就是说：**直接 `getMarkdown()` 回写 = 静默毁笔记**。必须在进出两侧各包一层。
//
// # 缝合策略（占位，未实现）
//
// 出（toDoc）：把正文里**会被误解析**的片段替换成私有区占位符，再把占位符送进编辑器。
// 入（fromDoc）：把编辑器吐出来的文本里的占位符还原成原文。
//
//   待保护片段           判据                        还原时的坑
//   [[标题]] / [[标题|别名]]   /\[\[[^\]\n]+\]\]/      editor 会把 `[[x]]` 写成 `\[\[x]]`
//                                                      ⇒ 还原要同时吃掉 `\[` 与 `[`
//   #标签                已在 client.jsx 的 countTags 定义，**必须复用它**，不要重写一遍正则
//                                                      （两处口径一旦分叉，状态栏词数会开始说谎）
//   行尾两个空格 → 硬换行  仅行尾、且下一行非空        编辑器改写为 `\`，还原要认两种形式
//   连续空行              /\n{3,}/                  编辑器折叠成一个空行，原数量要单独记
//   frontmatter          仅**文件首行**且下一行是 ---  编辑中段出现的 --- 不许当 frontmatter
//
// 三条硬约束：
//   1. 占位符必须落在**不会被 Markdown 解析**的位置 —— 用 `\uE000`–`\uF8FF` 私用区，
//      不要用 `\x00`（会被 trims）或 `{{...}}`（会被当成模板花括号）。
//   2. 占位符与还原表**同生同死**：一次 toDoc → fromDoc 必须成对，中途抛错就整体放弃，
//      退化成「保持 textarea 原文」。**宁可没有 WYSIWYG，也不能悄悄改字。**
//   3. 用户在编辑器里**主动编辑过的占位符区域**（位置变了、内容变了）无法可靠对应，
//      这种情况一律降级为原样文本 + 标记「本段以源码显示」，不要猜。

export const PLACEHOLDER_BASE = 0xe000;

/** Markdown → 编辑器输入。@todo 未实现。 */
export function toDoc(markdown) {
  void markdown;
  throw new Error('候选骨架：未实现（见文件头「缝合策略」）');
}

/** 编辑器输出 → Markdown。@todo 未实现。 */
export function fromDoc(editorOutput, restoreTable) {
  void editorOutput;
  void restoreTable;
  throw new Error('候选骨架：未实现（见文件头「缝合策略」）');
}

/** 上游锁版信息（评审时核对 npm，不核仓库 HEAD）。 */
export const UPSTREAM = Object.freeze({
  package: '@milkdown/kit',
  version: '7.23.0',
  license: 'MIT',
  homepage: 'https://github.com/Milkdown/milkdown',
  // 实测：npm i @milkdown/kit@7.23.0 → added 156 packages，全部为 7.23.0 同版本号；
  // 零 React 依赖（@milkdown/* 家族自足 + prosemirror 生态）。锁顶层版本即可锁住全树。
});
