// 课堂智能体编排的客户端入口。
//
// 与 `dsh-zhiyun-core-playback/src/client.jsx` 同一形态：只把**浏览器要用的纯函数**
// 暴露出去（动作描述、允许集、话术清洗、发言调度），页面用 external import 在运行时
// 拿到它们；宿主侧仍走 `ctx.zhiyunClassroomAgent`。两边共用同一份实现，不各写一份。
//
// ⚠️ 重建清单（`scripts/build.mjs` 的 CLIENT_PACKAGES）由仓库统一登记，本包不自登。
export const name = 'zhiyun-classroom-agent-client';
export const inject = [];
export function apply() {}

export { getActionsForRole, getBuiltInAgent, resolveRoster } from './roles.js';
export {
  getEffectiveActions,
  normalizeActionItem,
  availableActionsFor,
  ACTION_PARAM_SCHEMAS,
  SLIDE_ONLY_ACTIONS,
  describeAction,
} from './actions.js';
export {
  sanitizeVisibleSpeech,
  createVisibleSpeechDeltaSanitizer,
  getActionDescriptions,
  getChildHardCap,
  buildChildTurnPrompt,
} from './prompts.js';
export { scheduleTurn, validateSchedule, selectFirstSpeaker } from './scheduling.js';
export { actionDurationMs, estimateSpeechDurationMs } from './timing.js';
