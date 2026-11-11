/**
 * 「今日」页的**到点推送**（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。本文件只有占位与 TODO，
 *    **不写业务逻辑**。它把「将来要怎么接」的形状摆出来，供人工评审判断方向是否成立。
 *
 * # 这个包要做的事（意图）
 *
 * 「今日」页已经能算出**今天有哪些事、哪些已过期**（`dsh-zhiyun-page-planning/src/time.js`
 * 的「只统计没做的条目」，`ticks.js` 的「不需要再提醒了」持久标记）。
 * 但这条提醒**只活在用户打开工作台的那几秒里** —— 全仓 `new Notification` /
 * `requestPermission` / `serviceWorker` **一处都没有**，`document.title` 的 3 处
 * 全是导出 PDF 时临时改标题。
 *
 * 同一方向上前一轮（r106）已经出过 `dsh-radar-zone-notify`，它锁的上游
 * `dsh-plugin-notifications` **至今未发布到 npm** ⇒ 那个骨架锁不住版、跑不起来。
 * 本包不是它的替代品，而是**换了一条上游**：`@goodandready/dsh-plugin-notify@0.4.8`，
 * npm `latest` 与仓库 HEAD 版本一致、沙箱内真装真跑通过（见 `src/upstream.js`）。
 *
 * # 与 `dsh-radar-zone-notify` 的分工（评审时必须先回答）
 *
 *   上游能力              | zone-notify 的上游 | 本包的上游（0.4.8）
 *   ---------------------|-------------------|------------------
 *   桌面/系统通知          | 有（宣称）         | 有（HTML5 Notification）
 *   **关掉标签页仍可达**   | 未证实            | **有（W3C Web Push + SW）**
 *   IM Webhook            | 无                | 有（飞书/企微/钉钉/Slack/Discord/自定义）
 *   npm 可锁版            | **否（404）**      | **是（0.4.8）**
 *   体积                  | —                 | +33 包 / 12 MB（web-push 依赖链）
 *
 *   ⇒ 建议：**二选一，不要两个都接**。若本包通过评审，`zone-notify` 应作废
 *     （它的阻塞点在这里全部被绕开了）。
 *
 * # 强化式集成：三条同时成立
 *
 *   ① **仍是同一个面板** —— 不新增页面、不新增设置分组、不改「今日」页清单排序；
 *      推送**只是**这一页既有内容的另一个出口。
 *   ② **功能仍相似正交** —— 还是「今天要做什么、哪件过期了」；推送不参与判定
 *      做什么、哪件算过期，它只负责送达。
 *   ③ **底层多调了更优质实现** —— 原来是「零送达」（不打开页面就永远看不见），
 *      接入后是上游的 **Web Push / IM Webhook** 双通道，且能在**设备上、标签页全关**时到达。
 *      这一条是**本轮真正新增的**：r106 的上游只能桌面弹窗，本包的上游能推到手机。
 *
 *   三条缺一条这个包就该废。尤其是 ①：如果评审发现「今日」页需要一个
 *   **推送订阅管理面板**，那已经是新面板，得先回到产品层讨论，而不是由本包顺手加上。
 *
 * # 挂载与拆卸
 *
 *   1. 以子插件形式挂上上游宿主半边（`ctx.plugin`），把本仓定好的 `dataDir` 传给它；
 *   2. 运行时核对上游版本，与 `upstream.js` 的预期不符时**大声报警但不拦启动**；
 *   3. 注册本包自己的 `/zhiyun-notify-push` 前缀路由，把「发一条」以本仓的窄接口
 *      交给「今日」页调用。
 *
 * 第 2 条为什么不拦启动：整个 profile 里任何一条 bundle 条目抛错，起不来的是
 * **整个工作台**（CONTRIBUTING 3.1）。用户至少还该能打开其余几个页面。
 *
 * # 为什么这里没有 `send()` 的实现
 *
 * 上游**没有对外发送面**（实测见 `upstream.js` 的 `SEND_ENTRY`）。骨架**不猜**：
 * 是「复用上游的 VAPID 与订阅清单、自写一行 `fetch`」，还是「老实挂上游、
 * 只调它自己的 `/push/test`」，取决于「谁拥有 VAPID 私钥」这个产品决策。
 * 猜错了就是一条**看起来能跑、实际把私钥写进两份存储**的路。
 */

import { createRequire } from 'node:module';

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_ENTRY_ID,
  CLIENT_HALF_MOUNTED,
} from './upstream.js';

export const name = 'radar-notify-push';

/**
 * 只硬依赖 `profileContext`（数据目录）。`webServer` / `connection` 走
 * `ctx.inject` / `ctx.get` 惰性取 —— 可选宿主服务不写进 inject，
 * 否则对方没就绪时本插件会一直 pending。
 *
 * ⚠️ 上游自己 inject 的 `sessions` / `credentials` / `settings` **不写进来**：
 *    它们由上游宿主半边负责，本包重复声明只会制造互相等待。
 */
export const inject = ['profileContext'];

/** 本包自有前缀。**不得**用上游可能占用的前缀（上游用 `/dsh-plugin-notify/`）。 */
export const NOTIFY_PUSH_ROUTE_PREFIX = '/zhiyun-notify-push';

