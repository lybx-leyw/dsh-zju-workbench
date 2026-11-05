/**
 * 行内标记入口（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。`apply()` 只打一行日志，
 *    不注册页面、不注册 slot、不注册工具。评审驳回则整目录删除。
 *
 * # 定性：**强化式集成**（不是「全新」）
 *
 * 这个能力不是新面板，而是**既有阅读器的一次扩写**：
 * `dsh-zhiyun-page-paper/src/ReaderFrame.jsx:133-155` 已经有一段
 * `readSelection()` —— 它把选区限定在 `.textLayer` 内、取 `getClientRects()`、
 * 读出 `pageNode.dataset.page`，然后**只把结果交给悬停翻译**（`dwellRef.arm()`）。
 * 也就是说「画一个行内标记所需的一切输入，此刻都已经在手上」，只是没有第二个消费者。
 *
 * 本包要做的全部事情，就是在这同一个 `mouseup` 上**再加一个消费者**：
 * 把同一份 `{text, rects, page}` 落成一条可持久化的锚点。
 *
 * # 三条判据
 *
 * | 判据 | 本包怎么满足 | 结论 |
 * | --- | --- | --- |
 * | ① 仍是同一个面板 | 落点 = `page-paper` 既有的阅读器 iframe（`ReaderFrame`）；不新增导航、不新增页面、不新增第二种阅读器 | ✅ |
 * | ② 功能相似且正交 | 现有 = 康奈尔**页级旁注**（`cornell-notes.js` 只存 `{page, y, text}`，锚的是「这一页的某个高度」）；新增 = **行内标记**（锚的是「这一句」）。同一份 PDF、同一个面板，两种粒度 | ✅ |
 * | ③ 底层多调了更优质实现 | **半成立** —— 见下 | ⚠ |
 *
 * # 判据③为什么只是「半成立」（评审必须先读这一节）
 *
 * 开源界**没有**一个能挂在本仓阅读器外层的行内高亮库。两个真正有实力的都**自带 viewer**：
 *
 * | 候选 | 它锁的 pdfjs-dist | 本仓锁的 | 后果 |
 * | --- | --- | --- | --- |
 * | `react-pdf-highlighter` 7.0.0 / 8.0.0-rc.0 | `4.4.168` | `6.4.299` | 同一页跑两份 PDF.js，文本层 rect 基准不同 |
 * | `inklayer-react` 1.2.3 | `~4.3.136` | `6.4.299` | 同上，且另拖 14 个依赖（konva/exceljs/radix） |
 *
 * 所以本包**不是「接入一个库」**，而是「从两个上游的算法里取口径，自己写一段纯函数」。
 * 按「强化式集成」的严格读法，这**不构成**「多调了一个更优质的实现」。
 * **评审若要求判据③必须成立，本骨架应直接驳回删除** —— 这是允许的结局，README 已写明。
 *
 * # 本轮从中拿到的两个正面口径 + 一处必须避开的坑
 *
 * 正面：
 *   1. `react-pdf-highlighter` 的 `range → 逐行 rect` 序列化（同一行相邻 rect 合并，
 *      避免叠色加深）—— `dsh-paperforge` 的 `lineRects()`（`lib/client.js:417-452`）是同一算法。
 *   2. `dsh-paperforge` 的 `referenceBox()`：以**画布**而不是 `.page` 容器为基准盒，
 *      跳过了 reader 自己的 padding —— 这一条直接可用。
 *
 * 坑（本包**必须**比上游多做一步）：
 *   `dsh-paperforge` 存的是 `[x0,y0,x1,y1]` 四位小数的**页内归一化矩形**，
 *   **没有字符区间**。`getClientRects()` 是 subpixel 取整，来回缩放会有累积误差；
 *   更致命的是它无法「重锚定」—— 文本层重新排版后只能静默画到错位置。
 *   本包因此额外存 `pageNo` + `charIndex` 起止（见 `TODO(评审) 2`）。
 *
 * # 不做什么（评审重点）
 *
 * 1. **不做框选截图** —— 那是「留证据」，`dsh-radar-orb`（r119）已在那条线上。
 * 2. **不做 PDF 文件写回**（把标注烧进 PDF 的 `/Annots`）—— 需要 `pdf-lib`，且阅读器是只读上游，
 *    写回等于分裂真相；要导出交给 `core-classroom-export` 那条线。
 * 3. **不做六色 / 笔迹 / 形状 / 图章** —— 那是 annotator 的活，本包只做「一句话被标记过」。
 * 4. **不劫持既有 `mouseup`** —— 见 `README` 的「会打坏什么」。
 */

export const UPSTREAM = null;

export const name = 'dsh-radar-pdf-anchor';

/**
 * 插件挂载点（占位）。
 *
 * TODO(评审)：
 *   1. **先量再写**：本仓用户读论文是 1× 固定缩放，还是来回缩放？
 *      若恒为 1×，则「字符区间」整层可以砍掉，只留 rect（代码量减半）。
 *   2. **锚点形状**（`src/anchor.js` 是空壳，待评审后填）：
 *      `{ id, pageNo, charStart, charEnd, rects: 'x0,y0,x1,y1;…', color, note, createdAt }`。
 *      其中 `rects` 只作**首次绘制**的快速路径；`charStart/charEnd` 才是真相，
 *      每次加载都应用它去 `.textLayer` 里重新求 rect，求不到就标 `stale: true`。
 *   3. **与翻译弹层共存**：`ReaderFrame` 的 `mouseup` 已经挂了 `dwellRef.arm()`（悬停即翻）。
 *      新按钮必须**不改变** `dwell` 的判定路径 —— 否则等于改坏既有功能。
 *      建议：按钮出现在**翻译弹层之外**的独立位置，且 `mousedown` 在按钮上时不取消 dwell。
 *   4. **存储**：先跟 `cornell-notes.js` 一样落 `localStorage`
 *      （键 `zhiyun.paper.anchors.<topic>/<name>`），**不要**先建服务端路由。
 *   5. **导出**：等到真要导出时再说，走 Markdown 引文（`> 原文` + 页码），
 *      不写 PDF 文件。
 */
export function apply(ctx) {
  ctx?.logger?.info?.('[dsh-radar-pdf-anchor] 候选骨架，未实现');
}
