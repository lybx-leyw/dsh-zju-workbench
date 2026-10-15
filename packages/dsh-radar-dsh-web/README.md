> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
>
> 本包由每日「生态雷达」自动生成，**未经过人工评审**，**未接入** `profiles/zhiyun-bench/package.json`
> 的 `dsh.profile.bundles`。`src/index.js` 只有占位与 TODO，**没有可用实现**。
> 接入前必须先由人完成「接入前必须先做的事」一节的各项前置工作。
>
> **并且，本包与 [`dsh-radar-market`](../dsh-radar-market/) 至少有一个不该存在** —— 见下方「与
> `dsh-radar-market` 的取舍」。在人工裁定之前，本包不应继续推进。

# dsh-radar-dsh-web

为智云 Pro「插件」页补上**生态工坊**能力的候选骨架：锁版挂载上游
[`dsh-web`](https://github.com/zhu1090093659/dsh-web) 的**宿主半边**。

## 集成性质：**强化式集成**（不是「全新」）

落在**已有的「插件」页**（`dsh-zhiyun-page-plugins`），不新开导航项。三条同时成立：

| 判据 | 本候选 |
| --- | --- |
| **仍是同一个面板** | 落在「插件」页，侧栏第 7 项不动 |
| **功能仍相似正交** | 现有包答「**我手上这几个包**谁依赖谁、能不能安全关掉」（本地运行时依赖事实 + 行级开关）；上游答「**生态里还有什么**、怎么被分发」。一进一出，不重叠 |
| **底层多调了更优质实现** | 插件聚合 catalog、创意工坊分发、版本协商 —— 本仓没有对应实现，也不应自己造 |

⇒ 按雷达的判据归类为 **重复且可强化**，而非「全新」，也**不是**「简单集成重复功能」。

## 上游信息

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/zhu1090093659/dsh-web> |
| npm 包名 | `dsh-web` |
| **锁版** | **`0.0.1`**（`package.json` 与 `src/upstream.js` 两处逐字符一致） |
| 版本核对 | ⚠️ npm 上**仅此一个版本**，`dist-tags` 只有 `latest`；`dsh-web@0.0.1` 发布于 2026-09-28 |
| 许可证 | **Apache-2.0** ✅（仓库）／ npm 包 `license` 字段自报 `MIT` —— **两处不一致，须人工核** |
| 作者 | `zhu1090093659` |
| 体量 | 8 754 stars · 573 forks · 2 open issues · 2026-10-14 仍在推送 |
| topics | `cordis` · `deepseek-harness` · `dsh` · `dsh-plugin` · `dsh-web` · `dsh-web-ui` |

## ⚠️ 悬而未决：上游到底是不是「原生 DSH 插件包」

`npm view dsh-web` 返回的 `dsh` 字段是 **`null`** —— 上游 npm 包**没有声明** `dsh.bundle.patch`，
也没有 `dsh.client`。它的 npm 描述是 *"Web GUI toolkit for DeepSeek Harness (dsh): shared
components and helpers for dsh web plugins."*，即**给 dsh web 插件用的共享组件库**。

这与它在 GitHub 上的形态（描述为「插件聚合生态」「通过创意工坊分发」、topics 含 `dsh-plugin`）
**不一致**。两种可能：

1. 它是一个**工具库**，被别人写的插件使用 —— 那么它**不是**原生 DSH 插件包，本包应**废弃**；
2. 它是插件包，但没有把 `dsh.bundle.patch`（或其他 manifest）发到 npm —— 那样也无法靠 npm 锁版挂载。

**结论**：在人工按 TODO 2 实际读一遍上游 `package.json`（`npm pack dsh-web` 后解包，只读）之前，
「A 类原生 DSH 插件包」这个判定**不成立**。本骨架按 A 类形状摆出，是因为雷达的既有成例
（`dsh-radar-market`）如此，**不代表已经核实**。

## 与 `dsh-radar-market` 的取舍（本包最关键的问题）

| 候选 | 上游 | 上游生态位 | 上游成熟度 |
| --- | --- | --- | --- |
| [`dsh-radar-market`](../dsh-radar-market/) | `dshmarket` `1.66.21` | DSH **内**的可视化插件市场（浏览 / 搜索 / 一键安装） | **161 个版本**，1.66.x 已稳定 |
| **本包** | `dsh-web` `0.0.1` | DSH **Web 端**的插件聚合生态，经「创意工坊」分发 | **仅 1 个版本** |

两者面向**同一个「插件」页缺口的同一条缝**，差别不在功能描述，而在**上游成熟度**：
`dshmarket` 的协议形状被 161 次发版打磨过；`dsh-web` 只有 `0.0.1`，
**锁版实际上锁不住任何东西** —— 它的下一次发版就是第一次真正的破坏性变更。

⇒ **建议：二者只取一，取 `dsh-radar-market`。** 本包留作线索源与协议对照组
（Apache-2.0、体量大、话题热度高，生态情报价值仍在）。这一条是本包 TODO 1，
**须由人裁定，机器不预设**。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 挂载/拆卸的**占位**：版本核对的形状、自有前缀路由、TODO 清单 |
| `src/upstream.js` | 锁版凭据（包名 + 精确版本 + 仓库 + 版本号太空的风险说明），单一真源 |
| `cordis.patch.yml` | `insert` 一条 `radar-dsh-web` **（但未被任何 profile 引用）** |

**不含** `ATTRIBUTION.md`：本骨架未参考任何第三方实现，只有占位与 TODO，故按规范可省。

## 接入前必须先做的事（按依赖顺序）

1. **人工裁定与 `dsh-radar-market` 的取舍** —— 先于一切。二者不应同时接入。
2. **确认上游形态**（见上节）：它是插件包还是工具库？`npm pack dsh-web` 解包只读，
   **不改上游源码**。若只是工具库，本包应废弃并回写 registry。
3. **核对许可证不一致**：仓库 Apache-2.0、npm 包 `license` 自报 MIT —— 以**仓库 `LICENSE`
   文件**为准（Apache-2.0），并按 Apache-2.0 的归属义务补 `ATTRIBUTION.md` 与版权声明。
4. **上游能力盘点**：确认宿主半边实际暴露的能力。**只读，不改上游源码。**
5. **写入口克制**：安装/卸载会改用户的 profile 与 `cordis.patch.yml`。参照
   `dsh-zhiyun-page-plugins` 的成例，**不另开写入口**，能用宿主既有 Remote 的一律走宿主自己的路径。
6. **数据目录**：确认 catalog 缓存/快照的落点与离线降级行为。
7. **版本核对**：补上运行时核对，**只警告、不抛错**（注意上游只有 `0.0.1`，
   该检查目前永不触发，价值在其下次发版）。
8. **验证**：补 `tests/radar-packages.test.mjs` 的对应断言（断言三处版本一致，照
   `tests/paper.test.mjs` 成例），跑通 `npm test` 与 `npm run test:host`，并在真实宿主里
   确认**没有**抢占 settings 分组与外壳布局。

**以上全部完成后**，才由人决定是否把 `dsh-radar-dsh-web` 加进 `profiles/zhiyun-bench/package.json`
的 `dsh.profile.bundles`（依据 [CONTRIBUTING 3.1](../../docs/contributing/CONTRIBUTING.md)：
profile 中任何一条 Loader 条目解析失败，起不来的是**整个工作台**）。

## 边界

- `inject: ['profileContext']` 是唯一硬依赖。`webServer` / `connection` 走 `ctx.inject`，
  其余宿主服务走 `ctx.get` 惰性取 —— 可选宿主服务不写进 inject，否则对方没就绪时本插件会一直 pending。
- 自有前缀必须是 `/zhiyun-workshop`：宿主的 `webserver.register` 对同 `(kind, path)` 重复注册直接抛错，
  且 `/zhiyun-market`（market 包）与 `/paper-reader`（paper 包）都已被占用。
- **绝不修改上游源码**；上游以 npm 依赖形式锁版引入，按 Apache-2.0 正常使用。
