// 源：ref/OpenMAIC/lib/choreography/timing.ts:1-121
/**
 * 播放/演出节奏表。逐字搬运，不改数值。
 *
 * 源：ref/OpenMAIC/lib/choreography/timing.ts:1-121
 *
 * 为什么领域包也要这份表：`run()` 产出的事件流要带「这一步多久」的时长提示
 * （页面与导出器共用同一个数），如果这里再写一套字面量，导出的视频会与播放器
 * 无声漂开 —— 上游该文件的头注说的就是这件事。
 */

// ==================== Effect / scene timing ====================

/** Duration (ms) a fire-and-forget effect (spotlight/laser) stays before auto-clearing. */
export const EFFECT_AUTO_CLEAR_MS = 5000;

/** Delay (ms) before a discussion trigger shows its ProactiveCard (lets prior speech finish). */
export const DISCUSSION_TRIGGER_DELAY_MS = 3000;

/** Duration (ms) the ProactiveCard counts down in playback mode before it auto-skips. */
export const DISCUSSION_AUTO_SKIP_MS = 5000;

/** Safety cap (ms) on how long playback waits for a video to finish. */
export const MAX_VIDEO_WAIT_MS = 5 * 60 * 1000;

// ==================== Whiteboard / widget action durations ====================

/** wb_open — open animation (slow spring). */
export const WB_OPEN_MS = 2000;

/** wb_draw_* (text/shape/chart/latex/table/line) — element fade-in. */
export const WB_DRAW_MS = 800;

/** wb_edit_code — line-level edit animation. */
export const WB_EDIT_MS = 600;

/** wb_delete — element removal. */
export const WB_DELETE_MS = 300;

/** wb_close — close animation (ease-out tween). */
export const WB_CLOSE_MS = 700;

/** widget_* interactions (highlight/setState/annotation/reveal). */
export const WIDGET_MS = 300;

/** wb_draw_code — typing animation: base 800ms + 50ms/line, capped at 3000ms. */
export function wbDrawCodeMs(lineCount) {
  return Math.min(800 + lineCount * 50, 3000);
}

/** wb_clear — clear animation: base 380ms + 55ms/element, capped at 1400ms. */
export function wbClearMs(elementCount) {
  return Math.min(380 + elementCount * 55, 1400);
}

// ==================== No-audio narration estimate ====================

const CJK_REGEX = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/g;

const CJK_RATIO_THRESHOLD = 0.3;

const MIN_READING_MS = 2000;

const CJK_MS_PER_CHAR = 150;

const NON_CJK_MS_PER_WORD = 240;

/**
 * Estimate how long narration takes to "speak" when no pre-generated audio is
 * available (TTS disabled).
 *
 * @param {string} text
 * @param {{ speed?: number }} [opts]
 */
export function estimateSpeechDurationMs(text, opts) {
  const speed = opts?.speed ?? 1;
  const cjkCount = (text.match(CJK_REGEX) || []).length;
  const isCJK = cjkCount > text.length * CJK_RATIO_THRESHOLD;
  const rawMs = isCJK
    ? Math.max(MIN_READING_MS, text.length * CJK_MS_PER_CHAR)
    : Math.max(MIN_READING_MS, text.split(/\s+/).filter(Boolean).length * NON_CJK_MS_PER_WORD);
  return rawMs / speed;
}

/**
 * 单个动作的阻塞时长（与 `lib/action/engine.ts` 的 `delay(...)` 调用点一一对应）。
 * 源：ref/OpenMAIC/lib/choreography/timing.ts:38-96（数值）与
 *     ref/OpenMAIC/lib/action/engine.ts:456-868（哪个动作等多久）。
 */
export function actionDurationMs(actionName, params = {}, whiteboard = {}) {
  switch (actionName) {
    case 'spotlight':
    case 'laser':
      return 0; // fire-and-forget，靠 EFFECT_AUTO_CLEAR_MS 自动清
    case 'wb_open':
      return WB_OPEN_MS;
    case 'wb_draw_text':
    case 'wb_draw_shape':
    case 'wb_draw_chart':
    case 'wb_draw_latex':
    case 'wb_draw_table':
    case 'wb_draw_line':
      return WB_DRAW_MS;
    case 'wb_draw_code':
      return wbDrawCodeMs(String(params.code ?? '').split('\n').length);
    case 'wb_edit_code':
      return WB_EDIT_MS;
    case 'wb_delete':
      return WB_DELETE_MS;
    case 'wb_clear':
      return wbClearMs(Number(whiteboard.visibleElementCount ?? 0));
    case 'wb_close':
      return WB_CLOSE_MS;
    case 'widget_highlight':
    case 'widget_setState':
    case 'widget_annotation':
    case 'widget_reveal':
      return WIDGET_MS;
    default:
      return 0;
  }
}
