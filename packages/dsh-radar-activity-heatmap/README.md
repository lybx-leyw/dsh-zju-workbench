# dsh-radar-activity-heatmap

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-10-24 · C 组 · 第六十轮）。采用前请**重写**并走正常包流程。
> 本包**没有**导出 `apply()` —— 误接入会直接报错，而不是上线一个空面板。

> **定性：「全新（补缺视图）」，不是「强化式集成」。**
> 本仓没有任何被替换的底层（`grep -rniE "heatmap|热力|streak|连击|打卡|contribution"` = 0 命中），
> 强化三判据的第 ③ 条（底层多调了更优质实现）**不成立**。判 🟢 的理由是
> 「接进来就有东西看，且不新增页面 / 不新增存储 / 不新增开关」，与 `dsh-radar-note-graph`（cytoscape.js）、
> `dsh-radar-temml` 同处置。**该定性须人工拍。**

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/grubersjoe/react-activity-calendar |
| npm | `react-activity-calendar`（本骨架**锁版** `3.2.1`，不用 `^`） |
| 许可证 | **MIT** ✅（宽松白名单；npm `license` 字段与 GitHub `spdx_id` 双向一致） |
| 语言 | TypeScript（ESM，`type: module`） |
| ★ | 599（push 2026-10-21，活跃） |
| peerDependencies | `react: ^18.0.0 \|\| ^19.0.0`（本仓宿主是 React 18.3.1 ✅ 同源） |
| dependencies | `date-fns@^4.2.1`、`@floating-ui/react@^0.27.19` ← **本骨架唯一的真实成本** |
| exports | `.` → `./build/index.js`；`./tooltips.css` → `./build/tooltips.css`（**tooltip 是可选的**） |

## 集成方式（B 类 · 能力提取 + 封装）

上游是**纯 React 组件库**，没有 `dsh.bundle.patch` / `cordis.patch.yml`，所以本包不含任何
DSH 上游依赖，按 B 类处理：`src/upstream.js` 只做「上游 → 本仓」的薄封装，
`src/index.js` 只做槽位注册。

**不改上游源码、不 copy-paste 上游实现。**（同簇的 `fishdev20/shadcn-heatmap` 走的是
shadcn 的 copy-paste 范式，与本仓「不搬运上游源码」相反，故落选。）

## 补的是哪个缺口

本仓**日粒度的学习记录三处都在，但一次都没有被画出来过**：

| 数据 | 位置 | 状态 |
| --- | --- | --- |
| 每次作答（含 ISO `at`） | `packages/dsh-zhiyun-core-quiz/src/store.js` · `attempts` 轨道（`makeAttempt`） | 已落盘 |
| 会话最后更新时间（毫秒） | `packages/dsh-zhiyun-core-study/src/learning-space.js` · `sessionRows()` 读 `summary.updatedAt` | 已落盘 |
| 按天归日的时区约定 | 同上 · `relativeLabel()` 用 `Asia/Shanghai` | 已有 |

而「个人」页（`dsh-zhiyun-page-me/src/client.jsx`，59 行）只有账号占位、学习空间卡片、
网络代理槽、明暗切换 —— **没有任何一块是「我这一学期学了什么」**。

> 这是 r53（课表 → ics）、r54（`endMs` → 剩余整块时间）、r59（笔记 → UBB）之后的
> **第四次同型断环**：数据齐全、出口存在、缺的只是一层「逐条记录 → 日历格」的转换与渲染。

## 阻塞项：`TODO-B-1` 打包策略（出数前必须裁决）

本仓 `scripts/build.mjs` 是 `bundle: true` + 显式 `external`，且 `tests/build-seeds.test.mjs`
断言「产出里没有 node_modules 文件」（零依赖进包）。上游的两个传递依赖会撞这条断言：

| 走法 | 做法 | 代价 |
| --- | --- | --- |
| **A** | 三个包全 bundle 进 `lib/client.js` | 包体增大；**且**那条断言要开白名单 —— 本仓第一次开这个口子 |
| **B** | 把两者加进 `dsh.client.external` | 宿主模块表必须有它们，否则 `Could not resolve` |
| **C** | 不用 tooltip | 可去掉 `@floating-ui/react`；`date-fns` 仍在 |

**未做**：`npm pack` 拉产物确认 `build/index.js` 是否在顶层 import `@floating-ui/react`
（若非顶层，C 的成本更低）。**在此之前本包只能停在 `proposed`。**

## 与既有骨架的关系

`git ls-files packages/ | grep -iE "heat|calendar|streak|activity"` 只有
`dsh-radar-career-calendar`（招聘日历）与 `dsh-radar-panda-calendar`（节日/校园日历）——
**都是「别人的日程」，不是「你做过什么」**。84 个既有包里无重复。

## 连击（streak）请自写

本轮 `streak calculation language:typescript` 命中 17 条，**★ 全 ≤1**，且每一条都是
自带存储层（SQLite / D1 / Expo）的完整 App，没有一条导出可复用纯函数。

本包需要的逻辑约 15 行（从今天往回数连续有活动的天；今天无活动时从昨天起数 = 宽限 1 天），
**放在包内并配单测，不要引入任何依赖**。
