# dsh-radar-focus-machine —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 直接抛错，
> `src/upstream.js` 的 `loadUpstream()` 也直接抛错，其余函数只有形状与 TODO。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [statelyai/xstate](https://github.com/statelyai/xstate) |
| npm | **`xstate@5.33.3`**（2026-10-17 发布，`dist-tags.latest = 5.33.3`，本轮实查） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`、npm `versions['5.33.3'].license = MIT` 两处一致） |
| 作者 | Stately（`statelyai`） |
| Stars | ★30,342（push 2026-10-21） |
| 语言 | TypeScript 源码 → `dist/` 提供 `.cjs.js` + `.mjs` 两套入口 |
| 依赖 | **零运行时依赖**（`versions['5.33.3'].dependencies` 为 `null`/空，本轮实查） |
| 体积 | npm `unpackedSize` **2,313,880 B（≈2.2 MB）**，含 `dist` 的 CJS/ESM 两套产物与 `.d.ts`；**未测**本仓客户端打包后的增量 —— 见拍板项 1 |
| 首次发现 | 2026-10-23（B 组派生 · 学生功能域 · 「专注计时底座」轴；`pomodoro` 方向 2026-10-17 曾以「单页计时器」整体判 ⛔，本轮换的是**状态机底座**而不是计时器 UI） |

## 类型与集成判定

- **类型**：**B · 其他 JS 项目**（纯函数库，无 `dsh.bundle.patch`、不注册路由、不挂插槽）
- **与现有功能的关系**：**重复且可强化** → **强化式集成**

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 只在「规划」页页头摘要条加一个数（`focusSummary` 已在那），不新增导航项、不加插槽 |
| ② 功能相似正交 | ✅ | 现有答「哪些事在逼近」（按截止分 5 档、数 3 个数）；新增答「今天还剩多少整块时间」。同一天数据，不同问题 |
| ③ 底层多调了更优质实现 | ✅ | 本仓状态表达是 `let state = {}` + 逐处 `update({…})`，**时间逻辑零离线测试**；上游提供可注入时钟 + 可序列化快照 + 显式状态图 |

> **注意 ③ 的边界**：本轮**没有**证明「接上以后体验更好」。③ 只成立在
> 「可测性」这一层（M1/M2 显示上游能让整套时间逻辑脱离真实 `setTimeout` 跑），
> 不成立在「番茄钟比现有规划页更懂你」这种话上。

---

## 本轮实测（`xstate@5.33.3`，Node 22.13.1，CJS 与 ESM 两种入口各复现一次）

| # | 事实 | 证据 | 对我们的含义 |
| --- | --- | --- | --- |
| M1 | 不给 `clock` 时 `after` 走全局 `setTimeout`，延时是**相对值**（`after: { 4500: … }` → 全局 `setTimeout` 收到 `4500`） | 打桩 `globalThis.setTimeout` 后读到 `[4500]` | 生产可用，但单测必须注入时钟 |
| M2 | 给 `clock: { setTimeout, clearTimeout }` 后，`after` 的每个定时器都经它调度 | 注入时钟收到 `[3, 7]`（两个状态各一次） | **整套时间逻辑可离线测**，这是本包最大的价值 |
| M3 | **函数形式的 `after` 静默失效**：`after: ({ context }) => ({ [context.remain]: 'x' })` → 注入时钟**一次都没被调用**，actor 停在原状态，**不抛错、不告警** | CJS `require` 与 ESM `import` 各跑一遍，结果相同 | 动态时长**不能靠 `after` 函数**实现；只能用常量对象形式（`afterOf()`），剩余量自己算 |
| M4 | `getPersistedSnapshot()` 的 JSON 只有 `{status, output, error, value, historyValue, context, children}`，**没有 deadline / 剩余量** | 快照长度 81 B，正则 `/deadline|expires|remaining|60000/` 全部未命中 | 刷新后上游会把定时器当**从头开始**；「什么时候该响」必须由本包存 `deadlineMs` |
| M5 | 暂停期间 `Date.now()` 照走；恢复时若沿用旧 `deadlineMs`，一次 3 分钟暂停会让「本该剩 10 分钟」变成「一恢复就到点」 | `RESUME` 后 30 ms 即进入 `brk` | `RESUME` 必须重算 `deadlineMs = now + remainAtPauseMs`（`resumeDeadline()`） |
| M6 | 上游**确实**会 `clearTimeout` 离开状态时的定时器 | 日志 `["set",1,1500000], ["clear",1,true], ["set",2,300000]` | 不用自己撤销；但**要注意**：用「手动持有点火函数」的假时钟会把已撤销的回调再点一次（我第一轮探针就踩了这个，误判成「旧定时器仍活着」） |
| M7 | `createActor(machine).start()` 后若状态里还有 `after`，**不 stop 会让 Node 进程不退出** | 首轮探针 2 分钟未退出、被强杀 | 骨架与测试里每一处 actor 都必须 `stop()`；这条要写进实现清单 |
| M8 | `getSnapshot()` 与 `getPersistedSnapshot()` **不是一回事**：前者含 `machine` / `children`（不可 JSON 化），后者才是可落盘形状 | `getSnapshot()` 的 `_nodes`/`children` 直接 `JSON.stringify` 会得到不可恢复对象，恢复时抛 `Cannot convert undefined or null to object` | 落盘只准用 `getPersistedSnapshot()` |
| M9 | `@xstate/react@6.1.0`（MIT）带两个 peer 依赖 `use-sync-external-store` / `use-isomorphic-layout-effect` | npm registry 实查 | 若走客户端路线，**先不引**它，用 `useSyncExternalStore` 手接即可（React 19 已有） |

> **M6 的自曝**：我第一版探针把「`clearTimeout` 之后手动再点一次回调」当成「上游没撤销」，
> 由此得出反的结论，第二轮用真 `setTimeout` 才纠正。**假时钟必须实现
> 「撤销后回调永不再触发」的语义**，否则任何基于假时钟的结论都不可信。

---

## 接入点（评审要拍的三件事）

### 1. 宿主侧还是客户端？（**阻塞项**）

| 路线 | 代价 | 风险 |
| --- | --- | --- |
| 宿主侧（`dsh-zhiyun-page-planning` 的 host 半边） | 需要在 `inject` 里加 `profileContext` 才能落盘；计时状态不进客户端 bundle | 页面每秒钟要轮询一次宿主 —— **不可接受**，除非把「跳秒」放客户端、只把「开始/暂停/到点」这几次状态变化发宿主 |
| 客户端（`page-planning/src/client.jsx`） | 不需要 RPC，`setInterval` 只用来画表盘 | 「刷新后续」要靠 `localStorage`，与「设置 → 浙大一卡通」那套凭据存储**不是同一层**；且客户端 bundle 体积未测 |

**建议**：客户端路线 + 状态落 `localStorage`，「到点」这件事只写一条记录，不驱动宿主。
理由：计时是纯本地行为，跨设备同步没有意义（自习室的电脑和生产力的电脑不该共享一个番茄钟）。

### 2. 番茄循环的默认参数

本包**不设默认值**。25/5 是流行值，但「一节 45 分钟 + 课间 5 分钟」与本仓课表节次
（`source-zdbk/src/parse.js` 的 `PERIOD_TIMES`：1–2 节 08:00–09:35，中间 5 分钟）**天然对得上**。
若产品选择对齐节次，`afterOf()` 的输入就应当来自课表，而不是常量。

### 3. 系统通知

Electron 侧 `Notification` 本仓**尚无封装**（`grep -rn "new Notification" packages` 零命中）。
到点时不做系统通知，只有页面内提示 —— 用户切走标签页就收不到。
**这是功能缺口，不是本包能补的**；若要补，应单开一包（`dsh-radar-focus-notify`），不要混进来。

---

## 骨架文件

```text
package.json        dependencies: { "xstate": "5.33.3" }（写死，无 ^）
cordis.patch.yml    仅一条 insert，只为评审时单独挂起做差分（纯函数库本无 patch）
src/index.js        name / inject / apply（抛错）+ TODO-4..5
src/upstream.js     loadUpstream() / clockOf() / afterOf() / resumeDeadline() + M3/M4/M5 三条硬约束
```

## 与已有雷达骨架的关系（**同一处接缝上的第二、三条线**）

`dsh-radar-ics-export`（r53）把「今天的课」导出成日历；本包想把「今天还剩多少时间」
算成一个可扣减的数。两者都落在 `page-planning` / `page-today` 这一对页面上，
但**互不覆盖**：一个往外带走，一个在里记账。**合并评审时请注意**
—— 若两条都通过，`projectAgenda()` 的输出会同时被两个包读，不要各自复制一份投影逻辑。
