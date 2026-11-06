/**
 * 导出层用到的全部界面文案。
 *
 * 源：ref/OpenMAIC/lib/i18n/locales/en-US.json（export.placeholder.* / export.htmlPlayer.*）
 *     ref/OpenMAIC/lib/i18n/locales/zh-CN.json（同上）
 *
 * 上游在客户端按 locale 取 `t()`；导出层是服务端方法，没有 i18n runtime，所以把
 * 这两组 key 原样落成本模块的数据表。`{{name}}` 插值是上游用到的全部形态；缺 key
 * 时回落英文，再缺就返回 key 本身 —— 占位页文案不该让导出失败。
 */

export const STRINGS = {
  "en": {
    "placeholder": {
      "interactiveLabel": "Interactive",
      "quizLabel": "Quiz",
      "interactiveDesc": "Interactive web page. Open it online or scan the QR code.",
      "quizDesc": "Quiz scene. Answers are not included in this deck.",
      "quizQuestionCount": "Questions: {{count}}",
      "openOnline": "Open online",
      "openOffline": "Open offline copy",
      "offlineHint": "works when this deck stays in the extracted Resource Pack folder",
      "pblLabel": "Project",
      "pblDesc": "Project-based activity with AI roles. Open it online or scan the QR code.",
      "pblGoal": "Goal: {{goal}}",
      "pblMilestoneCount": "Milestones: {{count}}"
    },
    "htmlPlayer": {
      "previous": "Previous",
      "next": "Next",
      "scenes": "Scenes",
      "fullscreen": "Fullscreen",
      "exitFullscreen": "Exit fullscreen",
      "emptyClassroom": "This classroom has no scenes.",
      "unsupportedScene": "This scene isn't available in the offline export.",
      "interactiveTitle": "Interactive scene",
      "videoUnavailable": "Video isn't included in the offline export",
      "quizSubmit": "Submit",
      "quizRetry": "Try again",
      "quizScore": "Score",
      "quizCorrect": "Correct",
      "quizIncorrect": "Incorrect",
      "quizCorrectAnswer": "Correct answer",
      "quizExplanation": "Explanation",
      "quizReferenceAnswer": "Reference answer",
      "quizNoReferenceAnswer": "No reference answer is available for this question.",
      "quizAnswerPlaceholder": "Type your answer...",
      "quizMultipleHint": "Select all that apply",
      "pblScenario": "Scenario",
      "pblGoal": "Goal",
      "pblYourRole": "Your role",
      "pblCharacters": "Characters",
      "pblLearningObjective": "Learning objective",
      "pblMilestones": "Milestones",
      "pblOnlineOnly": "Working through the project with AI agents is only available in the online classroom.",
      "pblContinueOnline": "Continue this project online",
      "play": "Play",
      "pause": "Pause",
      "playbackStart": "Play classroom",
      "playbackContinue": "Continue",
      "captions": "Captions",
      "discussionTitle": "Discussion",
      "discussionContinueOnline": "Discuss this in the online classroom",
      "discussionDismiss": "Close",
      "linkedFilesUnavailable": "Some images, narration or video couldn't be loaded. If you opened classroom.html from inside the ZIP, extract the whole ZIP first.",
      "scriptRequired": "This classroom needs JavaScript. Open this file in a web browser with JavaScript enabled, such as Safari or Chrome.",
      "startFailed": "This classroom couldn't start. Try opening this file in another web browser, such as Safari or Chrome."
    }
  },
  "zh": {
    "placeholder": {
      "interactiveLabel": "互动页面",
      "quizLabel": "测验",
      "interactiveDesc": "互动网页。点击按钮在线打开，或扫描二维码。",
      "quizDesc": "测验场景。本 PPT 不包含答案。",
      "quizQuestionCount": "题目数：{{count}}",
      "openOnline": "在线打开",
      "openOffline": "打开离线副本",
      "offlineHint": "需将本 PPT 保留在解压后的教学资源包文件夹中",
      "pblLabel": "项目式学习",
      "pblDesc": "由 AI 角色参与的项目式学习活动。点击按钮在线打开，或扫描二维码。",
      "pblGoal": "目标：{{goal}}",
      "pblMilestoneCount": "里程碑数：{{count}}"
    },
    "htmlPlayer": {
      "previous": "上一页",
      "next": "下一页",
      "scenes": "场景",
      "fullscreen": "全屏",
      "exitFullscreen": "退出全屏",
      "emptyClassroom": "该课堂没有任何场景。",
      "unsupportedScene": "离线导出暂不支持此场景。",
      "interactiveTitle": "互动场景",
      "videoUnavailable": "离线导出不包含视频",
      "quizSubmit": "提交",
      "quizRetry": "重新作答",
      "quizScore": "得分",
      "quizCorrect": "正确",
      "quizIncorrect": "错误",
      "quizCorrectAnswer": "正确答案",
      "quizExplanation": "解析",
      "quizReferenceAnswer": "参考答案",
      "quizNoReferenceAnswer": "此题暂无参考答案。",
      "quizAnswerPlaceholder": "输入你的答案...",
      "quizMultipleHint": "可多选",
      "pblScenario": "情境",
      "pblGoal": "目标",
      "pblYourRole": "你的角色",
      "pblCharacters": "角色",
      "pblLearningObjective": "学习目标",
      "pblMilestones": "里程碑",
      "pblOnlineOnly": "与 AI 智能体协作完成项目仅在在线课堂中可用。",
      "pblContinueOnline": "在线继续此项目",
      "play": "播放",
      "pause": "暂停",
      "playbackStart": "播放课堂",
      "playbackContinue": "继续",
      "captions": "字幕",
      "discussionTitle": "讨论",
      "discussionContinueOnline": "在在线课堂中参与讨论",
      "discussionDismiss": "关闭",
      "linkedFilesUnavailable": "部分图片、旁白或视频无法加载。如果你是在 ZIP 内直接打开 classroom.html 的，请先完整解压 ZIP。",
      "scriptRequired": "此课堂需要 JavaScript。请在已启用 JavaScript 的网页浏览器（如 Safari 或 Chrome）中打开此文件。",
      "startFailed": "此课堂无法启动。请尝试用其他网页浏览器（如 Safari 或 Chrome）打开此文件。"
    }
  }
};

