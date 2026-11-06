/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 效法 `packages/dsh-radar-ics-export/src/upstream.js`：
 * 本包不直接 `import 'xstate'`，而是留一个**窄接口**，把「上游长什么样、有什么怪癖」
 * 的知识关在这一个文件里。
 *
 * 这样做的三个理由：
 *   ① 单测里能注入假时钟 / 假 actor（不装上游也能跑通上层逻辑）；
 *   ② 上游换版本时只改这一个文件；
 *   ③ 上游的坑（`after` 只认常量延时、快照里没有 deadline、暂停期间时钟照走）
 *      只在这里消化，不散落到调用方。
 *
 * ⚠ 下面每个 `TODO` 都是**评审前必须由人拍板**的事，不是可以随手填的空。
 *   本轮已在沙箱里实跑过 `xstate@5.33.3`（Node 22.13.1，CJS 与 ESM 两种入口各跑一遍），
 *   实测结论写在各自 TODO 与 README 的 M1–M9 表里。
 */

/** 上游锁定凭据 —— 与 `package.json.dependencies` 必须逐字一致。 */
export const UPSTREAM_PACKAGE = 'xstate';
export const UPSTREAM_VERSION = '5.33.3';
/** 供人工复核对照：仓库地址（npm 包的 `repository.url`）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/statelyai/xstate';

/**
 * 载入上游（占位）。
 *
 * TODO-0（**阻塞项**）：由评审决定本包是「宿主侧状态机」还是「客户端状态机」。
 *
 *   - 宿主侧：`import { createMachine, createActor, assign } from 'xstate'`，
 *     状态落盘走 `dsh-zhiyun-core-study` 同款的 `atomic()` 写法；
 *   - 客户端：客户端 bundle 体积要单独量（`xstate` 5.33.3 无运行时依赖，
 *     但本仓客户端不跑打包器的 tree-shake 结论 —— 本轮**未测**）。
 *
 * 两种路线的 `machine` 定义可以共用，`createActor` 的时钟注入方式不同（见 `clockOf()`）。
 *
 * @returns {Promise<{createMachine: Function, createActor: Function, assign: Function}>}
 */
export async function loadUpstream() {
  throw new Error('TODO-0：上游载入方式未定（宿主侧 / 客户端），评审前不实现');
}

/**
 * 上游的「时钟」概念：v5 只认 `{ setTimeout, clearTimeout }` 两件套。
 *
 * 实测（本轮 M1/M2）：
 *   - 不给 `clock` 时用的是宿主全局 `setTimeout`，**相对延时**；
 *   - 给了 `clock` 后所有 `after` 都经它调度，所以单测能完全脱离真实时间。
 *
 * ⚠ 它**没有** `now()`。上游从不去读「现在」，只信「某个定时器该在 N 毫秒后响」。
 *   这直接导致 M4：快照里没有 deadline，跨页面刷新无法恢复剩余时间 ——
 *   「剩余多少」这件事必须由**本包**算，不能指望上游。
 *
 * @param {{now: () => number, setTimeout: Function, clearTimeout: Function}} [source]
 * @returns {{setTimeout: Function, clearTimeout: Function}}
 */
export function clockOf(source) {
  if (!source) throw new Error('TODO-1：时钟必须显式注入（本仓不读全局 Date.now()）');
  return { setTimeout: source.setTimeout, clearTimeout: source.clearTimeout };
}

/**
 * 把「剩余毫秒」翻译成上游能接受的 `after` 配置。
 *
 * 实测（本轮 M3）：**`after` 只接受对象形式的常量延时**。
 *   - `after: { 1500000: 'break' }` —— 生效（注入时钟收到 1500000）；
 *   - `after: ({ context }) => ({ [context.remain]: 'break' })` —— **静默不生效**，
 *     注入时钟一次都没被调用、actor 停在原状态、**不抛错、不告警**。
 *     这一点与 v5 文档里「delay 可写成状态机参数」的说法**不一致**，
 *     两种入口（CJS `require` / ESM `import`）各复现一次，结论相同。
 *
 * 因此「暂停后恢复要接着走剩余时间」这件事**不能靠动态 `after` 实现**，
 * 只能在状态重入时把延时**重建**成常量，并把剩余量记在 context 里。
 *
 * @param {number} remainMs - 剩余毫秒（必须 > 0；0 应当由调用方直接发事件，别再排一个 0 毫秒定时器）。
 * @returns {Record<number, string>} 形如 `{ 600000: 'done' }`。
 */
export function afterOf(remainMs) {
  if (!Number.isFinite(remainMs) || remainMs <= 0) {
    throw new Error('TODO-2：remainMs 必须是正数；0/负数应当走「立即到点」事件而不是定时器');
  }
  return { [Math.round(remainMs)]: 'done' };
}

/**
 * 从持久快照里还原「已经过了多久」。
 *
 * 实测（本轮 M4）：`actor.getPersistedSnapshot()` 的 JSON 只有
 * `{status, output, error, value, historyValue, context, children}` —— **没有 deadline**，
 * 也没有任何「这个定时器还剩多久」的字段。所以刷新页面后，上游会把 `after`
 * 当成**从头开始**（或者根本不重启，取决于宿主是否重建 actor）。
 *
 * 结论：**「什么时候该响」必须由本包在 context 里存绝对时刻**（`deadlineMs`），
 * 并在恢复时用 `now()` 减它。上游只负责「到点发事件」。
 *
 * # 这里有个本仓特有的坑（M5 实测）
 *
 * 上游的 `after` 定时器**住在 actor 里**，`PAUSE` 到 `paused` 状态时它被 `clearTimeout` 掉了；
 * 但**暂停期间 `Date.now()` 只会继续走**。若 `deadlineMs` 在恢复时原样保留，
 * 一次 3 分钟的暂停会让「本该剩 10 分钟」变成「一恢复就到点」。
 * 所以 `RESUME` 必须重算：`deadlineMs = now + remainAtPauseMs`。
 *
 * @param {{deadlineMs: number, remainAtPauseMs: number}} context - 恢复前的上下文。
 * @param {number} now - 当前时刻（**注入**，不用 `Date.now()`）。
 * @returns {number} 恢复后的新 `deadlineMs`。
 */
export function resumeDeadline({ remainAtPauseMs }, now) {
  if (!Number.isFinite(remainAtPauseMs) || remainAtPauseMs <= 0) {
    throw new Error('TODO-3：暂停时的剩余量无效，应直接判为到点而不是排定时器');
  }
  return now + remainAtPauseMs;
}
