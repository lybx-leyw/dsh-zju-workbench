# dsh-radar-session-notebook —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 是空实现，`TODO` 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [timestatic/dsh-session-notebook](https://github.com/timestatic/dsh-session-notebook) |
| npm | `@timestatic/dsh-session-notebook@0.1.0` |
| 许可证 | **Apache-2.0** ✅（仓库 LICENSE 与 GitHub 元数据一致；⚠ npm 包 `license` 字段为空，见下） |
| 作者 | timestatic |
| Stars | ★0（新仓，2026-10-10 首推；**按热度看不出来，按能力看是本轮唯一 🟢**） |
| 最近推送 | 2026-10-10（在维护） |
| 语言 | JavaScript（`type: module`，`node >= 22`） |
| 上游挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.inject` **四个宿主插槽** |
| 上游运行时依赖 | 无（npm `dependencies` 为空，零传递污染） |
| 首次发现 | 2026-10-18（第十九轮 · A 组 · `topic:deepseek-harness-plugin note` 视图） |

> ⚠ **许可证双源不一致**：GitHub `license.spdx_id = Apache-2.0`、仓库根 `LICENSE` 正文为
> Apache 2.0（已核）；但 npm `0.1.0` 的 `package.json` **没有 `license` 字段**。
> 判定取仓库为准（发布产物缺声明，风险低，建议向上游提 issue）。已记入 `src/upstream.js`。

## 类型与集成判定

- **类型**：A · 原生 DSH 插件包（带 `dsh.bundle.patch`）—— 最高优先
- **集成方式**：**强化式集成** —— 锁版挂载 + 自有面板承载，**绝不改上游源码**
- **与现有功能的关系**：**重复且可强化** ✅

### 三条判据（同时成立才算强化式集成）

| 判据 | 本候选 |
| --- | --- |
| 仍是同一个面板 | ✅ 「今天」页轨迹区 + 「笔记」页笔记库，**不新增导航项**。⚠ 但上游默认注入 4 个宿主插槽，直接整包挂会变成「全站划线」，**必须先拆宿主/客户端**（TODO-1） |
| 功能仍相似正交 | ✅ 「我在对话里读到过什么」≠「我笔记库里有什么」，同一域的两个问题 |
| 底层多调了更优质实现 | ✅ 本仓笔记域**纯存储**，没有文本锚定、消息引用、快照恢复；上游三样都有 |

### 上游带来的、本仓确实没有的能力

| 上游模块 | 能力 | 本仓现状 |
| --- | --- | --- |
| `client/text-anchor.js` | 选区围绕正文锚定 —— 会话重开、消息增删后仍能定位原句 | 无（笔记只有 `[[双链]]`，不锚定对话） |
| `client/message-text-index.js` | 消息 → 文本的双向索引 | 无 |
| `client/quote.js` / `message-highlights.js` | 引用 + 高亮 | 无 |
| `snapshot-budget.js` / `restore-*.js` / `json-backup.js` | 预算内增量快照 + 可恢复备份 | 无 |

## 融合关系

```text
对话 / 轨迹（今天页）
    │  选中 → 划线 → 引用        ← 上游补这一段
    ▼
  引用条目（带 text-anchor）
    │  归入 vault 的某一篇        ← 本仓笔记页承接
    ▼
  磁盘上的 .md（唯一真源）       ← 本仓 vault
```

上游只当**捕获层 + 快照层**，`.md` 仍是唯一真源（TODO-4）。两侧都写会造成
同一段文字两个真相 —— 这是本候选最大的设计风险。

## 锁版

- `package.json` 依赖写死 `"@timestatic/dsh-session-notebook": "0.1.0"`（**不用 `^`**）。
- 常量固化在 `src/upstream.js`（`UPSTREAM_PACKAGE` / `UPSTREAM_VERSION`）。
- 上游处于 `0.x`：**0.x 阶段不承诺兼容**，小版本就可能改 `dsh.client.inject`
  的插槽 id 或 patch 形状，因此不能放宽。

## 为什么不选本轮其他更热的候选

见 `docs/ecosystem-radar/2026-10-18.md` §3。一句话：

- `bowenliang123/dsh-context`（★2246）与已出的 `dsh-radar-context-dashboard` / `dsh-radar-context-lens`
  **同域第三代**，再接是「重复且无增益」；
- `chenxiachan/thoughtdag`（★648）虽 MIT，但 npm 上同名的 `thoughtdag@0.2.2` 是
  「按文件反查会话」的**另一个产品**，不是这个无限画布 —— **仓库 ≠ npm 包**，
  `dsh.bundle` 字段也不存在，锁版路线不成立；
- `LivXue/dsh-plugin-shop`（★706）与已出的 `dsh-radar-dsh-market` / `dsh-radar-market` 重复。

## OWNERS

`shared`（不碰他人 OWNERS；真接入时再走正常包流程）
