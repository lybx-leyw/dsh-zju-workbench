# dsh-radar-zju-login —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> `src/index.js` 的 `apply()` 不注册路由、不读配置、不登录任何站点；
> `describeCoverage()` 是纯函数，只做静态对表。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。

---

## 集成形态：**强化式集成**（不是「全新」）

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | **✅ 形式成立** | 不新增页面/入口，只替换 `source-classroom`、`source-campus` 内部的会话层，对外函数签名不变 |
| ② 功能仍相似正交 | **⚠ 部分成立（待裁决）** | 重叠面：classroom / courses / zdbk / apilib / bookinglib / alt 六站，本仓各写过一遍；**缺口面**：上游**没有 WebVPN**，本仓 `source-netproxy` 不能撤 |
| ③ 底层多调了更优质实现 | **✅ 有时效** | 12 站登录收口成同一 `fetch` 形状；但上游 README 的「上次成功时间」最新只到 **2026/4/14** |

判据 ③ 之所以加「有时效」：上游是**覆盖面更完整**，不是**承诺更稳定**。
从上一次真机成功到现在已 6 个月，而登录链是最容易悄悄失效的那一层
（失败方式通常是「页面 200、会话为空」，不是抛错）。

## 上游

- 仓库：[`5dbwat4/login-ZJU`](https://github.com/5dbwat4/login-ZJU)
- 锁版：`login-zju@1.0.9`（npm `latest`，`2026-07-03T15:10:51Z`）
- 许可证：**MIT** ✅（GitHub `spdx_id`、`package.json.license`、tarball 内 `LICENSE`
  首行 `MIT License / Copyright (c) 2024 5dbwat4`，**三处一致**）
- 依赖：仅 `nanoid ^5.1.9`；`peerDependencies` / `engines` 均空
- 导出（`dist/index.d.ts` 逐字）：
  `ZJUAM` `CLASSROOM` `ZDBK` `COURSES` `FORM` `YQFKGL` `OPEN` `CC98` `ETA` `APILIB` `BOOKINGLIB` `ALT`

### 它是什么

服务端登录库，不是浏览器插件：

```js
import { ZJUAM, CLASSROOM } from 'login-zju'
const am = new ZJUAM(username, password)
const service = new CLASSROOM(am)
const res = await service.fetch('/api/some/path')   // 像原生 fetch 一样用
```

登录、续期、Cookie 管理都吞在 `fetch` 里面 —— 这正是它值得被「锁版挂载」的原因：
**它把一件每个站各写一遍的事，收成了一个函数。**

## 为什么先出「探测」而不是「替换」

两条都不能由自动扫描拍板：

1. **WebVPN 边界**。上游服务清单里没有 WebVPN，而本仓 `dsh-zhiyun-source-netproxy`
   做的是「单代理端点 + 就近分流」。校外访问必须继续走它；
   若有人以为「接了 login-zju 就能删中继」，会直接把校外用户打挂。
   `describeCoverage()` 就是把这个边界显式写出来。
2. **密码入内存**。上游 API 只接受明文 `new ZJUAM(u, p)`；本仓账号记录是加密落盘的，
   且 `source-cc98` 明确「不把 Bearer 令牌回给页面」。要接就得在内存里解一次密 ——
   这一条需要**明确批准或否决**，不是实现细节。

## 待决清单（评审时逐条回答）

| # | 问题 | 若答「否」 |
| --- | --- | --- |
| 1 | 真机跑一次 `CLASSROOM.fetch`，返回形状与本仓 `source-classroom/src/auth.js` 是否一致？ | 上游已失效 → **整条撤销** |
| 2 | WebVPN 场景是否可以明确保持走 `source-netproxy`，上游只管校内直连？ | 若不可分 → 判「重复且无增益」→ 撤销 |
| 3 | 明文密码入内存是否可接受（只在构造时用、不落盘、不进日志）？ | 判合规否决 → 撤销 |
| 4 | `source-card` 里 CC98 的 OAuth2 是否一并交给上游的 `CC98` 类？ | 保持现状（本仓自己管令牌，边界更清楚） |

四条全「是」才进入实现；任一「否」则删除本目录，并在 `registry.md` 把状态改成 `rejected`。

## 与既有结论的关系

- **r86** 的 `dsh-radar-zotero-bridge` 是「补一个**没有的来源**」；
  本骨架正相反 —— 它要动的是**已经有的**会话层，因此判据②的门槛高得多，
  README 也把「部分成立」写在最显眼处，而不是含糊成 ✅。
- `5dbwat4/login-ZJU` 自 2026-10-16 起就在 `registry.md` 里挂 🟢 但**一直没有骨架**；
  本轮补齐，是因为 B 组本轮唯一能站住的新面孔为零（见报告 §3），
  与其硬凑一个新候选，不如把已判 🟢 的这条走完尽职调查。

## 本轮明确**未**做

- 未在真机登录任何站点（无账号、无校内网络）。
- 未安装上游包（`npm install` 仍被 `dsh-radar-credit-audit-vendor@1.7.0` 的 npm 404 卡住，见 `skeleton-baseline.md`）。
- 未改任何 `dsh-zhiyun-*` 包的源码 —— 判据②未裁决前不动。
