# dsh-radar-conversation-tree —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-30 · r110 轮），**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `apply()` 与 `src/upstream.js` 的 `loadUpstream()`
> 都直接抛错，TODO 一条都没落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质

**「全新」**（不是强化式集成）。

本仓 `packages/radar/` 全部 83 个包，**没有任何**会话组织 / 对话树 / 脑图能力
（对 `conversation.tree` / `对话树` / `会话树` 全量检索无命中）。
对话树提供的是**新的会话导航维度**，不替换任何现有面板。

> 唯一的「强化」机会发生在**它的检索子能力**上（见下节），
> 但那属于「下游再增强」，不改变本包整体是「全新功能」的判定。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [chriswang/dsh-conversation-tree](https://github.com/chriswang/dsh-conversation-tree) |
| npm | **`dsh-conversation-tree@0.1.2`**（`dist-tags.latest`；仓库 `package.json` 已到 `0.1.3` 但未发 npm） |
| 许可证 | **MIT** ✅（tarball 内 `package/LICENSE` 实文：`MIT License / Copyright (c) 2026 chriswang`；GitHub `spdx_id` 与 npm `license` 三处一致） |
| 作者 | chriswang |
| Stars | ★0（fork 0；建仓 2026-10-27，`pushed_at` 2026-10-30，**在建**） |
| 语言 | TypeScript（npm 打包预构建 `lib/`，安装时不需要构建） |
| 运行时依赖 | **0 个**（`dependencies = null`，实查） |
| 引擎 | `engines.dsh = ">=0.2.1-rc.3"` |
| 挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.platform: web` —— **标准原生 DSH 插件（A 类）** |
| 上游 patch 行 | `- insert: [{ id: conversation-tree, name: 'dsh-conversation-tree' }]` |

### 上游做什么

> 在会话列左侧加一条可折叠、可拖宽的**对话树栏**，把对话按「工作区 → 主题 → 对话」组织，
> 并直接打开真实会话。产品的会话列、标题栏、Chat/Trajectory 页签、右栏、输入框都保持原样——
> 对话树只是让出一条栏位覆盖在左侧，不替换任何产品 UI。

- 多「空间」，每空间一棵独立树；面包屑 `全部空间 › 当前空间` 切换；
- 栏内搜索：节点标题/说明 + 已索引会话标题 + 会话正文（仅 user/assistant 文本）；
- 向 harness 注册 **9 个 `map_*` 工具**，模型可直接读写这棵树
  （含 `map_plan_goal` 一次建「目标 + 策略 + 任务」、`map_delete_nodes` 删子树）；
- Host 落盘 `$DSH_HOME/conversation-map/map.json`，走 `/conversation-map` RPC + revision 乐观锁；
  Host 不可用时降级为浏览器本地模式。

---

## 学生场景

一学期下来，「学习 / 论文 / 刷题 / 选课 / 实习」几类会话混在同一个会话列里，
找一个月前的某次讨论只能靠翻。对话树把这件事变成「工作区 = 课程/项目，主题 = 章节/题目」，
**且不改产品任何既有 UI** —— 正好是「不打断原有工作流」的接入形态。

---

## 与现有功能的关系

| 候选 | 现有能力 | 关系 | 判定 |
| --- | --- | --- | --- |
| 会话组织 / 对话树 | **无** | **全新** | 🟢 |

---

## 强化式集成的机会（评审重点，不是本包主体）

上游 README「已知限制」自述检索：

> 节点标题/说明、已索引会话标题、会话正文……**不支持模糊、分词与拼音**。

本仓恰好有三个**同户型**骨架，专补这三块，都已锁版、都已写清接口形状：

| 缺口 | 本仓骨架 | 上游实现 | 许可证 | 返回形状 |
| --- | --- | --- | --- | --- |
| 模糊 / 容错 | `dsh-radar-search-fuzzy` | `fuse.js@7.5.0`（bitap） | Apache-2.0 | 闭区间 `[start, end]` |
| 中文分词 | `dsh-radar-search-segment` | `jieba-wasm@2.4.0` | MIT | 有序词序列 |
| 拼音 / 首字母 | `dsh-radar-pinyin-match` | `pinyin-match@1.2.10` | MIT | 闭区间 `[start, end]` |

**三条判据核对**（只有三条同时成立才做）：

| # | 判据 | 是否成立 | 说明 |
| --- | --- | --- | --- |
| ① | 仍是同一个面板 | ✅ | 对话树栏内**同一个**搜索框、同一份结果列表，不新增搜索入口 |
| ② | 功能仍相似正交 | ✅ | 旧实现答「原文里有没有这串字」，新层答**同一个问题** |
| ③ | 底层多调了更优质实现 | ✅ | 本仓零分词 / 零拼音 / 零近似，三个上游都是成熟实现 |

> **⚠ 前置不确定项**：上游检索跑在 **Host 半身**（`lib/host-search-index.js`），
> 外围层只能接在**结果返回之后**做重排 / 补漏。这个注入点是否存在、是否稳定，
> **本轮未验证**（只读了 README 与产物文件清单，未读实现）。
> 若不存在干净注入点 → **放弃强化，只做全新功能接入**，**不得 fork 上游改源码**。

---

## 评审必看的冲突与风险

1. **左侧带槽位只有一个** —— 上游靠 `html[data-dsh-band-owner]` 与其他带插件协商，
   **同时挂两个带插件必打架**。接入前先盘点当前 profile 里谁占了这条带。
2. **依赖 4 处产品公开 DOM 约定** —— `shell.overlay` 槽、`[data-slot="main.conversation"] > div`
   的 `padding-left`、会话头 leading 席位、`data-sidebar-collapsed`。
   产品改结构时上游退化为「暂不可用」提示 —— **这是可接受的降级，不要在本包里去补 DOM**。
3. **模型工具面含危险操作** —— `map_delete_nodes` 可删整棵子树，需确认是否符合本仓
   工具权限 / 二次确认约定。
4. **单写者** —— 同一 `$DSH_HOME` 被多进程同写时以后写者为准；本仓有 CLI + App 并行的用法。
5. **★0 且在建** —— 2026-10-27 建仓，4 天内 3 个版本。**建议观察 2 周再评审**，
   尤其看它是否跟随产品 DOM 变更持续维护。

---

## 本骨架的约束

- 只含**坐标、形态记录与 TODO**，不含任何上游源码；
- `dependencies` 里 `dsh-conversation-tree` **锁死 `0.1.2`**（不用 `^`）；
- **无测试文件**、**不写 profile**、**不参与构建**（`build.mjs` / `profile.mjs` 只认 `dsh-zhiyun-` 前缀）。
