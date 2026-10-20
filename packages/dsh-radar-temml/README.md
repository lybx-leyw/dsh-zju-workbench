# dsh-radar-temml —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 是空实现，`TODO` 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [ronkok/Temml](https://github.com/ronkok/Temml) |
| npm | `temml@0.14.0` |
| 许可证 | **MIT** ✅（宽松白名单内，允许锁版引入） |
| 作者 | Ron Kok（上游提交者） |
| Stars | ★356（fork 27） |
| 最近推送 | 2026-10-08（同日发布 0.14.0） |
| 语言 | JavaScript |
| 依赖 | **零依赖**（`dependencies: null`） |
| 周下载 | ~72.9 万（npm registry，2026-10-06 ~ 10-12） |
| 上游形态 | **纯库**：无 `dsh.bundle.patch`、无 `cordis.patch.yml`、无客户端半边 |

上游 API 表面（`npm i temml@0.14.0` 实测）：`render` / `renderToString` /
`renderMathInElement` / `postProcess` / `ParseError` / `definePreamble`。

```js
require('temml').renderToString('\\frac{a}{b}', { throwOnError: false })
// => '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>'
```

## 集成方式

**锁版引入 + 薄封装**（B 类）。`package.json` 写精确版本 `0.14.0`；运行时核对实际安装版本
（`src/upstream.js`）；本包只做「TeX 字符串 → MathML 字符串」的转接，**不改上游源码**。

## 集成判定：**强化式集成**（⚠ 基线为空，需人工确认定性）

| 判据 | 结论 |
| --- | --- |
| 仍是同一个面板 | ✅ 不新增页面；公式出现在讲座要点 / 笔记正文 / 论文助手回答的**原位置** |
| 功能仍相似正交 | ✅ 仍是「呈现一段讲座/笔记文本」，只是数学片段从「源码」变成「排版结果」 |
| 底层多调更优质实现 | ⚠ 本仓**当前没有任何公式渲染器**，故是「无 → 有」 |

**增强哪个现有功能**：讲座要点页（`dsh-zhiyun-page-study` ← `dsh-zhiyun-core-lecture`）、
笔记页（`dsh-zhiyun-core-notes`）、论文阅读页的助手回答（`dsh-zhiyun-page-paper`）。

### ⚠ 定性风险（请评审重点看）

判据 ③ 的本意是「已有 A 实现，外部有更优 B 实现」。本包是「本来没有，接入 B」。
雷达按「同类内容渲染的质量升级」记为**强化式集成**，但严格按字面它更接近**全新能力**。
两种定性的处置不同：

- 若认「强化」→ 优先级高（改造面小、收益直接）；
- 若认「全新」→ 应回到候选池按「学生场景契合度」重新排队，优先级下调。

**这个定性必须由人决定，雷达不代为裁定。**

### 与 `dsh-radar-better-markdown` 的冲突（必须二选一或明确分层）

`packages/dsh-radar-better-markdown/` 锁版挂载的上游自带 **KaTeX**。若它先被采用：

- 本包的 ③ 判据立刻塌掉（从「没有」变成「已有另一个底层」）→ 本包应判 **⛔ 重复且无增益** 并删除；
- 或者明确**分层**：Markdown 流（论文全文）走 KaTeX，结构化字段（讲座要点）走 MathML。
  分层可行，但要接受**两套公式引擎**的维护成本。

## 现状核实（为什么不是「替换」）

对 `main` 分支（2026-10-18）的核对结论：

| 位置 | 现状 |
| --- | --- |
| `dsh-zhiyun-core-lecture/src/tree.js` | `looksLikeNotationOnly()` 用 `/^\$...\$$/` 判断「这一行是否为公式」，用于**标题判定**，不是渲染 |
| `dsh-zhiyun-core-parser/src/correction-policy.js` | 对 `$...$` 做**文本清洗**（去 `\quad`、剥 `\mathrm` 等），产出仍是纯文本 |
| `dsh-zhiyun-page-paper/src/citations.js` | 只处理「第 N 页」页码引用，与公式无关 |
| 依赖树 | 无 `katex` / `mathjax` / `temml` 任何一项 |

即：`$k_1$` 今天是**原样交给宿主 `MarkdownText` 显示**的。

## 主要风险

1. **MathML 字体兼容性**弱于 KaTeX 的 HTML+CSS 方案（老浏览器、部分移动端 WebView）。
   本仓是 Web 工作台 + Electron 桌面壳（`apps/desktop`），桌面壳的 Chromium 版本较新，
   风险主要在移动浏览器。
2. **链接注入**：上游 `\href` 可产出带 `href` 的 MathML 节点。讲座转写文本属于**不可信输入**，
   接入时必须确认 `trust: false` 之类开关能挡住外链（见 `src/index.js` TODO 5）。
3. **两套引擎**：若与 `dsh-radar-better-markdown` 并存，公式排版在两条路径下不一致。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 占位 + TODO（接入点、降级策略、注入目标、安全边界） |
| `src/upstream.js` | 锁版凭据（包名 / 精确版本 / 仓库 / 基线事实） |
| `cordis.patch.yml` | 一条 `insert`，`name` 与包名一致 |

## 下一步（给评审者）

1. 先裁**定性**：「强化」还是「全新」。
2. 再裁**与 better-markdown 的关系**：替代、分层，还是本包直接驳回。
3. 两条都通过后，再按 `src/index.js` 的 TODO 1–6 落地实现。
