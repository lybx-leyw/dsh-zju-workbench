// 源：ref/OpenMAIC/lib/choreography/timing.ts:22-97（唯一真源的时长常量）
// 源：ref/OpenMAIC/lib/playback/engine.ts:576-621（逐动作推进）
/**
 * 时间轴：把「一串动作」铺成「带时长的一串帧」。
 *
 * 上游每执行完一个动作就 `await delay(...)` 一段（`ActionEngine` 里逐个分支
 * 写死的 `WB_*_MS`），播放引擎再靠 `processNext()` 往下走。时间轴把这件事
 * 变成数据：每帧带 `at` / `duration` / `state`，客户端只负责按 `duration`
 * 翻页，不重算语义。这样「同样的账本在任何地方播放，节奏一致」是可测的。
 *
 * 时长常量、朗读估算、代码打字/清板动画全部逐字照搬上游
 * `lib/choreography/timing.ts` —— 那份文件本身就是「应用与导出器共用的唯一
 * 真源」，这里不另立一套数。
 *
 * # 效果的生命周期
 *
 * `spotlight` / `laser` 是 fire-and-forget：动作本身不占时长，但效果会在
 * `EFFECT_AUTO_CLEAR_MS` 后自动消失（上游 `scheduleEffectClear`）。折叠状态
 * 故意不含时钟，所以「到期」只在**帧快照**里体现：`buildTimeline` 记录每次
 * 效果的落点，生成快照时把过期的抹掉。折叠结果因此仍然逐字节可复现。
 *
 * 源：ref/OpenMAIC/lib/choreography/timing.ts:22-97
 * 源：ref/OpenMAIC/lib/playback/engine.ts:576-621（逐动作推进）
 * 源：ref/OpenMAIC/lib/action/engine.ts:314-339（效果自动清除）
 */

import { estimateSpeechDurationMs } from 'dsh-zhiyun-core-classroom-timing';
export { estimateSpeechDurationMs } from 'dsh-zhiyun-core-classroom-timing';
import { applyRecord, emptyStageState } from './ledger.js';

/** spotlight / laser 在被自动清除前停留的时长。 */
export const EFFECT_AUTO_CLEAR_MS = 5000;

/** `wb_open` 的开门动画（慢弹簧）。 */
export const WB_OPEN_MS = 2000;

/** `wb_draw_*` 的元素淡入。 */
export const WB_DRAW_MS = 800;

/** `wb_edit_code` 的逐行编辑动画。 */
export const WB_EDIT_MS = 600;

/** `wb_delete` 的移除动画。 */
export const WB_DELETE_MS = 300;

/** `wb_close` 的关门动画。 */
export const WB_CLOSE_MS = 700;

/** `widget_*` 的交互停留。 */
export const WIDGET_MS = 300;

/**
 * 代码打字动画：800ms 基础 + 每行 50ms，封顶 3000ms。
 *
 * @param {number} lineCount
 * @returns {number}
 */
export function wbDrawCodeMs(lineCount) {
  return Math.min(800 + lineCount * 50, 3000);
}

/**
 * 清板级联动画：380ms 基础 + 每元素 55ms，封顶 1400ms。
 *
 * @param {number} elementCount
 * @returns {number}
 */
export function wbClearMs(elementCount) {
  return Math.min(380 + elementCount * 55, 1400);
}



/**
 * 一条动作占用的时长。
 *
 * 依赖 `stateBefore` 的只有两处：清板看**清之前**的元素数、编辑/删除看板子
 * 当前是否为空 —— 与上游在 `delay(...)` 处读的是同一时刻的状态。
 *
 * @param {object} action
 * @param {object} stateBefore
 * @param {{speed?: number}} [options]
 * @returns {number}
 */
export function actionDurationMs(action, stateBefore, options = {}) {
  const speed = Number(options.speed) > 0 ? Number(options.speed) : 1;
  // 朗读估算自己就按语速折过，不能再除一次。
  if (action?.type === 'speech') return estimateSpeechDurationMs(action.text, { speed });
  return rawDurationMs(action, stateBefore) / speed;
}

