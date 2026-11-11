# dsh-radar-hook-order —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-11-10 · r168 轮），**仅用于人工评审**。
> `src/index.js` 的 `apply()` 与 `src/upstream.js` 的 `loadUpstream()` **都直接抛错**，
> TODO 一条都没落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

**同一批 hook、同一批订阅者，换一套「谁先谁后」的决定方式：不再靠加载时序，改成可声明的拓扑序。**

## 集成类型：**强化式集成**（不是「全新」）

| 项 | 值 |
| --- | --- |
| 与现有功能的关系 | **重复且可强化** |
| 强化哪个现有功能 | 宿主的 hook 派发链（`ctx.on` waterfall / serial，顺序仅由布尔 `prepend` + 注册时序决定） |
| 上游 | [`xinyuehtx/dsh-plugin-hooks-ordering`](https://github.com/xinyuehtx/dsh-plugin-hooks-ordering) · npm `@tengxiaohtx/dsh-plugin-hooks-ordering@0.2.0` |
| 许可证 | **MIT** ✅（GitHub `spdx_id` 与 npm `license` 两处互证） |
| 类型 | **A · 原生 DSH 插件包**（`dsh.bundle.patch`，**无** `dsh.client` —— 纯宿主侧） |
| Stars | ★1（2026-08-17 建仓，同日推 0.2.0；**小而新，未经社区检验**） |

### 三条判据

| # | 判据 | 是否成立 | 依据 |
| --- | --- | --- | --- |
| ① | **仍是同一个面板** | ✅ | 上游不改 UI，不新增面板/入口/命令，只挂 Cordis service 改**既有链的执行次序** |
| ② | **功能仍相似正交** | ✅ | 同一组 hook、同一批订阅者、同一份输出；正交的是「相对次序」 |
| ③ | **底层多调了更优质实现** | ✅ | 宿主只有布尔 `prepend`（最后者胜）；上游是 bracket + 稳定拓扑排序 + **环检测** |

> 判据③里最关键的不是「更好排」，而是 **`OrderingCycleError`**：
> 有环时宁可抛错，也不返回一个「看着排好了」的假顺序。这是正确性能力。

---

## ⛔ 但先读这一条：**本包当前收益为 0**（R-1）

上游的论据来自 **dsh 上游发行版** —— 那里 `agent/pre-step` 有十余个独立订阅者。

**本仓不是那个发行版。** 2026-11-10 实测（`grep -rn` 于 `packages/`，排除 radar）：

| hook | 本仓订阅数 |
| --- | --- |
| `agent/pre-step` | **0** |
| `tools/post-execute` | **0** |
| `llm/stream` | **0** |
| `system-prompt/assemble` | **0** |
| `agent/turn-stopping` | **0** |
| 关键字 `prepend` | **0** |

⇒ 现在挂上：**零风险**（空链透明透传），也**零收益**。

### 那为什么还出骨架？

因为它**不是为今天准备的**，而是为「本仓开始用 hook 的那一天」准备的。

`packages/radar/` 里已有多个骨架会订阅同一批 hook ——
`dsh-radar-diff-approval`（审批）、通知类、预算闸类。
它们一旦同时落地，就会**同时**挂到 `tools/post-execute`；谁先跑，
由 Cordis 的 `inject` 激活顺序决定，**不是任何人能声明的**。

> 所以本骨架的定位是：**先把声明面摆好，等第一批 hook 订阅者到来时它已经在那儿了。**
> 这是「为将来的正确性付一点现在的故障面」，不是「解决今天的问题」。
> 如果评审认为「等真需要时再做更划算」，驳回是合理选择 —— 本包**不辩解**。

### TODO-0 是真正的准入条件

拿本仓**真实已装包**（含 `packages/vendor/` 下第三方）枚举 hook 订阅，
列出「同一 hook 上 ≥2 个互不知情且顺序敏感的订阅者」清单：

- 清单为空 ⇒ 本包**当前无收益**，应打成 🔵 留档，**不要推进**；
- 非空 ⇒ 逐条核对「顺序错了结果会不会不同」，再放行。

> **捷径**：`dsh-radar-plugin-graph` 已经在扫插件关系图 ——
> 「哪些插件落在同一 hook 上」正是它已有的数据。用它当 TODO-0 的输入，成本会低很多。

---

## 上游做了什么（为什么不是「又一个排序库」）

它**不 fork Cordis、不 monkey-patch**，只用 Cordis 自己的洋葱模型做 bracket：

- **waterfall**：用**一个 prepended 监听器**把整条链包住 ——
  `next()` 之前是 `front` 阶段（跑在原生链前），之后是 `back` 阶段（跑在默认实现后）。
- **serial**：没有 `next()` 可包，用两个 coordinator（prepended front + appended back）夹住。
- 参与者**注册到 coordinator**（而不是裸 hook），带 `before`/`after` 名字；稳定拓扑排序定序。

```
HookOrdering, load order [auth, logging, metrics]  ->  auth, logging, <host default>, metrics
HookOrdering, load order [metrics, logging, auth]  ->  auth, logging, <host default>, metrics   ← 稳定
```

---

## 本包与上游的两处**刻意不同**

### 1. 控制面收窄：4 个 hook，不是 13+1

上游默认控 13 个 waterfall + 1 个 serial。本包只控 `tools/pre-execute`、
`tools/post-execute`、`fs/write-intent`、`fs/edit-intent`。

**理由**：本仓一个 hook 订阅者都没有，却要为此承担「排序策略压过第三方插件隐式假设」的
风险面。每多控一个 hook，出问题时多一个怀疑对象。
**按实测逐条放行是可回退的扩张；一上来全开不是。**

### 2. `serialHooks: []`

本仓 `agent/turn-stopping` 订阅数 0。空 serial coordinator 仍会注册两个 coordinator，
其中 front 那个**有短路整条 dispatch 的能力**。有订阅者再开。

---

## 阻塞风险

| # | 风险 | 为什么阻塞 |
| --- | --- | --- |
| **R-1** | **前提未证实** | 本仓 hook 订阅数全为 0。问题不存在时接入 = 白付故障面（见上） |
| **R-2** | **加载位次** | bracket 用 prepend，必须**最后加载**；否则后注册的 prepend 会逃出 bracket。bundle patch 的位次由 profile 叠加顺序决定，**骨架保证不了** |
| **R-3** | **风险面倒挂** | 上游 14 个 hook 全开 vs 本仓 0 个订阅者 —— 本包已收窄到 4 个，但仍需逐条论证 |
| **R-4** | **Node 版本** | 上游 `engines.node = ^22.19.0 \|\| >=24.0.0`；本沙箱 22.13.0 **低于下限**。须核对**宿主运行时** Node，不是沙箱的 |

---

## 与相邻骨架的边界

| 骨架 | 管什么 | 性质 |
| --- | --- | --- |
| `dsh-radar-plugin-graph` | 插件**依赖/能力**关系 | 描述（静态） |
| `dsh-radar-plugin-caps` | 插件**能力**清单 | 描述（静态） |
| `dsh-radar-diff-approval` | 编辑**审批**（消费 diff） | 动作 |
| **`dsh-radar-hook-order`** | hook **执行次序** | **干预（运行时）** |

前两个回答「谁依赖谁」，第三个回答「这段改动接受不接受」，本包回答「同一段链上谁先跑」。
**不重叠**；但前两个是本包 TODO-0 的天然输入。

---

## 上游关键凭据（评审可直接复核）

```text
npm    @tengxiaohtx/dsh-plugin-hooks-ordering@0.2.0   （2026-08-17 发布，MIT）
repo   https://github.com/xinyuehtx/dsh-plugin-hooks-ordering  （★1，2026-08-17 最后推送）
patch  dsh.bundle.patch: ./cordis.patch.yml   dsh.client: 无
deps   {}   零运行时依赖
node   ^22.19.0 || >=24.0.0
```

> **未搬上游源码**。本目录只含锁版凭据与 TODO，上游实现一行未摘。

---

## 评审通过后的实现顺序

1. **TODO-0** 实证「现状会不会乱」（不过就驳回，不写代码）
2. **TODO-1** 确认 profile 叠加顺序能让本包最后加载
3. **TODO-2/3** 按实测清单逐条放行 hook 控制面
4. **TODO-4** 决定约束 DAG 落在哪（文件 vs 插件页只读视图）
5. **TODO-6** 锁版核对（报警不拦启动）+ Node 版本核对

---

## 免责

本目录为自动化扫描产物，**未经任何人工评审**。上游 ★1、建于 2026-08-17，
社区检验为零。任何「已评审」的判断都必须由维护者基于真实 profile 实测做出，
**不来自本 README**。
