# dsh-radar-agent-teams

> **候选骨架：未评审、未接入 profile、不可直接使用。**
> `src/index.js` 的 `apply()` 只打一行日志，`loadUpstream()` 永远返回
> `{ ok: false, error: 'candidate skeleton: not implemented' }`。
> 本包**没有**被写进 `profiles/zhiyun-bench/package.json`，也不会自动加载。

**集成性质：强化式集成（不是全新功能）。**

把 `NanmiCoder/dsh-agent-teams` 锁版挂载进来，作为「规划」页（周计划）与「今天」页
（当日执行）的**任务分解与依赖调度底层** —— 仍是同一张计划表、同一页待办，
只是「排计划」这件事的底层从「一次 LLM 出一张扁平清单」换成
「依赖感知的任务图 + 状态推进」。

| 项 | 值 |
| --- | --- |
| 上游仓库 | <https://github.com/NanmiCoder/dsh-agent-teams> |
| 上游版本（锁版） | `@nanmicoder/dsh-agent-teams@0.1.25`（npm `latest`，2026-10-18 发布） |
| 许可证 | **MIT** ✅（GitHub metadata `MIT` / npm `license: MIT`，两源一致） |
| 作者 | NanmiCoder |
| 星级 / 活跃度 | ★2299 · push 2026-10-18 · 31 个发布版本 |
| npm unpacked | 3,418,813 B（≈3.26 MB） |
| 类型 | **A · 原生 DSH 插件包**（自带 `dsh.bundle.patch` / `cordis.patch.yml`，且有 `./client` 前端半边） |
| 与现有功能的关系 | **重复且可强化** —— 「规划」页的排计划、「今天」页的当日待办 |
| 集成方式 | A 类**锁版挂载 + 外围兼容层**（效法 `packages/dsh-zhiyun-paper`、`dsh-zhiyun-page-paper`） |

## 强化了哪个现有功能

本仓 `dsh-zhiyun-page-planning` 现在产出的是**扁平清单**：每条待办只有标题、时长、
来源，没有 `dependsOn`、没有中间状态、没有执行者；先后顺序由学生自己排。
`dsh-zhiyun-page-today` 再按日期把它拉成当日待办。

上游提供的是一套**依赖感知的任务状态机**：任务有显式状态、依赖未完成时不能认领、
空闲成员自动认领、失败尝试可安全接管（见上游 README 的 *Dependency-aware tasks* /
*Automatic reuse and safe takeover* 两节）。

对课业里「先读完讲义 → 再刷题 → 再订正」这类有硬顺序的任务，这是底层能力的实质升级。

### 三条判据逐条对照

| 判据 | 是否成立 | 说明 |
| --- | --- | --- |
| 仍是同一个面板 | ✅（**有前置条件**） | 不新增页面、不新增导航项。上游**自带 native workspace 面板**，本包只允许它出现在规划页抽屉内；照搬进导航即判「换了一页」，本方案作废 |
| 功能仍相似正交 | ✅ | 做的仍是「把一堆待办排成能执行的计划」；上游的「质量门禁」是流程内的可选步骤，不是新面板 |
| 底层多调了更优质实现 | ✅ | 扁平清单 → 依赖感知任务图 + 状态推进；本仓当前**完全没有**依赖概念 |

## 集成方式：锁版挂载 + 外围兼容层

- `package.json`：`dependencies` **写死** `0.1.25`（不用 `^`），`dsh.bundle.patch` 指向本包 patch。
- `cordis.patch.yml`：用**本仓 id** `radar-agent-teams` 插入本包名 `dsh-radar-agent-teams`；
  **不使用**上游那份 patch（上游 id 为 `agent-teams`，与 `dsh-radar-` 前缀的污染防护冲突），
  也**不预置** `config`（`stateDir` / `memberProvider` 是评审须裁定的产品决策）。
- `src/upstream.js`：锁版凭据单一真源 + 21 项 peer 的版本契约 + 只允许的两个导出路径。
- `src/index.js`：`apply()` 仅打日志；9 条 TODO 写清适配点。
- **不搬运上游源码**，**不改上游一行代码**。

## 挂载前必须回答的问题（评审重点）

1. **全局副作用**：上游把 14 个 `agent_teams_*` 工具注册进共享 `tools` 表，
   并往**全局 system prompt** 插一段 usage。本仓是一整个工作台（含「问一问」「笔记」），
   须先测「日常会话里模型会不会无端组建团队」。
2. **面板位置**：上游 workspace 能否不自动注册为导航页？不能则退到 iframe 承载。
3. **拓扑默认值**：`memberProvider` 默认 `spawn` 会新起会话；学生场景默认必须是「最省」。
4. **宿主版本**：上游推荐 Host `0.2.1-rc.2`；本仓 `runtime.lock.json` 偏好 `0.2.0-rc.2`
   （**在上游 peer 窗口内，但未跑 `scripts/test-host.mjs` 实测**）。
5. **体积**：≈3.26 MB unpacked，是否值得为「只在规划页用」付出这个代价。

完整清单见 `src/index.js` 底部 TODO 1–9。

## 不做什么

- 不写入 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`。
- 不改规划页落盘格式（只允许**追加**字段）。
- 不默认打开质量门禁、不默认打开自动 reuse/takeover。
- 不把 `.agent-teams/` 会话状态写进笔记库或计划表。

## 上游许可

MIT。本包仅 `import` 上游公开导出，不复制其源码；若后续有等价借鉴，
按 `CONTRIBUTING.md` 3.3 记入 `ATTRIBUTION.md`。
