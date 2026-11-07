# dsh-radar-notify-capability —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-11-05 · B 组），**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` **直接抛错**，
> 而且**不含任何上游代码、不含任何实现**（`dependencies` 为空，B 类不引入上游 DSH 包）。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

把「**这台机器、这个外壳，此刻能推到哪一级**」抽成**一个纯判定函数**，
让本仓已有但**零消费方**的两条通知读侧在渲染前先问它一次，
从而把「读到通知 → 送到用户眼前」这段**目前根本不存在的链路**补上**可降级的一级**。

## 集成方式：**强化式集成（重复且可强化）** —— 不是「全新」

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增页面、不新增设置分组。判定结果喂给**已有**的「今日」页（`page-planning`）与 cc98 / 学在浙大的既有入口 |
| ② 功能仍相似正交 | ✅ | 还是「有什么没处理」，判定层只回答**通道可用性**，不参与「哪些算未处理」的业务判定 |
| ③ 底层多调了更优质实现 | ✅ | 现状是**三级里零级**（见下「本仓实测」）；接入后至少到第三级（页面内角标），环境允许时升到第二级（`Notification API`）。**这是从 0 到 1，不是并列替换** |
| ④ 不是重复无增益 | ✅ | 与在册 `dsh-radar-zone-notify` / `dsh-radar-notify-push` **不同层**：那两个是「送达执行器」（且都因 npm 404 起不来），本包是「**执行器之前的可用性判定**」——执行器越多，越需要这一层 |

## 本仓实测（本轮一手核对，非推断）

| 事实 | 位置 |
| --- | --- |
| cc98 有通知读侧：`notifications({kind:'reply'\|'at'\|'system'})`，并单独查 `/me/unread-count` | `packages/dsh-zhiyun-source-cc98/src/reads.js:366` |
| 学在浙大有通知读侧：`notices({unread_only, keyword})` | `packages/dsh-zhiyun-source-xxt/src/reads.js:348` |
| **两个读侧在整个仓库里都没有调用方**（`.notifications(` / `notices(` 在 `packages/` 内除定义处 0 命中） | 本轮 `grep -rn` 全仓 |
| 全仓**没有**通知/收件箱面板（`ls packages/ \| grep notif\|inbox\|message\|notice` → 空） | 同上 |
| 全仓 `new Notification` / `requestPermission` **0 处**（与 r107 结论一致） | 在册 |
| 已有的两个通知骨架都卡在同一个 npm 404 | `dsh-radar-zone-notify/src/upstream.js:81`、`dsh-radar-notify-push/src/index.js:16` |

> 结论：**数据已经有了，送达链没有，且已有两个执行器骨架都起不来。**
> 缺口不在「再找一个通知库」，而在「先把『现在能用哪一级』变成可判定的东西」。

## 上游（参照，**不锁版、不引码**）

| 项 | 值 |
| --- | --- |
| 仓库 | [bertholomus/dsh-public-plugins](https://github.com/bertholomus/dsh-public-plugins) · `plugins/notifications` |
| 许可证 | MIT（仓库 `/LICENSE`，本轮**未读实文**，仅据扫描字段 — 评审须补读） |
| npm 包 | **`dsh-plugin-notifications` → 404，未发布**（这是本包不锁版的原因） |
| 已登记状态 | `registry.md` 第 3753 行，r107，🟢 `skeleton-created`（对应骨架 `dsh-radar-zone-notify`） |

## 与在册两个通知骨架的关系（**不合并、不替代**）

```
         ┌─ dsh-radar-zone-notify   （A 类·送达执行器：今日页 → 桌面）
判定层 ──┤
notify-   └─ dsh-radar-notify-push   （A 类·送达执行器：推送）
capability
（B 类·纯判定）
```

两个执行器都因为「上游 npm 404」而锁不住版；
**判定层不需要上游任何包**，所以即使两个执行器永远起不来，
它也能单独把「页面内角标」这一级做成可用的。这是本包存在的全部理由。

## 评审先回答的四个问题

`src/index.js` 的 `OPEN_QUESTIONS`（挂载时报错会原样带出）：

| # | 问题 | 为什么不能默认决定 |
| --- | --- | --- |
| TODO-0 | 判的是「**能不能**推」还是「用户**愿不愿**收」？ | 混成一个布尔 → 「已授权但设置页关了」会被误判为可用 |
| TODO-1 | 降级链三级都要，还是只做第三级（页面内角标）？ | 只做第三级 = **零外部依赖**、当天可落地；前两级要动 Service Worker 与宿主 |
| TODO-2 | 谁负责轮询？ | 判定层**不发请求**；不定归属 = 把轮询偷偷藏进判定层，重蹈「无调用方」 |
| TODO-3 | 权限弹窗的触发点？ | `requestPermission()` 是模态框；自动弹=骚扰，被拒后不得再自动请求 |

> TODO-2 是**先于实现**的一步：否则本包会成为第三个「有实现、无调用方」的骨架。

## 文件

| 文件 | 说明 |
| --- | --- |
| `package.json` | B 类：`dependencies` 为空（**不含**上游 DSH 包）；`dsh.bundle.patch` 指向 `cordis.patch.yml` |
| `cordis.patch.yml` | `insert: [{ id: radar-notify-capability, name: dsh-radar-notify-capability }]` |
| `src/index.js` | `apply()` 抛错；`PROPOSED_CAPABILITIES` 为评审示意；`OPEN_QUESTIONS` 四条 |
| `ATTRIBUTION.md` | 上游 MIT 归属说明（含「未发版」这一关键事实） |
| `OWNERS` | `Owner: shared` |
