# dsh-radar-milkdown-notes（候选骨架）

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 本包只有目录形状与判定结论，`src/*.js` 里的函数一律 `throw`。
> 它存在的意义是**把「为什么不能直接上」写死在仓库里**，避免下一轮又从头验证一遍。

- **类型**：B（其他 JS 项目）· 原生 DSH 生态里没有同一面板的同源实现（见下文「为什么不选 A」）
- **上游**：`@milkdown/kit@7.23.0`（MIT，★12,040，TS）→ <https://github.com/Milkdown/milkdown>
- **与现有功能的关系**：**重复且可强化** → 本包是**强化式集成**，不是「全新」
- **判据三件套**：① 仍是同一个面板 ✅　② 功能仍相似正交 ✅　③ 底层多调了更优质实现 ✅（**有前提**，见下）

---

## 一、它强化的到底是哪一处（本仓实测）

`packages/dsh-zhiyun-page-notes/src/client.jsx` 只有一个「编辑 / 阅读」按钮（:1400），两个态是：

| 态 | 实现 | 位置 |
| --- | --- | --- |
| 阅读 | 宿主 `<MarkdownText text={draft} />` | :1415 |
| 编辑 | **纯 `<textarea>`**，`aria-label="笔记正文（Markdown）"` | :1423 |

也就是说：**写的时候看到的是一堆 `#` 和 `|`，松手切到阅读态才看得见排版**。
本包只做一件事 —— 把编辑态那个 textarea 换成 WYSIWYG，阅读态**不动**。
导航、标签页、文件树、状态栏、800ms 防抖自动保存全部原样不动。

为什么不是全新面板：面板是现成的（笔记页），功能是现成的（写 Markdown），
换掉的是**写这一个动作的底层** —— 这正是「强化式集成」的定义。

## 二、为什么不选 A 类（原生 DSH 插件）

本轮 8 次搜索里，命中「笔记/Markdown 编辑」的 A 类插件共 12 个，全部为 🔵/⛔，无 🟢 可锁版：

| 仓库 | ★ | 为什么不能进 |
| --- | --- | --- |
| `XieZongChen/dsh-md-notes` | 15 | **自己起一套 MD 笔记管理** —— 与 `page-notes` 正面重复，正是「不得简单集成重复功能」 |
| `Roland0511/dsh-marktext` | 56 | 取向对（Muya WYSIWYG），但落在**右侧栏**，且 2026-11 新仓、**无 npm 发布 ⇒ 锁不了版** |
| `yadnuses/dsh-md-editor` | 2 | 明确「源码零漂移」—— **不引入结构化模型**，恰好是本轮要绕开的形态 |
| `hh719509125/dsh-preview-editor` | 5 | 右栏原位编辑；**但「行尾逐字节保留」这条口径值得抄**（不摘码） |
| `AKS1st/dock-markdown` / `dock-editor` | 3 / 3 | 依赖 `dock` 基座 ⇒ 引入即牵进整套工作台外壳，与本仓 `shell-*` 冲突 |

结论：**A 类在这一格是空的**。要么自己写编辑器（成本远高于接 Milkdown），要么不这片面做。

## 三、必须先解决的三个保真度缺口（本骨架的存在理由）

用 `@milkdown/kit@7.23.0`（commonmark + gfm）在 jsdom 下做真实往返，2026-11-03 实测：

```
✅ ```js 围栏        IDENTICAL
✅ 1. / 2. 有序列表  IDENTICAL
✅ # / ## 标题       IDENTICAL
✅ > 引用            IDENTICAL
❌ 见 [[线性代数]]   →  见 \[\[线性代数]]
❌ 甲\n\n\n\n乙      →  甲\n\n乙
❌ 甲··\n乙          →  甲\\\n乙
❌ ---\ntags:[a]\n--- →  ***\n\n## tags: \[a]
```

1. **`[[反链]]` 被转义成 `\[\[…]]`** —— 本仓笔记页的反链（`countLinks`，:104）与 Obsidian 语法全靠它。
   直接回写会把全库双链**静默改成普通文本**。这条是**一票否决级**。
2. **连续空行折叠、行尾硬换行改写** —— 排版漂移，用户会看到「我明明空了两行」。
3. **frontmatter 被当成「分隔线 + 二级标题」** —— 若将来笔记带元数据，会直接毁掉头部。

因此 `src/upstream.js` 规定了「进出双侧私用区占位符缝合」的策略，且**禁止**任何绕过它直接调
`getMarkdown()` 的代码路径。宁可没有 WYSIWYG，也不能悄悄改字。

## 四、锁版依据（实测，不是 README）

- `npm view @milkdown/kit dist-tags` → `latest 7.23.0`（2026-10-27 发布）
- `npm i @milkdown/kit@7.23.0` → **added 156 packages in 11s**
- 156 个包里 `@milkdown/*` 子包版本**全部为 7.23.0**，**零 React 依赖** ⇒ 锁顶层版本即锁全树
- `exports` 正常，`getMarkdown` / `getHTML` / `replaceAll` 均为 function
- ⚠️ 方法论：**仓库 HEAD 的 version 不能当锁版凭据**，一律以 npm `dist-tags` 为准

## 五、评审时必须先回答的三个问题

1. **反链缝合能不能做到「零漂移」？** 拿本仓真实笔记（含 `[[x]]`、`[[x|别名]]`、`#标签`、
   连续空行、frontmatter 各若干）做 100 篇往返 diff，**必须 0 处差异**才允许继续。
2. **`edit()` 是否仍是唯一写入口？** 若是，则不变量成立；若不是（例如 WYSIWYG 直连 IPC），
   本骨架作废 —— 草稿是内存里的第二份正文，多一个写入口就是多一条数据丢失路径。
3. **卸载路径干净吗？** Milkdown 不 `destroy()` 会留下 `MutationObserver` 和计时器；
   笔记页的标签页是**频繁开关**的，这条必须在真机验。

以上任一答「否」→ **撤销本包**，把结论追加到 `docs/ecosystem-radar/registry.md` 对应行的备注。

---

## 目录

| 文件 | 作用 |
| --- | --- |
| `package.json` | 锁版 `@milkdown/kit@7.23.0`；`dsh.bundle.patch` 指向本地 patch |
| `cordis.patch.yml` | `insert: radar-milkdown-notes`（**未接入 profile**） |
| `src/index.js` | 面板接线契约（挂载点、焦点语义、保存链不变量） |
| `src/upstream.js` | **缝合层**：`toDoc` / `fromDoc` 占位与五类片段的保护策略 |
| `OWNERS` | `Owner: shared` |

本骨架不含 `test/`、`__tests__/`、`*.test.*`、`*.spec.*` —— 按仓库规则，radar 包不写测试。
