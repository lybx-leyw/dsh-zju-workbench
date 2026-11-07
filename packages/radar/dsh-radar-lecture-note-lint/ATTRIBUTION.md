# ATTRIBUTION

## 借鉴对象

| 项 | 值 |
| --- | --- |
| 仓库 | [`chenqianyu486-sys/dsh-zju-lecture-note`](https://github.com/chenqianyu486-sys/dsh-zju-lecture-note) |
| 版本 | `1.3.3`（`package.json.version`；2026-11-01 读取） |
| 许可证 | **MIT**（`LICENSE` 首行 `MIT License`，26 行，双 Copyright：`chenqianyu486` 与 `zju-lecture-summerizer- contributors`）✅ |
| 借鉴位置 | `zju_lecture/note_lint.py`（378 行）中的**规则判据** |
| 借鉴方式 | **只借鉴规则清单与判定条件，用 JavaScript 重写；不复制任何源码** |

> 上游 GitHub API 报 `license.spdx_id = NOASSERTION`，但其仓库根**有** `LICENSE` 文件且为
> MIT 正文、`package.json.license = "MIT"`。按本任务规则「NOASSERTION → 待人工核验」，
> 已实读许可证原文完成核验：**是 MIT，不是无许可证**。仍仅借鉴规则、不摘代码，口径偏保守。

## 具体借鉴了哪些规则

`src/index.js` 的 `RULES` 表 11 条，判据逐条对应上游 `note_lint.py`：

| 规则 id | 上游判据 |
| --- | --- |
| `display_not_isolated` | `$$…$$` 必须独立成块，前后有空行 |
| `display_inline` | `$$…$$` 不得出现在行中间 |
| `table_bare_pipe` | 表格单元格内公式含未转义 `\|`（只有 `\|` 是合法转义；`\lvert` 不含竖线） |
| `frac_no_brace` | `\frac` 后必须紧跟 `{`（分子分母都要） |
| `dfrac_used` | `\dfrac` 在部分渲染器回退不一致 |
| `bare_imaginary_unit` | 裸 `i` 作虚数单位；`x_i` / `\mathrm{i}` 合法 |
| `inline_math_unclosed` | 行内公式未闭合 |
| `display_unclosed` | 块级公式未闭合 |
| `details_single_line` | 单行 `<details>` 会塌陷 |
| `summary_inline_content` | `<summary>` 与正文同行 |
| `text_cmd_cjk` | `\text{}` 内含 CJK 字符 |

## 明确**没有**借鉴的部分

- `zju_lecture/client.py`、`cookies.py`、`security.py`、`courseware.py`、`formatter.py` ——
  与本仓 `dsh-zhiyun-source-classroom` 重复，且涉及凭据读取，**一行未看、一行未取**。
- `lib/`（JS 桥）、`server.mjs`（MCP 入口）、`skills/` —— 属上游插件形态，本包不复用。
- `fix_markdown()`（自动修）—— 会改坏公式，未借鉴；评审若要自动修需单独立项。

## 许可证兼容性

上游 MIT，本仓同以 MIT 兼容口径使用；因属「规则重写」而非「代码复制」，不构成衍生作品，
但**仍在此声明来源**，便于审计。
