# dsh-radar-better-markdown —— 候选骨架

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
| 仓库 | [zerob13/dsh-better-markdown](https://github.com/zerob13/dsh-better-markdown) |
| npm | `dsh-better-markdown@0.1.2` |
| 许可证 | **MIT** ✅（宽松白名单内，允许锁版引入） |
| 作者 | zerob13 |
| Stars | ★20 |
| 最近推送 | 2026-08-17 |
| 语言 | TypeScript |
| 上游挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client`（npm registry 已核实） |
| 上游依赖 | `markstream-react`、`mermaid`、`katex`、`shiki`、`@shikijs/*`、`stream-markdown` |

## 类型与集成判定

- **类型**：A · 原生 DSH 插件包（带 `dsh.bundle.patch`）
- **集成方式**：**强化式集成** —— 锁版挂载 + 外围承载，**绝不改上游源码**
- **与现有功能的关系**：**重复且可强化** ✅

### 三条判据（同时成立才算强化式集成）

| 判据 | 本候选 |
| --- | --- |
| 仍是同一个面板 | ✅ 论文阅读页 / 笔记页，不新增页面、不改导航 |
| 功能仍相似正交 | ✅ 两边都是 Markdown 渲染，非两套并列能力 |
| 底层多调了更优质实现 | ✅ `markstream-react` 流式渲染 + Mermaid + KaTeX + 降级兜底，现有朴素渲染没有 |

## 增强哪个现有功能

`packages/dsh-zhiyun-host-paper`（论文阅读页）、`packages/dsh-zhiyun-core-notes`（笔记页）
的 Markdown 呈现区。当前呈现能力朴素；接上游后**同一区域**获得：

- 抗流式的增量渲染（长文档/流式回答不再闪烁重排）
- Mermaid 图表（论文里的流程图、数据流图直接出图）
- KaTeX 数学公式（理工科论文刚需）
- 渲染器降级兜底（出图失败不炸整页）

## 接入边界（重要）

本骨架**只做锁版引入 + 承载**，不碰上游源码，也不改他人 `OWNERS`。
真正把渲染器接进面板的那一步（替换呈现区组件）属于**编辑性质**，
**不在本骨架内完成** —— 待评审通过后，由独立的编辑流程处理。

## 需要人工裁定的事项

1. **与 `Laplace-bit/dsh-smooth-stream`（★82）二选一** —— 两者都是流式渲染，
   功能重叠。本候选胜在 Mermaid/KaTeX 齐全，对方胜在 ★ 更高、更聚焦滚动处理。
2. **体积评估** —— `mermaid` + `katex` + `shiki` 是重量级依赖，需确认不拖慢「今天」页首屏。
3. **呈现区替换边界** —— 结论块/引用块若无 Markdown 语义则不动。

## 未接入声明

- ❌ **未**写入 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`
- ❌ 未在真实环境挂载
- ❌ 未落实任何业务逻辑（`src/index.js` 为空实现）

## 许可与署名

上游 MIT，本骨架仅锁版引用、不摘取源码。若后续确有代码借鉴，
按 `CONTRIBUTING.md` 3.3 在 `ATTRIBUTION.md` 登记。
