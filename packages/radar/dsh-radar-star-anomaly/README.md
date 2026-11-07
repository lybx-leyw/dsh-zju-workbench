# dsh-radar-star-anomaly —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 于 2026-11-06 18:00（A 组 · DSH 插件生态）自动生成，**仅用于人工评审**。
> `src/index.js` 的 `apply()` 是空操作，`src/upstream.js` 的 `loadUpstream()` 恒抛错 —— 这是故意的。
> **请勿**加入 `profiles/zju-workbench/package.json` 的 `dsh.profile.bundles`，**请勿**在真实环境挂载。
> 报告：`docs/ecosystem-radar/2026-11-06-18.md`。

---

## 集成方式：**强化式集成**（不是「全新」）

落在**已有的「插件」页**（`dsh-zhiyun-page-plugins`，侧栏第 7 项），不新增导航项。

| 判据 | 本候选 | 证据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是「插件」页一行**只读**标记，不新开页面、不新增写入口 |
| ② 功能仍相似正交 | ✅ | 现有页答「我手上这几个包谁依赖谁、能不能安全关掉」；本候选答「这条推荐/这个星数**可不可信**」。一个管**本地运行时**，一个管**外部口径** |
| ③ 底层多调了更优质实现 | ✅（判据层面） | 本仓 `packages/dsh-zhiyun-*/src` 对 `star_surge / clawback / 刷星` **零命中**；上游维护了 24075 条仓库的每日快照与人工核实（`data/repositories.json` 23MB、`data/approved.json` 1.1MB、剔除 1007 个蹭词仓） |

### 与已登记候选的关系（不重复）

| 已登记 | 它答什么 | 与本候选 |
| --- | --- | --- |
| `PerryLink/dsh-score`（`dsh-radar-plugin-score`，🟡） | 插件**好不好**（安装成功率 / 文档 / 维护度多维评分） | **正交**：评分是「质量」，本候选是「星数是不是买的」。两者可以同时存在 |
| `dsh-market/dsh-market`（`dsh-radar-dsh-market`，🟢）及其余 5 个插件市场候选 | 生态里**有什么、怎么装** | **正交**：本候选**不做市场、不做安装**，只做可信度标记 |
| `dsh-radar-usage-ledger` | 我自己的 **token 用量账本** | 无关（一个是本地消耗，一个是外部星数） |

> 注：`awesome-dsh-plugin` 这个**仓库**在 registry 里已有一行（2026-10-14 记为「线索源」）。
> 本轮登记的是**同一仓库的另一个切口**：从「拿它的清单捞关键词」升级为「挂它的判据进插件页」。
> 这不是重复登记 —— 切口、用途、集成方式全变；但仍需评审确认这一刀值得单独开包。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/bruc3van/awesome-dsh-plugin> |
| 许可证 | **MIT** ✅ |
| 语言 | JavaScript（纯 Node 脚本 + 数据） |
| ★ | 500（2026-11-06） |
| 最近 push | 2026-11-06 |
| **可锁版的 npm 包** | **无** —— 根目录无 `package.json`，唯一 `scripts/host-market/package.json` 是采集流水线自己的 devDeps |

### 形态（决定了「怎么挂」）

上游**不是 DSH 插件包**，是**静态目录站 + 采集流水线**：

- `scripts/*.mjs`（采集/校验/渲染）+ `.github/workflows/refresh-*.yml`（定时刷新）
- `data/featured.json`（11KB，**编辑精选，推荐从这里取**）、`data/dsh-market-release.json`（331B，**带 `indexSha256`**）
- 重型索引 `data/repositories.json`（23MB）/ `data/dsh-market-index.json`（1.9MB）→ **不要进 bundle**

⇒ 因此本骨架的 `cordis.patch.yml` **没有 insert 条目**：没有可锁版的包，就无从「锁版挂载」。
若评审决定做，路线是**把判据搬成本地纯函数**（不是挂载上游），代价见了下面「风险」。

---

## 可移植 / 不可移植（2026-11-06 读 `scripts/star-anomaly.mjs` 实测）

| 判据 | 上游常量 | 可否移植 |
| --- | --- | --- |
| S1 日增异常 | `SURGE_DELTA = 100` | ✅ 可 |
| S2 清号回收（掉星） | `CLAWBACK_DELTA = 100` | ✅ 可（但是滞后信号） |
| S3 高星零 fork | `PENDING_STAR_FLOOR = 100`、`★/fork >= 100` | ✅ 可（新仓误报） |
| 榜单进入 / 跳位 / Top20 | `BOARD_ENTRY_DELTA = 50`、`RANK_LEAP = 50`、`BOARD_SIZE = 200` | ❌ 依赖上游自建榜单，本仓没有 |

## 风险（评审若采纳，必须逐条回答）

| # | 风险 | 说明 |
| --- | --- | --- |
| R1 | **数据来源未决** | 读上游 `data/*.json` = 引入 23MB 外部依赖 + 上游失效即功能失效；自建快照 = 本任务每 3 小时一轮，天然就在产出快照，但要落成持久存储 |
| R2 | **阈值不可照抄** | 3 小时间隔下 ±100★ 的判据与 24h 口径完全不同，须重标定 |
| R3 | **误报率未知** | S3 对新仓必触发；本仓「插件」页若以新包为主，标记会铺满 |
| R4 | **滞后** | S2 只能事后说「曾经可疑」 |
| R5 | **判据本身很浅** | 三条都是「两次快照相减 + 一个比值」。若评审认为不值一个包，**整目录删除是允许的结局** |

**撤销条件**：若评审量出「近 30 天插件页会触发的标记 < 5 条」，则说明这个功能没有信息量，**应整目录删除**。