const FALLBACK_LANG = 'en';
const SUPPORTED = Object.keys(STRINGS);

/** 把 `zh-CN` / `zh_Hans` 这类标签折到本模块收录的语言。 */
export function resolveLang(lang) {
  if (!lang) return FALLBACK_LANG;
  const text = String(lang);
  const exact = SUPPORTED.find((code) => code.toLowerCase() === text.toLowerCase());
  if (exact) return exact;
  const base = text.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.find((code) => code.toLowerCase().split('-')[0] === base) ?? FALLBACK_LANG;
}

function lookup(lang, scope, key) {
  const table = STRINGS[resolveLang(lang)] ?? STRINGS[FALLBACK_LANG];
  return table?.[scope]?.[key];
}

/** `{{name}}` 插值（与上游 i18n 的占位符写法一致）。 */
function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** 占位页文案（export.placeholder.*）。 */
export function placeholderText(lang, key, vars) {
  const value = lookup(lang, 'placeholder', key);
  return value === undefined ? key : interpolate(value, vars);
}

/** 离线播放器文案（export.htmlPlayer.*）。 */
export function playerText(lang, key, vars) {
  const value = lookup(lang, 'htmlPlayer', key);
  return value === undefined ? key : interpolate(value, vars);
}

/** 播放器整套文案：`<script id="openmaic-player-config">` 里携带的对象。 */
const PLAYER_KEYS = [
  'previous',
  'next',
  'scenes',
  'fullscreen',
  'exitFullscreen',
  'emptyClassroom',
  'unsupportedScene',
  'interactiveTitle',
  'videoUnavailable',
  'quizSubmit',
  'quizRetry',
  'quizScore',
  'quizCorrect',
  'quizIncorrect',
  'quizCorrectAnswer',
  'quizExplanation',
  'quizReferenceAnswer',
  'quizNoReferenceAnswer',
  'quizAnswerPlaceholder',
  'quizMultipleHint',
  'pblScenario',
  'pblGoal',
  'pblYourRole',
  'pblCharacters',
  'pblLearningObjective',
  'pblMilestones',
  'pblOnlineOnly',
  'pblContinueOnline',
  'play',
  'pause',
  'playbackStart',
  'playbackContinue',
  'captions',
  'discussionTitle',
  'discussionContinueOnline',
  'discussionDismiss',
  'linkedFilesUnavailable',
  'scriptRequired',
  'startFailed',
];

/** 源：standalone-html/contract.ts:81-121 —— STANDALONE_PLAYER_STRING_KEYS 的同一组字段。 */
export function playerStrings(lang) {
  return Object.fromEntries(PLAYER_KEYS.map((key) => [key, playerText(lang, key)]));
}
