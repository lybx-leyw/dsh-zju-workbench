/**
 * **只给浏览器**的入口：纯函数，零 `node:` 依赖。
 *
 * # 为什么要单独一个入口
 *
 * `@lybx-leyw/dsh-zju-core-planning` 的包入口（`src/index.js`）里既有纯逻辑，
 * 也有两个**读写文件**的存储（`schedule.js` / `ticks.js`，都 `import 'node:fs'`）。
 *
 * 页面的客户端半边（`client.jsx`）需要的是纯逻辑（时区、日历、pet 协议），
 * 但如果它 import 包入口，esbuild 会顺着 re-export 把 `node:fs` 一起解析进来，
 * **打进浏览器产物** —— 后果是进「规划」页当场白屏，而构建往往是绿的
 * （esbuild 对 node 内置模块只警告）。这是一条真实踩过的坑。
 *
 * 所以：客户端一律 import 这个子路径，它只导出**确定不含 node: 的东西**。
 * `tests/page-isolation.test.mjs` 会核对这一点。
 */

export {
  ZONE, URGENCY, URGENCY_LABEL, FOCUS_ORDER, FOCUS_LABEL,
  focusOf, isNewArrival, focusSummary, atShanghai, nextWeekday, dateTable,
  buildMonthCalendar, quickTimes, urgencyOf, dayKey, dayLabel, looksLikeSeconds,
} from './time.js';

export {
  taskKeyFor, toShanghaiLocal, fromShanghaiLocal, shanghaiDate, addDays,
  weekStart, overlaps, overlappingIds, isAfterDue, groupWeek,
} from './agenda.js';

export {
  LOCAL_FIELDS, SERVER_FIELDS, REPEAT_UNITS, REPEAT_LABEL, REPEAT_ANCHOR,
  REPEAT_DAY_FIELD, LOCAL_INPUT_FIELDS, normalizeRepeat, normalizeLocalInput,
  localError, newId, advanceBy, originalDayOf, nextOccurrence, createLocal,
  createSplit, patchLocal, setDone, recallGenerated,
} from './local.js';

export {
  MAX_MESSAGE, MAX_HISTORY, REPLY_FIELDS, ACTIONS, scheduleDraftItems,
  resolveScheduleReply, createPetPrompt, normalizeReply, readPetResponse,
  createStreamParser, trimHistory,
} from './pet.js';

export { buildPlanningFacts, answerScheduleStatus } from './pet-context.js';
export { createPetStream } from './pet-stream.js';
export {
  WINDOW_BACK, WINDOW_FORWARD, shanghaiToday, shiftDate, hintWindow, scheduleHint,
} from './schedule-hint.js';
export { errorText } from './error.js';
export {
  FOCUS_STORAGE_KEY, focusElementId, readFocus, clearFocus, focusDecision,
} from './focus.js';
