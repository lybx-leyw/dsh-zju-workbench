# dsh-radar-code-highlight

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 只有签名与 TODO，调用即抛错 ——
> 这是故意的，避免「看起来能跑」的骨架被误用。

## 集成类型：**强化式集成**（同一个面板 · 相似正交 · 底层换更优实现）

| 项 | 值 |
| --- | --- |
| 类型 | **B 类 · 其他 JS 项目**（无 `dsh.bundle.patch`，不是原生 DSH 插件） |
| 上游 | [`highlightjs/highlight.js`](https://github.com/highlightjs/highlight.js) ★25002 |
| 锁定版本 | `highlight.js@11.12.0`（精确版本，非 `^`） |
| 许可证 | **BSD-3-Clause** ✅（GitHub metadata 与 npm `license` 两源一致） |
| 作者 | Josh Goebel（current maintainer）与 highlight.js contributors |
| 与现有功能的关系 | **重复且可强化**（不是全新功能） |
| 强化的是谁 | 「论文」页 PDF 选中区里的代码、`dsh-zhiyun-lecture` 讲义里的代码段、`dsh-zhiyun-page-notes` 笔记里的围栏代码块 |

## 为什么是「强化」而不是「重复」

三条判据逐条对照：

| 判据 | 成立？ | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增页面/导航/RPC；只改**已有面板里代码块的显示** |
| ② 功能仍相似正交 | ✅ | 仍是「把一段代码显示出来」；不是运行、不是编辑、不是搜索 |
| ③ 底层多调了更优质实现 | ✅ | 本仓**没有任何高亮层**（`grep hljs|shiki|highlight` 只命中一句 TODO 注释） |

第三条是硬门槛，因此**不涉及**「重复且无增益」的风险：

> 现状：围栏代码块能显示（宿主 `MarkdownText` 负责），但是**一段纯等宽文本**。
> 不是「有高亮但不好」，而是「**没有**高亮」。这条属于「有 → 更准/更好读」中的「有 → 更好读」。

## 上游选型：为什么是 highlight.js 而不是 shiki / Prism

| 候选 | 许可 | 体积/首屏 | 结论 |
| --- | --- | --- | --- |
| **highlight.js** ★25002 | BSD-3-Clause | **零依赖、无构建步骤**、`core` + 按语言 import | ✅ **选用** |
| `shikijs/shiki` | MIT | 依赖 Oniguruma WASM，首屏重 | 🔵 记录（`dsh-radar-better-markdown` 的 TODO 原本想的就是它） |
| `PrismJS/prism` | MIT | 无条件但有全局状态、需 CSS 主题 | 🔵 记录 |
| `wooorm/starry-night` ★1817 | MIT | 521 个语法 + 依赖 `vscode-textmate` | 🔵 记录（许可与形态都好，但依赖树更重） |

**决定性理由**：`highlight.js` 是三者中唯一**既有 core-only 入口、又零运行时依赖、且无构建步骤**的；
`package.json` 里 `dependencies` 为空 —— 整棵依赖树就是它自己。

## 现状 vs 上游（每条都能在源码里指到）

| 能力 | 本仓现状 | 上游 |
| --- | --- | --- |
| 围栏代码块**渲染** | ✅ 宿主 `MarkdownText`（`page-notes/src/client.jsx` L23-26） | 不负责，本包也不负责 |
| 代码块**着色** | ❌ 无 | ✅ token 级 `hljs-*` 类名 |
| 语言名归一（`js`/`jsx`/`py`/`c++`） | ❌ 无 | ✅ `registerAliases`（本包另建有限枚举） |
| 体积控制 | — | ✅ `lib/core.js` + 逐语言 `import()` |

## 体积（沙箱实测 2026-10-19）

- npm `unpackedSize` = **5,503,982 B（5.50 MB）** —— 这是**全量**包，不是首屏量。
- `es/` 目录 ≈ 2.7 MB，含 190+ 语言；`styles/` ≈ 2.4 MB（每主题一个 CSS）。
- core-only 入口只含引擎；单语言文件 1–30 KB 量级。
- **无构建步骤**：`es/`、`lib/` 都能直接 `import`。

> ⚠ 上表「core-only 首屏数十 KB」是本轮的**估算**，尚未在浏览器里量过 gzip 后体积。
> 评审若在意这一点，第一批要做的就是把这条改成实测数字（见 src/index.js TODO 4）。

## 已知风险（评审重点）

1. **CSS 主题本身也可能很大**：`styles/` 2.4 MB 是**全部**主题的总和；单个 `github.min.css` 仅数 KB。
   **不要**把 `styles/` 整目录打包。
2. **`highlightAuto()` 必须禁用**：它在 core-only 下只认已注册语言，且会诱导「注册全部语言」。
   围栏没有语言标识时，正确做法是**显示纯文本**，不是猜。
3. **语言白名单是主观的**：本轮按「课程作业真会贴什么」定了 12 种。
   评审若认为 `matlab` / `r` 用不上，删掉即可 —— 白名单越短，首屏越轻。
4. **不是 DSH 原生插件**：没有 `dsh.bundle.patch`，接法只能是「本包提供服务 → 面板注入」，
   与 `dsh-zhiyun-*` 现有包一致，**不存在 iframe/锁版挂载**的需求。

## 下一步（评审通过后）

1. 先做**只读对比**：把 3 段真实讲义代码（C / Python / SQL）分别用「现状纯文本」与
   「core + 白名单高亮」渲染，量 gzip 后体积与首屏 TTI。
2. 实现 `normalizeLanguage()` 的单测（表已在 `src/upstream.js`，纯函数，零依赖）。
3. 只在**一个**面板接入（建议「讲义」页），观察一周再推广到论文/笔记。

## 不做什么

- **不做**代码运行、不做代码搜索、不做编辑器。
- **不碰** `profiles/zhiyun-bench/package.json`。
- **不搬**上游源码：只通过 npm 依赖引用 `highlight.js@11.12.0`。
