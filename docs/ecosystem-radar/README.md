# 生态雷达（radar）

本目录由「DSH 生态雷达」每日任务自动维护。

- `YYYY-MM-DD.md` —— 当日扫描报告（**无新候选也会产出**）：跑了哪组关键词、新候选、类型、分级、与现有功能的关系、许可证核实、建议集成方式。同日多轮扫描**追加**在同一文件内。
- `registry.md` —— 候选登记表（**追加式**，去重真值）。同 `owner/repo` 不重复登记；只增行，除状态列外不改旧行。

## `radar-` 前缀的包

`packages/dsh-radar-*` 是雷达自动生成的**候选骨架**：

- **未评审、未接入 profile、不可直接使用**；
- 仅供人工评估；真要采用须重写并走正常包流程；
- **不要**把它们写进 `profiles/zhiyun-bench/package.json` —— 未验证的包会让整个工作台起不来（[CONTRIBUTING 3.1](../../docs/contributing/CONTRIBUTING.md)）。

## 两类优先候选

| 类型 | 判据 | 集成方式 |
| --- | --- | --- |
| **A · 原生 DSH 插件包** | 带 `dsh.bundle.patch` / `cordis.patch.yml` | **最高优先**。锁版挂载 + 外围兼容层（效法 `packages/dsh-zhiyun-paper`）：锁版引入上游、自有前缀路由、自有插槽承载，**绝不改上游源码** |
| **B · 其他 JS 项目** | JS / TS 技术栈 | 须**高 stars** 或**明确面向浙大 / 考试 / 刷题 / 笔记 / 论文 / 锻炼** |

## 强化式集成（核心判据）

❌ 不得简单集成重复功能；✅ 某功能已有、外部有更优底层时接进来增强它。三条**同时**成立才算：

1. **仍是同一个面板** —— 不新开导航项，落在既有页面里；
2. **功能仍相似正交** —— 两者回答同一域的不同问题，不重叠；
3. **底层多调了更优质实现** —— 确实引入了本仓没有的、更优的实现。

`registry.md` 的「与现有功能」列即此判据的落点：`全新` / `重复可强化`（鼓励）/ `重复无增益`（⛔ 不集成）。

## 硬边界

- **推 `radar` 分支，绝不推 `main`**。
- **候选包不得接进 profile**：绝不写 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`。候选包只放 `packages/` 下并标注「未接入、未评审」。
- **许可证（仅宽松）**：`MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense / CC0-1.0` ✅；`GPL / AGPL / LGPL / MPL` 与**无许可证** ⛔ 只登记「仅供参考」，**不得摘取任何代码**；`NOASSERTION` ⚠ 待人工核验，不采用。
- **不搬运上游源码**；**不碰他人 `OWNERS`**（新包 `Owner: shared`）。
- 候选骨架一律 `dsh-radar-` 前缀，避免与本仓 `dsh-zhiyun-*` 混淆。

## 评审入口

雷达会把结果推到 `radar` 分支并**自动开 PR**（radar → main）。请**在 PR 里审查**候选分级、许可证与集成判定。

骨架包的第三方来源记录按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md) 执行：参考他人实现后须在该包内写 `ATTRIBUTION.md`，并在根 [ATTRIBUTION.md](../../ATTRIBUTION.md) 指向它。