function rawDurationMs(action, stateBefore) {
  const type = action?.type;
  switch (type) {
    case 'scene_switch':
    case 'spotlight':
    case 'laser':
    case 'discussion':
    case 'play_video':
      return 0;
    case 'speech':
      // 由 actionDurationMs 单独处理（要带语速）。
      return 0;
    case 'wb_open':
      return WB_OPEN_MS;
    case 'wb_close':
      return WB_CLOSE_MS;
    case 'wb_clear':
      return wbClearMs(stateBefore?.whiteboard?.elements?.length ?? 0);
    case 'wb_delete':
      return WB_DELETE_MS;
    case 'wb_edit_code':
      return WB_EDIT_MS;
    case 'wb_draw_code':
      return wbDrawCodeMs(String(action.code ?? '').split('\n').length);
    case 'wb_draw_text':
      return action.content ? WB_DRAW_MS : 0;
    case 'wb_draw_table': {
      const data = Array.isArray(action.data) ? action.data : [];
      return data.length > 0 && Array.isArray(data[0]) && data[0].length > 0 ? WB_DRAW_MS : 0;
    }
    case 'wb_draw_shape':
    case 'wb_draw_chart':
    case 'wb_draw_latex':
    case 'wb_draw_line':
      return WB_DRAW_MS;
    default:
      return typeof type === 'string' && type.startsWith('widget_') ? WIDGET_MS : 0;
  }
}

/**
 * 帧快照：把过期效果抹掉。
 *
 * @param {object} state
 * @param {number} at
 * @param {{spotlightAt: number|null, laserAt: number|null}} fired
 * @returns {object}
 */
function snapshot(state, at, fired) {
  const spotlightExpired = fired.spotlightAt !== null && at - fired.spotlightAt >= EFFECT_AUTO_CLEAR_MS;
  const laserExpired = fired.laserAt !== null && at - fired.laserAt >= EFFECT_AUTO_CLEAR_MS;
  if (!spotlightExpired && !laserExpired) return state;
  return {
    ...state,
    effects: {
      spotlight: spotlightExpired ? null : state.effects.spotlight,
      laser: laserExpired ? null : state.effects.laser,
    },
  };
}

/**
 * 构建可播放的时间轴。
 *
 * @param {Array<{seq: number, payload: object}>} records 账本记录（seq 升序）
 * @param {{speed?: number}} [options]
 * @returns {{frames: object[], durationMs: number, state: object}}
 *   `frames[0]` 是初始帧（还没执行任何动作）。
 */
export function buildTimeline(records, options = {}) {
  const list = Array.isArray(records) ? records : [];
  const speed = Number(options.speed) > 0 ? Number(options.speed) : 1;

  let state = emptyStageState();
  let at = 0;
  /** @type {{spotlightAt: number|null, laserAt: number|null}} */
  const fired = { spotlightAt: null, laserAt: null };

  const frames = [{
    index: 0,
    seq: null,
    type: null,
    at: 0,
    duration: 0,
    state,
  }];

  list.forEach((record, index) => {
    // 与 ledger.js 的 applyRecord 一致：既认账本记录（动作在 payload 里），
    // 也认生成侧动作（字段在顶层）。否则 scene.actions 传进来时每条都被
    // 读成 {}，时长恒为 0、效果全部 skipped。
    const action = typeof record?.payload === "object" && record.payload !== null
      ? record.payload
      : (() => {
        const { seq: _seq, runId: _runId, at: _at, ...rest } = record ?? {};
        return rest;
      })();
    const startAt = at;
    const duration = actionDurationMs(action, state, { speed });
    const next = applyRecord(state, record);

    if (action.type === 'spotlight') fired.spotlightAt = startAt;
    if (action.type === 'laser') fired.laserAt = startAt;
    // 场景切换会清效果（`clearEffects()`），过期时间一起作废。
    if (action.type === 'scene_switch') {
      fired.spotlightAt = null;
      fired.laserAt = null;
    }

    at += duration;
    state = next;
    frames.push({
      index: index + 1,
      seq: record?.seq ?? index,
      type: action.type ?? null,
      at,
      duration,
      state: snapshot(state, at, fired),
    });
  });

  return { frames, durationMs: at, state: snapshot(state, at, fired) };
}
