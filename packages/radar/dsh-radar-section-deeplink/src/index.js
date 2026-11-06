/**
 * dsh-radar-section-deeplink —— **对照物**，不是候选包。
 * ⚠ 未评审、未接入 profile、**不可挂载**（`apply()` 会抛错）。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 *
 * ── 为什么这个包存在 ────────────────────────────────────────────────
 *
 * 第五十轮（2026-10-22）的起点是一个假设：**「笔记里的跨节链接跳不过去」是本仓的断环**。
 * 读码之后，假设被推翻了一条、又被确认了一条：
 *
 *   ❌ 推翻：「漏了一个 case」。`packages/dsh-zhiyun-page-study/README.md:14` 明写
 *        「另一节的链接留在原地并说明跳不过去」，`tests/study.test.mjs:242` 还有断言
 *        → 这是**设计决定**，不是遗漏。
 *
 *   ✅ 确认：即便想做，也**做不了**，因为缺的是**入口**而不是**能力**：
 *        能力：`study-core/src/model.js:350-363`（`loadRecent`）已有
 *              `loadCourse(course)` → `selectLesson(lesson, course)` 的**跨课载入先例**。
 *        入口：`shell/src/client.jsx:48` 的 `navigate(id)` **只收页面 id、不收参数**；
 *              全仓页面侧无一处消费 `location.search` / `URLSearchParams`。
 *        注册位：`shell/src/client.jsx:143` 每页内容槽是 `kind: 'single'`，
 *              **没有第二个位置**给"接管跳转"用。
 *
 * ── 为什么不出 🟢 候选 ─────────────────────────────────────────────
 *
 * 「强化式集成」三条判据，第 1 条与第 3 条**同时不成立**：
 *   1. 不是同一个面板：「跳过去」= 换掉当前节，而学习页的**视频栏读的就是** `state.content`；
 *      `selectLesson()`（`model.js:112`）切节时会把 `content` 等 13 个字段清成 `null`
 *      → 播放中的视频被掐断。
 *   3. 没有更优底层：`parseZySectionUri()`（`notes/src/note.js:197-240`）
 *      已经能解析 `zy://section/<课>/<节>?page=&t=`，并能报 `BAD_SECTION_LINK`；
 *      **缺的是消费方，不是解析器**。接任何上游库都是"第二套解析器"，纯增益为负。
 *
 * ── TODO（评审通过后再动，本轮一律不实现）──────────────────────────
 *
 *  TODO-0 【阻塞项 · 在壳里，不在本包】给 `zhiyunNavigation.navigate()` 加第二参数
 *          `{ courseId, subId, page?, atSec? }`，或开一个 `zhiyun.study.content` 之外的
 *          单点槽位。**两件事都在 `dsh-zhiyun-shell` 里** —— 候选包改不了。
 *
 *  TODO-1 裁定形态（**这一步是产品决策，不是技术决策**）：
 *          (a) 就地切节 —— ❌ 会掐断播放，不建议；
 *          (b) 侧栏画中画 / 新标签打开目标节 —— 两节各持一份 `state.content`，
 *              但已经**超出「同一个面板」的范围**，属新功能；
 *          (c) 保持现状（就地说明）+ 只把「另一节」三个字换成可点的链接
 *              —— 成本最低，但 `tests/study.test.mjs:242` 的断言要先改。
 *
 *  TODO-2 若走 (b)：`selectLesson` 的 `selection` ticket 与 `state.content` 必须
 *          从"全局单份"改成"按节键存"，否则两条节会互相抢 ticket。
 *
 *  TODO-3 若走 (b)：播放器（`video-panel.jsx`）只允许**一份**是主播放，
 *          另一份必须静音且不抢 `hls` 实例（`hls.js` 是单例式的）。
 *
 *  TODO-4 §「掐断播放」是**读码推断**（`selectLesson` 清 `content` + 视频栏读
 *          `state.content`），**未实跑**。评审若要引用，需先补一条实跑用例。
 */

export const name = 'radar-section-deeplink';

/**
 * 占位入口。**不可挂载**：本骨架没有实现，挂上去只会让宿主以为有一项能力。
 *
 * 抛错而不是静默 no-op：静默 no-op 会被 profile:check 判为"已启用"，
 * 而它实际什么都不做 —— 这正是本仓「不许静默失败」要避免的形状。
 */
export function apply() {
  throw new Error(
    'dsh-radar-section-deeplink 是对照物（未评审、未接入），不可挂载。'
    + '它要说明的是：跨节深链缺的是壳的入口参数（TODO-0），不是上游库。'
  );
}

/** 给评审看的「我打算做什么 / 卡在哪」，不注册任何路由、不注入任何 UI。 */
export function describe() {
  return {
    status: 'contrast-object',
    reviewed: false,
    wiredIntoProfile: false,
    mountable: false,
    upstream: null, // B 类：零上游依赖
    blocking: 'TODO-0（壳的 navigate 参数化）—— 在本仓 dsh-zhiyun-shell 里',
    verdict: '不构成 🟢：判据 1（同一面板）与判据 3（更优底层）同时不成立',
    todos: [0, 1, 2, 3, 4].map((n) => `TODO-${n}`),
  };
}