/** 读已安装上游包的版本号。 */
function installedUpstreamVersion() {
  try {
    const require = createRequire(import.meta.url);
    const file = require.resolve(`${UPSTREAM_PACKAGE}/package.json`);
    return { version: createRequire(file)(file).version, file };
  } catch (err) {
    return { version: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// TODO(接入前必须完成，按依赖顺序)：
//
//   1. 【人工评审】先回答「本包 vs `dsh-radar-zone-notify` 谁留下」。
//      两个都接 = 同一件事两套通知栈，用户会被弹两次。**建议二选一**。
//
//   2. 【发送入口拍板】`src/upstream.js` 的 `SEND_ENTRY` 两条路里选一条。
//      判据不是「哪条代码短」，而是「VAPID 私钥归谁」。若选 b（自写发送器），
//      必须**复用**上游已落盘的 subscription 清单，不得另建一份 ——
//      两份订阅清单 = 用户在设置里退订一个设备，另一个还在响。
//
//   3. 【触发口径】只由「今日」页已有的**过期条目**触发，不新造判定：
//      复用 `dsh-zhiyun-page-planning/src/time.js` 的「未完成」口径，
//      并尊重 `ticks.json` 里「不需要再提醒了」的标记 —— 勾掉的**一律不发**。
//
//   4. 【节流与静默】同一条待办在多久内只推一次、夜间是否静默、
//      用户关掉之后多久内不再打扰 —— 这三条是**产品决策**，骨架不预设。
//      宁可先不实现，也不要写一个「每小时推一次」的默认值。
//
//   5. 【写入口克制】本包只**发**通知，不改「今日」页的任何数据；也不得替用户勾选
//      `ticks` —— 那条标记的含义写在 `ticks.js` 文件头，是用户的意愿，不是插件的。
//
//   6. 【客户端半边】骨架阶段**不引入**（见 `upstream.js` 的 `CLIENT_HALF_MOUNTED`）。
//      上游客户端只往 `plugins.item` / `plugins.row.config` 注册，与本仓插件页同槽位，
//      技术上不冲突；但「订阅入口放哪个页面」是产品决策，评审前不挂。
//
//   7. 【数据目录】上游的订阅清单落哪里？拟用
//      `ctx.profileContext.dir/data/zhiyun-notify-push`（可用 `config.dataDir` 覆盖）。
//      需确认上游 `resolveStatePath` 的实际默认值 —— **不要假设它与本仓约定一致**。
//
//   8. 【HTTPS 前提】W3C Web Push 要求 **HTTPS 或 localhost**。本仓桌面壳
//      （`apps/desktop`，Electron 打开 localhost）满足；但若用户从局域网 IP 访问，
//      推送会**静默失效**（`PushManager` 存在但 subscribe 抛错）。必须在 UI 上说清楚。
//
//   9. 【体积】接入即 +33 包 / +12 MB（web-push 依赖链，实测见 upstream.js）。
//      评审需确认这在本仓「零依赖优先」的取向里可接受；若不可接受，
//      退路是**只借 `channels.ts` 的 ntfy/Bark 纯 `fetch` 口径**（上游 0.1.0 分支有，
//      0.4.8 已移除），自己写 40 行 —— 但那就不再有 Web Push。
//
//  10. 【验证】接入前必须在真实宿主里确认四件事：
//      标签页在前台时**不推**（上游已有 `sseClients.size === 0` 判据，需复核）、
//      标签页全关时**能推**、点通知**回到对应条目**、重启后**不重发**。

export async function apply(ctx, config = {}) {
  const { version: installed, error } = installedUpstreamVersion();
  const drift = installed !== null && installed !== UPSTREAM_VERSION;

  if (drift) {
    // 大声但不是致命：见文件头「第 2 条为什么不拦启动」。
    ctx.logger?.warn?.(
      `[radar-notify-push] 上游 ${UPSTREAM_PACKAGE} 版本漂移：` +
        `预期 ${UPSTREAM_VERSION}，实际 ${installed}。兼容层按预期形状挂载，行为未证实。`,
    );
  }

  const status = {
    prefix: NOTIFY_PUSH_ROUTE_PREFIX,
    /** 候选骨架：即使被误接入，也要让页面能显示「这是未评审的骨架」。 */
    skeleton: true,
    /** 恒为 false：骨架阶段**刻意**不引入客户端半边（见 upstream.js）。 */
    clientHalf: CLIENT_HALF_MOUNTED,
    /** 上游 bundle patch 的行 id —— 冲突检测与「误接入两份」的判据。 */
    upstreamEntry: UPSTREAM_ENTRY_ID,
    upstream: {
      pkg: UPSTREAM_PACKAGE,
      expected: UPSTREAM_VERSION,
      installed,
      drift,
      error: error ?? null,
    },
    /** 发送入口未实现：见 TODO 第 2 条。 */
    send: 'unimplemented',
  };

  ctx.logger?.info?.(
    `[radar-notify-push] 候选骨架已加载（未评审）：上游 ${UPSTREAM_PACKAGE}@${installed ?? '未安装'}`,
  );

  // 占位：让「今日」页可以探测「推送能力是否就绪」，而不必自己去摸上游。
  // 注意——这里返回的是**骨架状态**，不是发送结果。
  return { status };
}
