# dsh-radar-plugin-caps —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-11-01 · r123 · 插件本体能力核对轴** 自动生成，仅用于人工评审。
> `apply()` 只打一行日志；没有 UI、没有路由、没有存储。**请勿**加入任何 profile。
> 评审驳回则整目录删除。

---

## 一句话

**本仓的「插件」页已经有图、也有账，但没有一张能力表。** 它回答「关掉谁会不会连坐」
（依赖拓扑），以及「这个工具/技能/插件用没用过、多久没用了」（`src/usage.js` 账本，
r112 从 `dsh-radar-knowledge-graph` 提取的 `count` / `lastUsed` / `STALE_DAYS=30` 判据）。
它**不回答**的是：**这个插件本身提供了什么** —— 注册了哪些工具、哪些命令、往哪些槽位注入。

⚠️ **本包因此比原计划窄得多**（见下「与原计划的差距」）：账本那一半在本仓已经落地了，
再写一遍就是「重复且无增益」。

## 定性：**强化式集成**（不是「全新」）

| 判据 | 本包怎么满足 |
| --- | --- |
| ① 仍是同一个面板 | 上到 `zhiyun.plugins.content` 同一槽位，**不新增导航项** |
| ② 功能仍相似正交 | 现有答「依赖风险」+「用没用过」，本条答「**提供了什么**」（工具/命令/槽位清单） |
| ③ 底层多调了更优质实现 | ⚠ **已不成立** —— 见下节。本仓 `usage.js` 的账本不比上游弱，上游没有更强的底层可调 |

三条缺一即降级为「重复且无增益」。**当前第 ③ 条不成立**，所以本包**不该按「强化」评审通过**，
只应作为「要不要补一张纯静态能力表」这个问题的问题单存在。

## 与原计划的差距（**评审必读**）

本轮出骨架时以为「使用账本」是本仓的空白，写完后核对 `dsh-zhiyun-page-plugins/src/usage.js`
才发现**它已经在仓里了**：

| 能力 | 上游 `dsh-armory` | 本仓 `page-plugins/src/usage.js` | 结论 |
| --- | --- | --- | --- |
| 每个工具被调用几次 | ✅ `count` | ✅ `count`（`kind:name` 作 key） | **重复，无增益** |
| 多久没用了 | ✅ 有 | ✅ `lastUsed` + `STALE_DAYS = 30` | **重复，无增益** |
| 累计耗时 / 失败次数 | ✅ `ms` / `errors` | ❌ 无 | 唯一可能的增益，但**口径未核**（TODO-M） |
| **每个插件注册了哪些工具/命令/槽位** | ✅（看板里列出） | ❌ **无** | **真空白** —— 本包只剩这一格 |
| MCP / Skill 管理 | ✅ | 在册 `dsh-radar-mcp-manager` | 重叠，不做 |

⇒ 本包的正确形态是**一张纯静态的能力表**，不是账本。
`src/caps.js` 里的 `foldLedger()` / `silentPlugins()` **应删**（本仓已有），保留 `capsRow()`。

## 缺口证据

```text
$ ls packages/dsh-zhiyun-page-plugins/src/
client.jsx  host.js  index.js  Panel.jsx  runtime.js  store.js  style.css  usage.js
$ grep -n "slots.inject" packages/dsh-zhiyun-page-plugins/src/client.jsx
33:  ctx.slots.inject('zhiyun.plugins.content', () => ctx.slots.register({

→ Panel.jsx 列的是「依赖边 + 开关」；usage.js 记的是「count + lastUsed」。
  两者都没有回答：这个包 ctx.tools / ctx.commands / ctx.slots 里各占了什么。
```

今天页、插件页都没有「某个包注册了哪些工具/命令/槽位」的列表。
`dsh-radar-plugin-graph` 画的是**注册图**（谁依赖谁），同样不含能力字段。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/2026heshao/dsh-armory |
| npm | `dsh-armory@2.4.7` |
| 许可证 | **MIT** ✅（GitHub API `license.spdx_id` 实核；npm 字段未取，TODO-L） |
| 规模 / 活跃 | ★62、JavaScript、14.0 MB、建仓 2026-10-10、push 2026-10-31 |
| 形态 | `dsh.bundle.patch: ./cordis.patch.yml`；`peer @deepseek-ai/cordis ~4.0.2`，其余 peer `>=0.1.5-rc.1` |

## 为什么不锁版挂载（**关键**）

上游是**一体看板**：MCP 管理 + Skill 市场 + WorkBuddy expert + 插件市场 + 六档主题 + 悬浮按钮 + MCP OAuth 授权。
它的 `cordis.patch.yml` 只有一行 `id: dsh-armory`，挂上之后会在插件页**旁边**再开一块自己的面板：

- 判据① **当场不成立**（不是「同一面板」，是「多一块面板」）；
- 与在册 `dsh-radar-mcp-manager`（MCP 管理骨架）**职责重叠**；
- 引入凭据面（OAuth 授权）。

⇒ 本包 `dependencies` 为空，`src/upstream.js` **只记录接口形状与待核项，一行代码都不摘**。
这与 `dsh-radar-paper-evidence`（★0、非 npm 包、只取 `data-contract.md`）是同一类处理。

## 三条必须守住的边界

1. **不新增面板**。渲染点是插件页已有的内容区。若评审认为「不值得为一列单独占一个插件槽位」，
   正确做法是**整目录删除**、把 `src/caps.js` 的形状内联进 `dsh-zhiyun-page-plugins`。
2. **不做 MCP / Skill / Expert 管理**。那是上游看板的主体，在册已有骨架。
3. **不写 profile、不装卸插件**。插件页只读；本仓不另开写入口。

## 已知风险 / 待核

| 项 | 说明 |
| --- | --- |
| 真源之争（TODO-0，**阻塞**） | 宿主 `manifest` 零成本但只有 patch 行名；扫每个包 `package.json`+patch 准确但极可能与 `/api/zhiyun-plugins` 撞缓存 |
| 账本打点（TODO-1） | **已作废**：本仓 `usage.js` 已有账本，不再自打点 |
| 计数口径（TODO-M） | 若要补 `ms` / `errors` 两列，须先核口径 —— **对不齐就是「数字和会话对不上」** |
| 持久化（TODO-N） | 若要补耗时列，须先确认不把工具参数一并写盘（参数可能含成绩、PII） |
| 宿主版本带（TODO-O） | 上游 peer 从 `0.1.5-rc.1` 起，本仓宿主在 `0.2.x`；若改判挂载须核已移除的客户端包 |
| 默认值（TODO-2） | **默认关**。能力清单对多数用户是噪声 |

## TODO

- [ ] **TODO-0（阻塞）**：能力清单的真源（见 `src/index.js`）。
- [ ] ~~TODO-1：账本计数从哪来~~ —— 作废，`page-plugins/src/usage.js` 已覆盖，`src/caps.js` 的账本函数应删。
- [ ] TODO-2：默认关，插件页一处开关点亮。
- [ ] TODO-L / TODO-M / TODO-N / TODO-O：见 `src/upstream.js` 文件头。
- [ ] 若评审结论是「内联即可」，删除本包。

## 归属

- 第三方来源与许可留痕：仓根 `ATTRIBUTION.md` →「候选骨架引用的第三方插件」一节。
- `OWNERS`：`Owner: shared`（不碰他人 OWNERS）。
