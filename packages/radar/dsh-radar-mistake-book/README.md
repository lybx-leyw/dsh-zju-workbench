# dsh-radar-mistake-book —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` **只有占位与 TODO**，
> 所有导出一律抛错。**请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。
>
> 本包**没有测试文件**（按仓库规则，radar 包不写测试）。

---

## 集成性质：**全新** —— 判 **🟢**

> 这一条**不是**强化式集成，如实说明为什么。

| 「强化式集成」三判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ❌ | 卷面错题**没有**归入现有任何一页：`core-quiz` 的归因列表只覆盖系统自己出的题 |
| ② 功能仍相似正交 | ❌ | 不是「同一个面板换个底层」，而是**一条新入口**（从纸面进来） |
| ③ 底层多调了更优质实现 | — | 无既有实现可替代，谈不上「更优」 |

**结论：按判据如实记为「全新」**，不做包装。

---

## 本仓的缺口（本轮 `grep` 实测）

```text
# 错题归因确实存在，但来源被死死限定
packages/dsh-zhiyun-core-quiz/src/store.js:21
    attempts | 作答记录 | 错题归因与薄弱点统计的**唯一**依据，是**已经发生过的事**

# 卷面/图片 OCR 通路：0
grep -rl "ocr\|OCR" packages/*/src
    → dsh-zhiyun-source-bilibili/src/triage.js
    → dsh-zhiyun-source-bilibili/src/playurl.js
    → dsh-zhiyun-core-classroom-agent/src/summarizers/state-context.js
    （全部是 bilibili / 课堂视频与字幕，没有一条是卷面）
```

也就是说：**老师发的纸质卷、你拍的照片、扫描的 PDF —— 一个字都进不来。**
「薄弱点」只看得见系统出过的题，看不见真正的考试卷。

---

## 上游是什么

`suanmingxing/dsh-ai-mistake-book`（**MIT** ✅，v0.3.2，★1，建仓 2026-10-17，JS）

**原生 DSH 插件包**：`package.json` 有 `dsh.bundle.patch → ./cordis.patch.yml`
（补丁 id `ai-mistake-book`），`engines.dsh >= 0.2.1-rc.2`。

做的事——**不是「AI 帮你解题」，而是「AI 帮你把卷面上已经存在的东西整理成可复习的结构」**：

| 步骤 | 细节 |
| --- | --- |
| 投喂 | PDF/图片 → 自动光栅化（默认 **400 dpi**），切整页概览 + 高清横带；看不清时按需原生分辨率重切 |
| 逐题提取 | 按**你报的题号**提取题干、作答、**划改**、页边演算、卷面标注、知识点、**错因**、难度 |
| 确认后归档 | `library/<学科>/<卷子>/cards/*.md`，带 front-matter，可手改、可 diff、可进版本库 |
| 索引 | 自动重建 `index.md` / `index.json`：学科 → 一级 → 二级知识点 |
| 手写笔记 | `/note` 多页逐页转录，保留标题/列表/表格结构，公式存 **LaTeX** |
| 笔迹颜色筛选 | 只整理**指定颜色**的笔迹（红笔订正 vs 蓝笔原答，能分开） |
| 导出 | PDF，公式用**Word 原生公式（OMML）**排版，不是 Unicode 拼凑 |
| 兜底 | 读不准的写进「待人工确认」，**绝不编造**；删除进 `_trash/` 可还原 |

---

## 与本仓的关系：**不重复**，且**与已登记的 OCR 簇正交**

registry 里已有三条 OCR 线索（`jing-hy/picturereader`、`CraZY222123/dsh-ocr-plugin`、
`ferstar/dsh-tool-ocr`），它们做的是**「图片 → 文本」这一层**，全部停在 🔵 线索。
本条的价值**不在 OCR**，而在 OCR **之后**：

```text
[OCR 簇]            图 → 文本
[本条 ]   图 → 题号切分 → 逐题结构化(含错因/知识点) → 按知识点索引 → 归档可复习 → 带公式导出
```

两者**正交**，不构成重复登记。

---

## 三处增量（评审通过后才实现，见 `src/` 的 TODO）

| # | 增量 | 为什么需要 |
| --- | --- | --- |
| ① | 卷面错题**可选回流**到 `core-quiz` 的 `attempts` | 不回流则「薄弱点」永远看不见考试卷；但**先要确认 `attempts` schema 容得下「无系统题 id」的条目** —— 这是本仓的硬约束，不是插件的事 |
| ② | `archiveRoot` **钉在工作区**，拒绝指向 profile | 上游默认 `~/.dsh/ai-mistake-book`；落进 profile 等于把学习资料写进应用配置目录 |
| ③ | 视觉模型能力**前置探测** | 上游在插件启动时校验（设计正确，不静默失败），但用户重启完才知道；本层在投喂前就提示 |

---

## 风险清单（评审必看）

1. **硬依赖视觉输入**：分析模型必须支持图片，否则插件启动即失败。这是**能力门槛**，不是 bug；
2. `engines.dsh >= 0.2.1-rc.2` 需与本仓 profile 基线对齐，低了要在**挂载前**失败（TODO-5）；
3. 上游把 `node_modules/`（`@deepseek-ai/schemastery`、`@deepseek-ai/cosmokit`、`katex`）
   **随仓库提交**，只为支持 `link:` 安装 —— **本骨架不 vendor**，只声明 `dependencies`；
4. npm **无发布**（README 明写只走 GitHub），只能按 tag 锁：`github:suanmingxing/dsh-ai-mistake-book#v0.3.2`；
5. **双挂风险**：用户若自己 `dsh plugin add` 装过上游，本包再整体挂载会重复（TODO-4）；
6. 上游 LICENSE 已实读确认首行为 `MIT License / Copyright (c) 2026 suanmingxing`。

---

## 文件

| 文件 | 职责 |
| --- | --- |
| `package.json` | 锁版 `ai-mistake-book: 0.3.2`（**不用 `^`**），`dsh.bundle.patch` → `./cordis.patch.yml` |
| `cordis.patch.yml` | `insert: [{ id: radar-mistake-book, name: dsh-radar-mistake-book }]` |
| `src/index.js` | 挂载点 + TODO-1/2/3（回流、归档根、视觉探测），全部抛错 |
| `src/upstream.js` | **唯一**接触上游的文件 + TODO-4/5（挂载、engines 对照） |
| `OWNERS` | `Owner: shared` |
