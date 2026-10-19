# dsh-radar-evolve-modes

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 只打一行日志、不注册任何槽位/RPC，
> `src/upstream.js` 的 `loadUpstream()` 直接返回失败 —— 这是故意的。

## 集成类型：**强化式集成**（同一个面板 · 相似正交 · 底层换更优实现）

| 项 | 值 |
| --- | --- |
| 类型 | **A 类 · 原生 DSH 插件包**（自带 `dsh.bundle.patch` + `dsh.client.inject` / 8 个前端包） |
| 上游 | [`GraySilver/dsh-evolve-modes`](https://github.com/GraySilver/dsh-evolve-modes) ★204 |
| 锁定版本 | `@graysilver/dsh-evolve-modes@0.4.1`（精确版本，非 `^`） |
| 许可证 | **MIT** ✅（GitHub metadata 与 npm `license` 两源一致） |
| 作者 | GraySilver |
| 体积 | npm `unpackedSize` 499,204 B（≈ 0.48 MB）；运行时依赖仅 `zod` + `@deepseek-ai/schemastery` |
| 与现有功能的关系 | **重复且可强化**（不是全新功能） |
| 强化的是谁 | `packages/dsh-zhiyun-page-planning` 的「排一下」—— 即 `plans.js` 的 `PLAN_PROMPT → readPlanResponse` 单次产出路径 |
| 集成方式 | **锁版挂载 + 外围兼容层**（本包用自己的 id 插入，运行时 `import()` 上游并调它的 `apply`；**不改上游源码**） |

## 为什么是「强化」而不是「重复」

| 判据 | 成立？ | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 仍是「规划」页：四个待办源（学在浙大 / 拼题A / 中转站 / 本地留存）、同一张表、同一个「排一下」 |
| ② 功能仍相似正交 | ✅ | 仍是「把一堆待办排成能执行的计划」；上游新增的两项（质量门禁 / 自进化）是**这同一条产出流程里的可选步骤**，不是新面板 |
| ③ 底层多调了更优质实现 | ✅ | 本仓规划产出**没有任何独立审查环节**，也不支持「先研究再出计划」的分流；上游提供独立的验收/对抗审查 Agent 与可组合的工作流维度 |

第三条是硬门槛，因此**不涉及**「重复且无增益」：

> 现状：`PLAN_PROMPT` 一次 LLM 调用直接给出计划，`readPlanResponse` 只做结构校验，
> **没有第二个 Agent 去看这份计划对不对**。这不是「审查做得不好」，而是「**没有**审查」。

## ⚠ 上游与「规划」页是**同名不同物**（评审第一件事）

| 词 | 上游的意思 | 本仓「规划」页的意思 |
| --- | --- | --- |
| 「计划 / plan」 | DSH **官方 plan-mode**（Agent 的执行计划，需用户批准后执行） | **学生这一周的待办表**（四源合并、可勾选、可导出） |

本骨架按「生成待办表的那次 LLM 调用的质量门禁」出具。
若评审认为应接「DSH plan-mode 入口」，那是另一条路线，**本骨架应作废重写** ——
不要两条都做（违反「功能仍相似正交」）。

## 接入前必须先确认的 5 件事

1. **版本窗口**：上游 `peerDependencies` 声明 `@deepseek-ai/dsh-*` 为 `^0.1.1-rc.2 || ^0.1.2-rc.1`（13 项）。
   必须与本仓 profile 实际锁定的宿主版本取交集；不相交 → 拒绝启用、退回现状。
2. **`!!js` 配置**：上游 patch 用 `!!js` 表达式决定 `shellTool`。本仓不支持 YAML 内执行 JS，
   须写死或由本包 `config` 给默认值（见 `src/index.js` TODO 2）。
3. **控制项挂载范围**：上游默认插在输入区。若上游不提供「仅某路由生效」的开关，
   「只在规划页生效」就不成立，需降级为「在规划页 drawer 内渲染上游 client 组件」。
4. **两个开关默认关**：质量门禁默认 `关`（= 现状）；自进化默认 `关`
   （上游默认 `Propose`，本包必须覆盖）。这两条要能被单测钉死。
5. **落盘只许追加**：审查结果若要写回计划条目，只能**追加**字段；旧数据读入必须仍可用。

## 与既有骨架的关系（**不得同时接入**）

| 骨架 | 锁版 | 关系 |
| --- | --- | --- |
| `packages/dsh-radar-evolve-modes`（本包） | `@graysilver/dsh-evolve-modes@0.4.1` | Agent **工作流 / 审查门禁** |
| `packages/dsh-radar-lookatstudy` | `dsh-plugin-lookatstudy@0.26.3` | 学习路径 / BKT 掌握度 / 技能树 |
| `packages/dsh-radar-fsrs-scheduler` | `ts-fsrs@5.4.2` | 复习**调度**（下一次什么时候复习） |
| `packages/dsh-radar-answer-equiv` | `decimal.js@10.6.0` | 答案**判等**（答案对不对） |

四者**正交**（工作流 / 路径 / 调度 / 判等），不存在「二选一」；
但本包是唯一一个会**改动全局 Agent 行为**的候选（因为它插在输入区、会改 system prompt section），
评审顺序建议放在最后。

## 来源与许可

- 上游 MIT：<https://github.com/GraySilver/dsh-evolve-modes/blob/main/LICENSE>
- 本包**未复制**上游任何源码，`dependencies` 里以精确版本引用；
  运行时不改上游文件，只在宿主侧 `import()` 其公开入口（`.` 与 `./client` 两个 exports 路径）。
- 无第三方代码借鉴，故不含 `ATTRIBUTION.md`。
