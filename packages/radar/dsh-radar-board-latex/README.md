# dsh-radar-board-latex —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 于 **2026-11-06 · r142 · C 组** 自动生成，仅用于人工评审。
> `renderBoardFormula()` 直接抛错，`apply()` 只留 TODO；没有 UI、没有存储、没有插槽注册。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。驳回则整目录删除。

---

## 一句话

**同一份公式，在课件 slide 上是好的，在白板上是源码。** 本包只补白板这一侧。

## 缺口（读码实测，不是猜）

| 位置 | 现状 |
| --- | --- |
| `dsh-zhiyun-classroom-renderer/src/view/slide.jsx:238` | `katex.renderToString(src, { throwOnError: false, strict: 'ignore' })` —— **正常渲染** |
| `dsh-zhiyun-core-classroom-stage/src/client.jsx:246-252` | `return <div className="zyc-stage-board-el zyc-stage-board-latex">{element.latex}</div>;` —— **纯文本子节点** |
| `dsh-zhiyun-core-classroom-stage/src/style.css:103-109` | `font-family: "Cambria Math", "Latin Modern Math", serif;` —— 用数学字体「假装」渲染，`\frac{a}{b}` 仍原样显示 |
| `dsh-zhiyun-core-classroom-agent/src/actions.js:156` | `wb_draw_latex` schema **存在且在启用白名单内**（`:374/:427/:776`）→ 不是死动作 |
| `dsh-zhiyun-core-classroom-stage/src/ledger.js:423, :476` | 两处落账都是 `type: 'latex'` + `latex` 字段 → **账本是真源，渲染才是缺口** |
| `dsh-zhiyun-core-classroom-export/src/standalone/player-runtime.js:109-112` | 离线播放器**已预留** `if (element.html) node.innerHTML = element.html;` —— 只是白板路径从未产出该字段 |

> 所以这不是「缺能力」，是「同一产品两个面板不一致」。KaTeX **已经在仓库依赖里**
> （`dsh-zhiyun-classroom-renderer/package.json:35` `"katex": "0.16.38"`），接进去不增加任何新依赖。

## ⛔ 作废条件（请先读这一条再读后面）

**本包成立与否，取决于 `wb_draw_latex` 的实际语法，而不是取决于 `kern` 好不好。**

| `latex` 字段里实际是 | 结论 |
| --- | --- |
| **全是 LaTeX**（`\frac{a}{b}`、`\sum_{i=0}^n`） | **本包作废、整目录删除。** 直接用仓库自带 `katex@0.16.38`，三行改动，零新依赖 |
| **出现 Typst**（`frac(a, b)`、`sum_(i=0)^n`） | 本包成立，锁 `kern-typ@0.2.0` |

为什么不能「反正 kern 也能渲染，就用 kern」：kern **吃 LaTeX 输入不报错**。
沙箱实测 `renderToString('\\frac{a}{b}')` → `<mtable class="kern-eqarray kern-aligned">…`，
**不抛错、不回落、静默渲成一张语义错误的表**。而本仓 `slide.jsx:239` 正是靠
`throwOnError: false` 把「渲染失败」变成「显示原文」——换成 kern 会把这个安全网拆掉。

