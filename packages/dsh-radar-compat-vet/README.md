# dsh-radar-compat-vet —— 候选骨架

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
| 仓库 | [liujianqiao701/dsh-compat-vet](https://github.com/liujianqiao701/dsh-compat-vet) |
| npm | `dsh-compat-vet@0.3.2` |
| 许可证 | **MIT** ✅（宽松白名单内，允许锁版引入；LICENSE 实文已比对） |
| 作者 | liujianqiao |
| Stars | ★0（fork 0） |
| 最近推送 | 2026-09-30 |
| 语言 | JavaScript |
| 上游挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` —— **标准 bundle 形状** |
| 上游 patch 行 id | `compat-vet` |
| 上游 dsh 版本要求 | `*`（**运行时探测 + 实测校准**，不锁版本） |
| 上游 Node 要求 | `>=20` |
| 上游自带验证 | `scripts/verify-real-boot.mjs` / `verify-real-repair.mjs` / `verify-tarball-install.mjs` + 9 个 `node --test` 文件 |

## 类型与集成判定

- **类型**：A · 原生 DSH 插件包（带 `dsh.bundle.patch`，npm 可锁版）
- **集成方式**：**强化式集成** —— 锁版挂载 + 宿主侧取数 + 页面侧追加一列，**绝不改上游源码**
- **与现有功能的关系**：**重复且可强化** ✅

### 三条判据（同时成立才算强化式集成）

| 判据 | 本候选 |
| --- | --- |
| 仍是同一个面板 | ✅ **「插件」页**，不新增导航项、不改侧栏；仅在该页依赖图的每一行追加一列。⚠ 上游自带 `./client` 可整页挂，但**本骨架刻意不用** —— 那会多出一块新面板，违反本条 |
| 功能仍相似正交 | ✅ 同一批插件、同一个判断（「它对我的工作台意味着什么」）：现有讲**横向**（谁依赖谁、现在能关掉谁），本候选讲**纵向**（下次启动还能不能被加载） |
| 底层多调了更优质实现 | ✅ 本仓**没有**兼容性/版本矩阵判定能力。关键不在「能不能自己写」，而在**本仓拿不到判定输入**：需要「本机 dsh 版本 × 每个插件 peer 范围 × 已知破坏性变更表」，第三项是上游长期维护的资产 |

## 增强哪个现有功能

`packages/dsh-zhiyun-page-plugins`（「插件」页）。

该页当前**只回答「我现在能不能关掉它」**：`src/runtime.js` 计算 `deps` / `dependents` /
`leaf` / `cancellable` / `readOnlyReason`，`src/Panel.jsx` 只渲染状态点、叶/下游/已取消/
不可更改徽标与开关。**全文无 peer / semver / 兼容 相关实现**（已 grep 核实）；
`packages/` 下也**无任何 `compat` 命名包**。

接上游后，**同一页面、同一行**上补出另一半信息：
这个插件**下次启动还能不能被加载**、是否已进入「即将不适配」区间。

## 为什么是本条、而不是同域的其他条

本轮「插件治理」轴一次命中 **11 个同类项**，其中两条已登记、多条同型。选本条出骨架的**决定性理由**是**可锁版挂载**：

| 候选 | 许可证 | `dsh` 挂载形状 | 能否锁版挂载 |
| --- | --- | --- | --- |
| **`liujianqiao701/dsh-compat-vet`（本条）** | MIT ✅ | **`bundle.patch`** ✅ | **能** ✅ |
| `rogerdigital/dsh-vet`（已登记 🟡） | MIT ✅ | `seams: [fs,shell,web]` ❌ | **不能** ❌ |
| `SongYuhui14/dsh-plugin-compat-checker` | MIT ✅ | npm 未发布、无 patch ❌ | **不能** ❌ |
| `jkrandom-sudo/dsh-plugin-audit`（已出骨架） | MIT ✅ | `bundle.patch` ✅ | 能，但**做的是另一件事**（静态权限画像，非兼容性判定） |

> 注：`dsh-radar-plugin-audit`（2026-10-15 出）与本条**不构成重复** ——
> 前者问「它**能碰到什么**」（权限面），本条问「它**还能不能被加载**」（兼容性面）。

## 需要人工裁定的事项

1. **`./audit` 能否被程序化调用（最大未知项）** —— 上游 `exports` 里**确实有**
   `./audit` / `./adapt` / `./repair`（比 `dsh-plugin-audit` 那条①只有 agent 工具、
   无库入口的情况乐观很多），但**是否依赖宿主 `ctx` 才能运行**仍需核实。
   **建议评审时优先验证这一条**，它决定方案 (a) 是否成立。

2. **⚠ 不得直接暴露上游的「一键修复」** —— 上游会做**真实的写操作**
   （隔离 / 卸载 / 升级插件）。本仓是**学生日常使用**的学习工作台，
   且本仓既有的「插件」页已经把「关掉一个包」这条路径收敛到
   **行级开关** `remote.pluginManager.setPluginEnabled`（写在用户 overlay 里、
   `initialize()` 明确保留、共享宿主的只读保护）——**本仓不另开写入口**。
   → **本骨架只取只读预警，不代理 repair/upgrade。**
   若评审认为可以复用上游修复逻辑，**必须先裁决是否接受上游直接写 profile**。

3. **探测成本与时机** —— 上游要「探测本机 dsh 版本与能力（含实测校准）」，
   不该每次打开插件页就跑一遍。需要缓存 + 失效条件（dsh 版本变更时重跑）。

4. **⚠ 上游极早期（★0 / fork 0 / 建于 2026-09-30）** ——
   采用前须在**隔离环境**实跑其 `verify-real-boot.mjs`，
   确认它**在本仓当前 dsh 版本上确实可用**。
   上游自称「适配任意 dsh 版本」，这句话要由本仓**自己验一遍**，
   不能作为采用依据。

5. **文案口径** —— 兼容性判定来自**运行时探测**，可能误判。
   界面**不得**把「将被拒绝」渲染成确定结论，应为「预警 / 建议核对」口吻。

## 未接入声明

- ❌ **未**写入 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`
- ❌ 未在真实环境挂载
- ❌ 未落实任何业务逻辑（`src/index.js` 为空实现）
- ❌ 未代理上游的 repair / upgrade 写入口（本包设计上不代理）

## 许可与署名

上游 MIT，本骨架仅锁版引用、不摘取源码。若后续确有代码借鉴，
按 `CONTRIBUTING.md` 3.3 在 `ATTRIBUTION.md` 登记。
