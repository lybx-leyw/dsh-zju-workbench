# dsh-radar-night-charge —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `apply()` 是空函数，`src/upstream.js`
> 的三个导出全部 `throw`。**请勿**加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [symudie/ZJU-ontime-charge](https://github.com/symudie/ZJU-ontime-charge) |
| 名称 | **ZJU-ontime-charge**（浙大尼普顿充电桩定时开电） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`；根 `LICENSE` 首行 `MIT License / Copyright (c) 2026 symudie`，逐字读过） |
| 形态 | **单文件 CLI** `neptune.mjs`（375 行，6 个 `node:` 内置模块 import，**零运行时依赖**） |
| Stars | ★1 |
| 建仓 / 最近推送 | 2026-11-07 / 2026-11-07（**建仓 2 天**） |
| 首次发现 | 2026-11-09（B 组 · 浙大场景 · `zju pushed:>2026-10-25` 时间窗切片） |

## 集成类型

**B 类 · 其他 JS 项目**（无 `dsh.bundle.patch`、无 `cordis.patch.yml`、非 DSH 插件）。

## 与现有功能的关系：**强化式集成**

三条判据**同时成立**：

1. **仍是同一个面板** —— 不开新页面。「今天」页的 `projectAgenda()`（`packages/client/page-today/src/agenda.js`）
   继续是唯一渲染入口；只是在**次日 06:00–08:00** 这一段插入一行状态。
2. **功能仍相似正交** —— 本仓 `grep -ri "charger|充电|neptune|尼普顿"`（`packages/` 除 `radar/` 外）
   **零命中**；「今天」页现有的是**课程时段**，充电是同一时间轴上的另一个生活事件。
   不是课程数据的另一种切法，也不是「今天」页已有卡片的换皮。
3. **底层多调了更优质实现** —— 本仓没有任何尼普顿协议。上游是抓包还原的真实接口
   （`getUserInfo` / `getDeviceInfo` / `isChargeing` / `startCharging` / `offCharge`）
   加一个北京时区锚定的 `nextChargeTime()`。骨架只转发，不重写协议。

## 为什么这个骨架值得存在（而不仅是一行登记）

上游的核心不是「充电」这个词，而是**一个「预约 → 到点执行 → 有限重试 → 过期丢弃」的
单次定时器语义**，且已经踩过两个真实的坑：

- **重试窗**：充电桩 06:35 才上线，06:30 打过去必然失败 ⇒ 15 分钟窗口内轮询
  `isChargeing` 直到成功。这不是"失败重试"的泛泛而谈，是一个**有上界的**等待。
- **过期丢弃**：队列里超 1 小时的预约直接丢，不补执行（避免早上 10 点给用户开电）。

本仓现有定时能力是**日历/课表**（`page-planning`），没有「单次、非周期、带重试窗、
超期作废」的执行器形态。这层语义可以复用给其他 campus 写操作，不限于充电。

## 三条硬边界（评审第一问，不解决则方案作废）

| # | 边界 | 原因 |
| --- | --- | --- |
| R-1 | **`openId` 等同账号钥匙，不得落工作区文件/日志** | 上游 README 原文：「链接含 openId，等同账号钥匙，勿外传」。拿到即可扣该账号预存款 |
| R-2 | **禁止自带常驻执行器** | 上游 `serve` 用 `spawn(detached)` + `PID_FILE` + `setInterval(20s)`。Web 宿主不能起游离进程 ⇒ 必须换成宿主内单次定时器 + `unref()`（照 `packages/core/llm-error/src/watchdog.js:64`） |
| R-3 | **只操作本人账号，写操作必须显式点击** | 协议由作者本人账号抓包还原；不做自动续约 / 多账号 / 代充值 |

## 不取什么

| 上游部分 | 不取的理由 |
| --- | --- |
| `login` 向导（微信 PC 端 History 面板取链） | 依赖微信客户端操作流程，工作台里无法复现 ⇒ 改为「粘贴一次链接」的输入框，解析 `openId` 后**只存一次**到宿主凭证区 |
| `serve` / `PID_FILE` / `detached spawn` | 见 R-2 |
| `neptune.config.local.json` / `neptune.log` | 平铺在仓库根，是 CLI 的产物形态；工作台用宿主产物目录 |
| `docs/*.png` | 上游操作截图，不入本仓 |

## 待评审确认

1. **引入方式**：npm 查无 `zju-ontime-charge` 与 `@symudie/zju-ontime-charge`（均 404），
   仓库无 tag ⇒ 「`dependencies` 锁版」不成立。是否走 `packages/vendor/` 路线（clone + 删 `.git` + `VERSION`）？
2. **该不该进产品**：充电桩属**生活服务**，不属本仓六域（课表/论文/笔记/刷题/锻炼/今天）。
   若评审认为「今天」页只收学业事件，本包应直接删除，仅保留登记行。
3. `areaId=6` 是上游作者所在片区，**不同宿舍区不同** —— 是否需要让用户在设置里填？

## TODO

见 `src/index.js` 与 `src/upstream.js` 顶部。顺序：

- [ ] **TODO-0（阻塞）** 拍板引入方式（vendor vs 放弃），在此之前不写 `dependencies`。
- [ ] TODO-1 拆 `post()` 与四个只读接口为薄封装，参数注入 `fetch`（走宿主 WebVPN 出口）。
- [ ] TODO-2 复用 `nextChargeTime()`，`6 - 8` 的偏移不要"修正"。
- [ ] TODO-3 执行器改单次定时器 + `unref()`，带 15 分钟重试窗与 1 小时过期丢弃。
- [ ] TODO-4 接「今天」页次日 06:00–08:00 段（不新增页面）。
- [ ] TODO-5 `offCharge` 两段式必须两步都成功；失败如实显示 `msg`。
- [ ] TODO-6 凭证不进工作区文件；日志 `openId` 脱敏。

## 许可

上游 MIT。若走 vendor 路线，摘取部分沿用 MIT，并在 `ATTRIBUTION.md` 记明仓库、commit、摘取文件清单。
**不搬运上游源码进本骨架** —— 本目录目前只有本仓自己写的占位文件。