> 一句话：**没有 LaTeX 前置判别，就没有本包。**

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [tejasprabhune/kern](https://github.com/tejasprabhune/kern) |
| npm | **`kern-typ@0.2.0`**（npm 名带 `-typ`：`kern` 已被一个 redis 客户端占用，上游 README 明确说明） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`；npm `versions['0.2.0'].license = MIT`；`LICENSE` 1,071 B 实文，三处一致） |
| Stars | ★20（fork 很少，单人项目） |
| 最近推送 | **2026-11-02**（`Add Typst source annotation and a real Typst parity oracle`） |
| npm 最近发布 | **2026-05-16**（`0.2.0`）—— ⚠ **npm 落后 GitHub 近 6 个月** |
| 语言 | TypeScript（产物含 `.d.ts`） |
| 依赖 | **零运行时依赖**（`dependencies` 空） |
| 体积 | `dist/kern.js` 71,232 B / `kern.min.js` 54,824 B / `unpackedSize` 207,445 B |
| 形态 | 纯库。无 `dsh.bundle.patch`、无 `cordis.patch.yml`、无客户端半边 |

**API 表面（与本仓 KaTeX 用法刻意同形）：**

```js
render(source, element, options)      // 替换 element 内容
renderToString(source, options)       // → HTML 字符串
renderMathInElement(el, { delimiters })   // 'kern-typ/auto-render'
options: { displayMode, output: 'mathml'|'html'|'htmlAndMathml', throwOnError, errorColor, macros, strict, trust }
```

**沙箱实测（`npm i kern-typ@0.2.0`，node ESM）：**

```
frac(a, b)                          => <mfrac><mi>a</mi><mi>b</mi></mfrac>
sum_(i=0)^n i = frac(n(n+1), 2)     => <msubsup><mo largeop="true">∑</mo>…
mat(1,0; 0,1)                       => …<mtable>…
integral_0^infinity e^(-x^2) dif x  => …<msubsup><mo largeop="true">∫</mo>…
cases(x & "if" x>0, -x & "else")    => …<mo stretchy="true">{</mo>…<mtable columnalign="left lef…
sqrt(x^2+y^2)                       => <msqrt>…
\\frac{a}{b}                        => <mtable class="kern-eqarray kern-aligned">…   ← ⚠ 错但静默
```

## 集成判定

- **类型**：**B · 其他 JS 项目**（非 DSH 原生插件包；上游无 `dsh.bundle.patch`，故**不含**上游 DSH 依赖）
- **关系**：**重复可强化**（强化式集成，不是「全新」）

| 判据 | 结论 |
| --- | --- |
| ① **仍是同一个面板** | ✅ 落点 `client.jsx:246` 的 `BoardElement`。同一块黑板、同一组元素坐标、同一次 `wb_draw_latex` 动作。**不新增页面、不新增面板、不改账本** |
| ② **功能仍相似正交** | ✅ 现有 = 「把公式画到白板上」（已实现，只是画成了源码）；新增 = 「把它画成公式」。同一动作、同一坐标，**只换渲染末端** |
| ③ **底层多调了更优质实现** | ⚠ **条件成立**：现底层是 `<div>{latex}</div>` 纯文本，任何真渲染器都比它优。但**选谁取决于语法** —— LaTeX → `katex`（仓库已有）；Typst → `kern-typ` |

## 为什么不是「全新」，也不是 ⛔

- **不是全新**：白板公式元素**已经存在**并会被真实产生（见上表 `actions.js` / `ledger.js`）。只换末端 = 教科书式的强化式集成。
- **不是「重复且无增益」**：现实现连行内分式都画不出来，谈不上「已有等价功能」。

## 与已有骨架的边界（防重复出骨架）

| 已有骨架 | 管什么 | 与本包关系 |
| --- | --- | --- |
| `dsh-radar-temml` | **LaTeX** → MathML（论文/笔记呈现层，`temml@0.14.0`） | **二选一**。若白板公式是 LaTeX，用 `katex` 或该骨架的 Temml，**本包删除** |
| `dsh-radar-better-markdown` | Markdown 流式渲染（自带 KaTeX） | 管「文字里的公式」，不管白板元素 |
| `dsh-radar-fsrs-scheduler` / `-fsrs-browser` / `-review-due` | 复习调度 | 无交集 |
| `dsh-radar-ics-export` | 课表 → ICS | 无交集 |

## 实现清单（评审通过后）

1. **语法判别**（不可省）：按 `\\[a-zA-Z]+` 反斜杠命令占比 + Typst 函数名白名单（`frac(`/`sqrt(`/`mat(`/`sum_(`）二选一判。
   判不准就**降级为显示原文**，绝不猜。
2. typst 分支 → `kernTyp.renderToString(src, { output: 'htmlAndMathml', throwOnError: false })`
   （`htmlAndMathml` 同时给浏览器和无 MathML 支持的导出路径用）。
3. latex 分支 → `katex.renderToString(src, { displayMode, throwOnError: false, strict: 'ignore' })`，与 `slide.jsx` 完全一致。
4. 两路都失败 → `escapeHtml(src)`，与 `slide.jsx` 同一策略。
5. 产物若是 HTML（`output: 'html'`），**必须同时塞进 `element.html`** ——
   离线播放器 `player-runtime.js:111` 已经在读这个字段，白板路径至今没产出它。

## 已知风险

| 风险 | 说明 |
| --- | --- |
| **npm 落后 GitHub 半年** | 锁版只能锁 `0.2.0`（2026-05-16）；GitHub 2026-11-02 的新特性拿不到。若要新特性 = **锁不住版** → 应降级为 🔵 而非挂载 |
| **单人项目 ★20** | 上游 bus factor = 1，长期维护风险高于 `katex`（本仓已用） |
| **CSS 依赖** | `output: 'html'` 必须引 `kern-typ/styles/kern.css`（默认字体走 KaTeX 的 cdnjs webfont → **离线不可用**；离线要换 `kern-newcm.css` 并自托管） |
| **不是 Typst 编译器** | 只有 Typst math 的**子集**（命名符号 + 十来个函数）。无 `\usepackage`、无环境、无编号 |

## 参考

- 报告：`docs/ecosystem-radar/2026-11-06-09.md`（§3.2.1 逐项实测、§4 判据、§7.1 评审第一问）
- 登记：`docs/ecosystem-radar/registry.md` → `2026-11-06 09:00 · C 组（学生功能域）· r142`
