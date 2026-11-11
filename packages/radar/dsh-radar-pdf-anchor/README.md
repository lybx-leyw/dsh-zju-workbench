# dsh-radar-pdf-anchor —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 只打一行日志，`src/anchor.js` 只有
> 两个抛错的空函数。**请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

**在论文阅读器里，把「选中的这一行」留下来。**

现有的康奈尔旁注只能锚到「第几页、纵向某个高度」，记的是一整页的想法；
本包补的是**行内级别**的留痕：锚到「这一句」。

## 集成性质：**强化式集成**（不是「全新」）

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是**既有**的论文阅读器 iframe（`dsh-zhiyun-page-paper/src/ReaderFrame.jsx`），复用同一个 `.textLayer` 选区。不新增页面、不新增导航项、不新增第二种阅读器 |
| ② 功能相似且正交 | ✅ | 现有：**页级旁注**（`cornell-notes.js` 存 `{page, y, text}`，锚「这一页某个高度」）。新增：**行内标记**（锚「这一句」）。同一份 PDF、同一面板，不同粒度 |
| ③ 底层多调了更优质实现 | ⚠ **半成立** | 见下节。**这是本骨架最脆的一环，评审结论可能直接是「驳回」** |

## 已核实的缺口（本仓，逐行读码）

| 事实 | 证据 |
| --- | --- |
| 论文页**只有一个选区出口**：悬停自动翻译 | `ReaderFrame.jsx:133-155` 的 `readSelection()` 是全仓唯一 `getSelection()` 调用点；产物直接进 `dwellRef.arm()` → 翻译弹层 |
| 选区**已经**被正确限定在 PDF 文本层 | 同处 `:139-140` `element.closest('.textLayer')`；`getClientRects()`、`pageNode.dataset.page` 都已取出 |
| 笔记是**页级纵向锚定**，不是按文字 | `cornell-notes.js:5` `noteAnchor(y, rect)` → `y ∈ [0, 0.98]`；`attachCornellNotes` 校验字段只有 `{id, page, y, text}` |
| 论文页**零高亮实现** | `grep -rniE "annotation\|highlight" page-paper/src/*.js*` → 命中全是 CSS 注释 |
| 全仓**无 PDF 批注库** | `grep -rniE "react-pdf-highlighter\|pdf-annotate\|web-highlighter" packages/` → **0** |

## 为什么不能锁版（判据③的实话）

两个真正有实力的上游都**自带 PDF viewer**，而本仓的阅读器是上游 PDF.js 画的：

| 候选 | 版本 | 它锁的 `pdfjs-dist` | 本仓锁的 | 后果 |
| --- | --- | --- | --- | --- |
| `react-pdf-highlighter`（`agentcooper`，★1414，MIT） | `7.0.0` / `8.0.0-rc.0` | `4.4.168` | **`6.4.299`** | 同一页两份 PDF.js，文本层 rect 基准不同 |
| `inklayer-react`（`Laomai-codefee`，★40，MIT） | `1.2.3` | `~4.3.136` | **`6.4.299`** | 同上；另拖 14 个依赖（konva / exceljs / radix / pdf-lib） |

`inklayer-react` 的 README 自述是「A PDF viewer and annotation SDK」——**viewer 在前**，
说明它不是一个可以挂在别的 viewer 外层的层。

因此本包**不是「接入一个库」**，而是「取两个上游的算法口径，写约 150 行纯函数」。
按「强化式集成」的严格读法，这**不构成**「底层多调了一个更优质的实现」。
**若评审要求判据③必须完全成立，本骨架应驳回、整目录删除** —— 这是本骨架**允许且预期**的结局。

## 从上游拿到的（正面两条 / 反面一条）

**正面**

1. **逐行 rect 合并** —— `dsh-paperforge` 的 `lineRects()`（`lib/client.js:417-452`）与
   `react-pdf-highlighter` 的 range 序列化是同一算法：同一行相邻 rect 合并成一个，
   避免叠色加深。直接照口径实现。
2. **基准盒取画布而非页面容器** —— `dsh-paperforge` 的 `referenceBox()`（`:409-414`）
   优先取 `[data-document-zoom-surface]` / `canvas`，跳过 reader 自己的 padding。

**反面（本包必须比上游多做的）**

> `dsh-paperforge` 存的是 `[x0,y0,x1,y1]` 四位小数**页内归一化矩形**，**没有字符区间**。
> 所以它既不能重锚定，也无法在文本层重新排版后判断「这条已经失效」——只会静默画偏。
>
> 本包因此**同时**存 `pageNo` + `charStart/charEnd`（文本层字符偏移）：
> `rects` 只作首次绘制的快速路径，**字符区间才是真相**；每次加载按字符区间重求 rect，
> 求不到就标 `stale: true` 并显示「已失效」，不猜位置。

## 会打坏什么（评审必读）

论文阅读器里**已经**有一段 `mouseup`，挂的是「选中英文 → 悬停自动翻译」。
新按钮与它**抢同一个事件源**。插入方式若碰到 `dwellRef` 的判定路径，就会让
「选中→即翻」变成「选中→弹按钮→不翻了」——这是**改坏既有功能**，比不加这个功能更糟。

建议：按钮渲染在翻译弹层**之外**的独立容器；`mousedown` 落在按钮上时**不**取消 `dwell`；
按钮只在选区仍在时出现。这一条必须真机验，不能靠读码。

## 不做什么

1. **不做框选截图** —— 已有 `dsh-radar-orb`（r119）那条线。
2. **不写回 PDF 文件**（`/Annots`）—— 需要 `pdf-lib`，且会分裂「磁盘 vs 应用内」两套真相。
3. **不做六色 / 笔迹 / 形状 / 图章** —— 那是一个 annotator 的活；本包只回答「这句话被标记过」。
4. **不做新面板 / 新导航**。

## 评审放行后要做的（按顺序）

1. 量「真实读论文时的缩放是否恒为 1×」。若是 → 砍掉字符区间层，代码减半。
2. 填 `src/anchor.js` 的两个纯函数（`encodeAnchor` / `resolveAnchor`）。
3. 在 `ReaderFrame.jsx` 里加第二个选区消费者，**先证明翻译仍正常工作**。
4. 落 `localStorage`（键 `zhiyun.paper.anchors.<topic>/<name>`），与服务端无关。
