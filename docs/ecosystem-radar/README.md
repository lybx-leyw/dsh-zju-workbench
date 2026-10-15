# 生态雷达（radar）

本目录由「DSH 生态雷达」每日任务自动维护。

- `YYYY-MM-DD.md` —— 当日扫描报告（**无新候选也会产出**）：跑了哪组关键词、新候选、类型、分级、与现有功能的关系、许可证核实、建议集成方式。同日多轮扫描**追加**在同一文件内。
- `registry.md` —— 候选登记表（**追加式**，去重真值）。同 `owner/repo` 不重复登记；只增行，除状态列外不改旧行。
- `rotation-state.md` —— **轮换状态**（选组单一真源）。任务开跑前先读它选组，跑完写回它。

## 轮换：先读状态再选组（重要）

原轮换公式 `day_of_year % 3` **只按日期取组，不记录「今天已经跑过哪组」** —— 同一天多跑一次
就必然重复跑同一组。2026-10-14 当天跑了三轮，第二、三轮关键词**逐字相同**，第三轮几乎全是重复劳动。

改为状态驱动，**跨天照旧、同日绝不重跑**：

```bash
# ① 开跑前：选组（只读，不改）
node scripts/radar-rotation.mjs

# ② 跑完：写回状态
node scripts/radar-rotation.mjs --commit <A|B|C> --note "关键词1 / 关键词2"

# 只取组名，便于脚本里用
node scripts/radar-rotation.mjs --group
```

取组规则：

1. **跨天**（`last_run_at` 不是今天）→ `(day_of_year % 3)` 对应的组，**与原公式完全一致**，不打乱既有节奏；
2. **同日**（`last_run_at` 是今天）→ 今天**尚未跑过**的组里累计次数最少的那个；
   三组今天都跑过 → 给出 `exhausted` 提示（**此时不建议再跑，重复劳动不会带来新候选**）；
3. 状态缺失/损坏 → 回落规则 1 并标 `stale`，不中断任务。

细节与字段说明见 `rotation-state.md`；行为由 `tests/radar-rotation.test.mjs` 钉住。

> 除状态外，**开跑前还必须 `fetch` 并检查 `origin/radar`**。「本地提交不跨轮保留」只对**本地**成立 ——
> **远端 radar 分支是保留的**。2026-10-14 有轮次因 `ls-remote` 超时被误读成「radar 不存在」，
> 遂从 `origin/main` 建分支，push 被拒（non-fast-forward）；当时若改用 `--force` 强推，
> **会摧毁当日前两轮的全部工作**。正确做法是 rebase 到 `origin/radar` 后再推。

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
