# ATTRIBUTION — dsh-radar-board-latex

本包是**候选骨架**，尚未移植任何上游代码。下列记录为评审通过后、真正接入时需要遵守的归属要求。

## 上游 1 · tejasprabhune/kern

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/tejasprabhune/kern |
| npm 包 | `kern-typ`（`kern` 已被占用） |
| 版本 | `0.2.0`（npm 发布 2026-05-16） |
| 许可证 | **MIT** ✅（`LICENSE` 1,071 B） |
| 使用方式 | **`package.json` 正常依赖引入，锁版 `0.2.0`**（不用 `^`） |

按 `docs/contributing/CONTRIBUTING.md` 3.3：**第三方库经 `package.json` 正常引入并按原协议使用时，不需要额外声明。**
本条记录仅为可追溯性，非法律要求。

### 参考了什么（未移植代码）

仅参考其 **API 形状** —— `render` / `renderToString` / `renderMathInElement` 三件套、
`options: { displayMode, output, throwOnError }` 的字段名与语义。这与 KaTeX 的 API 同形，
上游 README 亦自述为「Drop-in alternative to KaTeX」，属行业通行接口，不构成独创表达。

**未**复制其词法分析（`lexer.ts`）、解析（`parser.ts`）或符号表（`symbols.ts`）。

## 上游 2 · KaTeX（条件分支备用）

| 项 | 值 |
| --- | --- |
| npm 包 | `katex@0.16.38` |
| 许可证 | MIT |
| 关系 | **本仓已是直接依赖**（`packages/dsh-zhiyun-classroom-renderer/package.json:35`） |
| 用途 | 若白板公式实为 LaTeX，则**用 KaTeX 而非 kern**，本包整体作废；此时无需任何新增归属 |

## 负向记录

`ronkok/Temml`（已在 `dsh-radar-temml` 骨架中锁版 `temml@0.14.0`）**不在本包的依赖里**：
Temml 吃 LaTeX，kern 吃 Typst，二者输入侧不交。若两者都进同一页面，需要「先判语法再分派」，
见 README「⛔ 作废条件」。
