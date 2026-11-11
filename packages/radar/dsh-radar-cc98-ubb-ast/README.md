# dsh-radar-cc98-ubb-ast —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-11-05 · B 组），**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` **直接抛错**，
> 而且**不含任何上游代码、不含任何实现**（`dependencies` 为空，B 类不引入上游 DSH 包）。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

把 CC98 正文读侧从 **「UBB → 纯文本字符串」** 升级为 **「UBB → 带标签语义的 AST」**，
让 `[size] [color] [user] [img=1] [mp3] [audio] [video] [quote]` 这些 CC98 方言标签
不再在第一步就被压成内容本身。

## 集成方式：**强化式集成（重复且可强化）** —— 不是「全新」

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是 `packages/dsh-zhiyun-source-cc98/src/reads.js` **已有的 4 处正文出口**（帖子 / 简介 / 通知 / 私信）。不新建页面、不新增侧栏、不新增插槽 |
| ② 功能仍相似正交 | ✅ | 同一输入（UBB 字符串）、同一出口（正文），只把**中间表示**从 `string` 换成 AST。与 `dsh-radar-cc98-ubb-bridge`（**写**方向：Markdown → UBB）构成读写对偶，方向相反、不重叠 |
| ③ 底层多调了更优质实现 | ✅ | 本仓 `dsh-zhiyun-source-cc98/src/ubb.js` **全文 78 行**，`grep -c 'tag\|case'` = **0**，即**零标签分派** —— 「标签语义」这一维本仓结构上给不出。上游提供 25+ 标签的 CC98 方言映射表 |
| ④ 不是重复无增益 | ✅ | 若只做「又一个 UBB→显示」则是重复；但它给的是**本仓输出类型给不出的维度**，属升级而非并列替换 |

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [CoolSpring8/griseous](https://github.com/CoolSpring8/griseous) |
| 许可证 | **MIT** ✅（`LICENSE` 实文已读：`MIT License / Copyright (c) 2021 CoolSpring8`；GitHub `spdx_id` 一致） |
| Stars | ★1 |
| 活跃度 | **push 2022-07-07 —— 停更 4 年**（这也是不出客户端骨架的原因之一） |
| 语言 | TypeScript / React / Vite（默认分支 `master`） |
| 拟参照的文件 | `src/utils/Ubb.ts`（213 行，25+ 标签） |
| **不**参照的文件 | `src/pages/*`、`src/components/*`、`src/store.ts`、`src/hooks/*`、`src/App.tsx` —— **整个客户端形态都不要** |
| 附带线索 | `src/utils/boardInfoJson.ts`（14 KB，版块 id→名称全表，含「学习天地 68 / 科研学术 581」等），可供 `source-cc98` 版块名解析参考 |

### 为什么 ★1 的项目值得 🟢

因为判定看的是 **许可证 × 形态 × 与本仓的差集**，不是 ★。
`griseous` 的**客户端**价值为零（本仓不做 CC98 客户端），
但它的 **`Ubb.ts` 是一张完整的 CC98 方言标签表**，且首行注明了出处：

```
// https://github.com/ZJU-CC98/Forum/blob/dev/CC98.Forum/CC98.Forum/Ubb/UbbCodeExtension.tsx
```

即这张表本身就转述自官方 Forum 的原生实现 —— 表里每个标签的选择
（`[img=1]` → `isHiding`；`[size]` 夹到 7 并换算 `n/3 + 0.5rem`；`quote` → `blockquote`）
都是"CC98 上实际长这样"，而不是某个人的审美。

## 与在册骨架的关系（**不合并、不替代**）

```
dsh-radar-bbob            解析器层：UBB 字符串 → AST（@bbob/core，锁 4.4.1）
        │
        ├── dsh-radar-cc98-md-render  读·保结构（cc98-vscode 的文档图/锚点）
        └── dsh-radar-cc98-ubb-ast    ← 本包：读·**标签语义表**（25+ 标签映射）
        │
dsh-radar-cc98-ubb-bridge 写回层：Markdown → CC98 UBB 方言
```

**后续轮次约定**：cc98 渲染类骨架到此为三层，**不再生成第五个**，
除非上游带来本仓结构上给不出的新维度。

## 评审先回答的四个问题

`src/index.js` 的 `OPEN_QUESTIONS` 常量（挂载时报错会原样带出）：

| # | 问题 | 为什么不能默认决定 |
| --- | --- | --- |
| TODO-0 | AST 节点形状自定，还是复用 `dsh-radar-bbob` 的 `@bbob/core` 节点？ | 两套节点形状 = 两套解析器 → 直接违反判据② |
| TODO-1 | `reads.js` 4 处出口目前返回 `{text}`，换 AST 是否**破坏**下游快照？ | 影响面未实测，不能拍脑袋 |
| TODO-2 | 安全面：上游 `url` 标签处**自带 `// TODO: XSS?` 注释** | 本仓渲染前必须做 `http/https` 白名单；`[img=1]` 隐藏图是否要二次确认 |
| TODO-3 | 25+ 标签里，本仓真实帖子正文**实际出现几个**？ | 上一轮 `zotero-venue-tagger` 的教训：「上游有规则库 ≠ 本仓有那个字段」 |

> TODO-3 是**必须先做的一步**：用本仓 `reads.js` 抓到的 20 条真实帖子正文跑一遍标签覆盖统计，
> 再决定第一版进哪些标签。**不要先写实现再验证覆盖面。**

## 文件

| 文件 | 说明 |
| --- | --- |
| `package.json` | B 类：`dependencies` 为空（**不含**上游 DSH 包）；`dsh.bundle.patch` 指向 `cordis.patch.yml` |
| `cordis.patch.yml` | `insert: [{ id: radar-cc98-ubb-ast, name: dsh-radar-cc98-ubb-ast }]` |
| `src/index.js` | `apply()` 抛错；`PROPOSED_TAG_MAP` 为评审示意；`OPEN_QUESTIONS` 四条 |
| `ATTRIBUTION.md` | 上游 MIT 归属 |
| `OWNERS` | `Owner: shared` |
