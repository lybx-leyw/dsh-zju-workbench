# dsh-radar-lowtide —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 只有占位与 TODO，`register()` 直接抛错。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [KelaoHu/dsh-lowtide](https://github.com/KelaoHu/dsh-lowtide) |
| npm | **`dsh-lowtide@0.2.8`**（2026-10-17 15:06Z 发布，`dist-tags.latest = 0.2.8`） |
| 许可证 | **MIT** ✅（仓库根 `LICENSE` / `package.json.license` / npm `license` / GitHub 元数据，**四源一致**） |
| 作者 | dsh-lowtide contributors（仓库 owner `KelaoHu`） |
| Stars | ★174（2026-10-17 仍在推；本批唯一 🟢） |
| 语言 | TypeScript（ESM），`node ^22.19 \|\| >=24` |
| 挂载形状 | `dsh.bundle.patch`（1 份）+ `dsh.client.inject`（locale / conversation / settings / connection **四个面**），`platform: web` |
| peerDependencies | `@deepseek-ai/dsh-llm` / `dsh-agent` / `dsh-session` / `dsh-settings` / `dsh-storage-domain`，全部 `>=0.1.0-rc.7 <0.2.2-0` |
| 首次发现 | 2026-10-19（第二十八轮 · A 组 · `dsh-plugin task planning` 第 1 页首位） |

## 类型与集成判定

- **类型**：**A · 原生 DSH 插件包**（带 `dsh.bundle.patch` + `dsh.client.inject`）—— 最高优先
- **集成方式**：**强化式集成** —— 锁版挂载 + **只复刻 patch 的 insert 一行**，绝不改上游源码
- **与现有功能的关系**：**重复且可强化** ✅（「规划」页已有卡片，缺执行端）
- **不是「全新」**：本包不新开页面、不加插槽，只给既有的卡片区补一个状态维度。

## 它是什么

一句话：**忙时排任务，闲时自动跑。**

白天想到的活儿扔进队列 → 到你设的时间窗口（比如 19:00 之后，DeepSeek 谷价时段）自动执行 →
第二天早上看报告（实花 ¥ / 已省 ¥ / 哪些失败）。带四种执行策略（单次 / 迭代 / 采样 / 复核）、
一个「待裁定」人工闸门，以及桌面端与网页端共用同一份构建产物。

## 强化哪个现有功能（三条判据）

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 仍是「**规划**」页的**卡片区**（`packages/dsh-zhiyun-page-planning`）。不新增页面、不加插槽 |
| ② 功能相似正交 | ✅ | 现有：**拆待办 → 成卡片 → 按 `due` 排**。新增：**卡片 → 真实执行 → 按价格窗口安排**。同一批卡片的调度维度 |
| ③ 底层多调了更优质实现 | ✅ | 见下表 |

| 能力 | 本仓现状 | 上游 |
| --- | --- | --- |
| 时间 | 卡片上只有一个 `due` 字符串 | 窗口模型：多时段（1–6 个）、跨午夜、按 ISO 周几、显式 IANA 时区、`start === end` 表示全天 |
| 成本 | 无 | 峰谷价表（`deepseek-flash` / `deepseek-v4-pro` 两档），「现在跑 vs 晚上跑」差价可算，报告里有实花 / 已省 |
| 执行 | 无（卡片到页面为止） | 四种策略；失败重试；「待裁定」闸门 |
| 复核 | 无 | 执行报告 + 逐条裁定（收下 / 打回重跑） |
| 测试 | — | 上游称 168 项单测 + 10 个 e2e，CI 四环境 |

## 为什么不能整包套用（**评审重点**）

上游 `cordis.patch.yml` 里除了 `insert`，还有一整段 `- id: permission`。它做两件事：

1. **整行替换**宿主的 `permission` 行（上游注释原话：*a row patch REPLACES the targeted row's whole config*），
   把 `read-only / workspace-write / danger-full-access` 三个基础预设**重新声明一遍**。
   → 一旦上游某个版本给基础预设加了新行，或者**本仓自己扩展过预设**，这部分会**静默丢失**（配置项对不上不报错）。
2. **新增三个 `approval: never` 的预设**（`lt-readonly` / `lt-standard` / `lt-trusted`），设计前提是「夜跑无人值守」。

`approval: never` 就是**取消审批闸门**。本仓的沙箱治理挂在这一行上，候选包本身也明确「不得接进 profile」。
**本骨架的立场：永不引入 `approval: never`。** 若将来确需无人值守，应在本仓 `permission` 行里
**显式追加一个具名预设**、审批策略写明，而不是把上游那段引进来。

## 另一个必须先回答的问题：外部 API 面

上游在 L3 全自动模式下提供 `POST /ds-lowtide/tasks`（外部投递任务）。本仓是**单机工作台、没有鉴权层**，
该路由若绑到 `0.0.0.0`，等于「内网任何人可让 Agent 跑活」。骨架要求：**默认关闭，或仅绑回环**。
若上游不支持，本包**不得启用 L3**。

## TODO 一览

| # | 事项 | 阻塞？ |
| --- | --- | --- |
| TODO-0 | 核对上游 `ctx` 服务键与设置 schema（读 `lib/types/**/*.d.ts`） | 是 |
| TODO-1 | 核对本仓 `permission` 预设清单与上游三个基础预设的重名情况，结论写回本节 | 是 |
| TODO-2 | 确认 `POST /ds-lowtide/tasks` 能否关闭 / 绑回环；不能则禁用 L3 | 是 |
| TODO-3 | 卡片 ↔ 队列条目的**映射键**（规划页用 `entryPrefix()` 内容前缀，lowtide 用自己的任务 id） | 是 |
| TODO-4 | 执行报告的回写粒度：整批一块，还是逐卡一个状态位 | 否 |
| TODO-5 | 价格表过期（写死在 2026-09-10 生效的价表）：跟版升级，还是改可配置 | 否（需在上游开 issue） |

## 污染防护

- 前缀 `dsh-radar-`，与 `packages/` 下既有 54 个包不重名（生成前已 `git ls-files packages/` 查重）。
- **未修改** `profiles/zhiyun-bench/package.json`。
- **未摘取上游任何源码**；`src/` 全部为占位。
- `OWNERS`：`Owner: shared`。
