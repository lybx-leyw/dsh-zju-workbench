# dsh-radar-fsrs-browser

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-10-17 · C 组 · 第九轮）。采用前请**重写**并走正常包流程。
>
> **本包是「强化式集成」，不是「全新功能」。**

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/open-spaced-repetition/fsrs-browser |
| npm | `fsrs-browser`（本骨架**锁版** `6.6.0`，不用 `^`） |
| 许可证 | **BSD-3-Clause** ✅（宽松白名单） |
| 语言 | Rust（编译为 WASM） |
| ★ | 57（最近 push 2026-06-14） |
| 依赖 | **零运行时依赖**（`dependencies: None`）；导出 `fsrs_browser.js`，类型 `fsrs_browser.d.ts` |
| 作者 | `open-spaced-repetition` 组织（同一组织亦维护 `ts-fsrs` / `fsrs-rs` 等） |

## 集成判定

- **类型**：**B · 其他 JS 项目** —— 上游无 `dsh.bundle.patch` / `cordis.patch.yml`，
  故本包**不含上游 DSH 依赖**，按 B 类「能力提取 + 封装」处理。
- **与现有功能的关系**：**强化式集成** —— 增强「学习」页（`dsh-zhiyun-page-study`）
  与「习题」能力（`dsh-zhiyun-quiz`）的复习调度。
- **为什么算强化而非重复**：三条**同时**成立 ——
  1. **仍是同一个面板**：「学习」页不新增页面、不改交互，仍是同一棵树；
  2. **功能仍相似正交**：还是做题与复习，只是「先复习谁」由调度器决定、
     「参数从哪来」由优化器决定 —— 与本仓现有的「固定顺序刷题 / 手动排序」正交；
  3. **底层多调了更优质实现**：引入本仓**没有**的 **WASM 加速 Optimizer**
     （既有的纯 TS `ts-fsrs` 无 Optimizer WASM 路径）。
- **集成方式**：锁版引入 npm 包 + 薄封装（能力提取 + 封装，**不搬运上游源码**）
- **边界**：`dsh-zhiyun-quiz` 继续只管出题与质检；本包只管「下一次该复习谁」与
  「参数如何优化」；状态优先落 `dsh-zhiyun-study-core`，**不自建落盘**。

## ⚠ 关键前置裁决：与 `dsh-radar-fsrs-scheduler` 的关系

本仓**已有** `packages/dsh-radar-fsrs-scheduler`（2026-10-14 第二轮产出，
锁版 `ts-fsrs@5.4.2`，**同样是候选骨架**）。二者同属 `open-spaced-repetition` 组织，
**是分层而非竞品**，但 **不应同时采用** —— 否则违反「功能仍相似正交」判据。

| 方案 | 做法 | 收益 | 代价 |
| --- | --- | --- | --- |
| ① **替换** | 用 `fsrs-browser` 取代 `ts-fsrs` | 获得 WASM Optimizer | 引入 WASM 构建链，打包与资产加载变复杂 |
| ② 分层 | `ts-fsrs` 管纯算法、`fsrs-browser` 管优化器 | 能力最全 | 两个依赖，职责边界需严格约束 |
| ③ 维持现状 | 保留 `ts-fsrs`，不引入本包 | 简单、依赖少 | 无参数优化能力；认为当前阶段属过度设计 |

> **本骨架按【方案 ①】出具。** 若人工裁决为 ②/③，请改写或直接废弃本骨架。

## 上游未改动声明

本骨架**不含任何上游源码**，仅声明依赖并留下封装 TODO；
FSRS 算法与优化器实现完全来自上游 `fsrs-browser`（BSD-3-Clause）。
`src/upstream.js` 为纯接缝占位，效法 `packages/dsh-zhiyun-paper/src/upstream.js` 的组织方式。

## 主要技术风险（采用前须验证）

1. **WASM 资产加载**：上游导出 `fsrs_browser.js`，WASM 产物在宿主（Electron / Web 打包）
   下的加载路径与静态资源发布方式**必须实测**。
2. **降级路径**：WASM 不可用时应有可读降级（回退纯 TS 实现），
   **不能**让「学习」页整体不可用。
3. **项目成熟度**：57★、`forks=6`，属小而专的上游；建议冻结版本并保留替换能力。

## 尚未完成（采用前必做）

- [ ] **裁决**与 `dsh-radar-fsrs-scheduler` 的关系（方案 ①②③，见上表）
- [ ] 核实 `fsrs-browser` 6.6.0 的 API 表面，写薄封装（不重写算法）
- [ ] 实测 WASM 资产加载与失败降级路径
- [ ] 与 `dsh-zhiyun-study-core` 对齐状态存放粒度（账号 + 课程 + 节次）
- [ ] 明确与 `dsh-zhiyun-quiz` 的接缝，避免职责互相侵入
- [ ] 补测试（`npm test`）、接入 profile、按 CONTRIBUTING 写 `OWNERS`
