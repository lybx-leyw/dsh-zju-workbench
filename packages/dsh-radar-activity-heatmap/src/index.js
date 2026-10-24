// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把「本仓已经存在的学习记录」折成一张按天排的日历格，挂在「个人」页
//       （`zhiyun.me.content`）上，让用户一眼看到「这一学期我哪天动过、动了多少」。
//
// 上游：https://github.com/grubersjoe/react-activity-calendar
//       npm: react-activity-calendar（本骨架锁版 3.2.1，不用 ^）
//       许可证：MIT ✅（宽松白名单；npm `license` 字段与 GitHub `spdx_id` 双向一致）
//
// 性质：B 类（其他 JS 项目）—— 能力提取 + 封装；不引入任何 DSH 上游包
//       （上游无 dsh.bundle.patch / cordis.patch.yml，只是纯粹的 React 组件库）。
//
// 定性：**全新（补缺视图），不是强化式集成。**
//   本仓 `grep -rniE "heatmap|热力|streak|连击|打卡|contribution"` = 0 命中 ——
//   没有任何「被替换的底层」，所以强化三判据里的第 ③ 条（底层多调了更优质实现）
//   **不成立**。判 🟢 的理由是「接进来就有东西看，且不新增页面 / 不新增存储 / 不新增开关」，
//   与 `dsh-radar-note-graph`（cytoscape.js）、`dsh-radar-temml` 同处置。
//   ⚠ 这一定性须由人工拍；若认为「画用户自己的记录」属于「个人」页的既有职责，
//     那就该改写为强化并说明增强的是哪一块。
//
// ⚠ 阻塞项（出数前必须解决，否则本包只能停在 proposed）：
//   TODO-B-1 · 打包策略。上游 `dependencies` 是 `date-fns@^4.2.1` + `@floating-ui/react@^0.27.19`，
//     而本仓 `scripts/build.mjs` 是 `bundle: true` + 显式 external，且
//     `tests/build-seeds.test.mjs` 断言「产出里没有 node_modules 文件」。三种走法：
//       A) 三个包全 bundle 进 lib/client.js —— 须给那条断言开白名单（**本仓第一次开这个口子**）
//       B) 把两者加进 package.json 的 `dsh.client.external` —— 须确认宿主模块表里有它们，
//          否则表现为 `Could not resolve`（build.mjs 顶部注释记录过这个失效方式）
//       C) 不用 tooltip（`./tooltips.css` 是可选独立导出）—— 可去掉 `@floating-ui/react`，
//          但 `date-fns` 仍在（日历格的时间运算）
//     未做：`npm pack` 拉产物看 `build/index.js` 是否**顶层** import `@floating-ui/react`
//     （若非顶层，C 的成本会进一步降低）。
//
// TODO（采用前必须完成）：
//   1. 数据源接线：日粒度的记录**已经在库里**，不要新建存储 ——
//      - 作答：`dsh-zhiyun-core-quiz/src/store.js` 的 `attempts` 轨道（`makeAttempt` 带 ISO `at`）
//      - 会话：`dsh-zhiyun-core-study/src/learning-space.js` 的 `sessionRows()` 已在读 `updatedAt`（毫秒）
//      两者都要**从宿主服务读出全量**，再按 `Asia/Shanghai` 归日（本仓 `relativeLabel()` 已有
//      这个时区约定，见 learning-space.js L89–91 —— 不要另起一套）。
//   2. 「一天做了几道题」的口径要写死并测：
//      - 错题是否计入（`attempts` 里 `countsAsWrong` 为 true 的记录仍是一次"动过"）
//      - AI 判定 `unknown` 的记录是否计入（不该改变"动过"这一事实，但影响强度分级）
//      - 同日多次作答 → 只算一格。
//   3. **连击（streak）自写，不要找包**：本轮 17 条 `streak` 命中全是自带存储层的完整 App、
//      ★ 全 ≤1。所需逻辑约 15 行（从今天往回数连续天；今天无活动时从昨天起数 = 宽限 1 天），
//      放在本包内并配单测，不要引入任何依赖。
//   4. 不新增页面、不新增存储、不新增开关：只往 `zhiyun.me.content` 里插一块。
//      「个人」页现在是 59 行、以 `renderSlot` 组合（见 dsh-zhiyun-page-me/src/client.jsx L57–58），
//      本包应以**槽位注册**接入，而不是改那个页面的源码。
//   5. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'dsh-radar-activity-heatmap';

/** 锁版凭据的只读快照（供评审对照；不在此处初始化任何东西）。 */
export const UPSTREAM = Object.freeze({ package: UPSTREAM_PACKAGE, version: UPSTREAM_VERSION });

// TODO: 本包**刻意不导出 apply()**。
//
// 理由（与 dsh-radar-cc98-ubb-bridge 同处置）：骨架里有 `dsh.bundle.patch` 把 name 插进
// 图谱，若同时导出一个什么都不做的 `apply()`，本包一旦被误接入 profile 就会**静默上线一个
// 空面板**。保持「无 apply」→ 接入即报错，评审时一眼看得见。
//
// 真正实现时的形状（示意，未实现）：
//
//   export const inject = ['slots'];
//   export function apply(ctx) {
//     ctx.slots.inject('zhiyun.me.content', () => ctx.slots.register(
//       { name: 'zhiyun.me.content' },
//       ActivityHeatmap,          // ← 用 upstream.js 的 wrapper 渲染
//     ));
//   }
//
//   # activityEntries(rpc) -> [{ date: 'YYYY-MM-DD', count: number }]
//   #   rpc 见 dsh-zhiyun-core-study/src/client.jsx 的 controller 形状
//   #   （ctx.connection.rpc.call('/api', 'zhiyun-study', { method, args })）
