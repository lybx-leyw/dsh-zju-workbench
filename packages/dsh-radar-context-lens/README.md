# dsh-radar-context-lens

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> 调用即抛错 —— 这是故意的，避免「看起来能跑」的骨架被误用。

## 集成类型：**强化式集成**（不是全新）

| 项 | 值 |
| --- | --- |
| 与现有功能的关系 | **重复且可强化** |
| 强化哪个现有功能 | `dsh-zhiyun-page-plugins`（侧栏第 7 项「插件」页） |
| 关系判定 | **仍是同一个面板** ✅ + **功能正交** ✅ + **底层多调了更优质实现** ✅ |

三条同时成立，逐条说明：

1. **仍是同一个面板** —— 目标是在「插件」页现有的**那张依赖图**上，给每一行补一列成本；
   不是新开一个页面。若最终做成「旁边再挂一个 Lens 视图」，就**不满足**这一条，
   评审时应驳回（见 `src/upstream.js` 的 (a)/(b) 二选一）。
2. **功能仍相似正交** —— 插件页回答「**谁依赖谁**」（结构：inject 边、叶包、
   取消会不会连坐）；本包补的是「**谁占了多少上下文**」（成本：token 占比、KV cache、
   相邻请求增删）。两者同属「这个工作台由什么组成、代价是什么」，但**回答的是不同问题**，
   不是同一功能的第二份实现。
3. **底层多调了更优质实现** —— 插件页的 README 明确划了边界：
   > 「**只读宿主那棵树的依赖事实，不解析源码、不扫目录**」

   它从设计上就**没有**上下文成本的读数，本仓也没有第二处能提供。
   接入上游即多了一层**本仓自研不划算**的实现（请求重建 + 按插件归因 + KV cache 分账）。

### 为什么这条值得做（不是「重复且无增益」）

插件页存在的理由是那句「**我不用论文，能不能把论文那一整块关掉，而别把解析也弄坏**」。
要回答「能不能关」，**结构**只是必要条件 —— 还得知道**代价**：
论文包到底占了多大上下文？关掉它能省多少？这些目前**完全不可见**。
上游补的正是这个「成本依据」。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [`gordonlu/dsh-context-lens`](https://github.com/gordonlu/dsh-context-lens) |
| npm | `dsh-context-lens@0.3.1` |
| 许可证 | **MIT** ✅（GitHub `spdx_id` 与 npm `license` 双向核实一致） |
| 作者 | gordonlu |
| 语言 / stars | TypeScript / ★0（**新仓，但已在 npm 发布 5 个版本**） |
| 最近 push | 2026-09-14 |
| 类型 | **A · 原生 DSH 插件包**（自带 `dsh.bundle.patch → ./cordis.patch.yml`） |

### 集成方式：锁版挂载 + 外围兼容层

效法 `packages/dsh-zhiyun-host-paper`（上游 `@ggboy123/dsh-paper-reader` 锁版 `1.3.1`）：

- `dependencies` 写**精确版本** `0.3.1`，**不用 `^`**；
- **绝不改上游源码**；
- 本包只做三件事：挂载、适配、把读数接到插件页。

### 前置条件核实（本轮已核）

| 项 | 上游要求 | 本仓现状 | 结论 |
| --- | --- | --- | --- |
| Node | `>=20.19.0` | `^22.19.0 \|\| >=24.0.0` | ✅ 取本仓更严者 |
| 运行时依赖 | 仅 `zod@^4.4.3` | — | ✅ 无传递负担 |
| DSH host | 未声明窄区间 | `0.2.0-rc.2` / `0.2.1-alpha.1` | ⚠ **需真机挂载验证** |

## 数据来源的诚实声明

上游 README 自述为 **Work in progress**，原文：

> *"Context Lens is under active development and may still contain substantial bugs or
> incomplete behavior. Plugin shares are estimated with DSH token-meter density,
> not the provider tokenizer."*

**即：token 占比是「估算」，不是 provider 计费真值。**
若接入，界面文案**不得**把它呈现为精确计费数字。这是评审要点之一。

## 边界（沿用上游与本仓的共同约定）

- **只读** —— 上游是 read-only 观测；插件页也「不另开写入口」。两边一致，
  本包**不得**因此新增任何写操作。
- **不改上游源码** —— 需要改动时走上游 issue / PR，不在本包 patch。
- **样式** —— 上游复用 DSH Web 的 `--dsw-*` tokens；本仓页面用 `zpl-` 前缀。
  同页共存的层序需在接入前确认。

## 目录

```text
packages/dsh-radar-context-lens/
├── package.json     # 锁版引入 dsh-context-lens@0.3.1（无 ^）
├── cordis.patch.yml # - insert: [{ id: radar-context-lens, name: dsh-radar-context-lens }]
├── src/index.js     # 占位 + 适配点 TODO（无业务逻辑）
├── src/upstream.js  # 锁版凭据 + 上游封装占位
├── README.md        # 本文件
└── OWNERS           # Owner: shared
```

## 评审建议

1. **先定 (a)/(b)**：整页挂载，还是只取数据接到插件页那张图？
   选 (a) 就**不满足**「仍是同一个面板」，建议驳回。
2. **真机挂载验证**：DSH `0.2.0-rc.2` 上挂一次，确认与 `dsh-zhiyun-shell-workbench` 会话区不冲突。
3. **文案口径**：确认 token 占比在界面上标注为**估算**。
4. **是否值得**：上游 ★0 且自述 WIP。若认定「成本视角」优先级不够，
   本骨架可直接 `rejected`，本仓**没有**沉没成本 —— 它只有占位。
